import { describe, expect, it } from 'vitest';
import type { BeadColor } from '../types';
import { deltaE2000, preparePaletteLab, rgbToLab } from './colorUtils';
import type { ImportGridCalibration } from './importGridCalibration';
import { recognizeImportImage, type ImportImagePixels, type ImportRecognitionCell } from './importRecognition';
import { applyCountBalance } from './importLegendBalance';

// 两支 ΔE2000 适中（< 25 守卫内）的自定义色，保证转让守卫不被距离卡死。
const warm: BeadColor = { id: 'WA', code: 'WA', name: 'Warm', hex: '#d27a5c', rgb: [210, 122, 92], brand: 'CUSTOM' };
const cool: BeadColor = { id: 'CB', code: 'CB', name: 'Cool', hex: '#e19a76', rgb: [225, 154, 118], brand: 'CUSTOM' };
const palette = preparePaletteLab([warm, cool]);
// 前置自检：这对颜色必须处于守卫阈值内，否则测试前提失效。
const warmCoolDeltaE = deltaE2000(rgbToLab(...warm.rgb), rgbToLab(...cool.rgb));

const calibration: ImportGridCalibration = {
  originX: 0, originY: 0, cellWidth: 4, cellHeight: 4, columns: 1, rows: 1,
};

function imageFromCodes(codes: Array<'WA' | 'CB'>): ImportImagePixels {
  const width = codes.length * 4;
  const data = new Uint8ClampedArray(width * 4 * 4);
  for (let cell = 0; cell < codes.length; cell += 1) {
    const rgb = codes[cell] === 'WA' ? warm.rgb : cool.rgb;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const offset = (y * width + cell * 4 + x) * 4;
        data[offset] = rgb[0]; data[offset + 1] = rgb[1]; data[offset + 2] = rgb[2]; data[offset + 3] = 255;
      }
    }
  }
  return { width, height: 4, data };
}

function cellsFromCodes(codes: Array<'WA' | 'CB'>, dominant: number[] = [], recognisingPalette: BeadColor[] = [warm, cool]): ImportRecognitionCell[][] {
  const source = imageFromCodes(codes);
  const calibration: ImportGridCalibration = {
    originX: 0, originY: 0, cellWidth: 4, cellHeight: 4, columns: codes.length, rows: 1,
  };
  const result = recognizeImportImage(source, calibration, recognisingPalette, 'precision');
  return result.cells.map((row, rowIndex) => row.map((cell, columnIndex) => ({
    ...cell,
    dominantRatio: dominant[rowIndex * row.length + columnIndex] ?? cell.dominantRatio,
  })));
}

function codesOf(cells: ImportRecognitionCell[][]): string[] {
  return cells.flat().map(cell => cell.colorId ?? '');
}

