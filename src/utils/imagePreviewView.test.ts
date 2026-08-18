import { describe, expect, it } from 'vitest';
import {
  changeImagePreviewScale,
  createInitialImagePreviewView,
  forwardReferenceImageUpload,
  IMAGE_PREVIEW_CONTROLS,
  IMAGE_PREVIEW_TOOLBAR_CLASS,
  resetImagePreviewView,
} from './imagePreviewView';

describe('image preview view', () => {
  it('forwards the selected file to the existing upload owner', () => {
    const file = { name: 'replacement.png' } as File;
    let received: File | undefined;

    forwardReferenceImageUpload(file, candidate => {
      received = candidate;
    });

    expect(received).toBe(file);
  });

  it('resets only the preview view state after zooming and panning', () => {
    const view = {
      ...changeImagePreviewScale(createInitialImagePreviewView(), 1),
      pan: { x: 96, y: -48 },
    };

    expect(resetImagePreviewView()).toEqual({ scale: 1, pan: { x: 0, y: 0 } });
    expect(view.scale).toBe(2);
    expect(view.pan).toEqual({ x: 96, y: -48 });
  });

  it('defines accessible controls and a wrapping narrow-width toolbar', () => {
    Object.values(IMAGE_PREVIEW_CONTROLS).forEach(control => {
      expect(control.title).toBeTruthy();
      expect(control.ariaLabel).toBeTruthy();
    });
    expect(IMAGE_PREVIEW_TOOLBAR_CLASS).toContain('flex-wrap');
    expect(IMAGE_PREVIEW_TOOLBAR_CLASS).toContain('min-w-0');
  });
});
