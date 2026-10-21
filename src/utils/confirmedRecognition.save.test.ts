import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recognizeImportImage } from './importRecognition';
import { confirmRecognitionResult, saveConfirmedRecognition } from './confirmedRecognition';
import { saveExportedPatternRecord } from './patternHistory';
import type { BeadColor, ConvertSettings } from '../types';

vi.mock('./patternHistory', () => ({ saveExportedPatternRecord: vi.fn() }));
const palette: BeadColor[] = [{ id: 'MARD_H7', code: 'H7', name: '黑', hex: '#000000', rgb: [0, 0, 0], brand: 'MARD' }];
const settings: ConvertSettings = { width: 79, height: 44, boardSize: 29, brand: 'MARD', keepAspectRatio: true,
  dither: 'none', colorLimit: 0, brightness: 0, contrast: 0, saturation: 0, transparentCutoff: 24,
  colorMatchAlgo: 'ciede2000', sharpening: 0, outlineBoost: false, chromaKeyColor: null, chromaKeyTolerance: 0 };
function confirmed() {
  const result = recognizeImportImage({ width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) },
    { originX: 0, originY: 0, columns: 1, rows: 1, cellWidth: 1, cellHeight: 1 }, palette, 'precision');
  return confirmRecognitionResult(result, palette, '确认图纸', 'recognition_separate');
}

describe('confirmed recognition library save', () => {
  beforeEach(() => vi.mocked(saveExportedPatternRecord).mockReset());

  it('rejects anonymous saves before writing to the library', async () => {
    await expect(saveConfirmedRecognition(confirmed(), settings, null)).rejects.toThrow('请先登录');
    expect(saveExportedPatternRecord).not.toHaveBeenCalled();
  });

  it('uses independent confirmed dimensions, identity, palette and draft status', async () => {
    vi.mocked(saveExportedPatternRecord).mockResolvedValue({ id: 'recognition_separate', syncState: 'synced' } as never);
    const draft = confirmed();
    const baseline = structuredClone(settings);
    await saveConfirmedRecognition(draft, settings, 'owner');
    expect(saveExportedPatternRecord).toHaveBeenCalledWith(expect.objectContaining({
      id: 'recognition_separate', userId: 'owner', title: '确认图纸', width: 1, height: 1,
      boardSize: 26, grid: [['MARD_H7']], brand: 'MARD', completionStatus: 'DRAFT', paidNonEmptyBeads: null,
      totalBeads: 1,
    }));
    expect(settings).toEqual(baseline);
    expect(draft.grid).toEqual([['MARD_H7']]);
  });

  it('propagates save errors for retry and reuses the confirmed ID rather than duplicating drafts', async () => {
    const draft = confirmed();
    vi.mocked(saveExportedPatternRecord).mockRejectedValueOnce(new Error('storage full'));
    await expect(saveConfirmedRecognition(draft, settings, 'owner')).rejects.toThrow('storage full');
    vi.mocked(saveExportedPatternRecord).mockResolvedValueOnce({ id: draft.id, syncState: 'failed' } as never);
    expect((await saveConfirmedRecognition(draft, settings, 'owner')).syncState).toBe('failed');
    expect(vi.mocked(saveExportedPatternRecord).mock.calls.map(([input]) => input.id)).toEqual([draft.id, draft.id]);
  });
});
