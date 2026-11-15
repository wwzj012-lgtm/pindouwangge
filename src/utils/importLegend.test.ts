import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BeadColor } from '../types';
import { annotateCountClusters, debugLegendParse, parseLegend } from './importLegend';
import type { ImportGridCalibration } from './importGridCalibration';
import type { ImportImagePixels } from './importRecognition';

/**
 * 图例解析测试。
 *
 * 合成 fixture 用程序化位图字体画"色点 + 色号 + NNN粒"，验证
 * 分段 / 色点先验 / 全局一致性求解 / 粒数识别的端到端正确性；
 * 另按设计文档四机制补对抗用例：①点色先验错但全局求解纠正
 * ②粘连数字切片回收 ③计数簇 EM 自纠（导出纯函数直测）
 * ④浅色点低阈值补搜；water-box.jpg 集成断言（存在时）用
 * benchmark/water-box.legend.json 的真值量化命中率。
 */

// ---- 合成 fixture 的位图字体（5×7）与绘制工具 ----

const GLYPHS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  '4': ['#..#.', '#..#.', '#..#.', '#####', '...#.', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#...#', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '..#..', '..#..', '..#..'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '#...#', '.###.'],
  // 「粒」：致密 CJK 块（宽 11，明显比数字宽 → splitEntry 按"粒"后缀剥离）
  粒: [
    '###########',
    '#.##.##.##.',
    '##.#####.##',
    '###########',
    '#.##.##.##.',
    '##.#####.##',
    '#.##.##.##.',
    '###########',
  ],
};

const INK: [number, number, number] = [60, 70, 90];

interface FixtureEntry {
  code: string;
  count: number;
  rgb: [number, number, number];
  /** 粒数字符粘连印刷（字距 7px < 粗体 8px 步进），触发宽块切片回收。 */
  sticky?: boolean;
}

function drawLegend(entries: FixtureEntry[], width: number, height: number, legendTop: number): ImportImagePixels {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const set = (x: number, y: number, rgb: [number, number, number]) => {
    const i = (y * width + x) * 4;
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  };
  let x = 8;
  for (const entry of entries) {
    // 色点：实心圆 r=4
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        if (dx * dx + dy * dy <= 16) set(x + 4 + dx, legendTop + 6 + dy, entry.rgb);
      }
    }
    x += 12;
    // 色号（粗体：5×7 放粗 1px → 6 宽）
    for (const ch of entry.code) {
      const glyph = GLYPHS[ch];
      for (let gy = 0; gy < glyph.length; gy += 1) {
        for (let gx = 0; gx < glyph[gy].length; gx += 1) {
          if (glyph[gy][gx] === '#') {
            set(x + gx, legendTop + gy, INK);
            set(x + gx + 1, legendTop + gy, INK); // 粗体
          }
        }
      }
      x += 8;
    }
    x += 5; // code|count 空格
    // 粒数（与色号同字重，5×7 粗体 → 6 宽）；sticky 时字距 7px 使相邻
    // 数字笔画相接 → 连通域合并成一个宽块（粘连数字切片回收的对立面输入）。
    for (const ch of String(entry.count)) {
      const glyph = GLYPHS[ch];
      for (let gy = 0; gy < glyph.length; gy += 1) {
        for (let gx = 0; gx < glyph[gy].length; gx += 1) {
          if (glyph[gy][gx] === '#') {
            set(x + gx, legendTop + gy, INK);
            set(x + gx + 1, legendTop + gy, INK);
          }
        }
      }
      x += entry.sticky ? 7 : 8;
    }
    x += 3;
    // 「粒」
    for (let gy = 0; gy < GLYPHS.粒.length; gy += 1) {
      for (let gx = 0; gx < GLYPHS.粒[gy].length; gx += 1) {
        if (GLYPHS.粒[gy][gx] === '#') set(x + gx, legendTop + gy, INK);
      }
    }
    x += 9;
    x += 30; // 条目间距（远大于字内间隙）
  }
  return { data, width, height };
}

const PALETTE: BeadColor[] = [
  { id: 'c15', code: 'C15', name: '天蓝', hex: '#3366cc', rgb: [51, 102, 204], brand: 'CUSTOM' },
  { id: 'd24', code: 'D24', name: '橘橙', hex: '#cc6633', rgb: [204, 102, 51], brand: 'CUSTOM' },
  { id: 'f3', code: 'F3', name: '明黄', hex: '#eea936', rgb: [238, 169, 54], brand: 'CUSTOM' },
];

