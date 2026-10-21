import { describe, expect, it } from 'vitest';
import type { BeadColor } from '../types';
import { recognizeImportImage, recognitionResultToCodeMatrix } from './importRecognition';
import { applyRecognitionCorrections, cellNeedsRecognitionReview, getRecognitionReviewCells, recognitionCellKey } from './importRecognitionReview';

const red: BeadColor = { id: 'r', code: 'R1', name: '红', hex: '#ff0000', rgb: [255, 0, 0], brand: 'CUSTOM' };
const blue: BeadColor = { id: 'b', code: 'B1', name: '蓝', hex: '#0000ff', rgb: [0, 0, 255], brand: 'CUSTOM' };
const palette = [red, blue];
function fixture() {
  const data = new Uint8ClampedArray(10 * 4);
  for (let x = 0; x < 10; x++) data.set([...((x % 5 < 3) ? red.rgb : blue.rgb), 255], x * 4);
  return recognizeImportImage({ width: 10, height: 1, data },
    { originX: 0, originY: 0, columns: 2, rows: 1, cellWidth: 5, cellHeight: 1 }, palette, 'precision');
}

describe('local recognition review', () => {
  it('keeps strong 60/40 dominance separate from ambiguous 51/49 or equal plurality', () => {
    const cell = fixture().cells[0][0];
    expect(cellNeedsRecognitionReview(cell)).toBe(false);
    expect(cellNeedsRecognitionReview({ ...cell, dominantRatio: 0.51, runnerUpRatio: 0.49 })).toBe(true);
    expect(cellNeedsRecognitionReview({ ...cell, dominantRatio: 0.4, runnerUpRatio: 0.4 })).toBe(true);
    expect(cellNeedsRecognitionReview({ ...cell, distance: 16 })).toBe(true);
    expect(cellNeedsRecognitionReview({ ...cell, status: 'invalid' })).toBe(true);
    expect(cellNeedsRecognitionReview({ ...cell, status: 'blank', dominantRatio: null })).toBe(false);
  });

  it('applies manual codes to the matrix and counts while preserving original measurements', () => {
    const original = fixture();
    const before = structuredClone(original);
    const reviewed = applyRecognitionCorrections(original, { [recognitionCellKey(0, 0)]: blue.id }, palette);
    expect(recognitionResultToCodeMatrix(reviewed)).toEqual([['B1', 'R1']]);
    expect(reviewed.summary.distinctColors).toBe(2);
    expect(reviewed.summary.mapped).toBe(2);
    expect(reviewed.cells[0][0].dominantRatio).toBeNull();
    expect(reviewed.cells[0][0].distance).toBeNull();
    expect(reviewed.cells[0][0].sampleRgb).toBeNull();
    expect(original).toEqual(before);
    expect(original.cells[0][0].dominantRatio).toBeCloseTo(0.6);
    expect(reviewed.cells[0][1]).toBe(original.cells[0][1]);
  });

  it('marks cells blank, and resetting overrides returns the exact automatic result', () => {
    const original = fixture();
    const reviewed = applyRecognitionCorrections(original, { '0:0': null, '0:1': null }, palette);
    expect(recognitionResultToCodeMatrix(reviewed)).toEqual([['', '']]);
    expect(reviewed.summary).toMatchObject({ blank: 2, mapped: 0, distinctColors: 0 });
    expect(applyRecognitionCorrections(original, {}, palette)).toBe(original);
  });

  it('ignores invalid keys, unknown color IDs and disabled colors', () => {
    const original = fixture();
    expect(applyRecognitionCorrections(original, { '99:99': null, '0:0': 'unknown' }, palette)).toBe(original);
    expect(applyRecognitionCorrections(original, { '0:0': blue.id }, [red, { ...blue, enabled: false }])).toBe(original);
  });

  it('omits manually reviewed cells from the pending queue without erasing original evidence', () => {
    const original = fixture();
    original.cells[0] = original.cells[0].map(cell => ({ ...cell, dominantRatio: 0.51, runnerUpRatio: 0.49 }));
    expect(getRecognitionReviewCells(original)).toEqual([{ row: 0, column: 0 }, { row: 0, column: 1 }]);
    expect(getRecognitionReviewCells(original, { '0:0': blue.id })).toEqual([{ row: 0, column: 1 }]);
    expect(getRecognitionReviewCells(original, { '0:0': null, '0:1': red.id })).toEqual([]);
    expect(original.cells[0][0].dominantRatio).toBe(0.51);
  });
});
