import type { BeadColor } from '../types';
import type { GridMatrix } from './patternGridCodec';

export const PREVIEW_MAX_SIDE = 256;
export const PREVIEW_MAX_BYTES = 120 * 1024;
/** 空白格底色（与旧 fillRect 版本一致）。 */
const PREVIEW_BACKGROUND_RGB: [number, number, number] = [0x10, 0x18, 0x27];

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
    context.imageSmoothingEnabled = false;

    // 逐格 fillRect 在 100×100 上是 1 万次 fillStyle 字符串赋值 + 1 万次
    // 裁剪绘制，实测 340ms——而保存的等待时间里有它一大半。改成直接写
    // ImageData（一次 putImageData）：同样的"最近邻不插值"几何，像素级
    // 直写实测 <15ms（2026-11-25 保存提速）。
    const outW = canvas.width;
    const outH = canvas.height;
    const image = context.createImageData(outW, outH);
    const data = image.data;
    const bg = PREVIEW_BACKGROUND_RGB;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = bg[0]; data[i + 1] = bg[1]; data[i + 2] = bg[2]; data[i + 3] = 255;
    }
    const rgbById = new Map<string, [number, number, number]>();
    for (const color of source.palette) {
      rgbById.set(color.id, [color.rgb[0], color.rgb[1], color.rgb[2]]);
    }
    for (let y = 0; y < source.height; y += 1) {
      const row = source.grid[y] ?? [];
      const top = Math.floor((y * outH) / source.height);
      const bottom = Math.min(outH, Math.max(top + 1, Math.ceil(((y + 1) * outH) / source.height)));
      for (let x = 0; x < source.width; x += 1) {
        const rgb = rgbById.get(row[x] ?? '');
        if (!rgb) continue;
        const left = Math.floor((x * outW) / source.width);
        const right = Math.min(outW, Math.max(left + 1, Math.ceil(((x + 1) * outW) / source.width)));
        for (let py = top; py < bottom; py += 1) {
          let offset = (py * outW + left) * 4;
          for (let px = left; px < right; px += 1) {
            data[offset] = rgb[0];
            data[offset + 1] = rgb[1];
            data[offset + 2] = rgb[2];
            offset += 4;
          }
        }
      }
    }
    context.putImageData(image, 0, 0);

    const webp = await canvasBlob(canvas, 'image/webp');
    if (webp && webp.size <= PREVIEW_MAX_BYTES && webp.type === 'image/webp') return webp;
    const png = await canvasBlob(canvas, 'image/png');
    if (png && png.size <= PREVIEW_MAX_BYTES) return png;
    maxSide = Math.floor(maxSide * 0.75);
  }
  throw new Error('Pattern preview could not be compressed within the size limit');
}