const CALIBRATION: ImportGridCalibration = {
  originX: 4, originY: 4, cellWidth: 12, cellHeight: 12, columns: 24, rows: 24,
};

function fixturePixels(): ImportImagePixels {
  // 网格底边 = 4 + 24×12 = 292；图例带在 340 行起
  return drawLegend(
    [
      { code: 'C15', count: 51, rgb: [51, 102, 204] },
      { code: 'D24', count: 242, rgb: [204, 102, 51] },
      { code: 'F3', count: 33, rgb: [238, 169, 54] },
    ],
    420, 380, 340,
  );
}

describe('parseLegend', () => {
  it('parses a synthetic 3-entry legend completely (codes + counts)', () => {
    const result = parseLegend(fixturePixels(), CALIBRATION, PALETTE, { gridRows: 24, gridCols: 24 });
    expect(result.ok).toBe(true);
    expect(result.entries.map(entry => entry.code)).toEqual(['C15', 'D24', 'F3']);
    expect(result.entries.map(entry => entry.count)).toEqual([51, 242, 33]);
    expect(result.checks.codesInPalette).toBe(true);
    expect(result.checks.codesUnique).toBe(true);
    expect(result.checks.sumWithinGrid).toBe(true);
    expect(result.checks.sumCount).toBe(51 + 242 + 33);
  });

  it('is deterministic across repeated parses', () => {
    const pixels = fixturePixels();
    const first = parseLegend(pixels, CALIBRATION, PALETTE, { gridRows: 24, gridCols: 24 });
    const second = parseLegend(pixels, CALIBRATION, PALETTE, { gridRows: 24, gridCols: 24 });
    expect(second).toEqual(first);
  });

  it('returns ok=false without throwing for photos without a legend band', () => {
    // 网格下方是纯色空白：没有图例条
    const width = 200;
    const height = 200;
    const data = new Uint8ClampedArray(width * height * 4).fill(250);
    const result = parseLegend({ data, width, height }, { originX: 0, originY: 0, cellWidth: 10, cellHeight: 10, columns: 20, rows: 20 }, PALETTE, { gridRows: 20, gridCols: 20 });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toBe('noLegendBand');
    expect(result.entries).toEqual([]);
  });

  it('rejects invalid calibration and empty palettes without throwing', () => {
    const pixels = fixturePixels();
    const broken: ImportGridCalibration = { originX: 0, originY: 0, cellWidth: 0, cellHeight: 0, columns: 0, rows: 0 };
    expect(parseLegend(pixels, broken, PALETTE).ok).toBe(false);
    expect(parseLegend(pixels, CALIBRATION, []).ok).toBe(false);
  });

  // ---- 对抗用例（按设计文档四机制） ----

  it('mechanism 1: a dot prior misled to the window runner-up is corrected by the global consistency solve', () => {
    // 条目 2（真值 C16）的色点误印成 C15 的颜色：先验 argmin = C15（错），
    // 但 C16 落在可信窗内（ΔE ≈ 3.7 ≤ argmin+4）。求解时 C15 先被条目 1
    // 以 ΔE 领先度定解并全局占用，条目 2 的候选只剩 C16 → 唯一解纠正。
    const misleading: [number, number, number] = [51, 102, 204];
    const pixels = drawLegend(
      [
        { code: 'C15', count: 15, rgb: [51, 102, 204] },
        { code: 'C16', count: 61, rgb: misleading },
        { code: 'D24', count: 242, rgb: [204, 102, 51] },
      ],
      420, 380, 340,
    );
    const palette: BeadColor[] = [
      { id: 'c15', code: 'C15', name: '天蓝', hex: '#3366cc', rgb: [51, 102, 204], brand: 'CUSTOM' },
      { id: 'c16', code: 'C16', name: '湖蓝', hex: '#3a70c4', rgb: [58, 112, 196], brand: 'CUSTOM' },
      { id: 'd24', code: 'D24', name: '橘橙', hex: '#cc6633', rgb: [204, 102, 51], brand: 'CUSTOM' },
    ];
    const result = parseLegend(pixels, CALIBRATION, palette, { gridRows: 24, gridCols: 24 });
    expect(result.ok).toBe(true);
    expect(result.entries.map(entry => entry.code)).toEqual(['C15', 'C16', 'D24']);
    expect(result.entries.map(entry => entry.count)).toEqual([15, 61, 242]);
    const debug = debugLegendParse(pixels, CALIBRATION, palette, { gridRows: 24, gridCols: 24 });
    expect(debug).not.toBeNull();
    expect(debug!.priors[1]?.code).toBe('C15'); // 先验被点色带偏（单条目视角会错）
    expect(debug!.resolvedCodes[1]?.code).toBe('C16'); // 全局一致性求解纠正
    expect(debug!.resolvedCodes[1]?.unique).toBe(true);
  });

  it('mechanism 2: stuck digit pairs ("77"/"15" style) are recovered by width-equal slicing', () => {
    // 两个条目的粒数用 7px 字距粘连印刷（数字笔画相接 → 单个宽块连通域），
    // 其余条目提供单字宽计数字形供数字模板自举；宽块走 round(w/digitW)
    // 等分切片回收，逐切片匹配数字模板。
    const palette: BeadColor[] = [
      { id: 'a15', code: 'A15', name: '草绿', hex: '#33a050', rgb: [51, 160, 80], brand: 'CUSTOM' },
      { id: 'b77', code: 'B77', name: '深灰', hex: '#5a5a5a', rgb: [90, 90, 90], brand: 'CUSTOM' },
      { id: 'c15', code: 'C15', name: '天蓝', hex: '#3366cc', rgb: [51, 102, 204], brand: 'CUSTOM' },
      { id: 'd24', code: 'D24', name: '橘橙', hex: '#cc6633', rgb: [204, 102, 51], brand: 'CUSTOM' },
      { id: 'f3', code: 'F3', name: '明黄', hex: '#eea936', rgb: [238, 169, 54], brand: 'CUSTOM' },
    ];
    const pixels = drawLegend(
      [
        { code: 'A15', count: 757, rgb: [51, 160, 80] },
        { code: 'B77', count: 77, rgb: [90, 90, 90], sticky: true },
        { code: 'C15', count: 771, rgb: [51, 102, 204] },
        { code: 'D24', count: 155, rgb: [204, 102, 51] },
        { code: 'F3', count: 15, rgb: [238, 169, 54], sticky: true },
      ],
      700, 380, 340,
    );
    const result = parseLegend(pixels, CALIBRATION, palette, { gridRows: 60, gridCols: 60 });
    expect(result.ok).toBe(true);
    expect(result.entries.map(entry => entry.code)).toEqual(['A15', 'B77', 'C15', 'D24', 'F3']);
    expect(result.entries.map(entry => entry.count)).toEqual([757, 77, 771, 155, 15]);
    expect(result.checks.sumWithinGrid).toBe(true);
  });

  it('mechanism 4: an anchor-failed pale dot is recovered by the low-threshold side search', () => {
    // 浅粉点 vs 白底的 RGB 距离 ≈ 59.5，低于文字掩码阈值 60 → 色点不进
    // 主连通域、条目首字形是色号字母（点锚定失败）；findPaleDot 用
    // DOT_CONTRAST=12 的低阈值掩码在首字形左侧窗口补搜命中。
    const pale: [number, number, number] = [238, 210, 220];
    const palette: BeadColor[] = [
      { id: 'p94', code: 'P94', name: '浅粉', hex: '#eed2dc', rgb: pale, brand: 'CUSTOM' },
      { id: 'c15', code: 'C15', name: '天蓝', hex: '#3366cc', rgb: [51, 102, 204], brand: 'CUSTOM' },
    ];
    const pixels = drawLegend(
      [
        { code: 'P94', count: 44, rgb: pale },
        { code: 'C15', count: 51, rgb: [51, 102, 204] },
      ],
      420, 380, 340,
    );
    const result = parseLegend(pixels, CALIBRATION, palette, { gridRows: 24, gridCols: 24 });
    expect(result.ok).toBe(true);
    expect(result.entries.map(entry => entry.code)).toEqual(['P94', 'C15']);
    expect(result.entries.map(entry => entry.count)).toEqual([44, 51]);
    const debug = debugLegendParse(pixels, CALIBRATION, palette, { gridRows: 24, gridCols: 24 });
    expect(debug).not.toBeNull();
    // dotRgb 存在且等于浅点色 → 走的是低阈值补搜分支（主掩码没看见色点）。
    expect(debug!.rawEntries[0]?.dotRgb).toEqual(pale);
    expect(debug!.rawEntries[1]?.dotRgb).toEqual([51, 102, 204]);
  });

  // ---- water-box.jpg 集成断言（文件存在时） ----

  const truthPath = 'benchmark/water-box.legend.json';
  const imagePath = 'benchmark/images/water-box.jpg';
  const hasWaterBox = existsSync(truthPath) && existsSync(imagePath);

  it.runIf(hasWaterBox)('resolves all water-box legend entries with codes constrained to the palette', async () => {
    const { default: sharp } = await import('sharp');
    const truth = JSON.parse(readFileSync(truthPath, 'utf-8')) as {
      grid: { cols: number; rows: number };
      headerColorCount: number;
      entries: Array<{ code: string; count: number }>;
    };
    const { data, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const source: ImportImagePixels = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
    const calibration: ImportGridCalibration = { originX: 276, originY: 116, cellWidth: 8.79, cellHeight: 8.79, columns: truth.grid.cols, rows: truth.grid.rows };
    const started = performance.now();
    const result = parseLegend(source, calibration, PALETTE, { gridRows: truth.grid.rows, gridCols: truth.grid.cols });
    const elapsed = performance.now() - started;
    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(27);
    expect(result.checks.sumWithinGrid).toBe(true);
    // 逐条置信度口径：错读条目必须低于阈值并带 warn，供 UI 标黄兜底。
    for (const entry of result.entries) {
      const truthEntry = truth.entries.find(item => item.code === entry.code);
      if (!truthEntry || entry.count !== truthEntry.count) {
        expect.soft(entry.confidence, `${entry.code} 错读但置信度未降级`).toBeLessThan(0.9);
      }
    }
    // 头部交叉校验字段允许缺省（可选校验），出现时应与真值一致。
    if (result.checks.headerColorCount !== undefined) {
      expect(result.checks.headerColorCount).toBe(truth.headerColorCount);
    }
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('annotateCountClusters (mechanism 3: same-font EM self-correction)', () => {
  // annotateCountClusters 是 buildCountTemplates 第 3 步的纯函数提取：
  // 跨字体 argmin 起步 + 同字体临时模板 EM 自纠。直测用手工位图，
  // 不经端到端管线（该路径在真实图例上难以从外部确定性触发）。
  interface TestBitmap { data: Uint8Array; w: number; h: number }

  const bitmapOf = (rows: string[]): TestBitmap => {
    const h = rows.length;
    const w = Math.max(...rows.map(row => row.length));
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) data[y * w + x] = rows[y][x] === '#' ? 1 : 0;
    }
    return { data, w, h };
  };
  // 代码字体（fixture 同款）：每个墨点横向加倍。
  const bolden = (rows: string[]): string[] =>
    rows.map(row => [...row].map(ch => (ch === '#' ? '##' : '.')).join(''));

  const codeDigitTemplates = new Map<string, TestBitmap>([
    ['1', bitmapOf(bolden(GLYPHS['1']))],
    ['6', bitmapOf(bolden(GLYPHS['6']))],
  ]);
  const thin6 = bitmapOf(GLYPHS['6']);
  const thin1 = bitmapOf(GLYPHS['1']);
  // '6' 变体：末行 ".###." → "#.##."（底行左移一像素）。
  // 实测 Jaccard：对代码字体 argmin = '1'（d≈0.353 < d('6')≈0.375，跨字体误标），
  // 但对同字体 thin '6' 距离仅 ≈0.111 —— EM 一轮即纠正回多数派。
  const mut6 = bitmapOf(GLYPHS['6'].map((row, y) => (y === 6 ? '#.##.' : row)));

  it('corrects a cross-font mislabeled cluster to the majority same-font label', () => {
    // 无多数派锚（thin '6' 簇不在场）：误标无法自纠，'6' 变体留在 '1'。
    expect(annotateCountClusters([[thin1], [mut6]], codeDigitTemplates)).toEqual(['1', '1']);
    // 有多数派锚：第一轮同字体临时模板把误标簇拉回 '6'（thin '1' 不受影响）。
    expect(annotateCountClusters([[thin6], [thin1], [mut6]], codeDigitTemplates)).toEqual(['6', '1', '6']);
  });

  it('is deterministic and stable once converged', () => {
    const first = annotateCountClusters([[thin6], [thin1], [mut6]], codeDigitTemplates);
    const second = annotateCountClusters([[thin6], [thin1], [mut6]], codeDigitTemplates);
    expect(second).toEqual(first);
    expect(first).toEqual(['6', '1', '6']);
  });
});
