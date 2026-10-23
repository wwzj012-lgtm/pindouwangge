import { describe, expect, it } from 'vitest';
import type { BeadColor } from '../types';
import { confirmRecognitionResult } from './confirmedRecognition';
import { recognizeImportImage, recognitionResultToCodeMatrix } from './importRecognition';
import { applyRecognitionCorrections, type ImportRecognitionCorrections } from './importRecognitionReview';
import { getRecognitionBackgroundCandidate, getRecognitionBackgroundCells, recognitionBackgroundCorrections, releaseRecognitionBackgroundCell } from './recognitionBackground';

const palette: BeadColor[] = [
  { id: 'w', code: 'W', name: '白', hex: '#ffffff', rgb: [255, 255, 255], brand: 'CUSTOM' },
  { id: 'b', code: 'B', name: '蓝', hex: '#0000ff', rgb: [0, 0, 255], brand: 'CUSTOM' },
  { id: 'r', code: 'R', name: '红', hex: '#ff0000', rgb: [255, 0, 0], brand: 'CUSTOM' },
];

function fixture(grid: string[]) {
  const width = grid[0]?.length ?? 0;
  const height = grid.length;
  const data = new Uint8ClampedArray(width * height * 4);
  grid.forEach((row, y) => [...row].forEach((id, x) => {
    const color = palette.find(item => item.id === id);
    if (color) data.set([...color.rgb, 255], (y * width + x) * 4);
  }));
  return recognizeImportImage({ data, width, height }, {
    originX: 0, originY: 0, cellWidth: 1, cellHeight: 1, columns: width, rows: height,
  }, palette, 'precision');
}

const enclosed = ['wwwwwww', 'wbbbbbw', 'wbwwwbw', 'wbw.wbw', 'wbwwwbw', 'wbbbbbw', 'wwwwwww'];

