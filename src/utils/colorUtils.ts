import { BeadColor, ConvertSettings, DitherMode } from '../types';

// Convert RGB to LAB for accurate Delta E distance calculation
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let rN = r / 255, gN = g / 255, bN = b / 255;
  rN = rN > 0.04045 ? Math.pow((rN + 0.055) / 1.055, 2.4) : rN / 12.92;
  gN = gN > 0.04045 ? Math.pow((gN + 0.055) / 1.055, 2.4) : gN / 12.92;
  bN = bN > 0.04045 ? Math.pow((bN + 0.055) / 1.055, 2.4) : bN / 12.92;

  let x = (rN * 0.4124 + gN * 0.3576 + bN * 0.1805) * 100;
  let y = (rN * 0.2126 + gN * 0.7152 + bN * 0.0722) * 100;
  let z = (rN * 0.0193 + gN * 0.1192 + bN * 0.9505) * 100;

  // Reference White D65
  x /= 95.047;
  y /= 100.000;
  z /= 108.883;

  x = x > 0.008856 ? Math.pow(x, 1 / 3) : (7.787 * x) + (16 / 116);
  y = y > 0.008856 ? Math.pow(y, 1 / 3) : (7.787 * y) + (16 / 116);
  z = z > 0.008856 ? Math.pow(z, 1 / 3) : (7.787 * z) + (16 / 116);

  const L = (116 * y) - 16;
  const a = 500 * (x - y);
  const B = 200 * (y - z);

  return [L, a, B];
}

// Find closest BeadColor in active palette
export function findClosestBeadColor(
  r: number,
  g: number,
  b: number,
  palette: BeadColor[]
): BeadColor {
  if (palette.length === 0) {
    throw new Error('Palette cannot be empty');
  }

  const targetLab = rgbToLab(r, g, b);
  let minDistance = Infinity;
  let closest = palette[0];

  for (const color of palette) {
    if (color.enabled === false) continue;

    const colorLab = rgbToLab(color.rgb[0], color.rgb[1], color.rgb[2]);
    // CIE76 Delta E
    const dL = targetLab[0] - colorLab[0];
    const da = targetLab[1] - colorLab[1];
    const db = targetLab[2] - colorLab[2];
    const dist = dL * dL + da * da + db * db;

    if (dist < minDistance) {
      minDistance = dist;
      closest = color;
    }
  }

  return closest;
}

// Pre-process image pixels with Brightness, Contrast, Saturation adjustments
function adjustColor(
  r: number,
  g: number,
  b: number,
  brightness: number,
  contrast: number,
  saturation: number
): [number, number, number] {
  // 1. Brightness (-100 to 100)
  r += (brightness / 100) * 255;
  g += (brightness / 100) * 255;
  b += (brightness / 100) * 255;

  // 2. Contrast (-100 to 100)
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  r = factor * (r - 128) + 128;
  g = factor * (g - 128) + 128;
  b = factor * (b - 128) + 128;

  // 3. Saturation (-100 to 100)
  const gray = 0.2989 * r + 0.5870 * g + 0.1140 * b;
  const satFactor = (saturation + 100) / 100;
  r = gray + satFactor * (r - gray);
  g = gray + satFactor * (g - gray);
  b = gray + satFactor * (b - gray);

  return [
    Math.min(255, Math.max(0, Math.round(r))),
    Math.min(255, Math.max(0, Math.round(g))),
    Math.min(255, Math.max(0, Math.round(b))),
  ];
}

