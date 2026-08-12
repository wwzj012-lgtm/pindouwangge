import { describe, expect, it } from 'vitest';
import { getPreviewDimensions, getPreviewPixelSource } from './patternPreview';

describe('pattern preview helpers', () => {
  it('keeps a 1x1 through 900x900 grid within the bounded preview canvas', () => {
    expect(getPreviewDimensions(1, 1)).toEqual({ width: 1, height: 1 });
    expect(getPreviewDimensions(900, 900)).toEqual({ width: 256, height: 256 });
    expect(getPreviewDimensions(900, 300)).toEqual({ width: 256, height: 85 });
    expect(getPreviewDimensions(300, 900)).toEqual({ width: 85, height: 256 });
  });

  it('maps palette color ids to deterministic preview colors', () => {
    const preview = getPreviewPixelSource({
      width: 2,
      height: 1,
      grid: [['red', 'fallback']],
      palette: [
        { id: 'red', code: 'R', name: 'Red', hex: '#AA0011', rgb: [170, 0, 17], brand: 'MARD' },
        { id: 'fallback', code: 'F', name: 'Fallback', hex: 'invalid', rgb: [1, 2, 3], brand: 'MARD' },
      ],
    });
    expect(preview.colorById.get('red')).toBe('#AA0011');
    expect(preview.colorById.get('fallback')).toBe('rgb(1, 2, 3)');
  });
});