describe('recognition background removal', () => {
  it('removes the border-connected single color and preserves enclosed same-color cells and blank holes', () => {
    const original = fixture(enclosed);
    const before = structuredClone(original);
    const keys = getRecognitionBackgroundCells(original, 'w');
    expect(keys).toHaveLength(24);
    const result = applyRecognitionCorrections(original, recognitionBackgroundCorrections([keys]), palette);
    expect(recognitionResultToCodeMatrix(result)[3]).toEqual(['', 'B', 'W', '', 'W', 'B', '']);
    expect(result.summary).toMatchObject({ mapped: 24, blank: 25, distinctColors: 2 });
    expect(original).toEqual(before);
  });

  it('does not cross another color or follow diagonal neighbours', () => {
    const original = fixture(['wbb', 'bwb', 'bbw']);
    expect(getRecognitionBackgroundCells(original, 'w').sort()).toEqual(['0:0', '2:2']);
    const result = applyRecognitionCorrections(original, recognitionBackgroundCorrections([['0:0', '2:2']]), palette);
    expect(result.cells[1][1].colorId).toBe('w');
    expect(result.summary.mapped).toBe(7);
  });

  it('keeps other border colors even if several background regions are disconnected', () => {
    const original = fixture(['wwbrr', 'wwbrr', 'wwbrr']);
    const keys = getRecognitionBackgroundCells(original, 'w');
    expect(keys).toHaveLength(6);
    const result = applyRecognitionCorrections(original, recognitionBackgroundCorrections([keys]), palette);
    expect(result.summary).toMatchObject({ mapped: 9, distinctColors: 2 });
    expect(result.cells[0][4].colorId).toBe('r');
  });

  it('can reach the candidate through existing exterior transparency without filling or removing it', () => {
    const original = fixture(['.....', '.www.', '.wbw.', '.www.', '.....']);
    expect(getRecognitionBackgroundCandidate(original)).toBeNull();
    const keys = getRecognitionBackgroundCells(original, 'w');
    expect(keys).toHaveLength(8);
    const result = applyRecognitionCorrections(original, recognitionBackgroundCorrections([keys]), palette);
    expect(result.summary).toMatchObject({ mapped: 1, blank: 24 });
    expect(result.cells[2][2].colorId).toBe('b');
  });

  it('does not treat invalid cells as empty background passages', () => {
    const original = fixture(['bbb', 'bwb', 'bbb']);
    original.cells[0][1] = { ...original.cells[0][1], status: 'invalid', color: null, colorId: null };
    expect(getRecognitionBackgroundCells(original, 'w')).toEqual([]);
  });

  it.each([['w'], ['wwbww'], ['w', 'b', 'w']])('handles narrow grids: %j', (...grid) => {
    const original = fixture(grid);
    expect(getRecognitionBackgroundCells(original, 'w')).toHaveLength(grid.join('').split('w').length - 1);
  });

  it('reports no work for no candidate, absent color, enclosed color, or all-transparent input', () => {
    expect(getRecognitionBackgroundCells(fixture(['w']), null)).toEqual([]);
    expect(getRecognitionBackgroundCells(fixture(['w']), 'missing')).toEqual([]);
    expect(getRecognitionBackgroundCells(fixture(['bbb', 'bwb', 'bbb']), 'w')).toEqual([]);
    expect(getRecognitionBackgroundCells(fixture(['...', '...']), 'w')).toEqual([]);
  });

  it('uses a strict whole-border majority, counts corners once, and does not guess ties', () => {
    expect(getRecognitionBackgroundCandidate(fixture(enclosed))).toBe('w');
    expect(getRecognitionBackgroundCandidate(fixture(['wb', 'bw']))).toBeNull();
    expect(getRecognitionBackgroundCandidate(fixture(['w.', '..']))).toBeNull();
    expect(getRecognitionBackgroundCandidate(fixture(['w']))).toBe('w');
    expect(getRecognitionBackgroundCandidate(fixture(['wwbww']))).toBe('w');
  });

  it('supports a large grid without recursive stack overflow', () => {
    const original = fixture(['w']);
    const size = 512;
    const base = original.cells[0][0];
    original.cells = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => ({ ...base, row, column })));
    original.calibration = { ...original.calibration, rows: size, columns: size };
    const keys = getRecognitionBackgroundCells(original, 'w');
    expect(keys).toHaveLength(size * size);
    expect(new Set(keys).size).toBe(size * size);
  });

  it('undo restores pre-existing manual colors and blanks while keeping later manual edits', () => {
    const original = fixture(['wwwww', 'wbbbw', 'wwwww']);
    const manual: ImportRecognitionCorrections = { '0:0': 'r', '0:1': null, '0:2': 'w' };
    const reviewed = applyRecognitionCorrections(original, manual, palette);
    let history = [getRecognitionBackgroundCells(reviewed, 'w')];
    expect(recognitionBackgroundCorrections(history)['0:2']).toBeNull();
    expect(recognitionBackgroundCorrections(history)).not.toHaveProperty('0:0');
    manual['0:3'] = 'b';
    history = releaseRecognitionBackgroundCell(history, '0:3');
    let result = applyRecognitionCorrections(original, { ...manual, ...recognitionBackgroundCorrections(history) }, palette);
    expect(result.cells[0][3].colorId).toBe('b');
    history = history.slice(0, -1);
    result = applyRecognitionCorrections(original, { ...manual, ...recognitionBackgroundCorrections(history) }, palette);
    expect(result.cells[0].map(cell => cell.colorId)).toEqual(['r', null, 'w', 'b', 'w']);
  });

  it('keeps explicit later blank/reset choices and supports several removal/undo batches', () => {
    let history = [['0:0', '0:1'], ['1:0']];
    history = releaseRecognitionBackgroundCell(history, '0:0');
    expect(recognitionBackgroundCorrections(history)).toEqual({ '0:1': null, '1:0': null });
    expect(recognitionBackgroundCorrections(history.slice(0, -1))).toEqual({ '0:1': null });
    history = releaseRecognitionBackgroundCell(history, '1:0');
    expect(history).toEqual([['0:1']]);
    expect(releaseRecognitionBackgroundCell(history, '0:1')).toEqual([]);
  });

  it('confirms and copies the effective grid while preserving an earlier frozen snapshot', () => {
    const original = fixture(enclosed);
    const before = confirmRecognitionResult(original, palette, '原始', 'before');
    const result = applyRecognitionCorrections(original, recognitionBackgroundCorrections([getRecognitionBackgroundCells(original, 'w')]), palette);
    const after = confirmRecognitionResult(result, palette, '去背景', 'after');
    expect(before.grid[0][0]).toBe('w');
    expect(after.grid[0][0]).toBeNull();
    expect(after.grid[2][2]).toBe('w');
    expect(after.grid[3][3]).toBeNull();
    expect(recognitionResultToCodeMatrix(result)[0]).toEqual(Array(7).fill(''));
  });
});
