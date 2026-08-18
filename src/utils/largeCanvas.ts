import type { ConvertSettings } from '../types';

export type LargeCanvasConversionMode = 'cartoon' | 'photo' | 'logo';

export const LARGE_CANVAS_MODES: ReadonlyArray<{ id: LargeCanvasConversionMode; label: string }> = [
  { id: 'cartoon', label: '卡通' },
  { id: 'photo', label: '照片' },
  { id: 'logo', label: 'Logo文字' },
];

export const LARGE_CANVAS_MAX_GRID_SIZE = 100;
export const LARGE_CANVAS_MIN_GRID_SIZE = 1;
export const LARGE_CANVAS_MAX_SIDES = [100, 50, 25] as const;
export type LargeCanvasMaxSide = typeof LARGE_CANVAS_MAX_SIDES[number];

export interface LargeCanvasGridRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LargeCanvasGridResizeHandle = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

function snapGridCoordinate(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function snapGridSize(value: number): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : LARGE_CANVAS_MIN_GRID_SIZE;
  return Math.max(LARGE_CANVAS_MIN_GRID_SIZE, Math.min(LARGE_CANVAS_MAX_GRID_SIZE, rounded));
}

/** Snaps a frame to integer grid cells and limits either dimension to 1..100 cells. */
export function snapLargeCanvasGridRect(rect: LargeCanvasGridRect): LargeCanvasGridRect {
  return {
    id: rect.id,
    x: snapGridCoordinate(rect.x),
    y: snapGridCoordinate(rect.y),
    width: snapGridSize(rect.width),
    height: snapGridSize(rect.height),
  };
}

/** Uses half-open cell intervals, so frames that only share an edge do not overlap. */
export function largeCanvasGridRectsOverlap(first: LargeCanvasGridRect, second: LargeCanvasGridRect): boolean {
  const a = snapLargeCanvasGridRect(first);
  const b = snapLargeCanvasGridRect(second);
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function getLargeCanvasGridRectCandidate(
  candidate: LargeCanvasGridRect,
  frames: readonly LargeCanvasGridRect[],
): LargeCanvasGridRect | null {
  const snapped = snapLargeCanvasGridRect(candidate);
  return frames.some(frame => frame.id !== snapped.id && largeCanvasGridRectsOverlap(snapped, frame)) ? null : snapped;
}

/** Returns a snapped new frame, or null when it intersects an existing frame. */
export function getNewLargeCanvasGridRectCandidate(
  candidate: LargeCanvasGridRect,
  frames: readonly LargeCanvasGridRect[],
): LargeCanvasGridRect | null {
  return getLargeCanvasGridRectCandidate(candidate, frames);
}

/** Returns a snapped moved frame, or null when the move intersects another frame. */
export function getMovedLargeCanvasGridRectCandidate(
  frame: LargeCanvasGridRect,
  position: Pick<LargeCanvasGridRect, 'x' | 'y'>,
  frames: readonly LargeCanvasGridRect[],
): LargeCanvasGridRect | null {
  return getLargeCanvasGridRectCandidate({ ...frame, ...position }, frames);
}

/** Returns a snapped corner-resize result, or null when it intersects another frame. */
export function getResizedLargeCanvasGridRectCandidate(
  frame: LargeCanvasGridRect,
  handle: LargeCanvasGridResizeHandle,
  point: Pick<LargeCanvasGridRect, 'x' | 'y'>,
  frames: readonly LargeCanvasGridRect[],
): LargeCanvasGridRect | null {
  const current = snapLargeCanvasGridRect(frame);
  const x = snapGridCoordinate(point.x);
  const y = snapGridCoordinate(point.y);
  const right = current.x + current.width;
  const bottom = current.y + current.height;

  if (handle === 'top-left') {
    const width = snapGridSize(right - x);
    const height = snapGridSize(bottom - y);
    return getLargeCanvasGridRectCandidate({ ...current, x: right - width, y: bottom - height, width, height }, frames);
  }
  if (handle === 'top-right') {
    const width = snapGridSize(x - current.x);
    const height = snapGridSize(bottom - y);
    return getLargeCanvasGridRectCandidate({ ...current, y: bottom - height, width, height }, frames);
  }
  if (handle === 'bottom-left') {
    const width = snapGridSize(right - x);
    const height = snapGridSize(y - current.y);
    return getLargeCanvasGridRectCandidate({ ...current, x: right - width, width, height }, frames);
  }

  return getLargeCanvasGridRectCandidate({ ...current, width: snapGridSize(x - current.x), height: snapGridSize(y - current.y) }, frames);
}

export function getLargeCanvasGridDimensions(
  naturalWidth: number,
  naturalHeight: number,
  maxSide: LargeCanvasMaxSide = LARGE_CANVAS_MAX_GRID_SIZE,
): { width: number; height: number } {
  const targetSide: LargeCanvasMaxSide = LARGE_CANVAS_MAX_SIDES.includes(maxSide) ? maxSide : LARGE_CANVAS_MAX_GRID_SIZE;
  const width = Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : 1;
  const height = Number.isFinite(naturalHeight) && naturalHeight > 0 ? naturalHeight : 1;

  if (width >= height) {
    return {
      width: targetSide,
      height: Math.max(1, Math.min(targetSide, Math.round(targetSide * height / width))),
    };
  }

  return {
    width: Math.max(1, Math.min(targetSide, Math.round(targetSide * width / height))),
    height: targetSide,
  };
}

export function getLargeCanvasModeSettings(mode: LargeCanvasConversionMode): Pick<ConvertSettings, 'pipelineOverride' | 'dither' | 'ditherStrength' | 'sharpening' | 'outlineBoost'> {
  if (mode === 'photo') {
    return { pipelineOverride: 'photo', dither: 'floyd', ditherStrength: 0.65, sharpening: 15, outlineBoost: false };
  }
  if (mode === 'logo') {
    return { pipelineOverride: 'logo', dither: 'none', ditherStrength: 0, sharpening: 55, outlineBoost: true };
  }
  return { pipelineOverride: 'logo', dither: 'none', ditherStrength: 0, sharpening: 25, outlineBoost: true };
}

export function clampLargeCanvasFramePosition(
  position: { x: number; y: number },
  bounds: { width: number; height: number },
  frame: { width: number; height: number },
  padding = 16,
): { x: number; y: number } {
  return {
    x: Math.max(padding, Math.min(bounds.width - frame.width - padding, position.x)),
    y: Math.max(padding, Math.min(bounds.height - frame.height - padding, position.y)),
  };
}
