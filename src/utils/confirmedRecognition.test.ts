import { describe, expect, it } from 'vitest';
import type { BeadColor, ConvertSettings } from '../types';
import { recognizeImportImage } from './importRecognition';
import { applyRecognitionCorrections } from './importRecognitionReview';
import { confirmRecognitionResult, recognitionDraftToProject } from './confirmedRecognition';

const palette: BeadColor[] = [
  { id: 'red', code: 'R1', name: '红', hex: '#ff0000', rgb: [255, 0, 0], brand: 'CUSTOM' },
  { id: 'blue', code: 'B1', name: '蓝', hex: '#0000ff', rgb: [0, 0, 255], brand: 'CUSTOM' },
];
const settings: ConvertSettings = {
  width: 79, height: 44, boardSize: 29, brand: 'MARD', keepAspectRatio: true,
  dither: 'none', colorLimit: 0, brightness: 0, contrast: 0, saturation: 0,
  transparentCutoff: 24, colorMatchAlgo: 'ciede2000', sharpening: 0,
  outlineBoost: false, chromaKeyColor: null, chromaKeyTolerance: 0,
};
function result() {
  return recognizeImportImage({ width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]) },
    { columns: 2, rows: 1, cellWidth: 1, cellHeight: 1, originX: 0, originY: 0 }, palette, 'precision');
}

describe('confirmed recognition handoff', () => {
  it('copies the exact reviewed matrix including manual blank cells, without retaining live references', () => {
    const original = result();
    const reviewed = applyRecognitionCorrections(original, { '0:0': null, '0:1': 'red' }, palette);
    const draft = confirmRecognitionResult(reviewed, palette, '  我的导入  ', 'recognition_test');
    expect(draft).toMatchObject({ id: 'recognition_test', title: '我的导入', width: 2, height: 1, boardSize: 26, brand: 'CUSTOM', grid: [[null, 'red']] });
    reviewed.cells[0][1].colorId = 'blue';
    expect(draft.grid).toEqual([[null, 'red']]);
    expect(draft.palette).not.toBe(palette);
    expect(draft.palette[0]).not.toBe(palette[0]);
    expect(draft.palette[0].rgb).not.toBe(palette[0].rgb);
    expect(original.cells[0][0].colorId).toBe('red');
  });

  it('starts the editor/library project as a fresh draft with a separate identity and no inherited entitlements', () => {
    const draft = confirmRecognitionResult(result(), palette, '识别结果', 'recognition_new');
    const before = structuredClone(settings);
    const project = recognitionDraftToProject(draft, settings);
    expect(project).toMatchObject({ version: 2, workId: 'recognition_new', completionStatus: 'DRAFT', paidNonEmptyBeads: null, width: 2, height: 1, boardSize: 26, brand: 'CUSTOM' });
    expect(project.settings).toMatchObject({ width: 2, height: 1, boardSize: 26, brand: 'CUSTOM', keepAspectRatio: false });
    expect(project.grid).toEqual([['red', 'blue']]);
    expect(project.grid[0]).not.toBe(draft.grid[0]);
    expect(settings).toEqual(before);
    project.grid[0][0] = null;
    expect(draft.grid[0][0]).toBe('red');
  });

  it('rejects unresolved invalid cells, malformed dimensions and colors outside the palette', () => {
    const invalid = result();
    invalid.cells[0][0].status = 'invalid';
    expect(() => confirmRecognitionResult(invalid, palette, 'test')).toThrow('无效格');
    const malformed = result();
    malformed.calibration.columns = 3;
    expect(() => confirmRecognitionResult(malformed, palette, 'test')).toThrow('尺寸');
    const unknown = result();
    unknown.cells[0][0].colorId = 'unknown';
    expect(() => confirmRecognitionResult(unknown, palette, 'test')).toThrow('色板之外');
  });

  it.each(['', '   ', '长'.repeat(61)])('rejects invalid names before saving or editing', name => {
    expect(() => confirmRecognitionResult(result(), palette, name)).toThrow('作品名称');
  });

  it('uses the selected brand, and preserves mixed/custom palette identities', () => {
    const mard = palette.map(color => ({ ...color, brand: 'MARD' as const }));
    expect(confirmRecognitionResult(result(), mard, 'mard').brand).toBe('MARD');
    const mixed = [{ ...palette[0], brand: 'MARD' as const }, palette[1]];
    expect(confirmRecognitionResult(result(), mixed, 'mixed').brand).toBe('CUSTOM');
  });
});