describe('applyCountBalance', () => {
  it('uses a guard-compatible colour pair as test premise', () => {
    expect(warmCoolDeltaE).toBeGreaterThan(2);
    expect(warmCoolDeltaE).toBeLessThan(25);
  });

  it('transfers least-confident surplus cells to the deficit colour until quotas match', () => {
    // 8 格：前 6 格 WA（其中第 4~6 格置信度低）、后 2 格 CB；WA 目标 5、CB 目标 3
    // → WA surplus=1。最便宜的被让格 = 低置信 **且** 与 CB 相邻的第 6 格（ΔE 相同时邻域加权胜出）。
    const cells = cellsFromCodes(['WA', 'WA', 'WA', 'WA', 'WA', 'WA', 'CB', 'CB'], [1, 1, 1, 0.5, 0.5, 0.5, 1, 1]);
    const result = applyCountBalance(cells, { WA: 5, CB: 3 }, palette);
    expect(result.moved).toBe(1);
    expect(result.satisfied).toBe(true);
    expect(result.residual).toEqual({});
    expect(codesOf(result.cells)).toEqual(['WA', 'WA', 'WA', 'WA', 'WA', 'CB', 'CB', 'CB']);
    // 被让的格：WA 中置信度最低（dominantRatio 0.5）的那一列。
    expect(result.cells[0][5].dominantRatio).toBe(0.5);
    // 改写格的 distance 按新色号重算（ΔE 语义与 smoothCells/unify 一致）。
    expect(result.cells[0][5].distance).not.toBeNull();
    // 采样色不变：平衡只改判读不改测量。
    expect(result.cells[0][5].sampleRgb).toEqual(cells[0][5].sampleRgb);
    // 输入网格不被原地改写。
    expect(codesOf(cells)).toEqual(['WA', 'WA', 'WA', 'WA', 'WA', 'WA', 'CB', 'CB']);
  });

  it('prefers deficit colours that are spatially adjacent to the candidate cell', () => {
    // [WA WA WA CB]，WA 目标 1、CB 目标 3：与 CB 相邻的那格成本最低，先让。
    const cells = cellsFromCodes(['WA', 'WA', 'WA', 'CB']);
    const result = applyCountBalance(cells, { WA: 1, CB: 3 }, palette);
    expect(result.moved).toBe(2);
    expect(result.satisfied).toBe(true);
    expect(codesOf(result.cells)).toEqual(['WA', 'CB', 'CB', 'CB']);
  });

  it('refuses to move any cell when every transfer exceeds the ΔE jump guard', () => {
    const red: BeadColor = { id: 'RD', code: 'RD', name: 'Red', hex: '#ff0000', rgb: [255, 0, 0], brand: 'CUSTOM' };
    const blue: BeadColor = { id: 'BL', code: 'BL', name: 'Blue', hex: '#0000ff', rgb: [0, 0, 255], brand: 'CUSTOM' };
    const farPalette = preparePaletteLab([red, blue]);
    expect(deltaE2000(rgbToLab(...red.rgb), rgbToLab(...blue.rgb))).toBeGreaterThan(25);
    // 四格全判为 RD（WA 采样色在 farPalette 里的最近色），quota 让 RD 出 3 格给 BL。
    const cells = cellsFromCodes(['WA', 'WA', 'WA', 'WA'], [], [red, blue]);
    expect(codesOf(cells)).toEqual(['RD', 'RD', 'RD', 'RD']);
    const result = applyCountBalance(cells, { RD: 1, BL: 3 }, farPalette);
    expect(result.moved).toBe(0);
    expect(result.satisfied).toBe(false);
    expect(result.residual).toEqual({ RD: 3, BL: -3 });
    expect(codesOf(result.cells)).toEqual(['RD', 'RD', 'RD', 'RD']);
  });

  it('keeps surplus cells in place and reports them when sum(quota) is below mapped total', () => {
    const cells = cellsFromCodes(['WA', 'WA', 'WA', 'CB']);
    const result = applyCountBalance(cells, { WA: 1 }, palette);
    // CB 不在 quota：无 deficit 可接收，WA 超出的 2 格保持原分类（不发明"多余格"）。
    expect(result.moved).toBe(0);
    expect(result.satisfied).toBe(false);
    expect(result.residual).toEqual({ WA: 2 });
    expect(codesOf(result.cells)).toEqual(['WA', 'WA', 'WA', 'CB']);
  });

  it('is a no-op with empty quota or codes outside the palette', () => {
    const cells = cellsFromCodes(['WA', 'CB']);
    for (const quota of [{}, { ZZ: 2 }]) {
      const result = applyCountBalance(cells, quota, palette);
      expect(result.moved).toBe(0);
      expect(result.satisfied).toBe(true);
      expect(result.residual).toEqual({});
      expect(result.cells).toBe(cells);
    }
  });

  // 注：迭代上限 Σsurplus+8 按构造不可触达（最多 Σsurplus 次转让即可配平），
  // 本测试只验证预算内收敛的确定性与恰好语义，不构造"撞上限"场景。
  it('settles within the iteration budget and stays deterministic across runs', () => {
    const cells = cellsFromCodes(['WA', 'WA', 'WA', 'WA', 'WA', 'WA', 'WA', 'WA', 'CB', 'CB']);
    const first = applyCountBalance(cells, { WA: 2, CB: 8 }, palette);
    const second = applyCountBalance(cells, { WA: 2, CB: 8 }, palette);
    expect(first.moved).toBe(6);
    expect(first.satisfied).toBe(true);
    expect(codesOf(first.cells)).toEqual(codesOf(second.cells));
    expect(first.cells.map(row => row.map(cell => cell.distance))).toEqual(second.cells.map(row => row.map(cell => cell.distance)));
  });
});
