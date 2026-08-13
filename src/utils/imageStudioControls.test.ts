import { describe, expect, it } from 'vitest';
import type { ConvertSettings } from '../types';
import {
  IMAGE_STUDIO_PREVIEW_DEBOUNCE_MS,
  buildTransformedImageCanvas,
  clampImageStudioControl,
  isImageStudioOperationCurrent,
  nextImageStudioOperationToken,
  resetBackgroundRemovalForNewImage,
  resetImageStudioBackgroundSettings,
  stepImageStudioControl,
} from './imageStudioControls';

const settings = {
  width: 20, height: 20, keepAspectRatio: true, brand: 'MARD', dither: 'none', colorLimit: 0,
  brightness: 0, contrast: 0, saturation: 0, transparentCutoff: 16, boardSize: 29,
  colorMatchAlgo: 'ciede2000', sharpening: 0, outlineBoost: false,
  chromaKeyColor: '#FFFFFF', chromaKeyTolerance: 20, backgroundRemovalEnabled: true,
} satisfies ConvertSettings;

describe('image studio control helpers', () => {
  it('clamps and steps continuous values consistently', () => {
    expect(clampImageStudioControl(120, -100, 100)).toBe(100);
    expect(clampImageStudioControl(-140, -100, 100)).toBe(-100);
    expect(stepImageStudioControl(0, 1, -100, 100)).toBe(1);
    expect(stepImageStudioControl(0, -1, -100, 100)).toBe(-1);
    expect(clampImageStudioControl(120, 0, 100)).toBe(100);
    expect(stepImageStudioControl(0, -1, 0, 100)).toBe(0);
    expect(stepImageStudioControl(100, 1, 0, 100)).toBe(100);
  });

  it('starts every studio session with background removal disabled', () => {
    expect(resetImageStudioBackgroundSettings(settings)).toMatchObject({
      backgroundRemovalEnabled: false,
      chromaKeyColor: null,
    });
  });

  it('clears the opt-in when a new source image starts', () => {
    expect(resetBackgroundRemovalForNewImage(settings)).toMatchObject({
      backgroundRemovalEnabled: false,
      chromaKeyColor: null,
    });
  });

  it('uses a real debounce interval for expensive previews', () => {
    expect(IMAGE_STUDIO_PREVIEW_DEBOUNCE_MS).toBeGreaterThanOrEqual(150);
    expect(IMAGE_STUDIO_PREVIEW_DEBOUNCE_MS).toBeLessThanOrEqual(200);
  });

  it('keeps transform and operation tokens monotonic and exact', () => {
    expect(nextImageStudioOperationToken(0)).toBe(1);
    expect(nextImageStudioOperationToken(4)).toBe(5);
    expect(isImageStudioOperationCurrent(5, 5)).toBe(true);
    expect(isImageStudioOperationCurrent(4, 5)).toBe(false);
  });

  it('rejects invalid transform dimensions without touching a canvas', () => {
    const image = { naturalWidth: 0, naturalHeight: 0, width: 0, height: 0 } as HTMLImageElement;
    expect(buildTransformedImageCanvas(image, 90, false)).toBeNull();
  });
});
