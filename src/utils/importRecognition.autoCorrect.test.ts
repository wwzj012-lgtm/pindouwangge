import { describe, expect, it } from 'vitest';
import type { BeadColor } from '../types';
import type { ImportGridCalibration } from './importGridCalibration';
import { recognizeImportImage } from './importRecognition';
import type { ImportImagePixels } from './importRecognition';

/**
 * 自动校正的验收用例。
 *
 * 三项能力各有明确的适用条件，所以测试也必须成对：**开关打开时确实变好、
 * 关闭时确实更差**——否则这套机制只是看起来存在。另外每一项都配了"不该动"的
 * 反向用例，因为过去两轮的教训是"多做一步"比"少做一步"更容易把结果改坏。
 */

const calibration = (columns: number, rows: number, cell: number, originX = 0, originY = 0): ImportGridCalibration => ({
  originX, originY, cellWidth: cell, cellHeight: cell, columns, rows,
});

type Rgb = [number, number, number];

function buildImage(width: number, height: number, paint: (x: number, y: number) => Rgb): ImportImagePixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

const intensity = (value: number, light: number) => Math.min(255, Math.max(0, Math.round(value * light)));

const bead = (id: string, rgb: Rgb): BeadColor => ({
  id, code: id.toUpperCase(), name: id, hex: `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`, rgb, brand: 'CUSTOM',
});

describe('color cast correction (opt-in)', () => {
  // 两支只差一点点的灰：偏色时浅灰会被推到暖灰上，正是要修的那个错。
  const palette: BeadColor[] = [
    bead('grey', [150, 150, 150]),
    bead('warmgrey', [172, 158, 142]),
    bead('navy', [31, 58, 86]),
    bead('white', [215, 215, 213]),
    bead('black', [26, 26, 28]),
  ];
  const cells: string[] = [
    'white', 'white', 'grey', 'warmgrey',
    'grey', 'warmgrey', 'white', 'white',
    'grey', 'grey', 'warmgrey', 'warmgrey',
    'white', 'grey', 'warmgrey', 'white',
  ];
  const colorOf = new Map(palette.map(color => [color.id, color.rgb]));
  // 暖光：红多一点、蓝少一点（通道不等才是色偏；三通道同比例放大只是曝光）
  const cast: Rgb = [1.1, 1.0, 0.9];

  const image = buildImage(64, 64, (x, y) => {
    const id = cells[Math.floor(y / 16) * 4 + Math.floor(x / 16)];
    const [r, g, b] = colorOf.get(id) as Rgb;
    return [
      Math.min(255, Math.round(r * cast[0])),
      Math.min(255, Math.round(g * cast[1])),
      Math.min(255, Math.round(b * cast[2])),
    ];
  });

  it('recovers the true codes when the correction is switched on', () => {
    const result = recognizeImportImage(image, calibration(4, 4, 16), palette, 'precision', 24, { autoColorBalance: true });
    expect(result.cells.flat().map(cell => cell.color?.code)).toEqual(cells.map(id => id.toUpperCase()));
    expect(result.autoCorrection?.colorGains).not.toBeNull();
  });

  it('misreads the grey cells when it is switched off (the default)', () => {
    const result = recognizeImportImage(image, calibration(4, 4, 16), palette, 'precision', 24);
    expect(result.autoCorrection?.colorGains).toBeNull();
    expect(result.cells.flat().map(cell => cell.color?.code)).not.toEqual(cells.map(id => id.toUpperCase()));
  });

  it('leaves a neutral picture untouched even when enabled', () => {
    const neutral = buildImage(64, 64, (x, y) => colorOf.get(cells[Math.floor(y / 16) * 4 + Math.floor(x / 16)]) as Rgb);
    const result = recognizeImportImage(neutral, calibration(4, 4, 16), palette, 'precision', 24, { autoColorBalance: true });
    expect(result.autoCorrection?.colorGains).toBeNull();
    expect(result.cells.flat().map(cell => cell.color?.code)).toEqual(cells.map(id => id.toUpperCase()));
  });
});

