import { describe, expect, it } from 'vitest';
import type { BeadColor } from '../types';
import type { ExportOptions } from './exportUtils';
import { getExportFilename, getExportFilenameBase, getExportPreset, getExportSummary, resolveExportPrivileges } from './exportModalUtils';

const red: BeadColor = { id: 'red', code: 'A01', name: 'Red', hex: '#ff0000', rgb: [255, 0, 0], brand: 'MARD' };
const blue: BeadColor = { ...red, id: 'blue', code: 'A02', name: 'Blue', hex: '#0000ff', rgb: [0, 0, 255] };
const paletteMap = new Map([['red', red], ['blue', blue]]);
const grid = [['red', null, 'blue'], ['red', 'red', null], [null, 'blue', 'red']];
const options: ExportOptions = {
  grid, paletteMap, width: 3, height: 3, boardSize: 2, brandName: 'MARD', projectName: 'Original',
  beadShape: 'square', ...getExportPreset('standard'), watermarkType: 'none', exportQuality: 'ultra',
  watermarkText: 'Store', watermarkOpacity: .25, watermarkAngle: 20, watermarkColor: '#123456',
};

describe('export output summary', () => {
  it('counts occupied cells and actual colors in the full pattern', () => {
    expect(getExportSummary(grid, paletteMap, 3, 3, 2, null)).toMatchObject({
      width: 3, height: 3, totalBeads: 6, colorCount: 2,
      materials: [{ id: 'red', count: 4, bead: red }, { id: 'blue', count: 2, bead: blue }],
    });
  });

  it.each([
    [0, 2, 2, 3, 1], [1, 1, 2, 1, 1], [2, 2, 1, 1, 1], [3, 1, 1, 1, 1],
  ])('matches the renderer bounds for board %i, including partial edge boards', (board, width, height, totalBeads, colorCount) => {
    expect(getExportSummary(grid, paletteMap, 3, 3, 2, board)).toMatchObject({ width, height, totalBeads, colorCount });
  });

  it('does not count empty cells as a material or mutate the grid', () => {
    const snapshot = structuredClone(grid);
    expect(getExportSummary([[null]], paletteMap, 1, 1, 2, null)).toMatchObject({ totalBeads: 0, colorCount: 0, materials: [] });
    getExportSummary(grid, paletteMap, 3, 3, 2, 0);
    expect(grid).toEqual(snapshot);
  });
});

describe('export filenames', () => {
  it.each([
    ['  我的图纸.PNG ', '我的图纸'], ['a/b:c?d*e', 'a_b_c_d_e'], ['hello... ', 'hello'],
    ['NUL', '_NUL'], ['COM1.png', '_COM1'], ['花朵 🌼', '花朵 🌼'],
  ])('normalizes %s without losing meaningful names', (input, expected) => {
    expect(getExportFilenameBase(input, 'Fallback')).toBe(expected);
  });
  it('uses a safe fallback for blank names and caps length', () => {
    expect(getExportFilenameBase('  ...  ', 'Original')).toBe('Original');
    expect(getExportFilenameBase('', '')).toBe('Pattern');
    expect(getExportFilenameBase('a'.repeat(150), '')).toHaveLength(100);
  });
  it('keeps full and board names distinct in both languages', () => {
    expect(getExportFilename('Custom', null, true)).toBe('Custom_FullPattern.png');
    expect(getExportFilename('Custom', 0, true)).toBe('Custom_Board1.png');
    expect(getExportFilename('自定义', null, false)).toBe('自定义_完整图纸.png');
    expect(getExportFilename('自定义', 3, false)).toBe('自定义_板4.png');
  });
});

describe('export presets and membership boundary', () => {
  it.each(['standard', 'follow', 'share'] as const)('preset %s cannot grant privileges or change pattern content', preset => {
    const result = getExportPreset(preset);
    expect(result).not.toHaveProperty('watermarkType');
    expect(result).not.toHaveProperty('grid');
    expect(result).not.toHaveProperty('selectedBoardIndex');
    expect(result.exportQuality).toBe('high');
  });
  it('keeps code visibility and symbol type consistent', () => {
    expect(getExportPreset('share')).toMatchObject({ showSymbols: false, symbolDisplayType: 'none', showCoordinates: false, hideEmptyPegs: true });
    expect(getExportPreset('follow')).toMatchObject({ showSymbols: true, symbolDisplayType: 'code', symbolFontScale: 1.25, legendPosition: 'bottom' });
    expect(getExportPreset('standard')).toMatchObject({ symbolFontScale: 1, legendPosition: 'right', hideEmptyPegs: true });
    expect(getExportPreset('follow').hideEmptyPegs).toBe(true);
  });
  it.each([true, false])('clamps stale VIP settings synchronously for a free user (English=%s)', isEn => {
    const original = { ...options, isEn };
    const result = resolveExportPrivileges(original, false);
    expect(result).toMatchObject({
      watermarkType: 'double_diagonal', exportQuality: 'high', watermarkText: isEn ? 'BeadGrid' : '豆织星格',
      watermarkColor: '#A855F7', watermarkAngle: -25, watermarkOpacity: .25,
    });
    expect(result.grid).toBe(grid);
    expect(result.paletteMap).toBe(paletteMap);
    expect(original.watermarkType).toBe('none');
    expect(original.exportQuality).toBe('ultra');
  });
  it('preserves authorized VIP options and existing watermarked free options', () => {
    expect(resolveExportPrivileges(options, true)).toBe(options);
    expect(resolveExportPrivileges({ ...options, watermarkType: 'double_diagonal', exportQuality: 'high' }, false))
      .toMatchObject({ watermarkType: 'double_diagonal', exportQuality: 'high' });
  });
});
