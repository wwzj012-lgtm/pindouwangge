import type { BeadColor } from '../types';
import type { GridMatrix } from './patternGridCodec';

export const PREVIEW_MAX_SIDE = 256;
export const PREVIEW_MAX_BYTES = 120 * 1024;

export interface PatternPreviewSource {
  width: number;
  height: number;
  grid: GridMatrix;
  palette: BeadColor[];
}

export interface PreviewDimensions {
  width: number;
  height: number;
}

export interface PreviewPixelSource extends PreviewDimensions {
  colorById: Map<string, string>;
}

export function getPreviewDimensions(width: number, height: number, maxSide = PREVIEW_MAX_SIDE): PreviewDimensions {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Pattern dimensions must be positive integers');
  }
  const safeMaxSide = Math.max(1, Math.floor(maxSide));
  const scale = Math.min(1, safeMaxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function colorFromPalette(color: BeadColor): string {
  if (/^#[0-9a-f]{6}$/i.test(color.hex)) return color.hex;
  const [red, green, blue] = color.rgb;
  return `rgb(${red}, ${green}, ${blue})`;
}

export function getPreviewPixelSource(source: PatternPreviewSource, maxSide = PREVIEW_MAX_SIDE): PreviewPixelSource {
  return {
    ...getPreviewDimensions(source.width, source.height, maxSide),
    colorById: new Map(source.palette.map((color) => [color.id, colorFromPalette(color)])),
  };
}

function canvasBlob(canvas: HTMLCanvasElement, type: 'image/webp' | 'image/png'): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, type === 'image/webp' ? 0.82 : undefined));
}

/** Renders only the editable grid and palette; it never reads an imported source image. */
export async function renderPatternPreview(source: PatternPreviewSource): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('Pattern preview rendering requires a browser canvas');
  let maxSide = PREVIEW_MAX_SIDE;
  while (maxSide >= 32) {
    const pixels = getPreviewPixelSource(source, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Pattern preview canvas is unavailable');
    context.fillStyle = '#101827';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;

    for (let y = 0; y < source.height; y += 1) {
      const row = source.grid[y] ?? [];
      const top = Math.floor((y * canvas.height) / source.height);
      const bottom = Math.max(top + 1, Math.ceil(((y + 1) * canvas.height) / source.height));
      for (let x = 0; x < source.width; x += 1) {
        const color = pixels.colorById.get(row[x] ?? '');
        if (!color) continue;
        const left = Math.floor((x * canvas.width) / source.width);
        const right = Math.max(left + 1, Math.ceil(((x + 1) * canvas.width) / source.width));
        context.fillStyle = color;
        context.fillRect(left, top, right - left, bottom - top);
      }
    }

    const webp = await canvasBlob(canvas, 'image/webp');
    if (webp && webp.size <= PREVIEW_MAX_BYTES && webp.type === 'image/webp') return webp;
    const png = await canvasBlob(canvas, 'image/png');
    if (png && png.size <= PREVIEW_MAX_BYTES) return png;
    maxSide = Math.floor(maxSide * 0.75);
  }
  throw new Error('Pattern preview could not be compressed within the size limit');
}