describe('global grid offset correction (opt-in)', () => {
  const palette: BeadColor[] = [
    bead('red', [220, 30, 30]),
    bead('green', [30, 200, 30]),
    bead('blue', [40, 40, 220]),
    bead('yellow', [230, 210, 40]),
  ];
  const cellSize = 10;
  const columns = 8;
  const rows = 8;
  const drift = 1.6; // 整张图向右偏 0.16 格：校准框与真实网格错开

  const grid = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => palette[(row * 3 + column * 5) % palette.length].rgb));

  const image = buildImage(columns * cellSize, rows * cellSize, (x, y) => {
    const column = Math.max(0, Math.min(columns - 1, Math.floor((x - drift) / cellSize)));
    const row = Math.min(rows - 1, Math.floor(y / cellSize));
    return grid[row][column];
  });

  it('snaps the whole grid when every cell is shifted the same way', () => {
    const result = recognizeImportImage(image, calibration(columns, rows, cellSize), palette, 'precision', 24, { autoAlign: true });
    expect(result.autoCorrection?.gridOffset.x).not.toBe(0);
    // 图纸整体右移，采样窗口也要跟着右移
    expect(result.autoCorrection?.gridOffset.x).toBeGreaterThan(0);
    expect(result.summary.meanConfidence ?? 0).toBeGreaterThan(0.95);
  });

  it('stays put by default even when the grid is off by a fraction of a cell', () => {
    const result = recognizeImportImage(image, calibration(columns, rows, cellSize), palette, 'precision', 24);
    expect(result.autoCorrection?.gridOffset).toEqual({ x: 0, y: 0 });
    expect(result.summary.meanConfidence ?? 0).toBeLessThan(0.92);
  });

  it('does not invent an offset on an already aligned image', () => {
    const aligned = buildImage(columns * cellSize, rows * cellSize, (x, y) => grid[Math.floor(y / cellSize)][Math.floor(x / cellSize)]);
    const result = recognizeImportImage(aligned, calibration(columns, rows, cellSize), palette, 'precision', 24, { autoAlign: true });
    expect(result.autoCorrection?.gridOffset).toEqual({ x: 0, y: 0 });
    expect(result.summary.meanConfidence ?? 0).toBeGreaterThan(0.99);
  });
});

describe('bead photo mode (holes, glare, underexposure)', () => {
  // 拍一张拼好的豆板：整体偏暗（手机自动曝光偏低）、每格亮度还不一样、
  // 珠子中心有孔、孔右上有反光，另有轻微的压缩噪声。
  const palette: BeadColor[] = [
    bead('white', [236, 236, 233]),
    bead('light', [198, 206, 214]),
    bead('mid', [146, 154, 163]),
    bead('dark', [74, 85, 96]),
    bead('navy', [31, 58, 86]),
    bead('black', [26, 26, 28]),
    bead('red', [186, 54, 44]),
  ];
  const cell = 14;
  const columns = 12;
  const rows = 12;
  const pattern = ['white', 'light', 'light', 'mid', 'mid', 'dark', 'dark', 'navy', 'navy', 'black', 'red', 'white'];
  const grid = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => pattern[(row * 5 + column * 3) % pattern.length]));
  const colorOf = new Map(palette.map(color => [color.id, color.rgb]));

  const image = buildImage(columns * cell, rows * cell, (x, y) => {
    const column = Math.floor(x / cell);
    const row = Math.floor(y / cell);
    const [r, g, b] = colorOf.get(grid[row][column]) as Rgb;
    // 每格曝光不同，整体偏暗 7%~16%
    const light = 0.84 + ((row * 3 + column * 5) % 4) * 0.03;
    const lx = (x % cell) - cell / 2 + 0.5;
    const ly = (y % cell) - cell / 2 + 0.5;
    // 珠子中间的孔：偏黑
    if (Math.hypot(lx, ly) <= cell * 0.24) return [Math.round(20 * light), Math.round(20 * light), Math.round(23 * light)];
    // 孔右上的一点反光
    if (lx > 0 && lx < 3 && ly < -1 && ly > -4) return [intensity(246, light), intensity(246, light), intensity(243, light)];
    const noise = ((x * 7 + y * 13) % 9) - 4;
    return [
      Math.max(0, Math.min(255, Math.round(r * light) + noise)),
      Math.max(0, Math.min(255, Math.round(g * light) + noise)),
      Math.max(0, Math.min(255, Math.round(b * light) + noise)),
    ];
  });

  const expected = grid.flat().map(id => id.toUpperCase());

  const recognize = (options?: Parameters<typeof recognizeImportImage>[5]) => {
    const result = recognizeImportImage(image, calibration(columns, rows, cell), palette, 'precision', 24, options);
    const got = result.cells.flat().map(cellResult => cellResult.color?.code ?? '—');
    const hits = got.filter((code, index) => code === expected[index]).length;
    return { accuracy: hits / expected.length, result };
  };

  it('beats plain matching once bead photo mode is on', () => {
    const plain = recognize();
    const beadPhoto = recognize({ beadPhoto: true });
    // 不归一曝光时整片各暗一档：白→浅灰、浅灰→中灰，正是用户看到的那类错。
    expect(plain.accuracy).toBeLessThan(0.9);
    expect(beadPhoto.accuracy).toBeGreaterThan(plain.accuracy);
    expect(beadPhoto.accuracy).toBeGreaterThan(0.95);
    // 曝光归一本身也要能被解释：增益必须是把画面提亮
    expect(beadPhoto.result.autoCorrection?.colorGains).not.toBeNull();
    expect(beadPhoto.result.autoCorrection!.colorGains!.g).toBeGreaterThan(1.05);
  });

  it('is off by default', () => {
    const { result } = recognize();
    expect(result.autoCorrection?.colorGains).toBeNull();
    expect(result.autoCorrection?.gridOffset).toEqual({ x: 0, y: 0 });
  });
});