// Convert image element to Grid (matrix of color IDs or null)
export function imageToGrid(
  img: HTMLImageElement | HTMLCanvasElement,
  settings: ConvertSettings,
  palette: BeadColor[]
): (string | null)[][] {
  const activePalette = palette.filter(c => c.enabled !== false);
  if (activePalette.length === 0) return [];

  const { width: targetW, height: targetH, dither, brightness, contrast, saturation, transparentCutoff } = settings;

  // Create temporary offscreen canvas to scale image
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  // Image smoothing false for pixel crisp scaling
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  const data = imgData.data;

  // Prepare float buffer for dithering processing
  const bufferR = new Float32Array(targetW * targetH);
  const bufferG = new Float32Array(targetW * targetH);
  const bufferB = new Float32Array(targetW * targetH);
  const bufferA = new Uint8Array(targetW * targetH);

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const idx = (y * targetW + x) * 4;
      const alpha = data[idx + 3];
      bufferA[y * targetW + x] = alpha;

      if (alpha >= transparentCutoff) {
        const [ar, ag, ab] = adjustColor(
          data[idx],
          data[idx + 1],
          data[idx + 2],
          brightness,
          contrast,
          saturation
        );
        bufferR[y * targetW + x] = ar;
        bufferG[y * targetW + x] = ag;
        bufferB[y * targetW + x] = ab;
      } else {
        bufferR[y * targetW + x] = 0;
        bufferG[y * targetW + x] = 0;
        bufferB[y * targetW + x] = 0;
      }
    }
  }

  const resultGrid: (string | null)[][] = Array.from({ length: targetH }, () =>
    Array(targetW).fill(null)
  );

  // Apply conversion with selected dither mode
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const idx = y * targetW + x;
      if (bufferA[idx] < transparentCutoff) {
        resultGrid[y][x] = null;
        continue;
      }

      const curR = Math.min(255, Math.max(0, bufferR[idx]));
      const curG = Math.min(255, Math.max(0, bufferG[idx]));
      const curB = Math.min(255, Math.max(0, bufferB[idx]));

      const closest = findClosestBeadColor(curR, curG, curB, activePalette);
      resultGrid[y][x] = closest.id;

      if (dither !== 'none') {
        const errR = curR - closest.rgb[0];
        const errG = curG - closest.rgb[1];
        const errB = curB - closest.rgb[2];

        const addError = (nx: number, ny: number, weight: number) => {
          if (nx >= 0 && nx < targetW && ny >= 0 && ny < targetH) {
            const nIdx = ny * targetW + nx;
            if (bufferA[nIdx] >= transparentCutoff) {
              bufferR[nIdx] += errR * weight;
              bufferG[nIdx] += errG * weight;
              bufferB[nIdx] += errB * weight;
            }
          }
        };

        if (dither === 'floyd') {
          // Floyd-Steinberg error diffusion
          addError(x + 1, y, 7 / 16);
          addError(x - 1, y + 1, 3 / 16);
          addError(x, y + 1, 5 / 16);
          addError(x + 1, y + 1, 1 / 16);
        } else if (dither === 'atkinson') {
          // Atkinson dithering
          addError(x + 1, y, 1 / 8);
          addError(x + 2, y, 1 / 8);
          addError(x - 1, y + 1, 1 / 8);
          addError(x, y + 1, 1 / 8);
          addError(x + 1, y + 1, 1 / 8);
          addError(x, y + 2, 1 / 8);
        }
      }
    }
  }

  // If color limit is specified (> 0)
  if (settings.colorLimit > 0) {
    return applyColorLimit(resultGrid, activePalette, settings.colorLimit);
  }

  return resultGrid;
}

// Reduce color count to capped limit if requested
function applyColorLimit(
  grid: (string | null)[][],
  palette: BeadColor[],
  maxColors: number
): (string | null)[][] {
  const counts = new Map<string, number>();
  for (const row of grid) {
    for (const cell of row) {
      if (cell) {
        counts.set(cell, (counts.get(cell) || 0) + 1);
      }
    }
  }

  if (counts.size <= maxColors) return grid;

  // Pick top N colors
  const topColorIds = new Set(
    Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxColors)
      .map(entry => entry[0])
  );

  const restrictedPalette = palette.filter(c => topColorIds.has(c.id));
  if (restrictedPalette.length === 0) return grid;

  // Remap non-top colors to nearest allowed top color
  const paletteMap = new Map(palette.map(c => [c.id, c]));

  return grid.map(row =>
    row.map(cellId => {
      if (!cellId || topColorIds.has(cellId)) return cellId;
      const curColor = paletteMap.get(cellId);
      if (!curColor) return cellId;
      const closest = findClosestBeadColor(
        curColor.rgb[0],
        curColor.rgb[1],
        curColor.rgb[2],
        restrictedPalette
      );
      return closest.id;
    })
  );
}
