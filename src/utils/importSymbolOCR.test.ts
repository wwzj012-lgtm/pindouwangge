import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { extractBeadSymbols } from './importSymbolOCR';
import { recognizeImportImage } from './importRecognition';
import { BRAND_PALETTES } from '../data/palettes';

const CELL = 50;

const rgbOf = (code: string): [number, number, number] => {
  const color = BRAND_PALETTES.MARD.find((c) => c.code === code);
  if (!color) throw new Error(`MARD 色板缺少 ${code}`);
  return color.rgb;
};



/**
 * 迷你 5x7 点阵字体（测试专用）：librsvg 在部分环境里没有可用系统字体，
 * SVG <text> 渲染会退化或缺失——点阵方块是跨平台确定性的。
 */
const FONT_5X7: Record<string, string[]> = {
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  '2': ['#####', '....#', '....#', '#####', '#....', '#....', '#####'],
  '4': ['#...#', '#...#', '#...#', '#####', '....#', '....#', '....#'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  G: ['#####', '#....', '#....', '#..##', '#...#', '#...#', '#####'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  '6': ['#####', '#....', '####.', '#...#', '#...#', '#...#', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  '3': ['#####', '....#', '....#', '.####', '....#', '....#', '#####'],
  C: ['#####', '#....', '#....', '#....', '#....', '#....', '#####'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
};

/** 在 SVG parts 里用 3px 方块画出点阵色号（高度 21px，格内居中）。 */
function drawCode(parts: string[], x: number, y: number, code: string) {
  const px = 2;
  const totalW = code.length * 5 * px + (code.length - 1) * px;
  let cursor = x + (CELL - totalW) / 2;
  const top = y + (CELL - 7 * px) / 2;
  for (const ch of code) {
    const glyph = FONT_5X7[ch];
    if (!glyph) { cursor += 5 * px + px; continue; }
    for (let gy = 0; gy < glyph.length; gy += 1) {
      for (let gx = 0; gx < glyph[gy].length; gx += 1) {
        if (glyph[gy][gx] === '#') {
          parts.push(`<rect x="${Math.round(cursor + gx * px)}" y="${Math.round(top + gy * px)}" width="${px}" height="${px}" fill="#222"/>`);
        }
      }
    }
    cursor += 5 * px + px;
  }
}

/** 合成一张带色号文字的图纸：白底黑网格，指定格填色并印色号。 */
async function makePattern(
  cells: Array<{ row: number; column: number; rgb: [number, number, number]; code: string }>,
  columns: number,
  rows: number,
): Promise<{ source: { data: Uint8ClampedArray; width: number; height: number }; calibration: { originX: number; originY: number; cellWidth: number; cellHeight: number; columns: number; rows: number } }> {
  const W = columns * CELL, H = rows * CELL;
  const parts: string[] = [];
  for (const c of cells) {
    parts.push(`<rect x="${c.column * CELL}" y="${c.row * CELL}" width="${CELL}" height="${CELL}" fill="rgb(${c.rgb.join(',')})"/>`);
    drawCode(parts, c.column * CELL, c.row * CELL, c.code);
  }
  for (let i = 0; i <= columns; i += 1) parts.push(`<line x1="${i * CELL}" y1="0" x2="${i * CELL}" y2="${H}" stroke="#999" stroke-width="1"/>`);
  for (let i = 0; i <= rows; i += 1) parts.push(`<line x1="0" y1="${i * CELL}" x2="${W}" y2="${i * CELL}" stroke="#999" stroke-width="1"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    source: { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height },
    calibration: { originX: 0, originY: 0, cellWidth: CELL, cellHeight: CELL, columns, rows },
  };
}

describe('extractBeadSymbols', () => {
  it('reads printed colour codes from a synthetic symbol chart', async () => {
    // 每个色号放两格：字符模板要求同标签 ≥2 个实例才建模板（防单样本污染）。
    // （不含 M13：点阵 M 的中部横线与真实字体差异大，真实图纸验证见妲己基准）
    const { source, calibration } = await makePattern([
      { row: 0, column: 0, rgb: rgbOf('F24'), code: 'F24' },
      { row: 0, column: 1, rgb: rgbOf('H2'), code: 'H2' },
      { row: 0, column: 2, rgb: rgbOf('G16'), code: 'G16' },
      { row: 1, column: 1, rgb: rgbOf('C13'), code: 'C13' },
      { row: 2, column: 3, rgb: rgbOf('F24'), code: 'F24' },
      { row: 2, column: 4, rgb: rgbOf('H2'), code: 'H2' },
      { row: 2, column: 5, rgb: rgbOf('G16'), code: 'G16' },
      { row: 2, column: 1, rgb: rgbOf('C13'), code: 'C13' },
    ], 6, 3);
    const result = extractBeadSymbols(source, calibration, BRAND_PALETTES.MARD);
    expect(result.textCellCount).toBeGreaterThanOrEqual(8);
    expect(result.resolvedCount).toBe(8);
    expect(result.codes.get('0:0')?.code).toBe('F24');
    expect(result.codes.get('0:1')?.code).toBe('H2');
    expect(result.codes.get('0:2')?.code).toBe('G16');
    expect(result.codes.get('1:1')?.code).toBe('C13');
    expect(result.codes.get('2:3')?.code).toBe('F24');
    // 空白格（无文字、白纸底）应被标记
    expect(result.blankCells.has('1:5')).toBe(true);
  });

  it('leaves cells whose text matches no palette code unresolved', async () => {
    // "ZZ" 不在色板 → 该格不应输出
    const { source, calibration } = await makePattern([
      { row: 0, column: 0, rgb: [244, 208, 224], code: 'ZZ' },
    ], 4, 2);
    const result = extractBeadSymbols(source, calibration, BRAND_PALETTES.MARD);
    expect(result.codes.size).toBe(0);
  });
});

describe('recognizeImportImage with symbolAssist', () => {
  it('overrides printed-code cells and marks paper blanks', async () => {
    const { source, calibration } = await makePattern([
      { row: 0, column: 0, rgb: rgbOf('F24'), code: 'F24' },
      { row: 1, column: 1, rgb: rgbOf('F24'), code: 'F24' },
      { row: 1, column: 2, rgb: rgbOf('H2'), code: 'H2' },
      { row: 2, column: 2, rgb: rgbOf('H2'), code: 'H2' },
    ], 5, 3);
    const result = recognizeImportImage(source, calibration, BRAND_PALETTES.MARD, 'precision', undefined, {
      symbolAssist: true,
    });
    expect(result.symbolAssist).toBeDefined();
    expect(result.symbolAssist!.overridden).toBe(4);
    expect(result.symbolAssist!.blanks).toBeGreaterThan(0);
    expect(result.cells[0][0].colorId).toBe('MARD_F24');
    expect(result.cells[1][2].colorId).toBe('MARD_H2');
    expect(result.cells[1][1].colorId).toBe('MARD_F24');
    // 纸底空格不放豆
    expect(result.cells[2][4].status).toBe('blank');
    expect(result.cells[2][4].colorId).toBeNull();
  });

  it('keeps default behaviour untouched when symbolAssist is off', async () => {
    const { source, calibration } = await makePattern([
      { row: 0, column: 0, rgb: rgbOf('F24'), code: 'F24' },
    ], 4, 2);
    const result = recognizeImportImage(source, calibration, BRAND_PALETTES.MARD, 'precision', undefined, {});
    expect(result.symbolAssist).toBeUndefined();
    // 无 symbolAssist 时纸底按颜色识别（不会判 blank）
    expect(result.cells[1][3].status).not.toBe('blank');
  });
});
