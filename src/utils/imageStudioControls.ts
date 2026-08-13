import type { ConvertSettings } from '../types';

export const IMAGE_STUDIO_PREVIEW_DEBOUNCE_MS = 180;

export function nextImageStudioOperationToken(current: number): number {
  return Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
}

export function isImageStudioOperationCurrent(token: number, current: number): boolean {
  return token === current;
}

export function transformedImageDimensions(width: number, height: number, rotation: number): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const isQuarterTurn = normalizedRotation === 90 || normalizedRotation === 270;
  return isQuarterTurn ? { width: height, height: width } : { width, height };
}

/** Draws the current crop/rotation/flip state into a canvas for both preview and apply. */
export function buildTransformedImageCanvas(
  image: HTMLImageElement,
  rotation: number,
  flipH: boolean,
  targetCanvas?: HTMLCanvasElement,
): HTMLCanvasElement | null {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const dimensions = transformedImageDimensions(sourceWidth, sourceHeight, rotation);
  if (!dimensions) return null;

  const canvas = targetCanvas ?? document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;

  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((normalizedRotation * Math.PI) / 180);
  if (flipH) context.scale(-1, 1);
  context.drawImage(image, -sourceWidth / 2, -sourceHeight / 2);
  context.restore();
  return canvas;
}

export function clampImageStudioControl(value: number, min: number, max: number): number {
  const fallback = Math.min(max, Math.max(min, 0));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function stepImageStudioControl(
  value: number,
  direction: -1 | 1,
  min: number,
  max: number,
  step = 1,
): number {
  return clampImageStudioControl(value + direction * step, min, max);
}

/** A studio session never inherits a destructive background-removal choice. */
export function resetImageStudioBackgroundSettings(settings: ConvertSettings): ConvertSettings {
  return {
    ...settings,
    chromaKeyColor: null,
    backgroundRemovalEnabled: false,
  };
}

/** New source images must always begin without a destructive background-removal choice. */
export function resetBackgroundRemovalForNewImage(settings: ConvertSettings): ConvertSettings {
  return resetImageStudioBackgroundSettings(settings);
}
