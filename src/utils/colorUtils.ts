import type { BeadColor, ColorMatchAlgo, ConvertSettings } from '../types';
import {
  convertImageDataToGrid,
  deltaE2000 as pipelineDeltaE2000,
  type ConversionResult,
} from './imagePipeline';

export function srgbToLinear(component: number): number {
  const normalized = component / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(component: number): number {
  const clamped = Math.max(0, Math.min(1, component));
  const srgb = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(srgb * 255)));
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const red = srgbToLinear(r);
  const green = srgbToLinear(g);
  const blue = srgbToLinear(b);
  let x = (red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047;
  let y = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  let z = (red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883;
  const transform = (value: number) => value > 0.008856 ? value ** (1 / 3) : 7.787 * value + 16 / 116;
  x = transform(x);
  y = transform(y);
  z = transform(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function deltaE2000(
  first: [number, number, number],
  second: [number, number, number],
  kL = 1,
  kC = 1,
  kH = 1,
): number {
  if (kL === 1 && kC === 1 && kH === 1) return pipelineDeltaE2000(first, second);

  // Weighted variants are retained for the public helper API used by smart reduction.
  const [l1, a1, b1] = first;
  const [l2, a2, b2] = second;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const hue = (a: number, b: number) => (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);
  const dLp = l2 - l1;
  const dCp = c2p - c1p;
  let dhp = h2p - h1p;
  if (c1p * c2p === 0) dhp = 0;
  else if (dhp > 180) dhp -= 360;
  else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(dhp * Math.PI / 360);
  const lBar = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBar = h1p + h2p;
  if (c1p * c2p !== 0 && Math.abs(h1p - h2p) <= 180) hBar /= 2;
  else if (c1p * c2p !== 0) hBar = hBar < 360 ? (hBar + 360) / 2 : (hBar - 360) / 2;
  const t = 1 - 0.17 * Math.cos((hBar - 30) * Math.PI / 180)
    + 0.24 * Math.cos(2 * hBar * Math.PI / 180)
    + 0.32 * Math.cos((3 * hBar + 6) * Math.PI / 180)
    - 0.2 * Math.cos((4 * hBar - 63) * Math.PI / 180);
  const deltaTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rotation = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  const sl = 1 + 0.015 * (lBar - 50) ** 2 / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin(2 * deltaTheta * Math.PI / 180) * rotation;
  return Math.sqrt(
    (dLp / (kL * sl)) ** 2
    + (dCp / (kC * sc)) ** 2
    + (dHp / (kH * sh)) ** 2
    + rt * (dCp / (kC * sc)) * (dHp / (kH * sh)),
  );
}

export interface PreparedPaletteColor {
  color: BeadColor;
  lab: [number, number, number];
  chroma: number;
}

export function preparePaletteLab(palette: BeadColor[]): PreparedPaletteColor[] {
  return palette
    .filter((color) => color.enabled !== false)
    .map((color) => {
      const lab = rgbToLab(...color.rgb);
      return { color, lab, chroma: Math.hypot(lab[1], lab[2]) };
    });
}

function deltaE76(first: [number, number, number], second: [number, number, number]): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

export function findClosestBeadColor(
  r: number,
  g: number,
  b: number,
  palette: BeadColor[] | PreparedPaletteColor[],
  algorithm: ColorMatchAlgo = 'ciede2000',
): BeadColor {
  if (palette.length === 0) throw new Error('Palette cannot be empty');
  const prepared = 'lab' in palette[0] ? palette as PreparedPaletteColor[] : preparePaletteLab(palette as BeadColor[]);
  if (prepared.length === 0) throw new Error('No enabled palette colors available');
  const targetLab = rgbToLab(r, g, b);
  const targetChroma = Math.hypot(targetLab[1], targetLab[2]);
  let best = prepared[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of prepared) {
    let distance: number;
    if (algorithm === 'rgb_weighted') {
      const dr = r - candidate.color.rgb[0];
      const dg = g - candidate.color.rgb[1];
      const db = b - candidate.color.rgb[2];
      const meanRed = (r + candidate.color.rgb[0]) / 2;
      distance = (2 + meanRed / 256) * dr ** 2 + 4 * dg ** 2 + (2 + (255 - meanRed) / 256) * db ** 2;
    } else {
      distance = algorithm === 'cie76' ? deltaE76(targetLab, candidate.lab) : deltaE2000(targetLab, candidate.lab);
    }
    const neutralTie = targetChroma < 8 && Math.abs(distance - bestDistance) <= 0.1 && candidate.chroma < best.chroma;
    if (distance < bestDistance - 1e-9 || neutralTie) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best.color;
}

function renderConversionSource(img: HTMLImageElement | HTMLCanvasElement): { data: Uint8ClampedArray; width: number; height: number } | null {
  const width = img instanceof HTMLImageElement ? (img.naturalWidth || img.width) : img.width;
  const height = img instanceof HTMLImageElement ? (img.naturalHeight || img.height) : img.height;
  if (width === 0 || height === 0) return null;
  const scale = Math.min(1, 1200 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
}

export function imageToGridWithDiagnostics(
  img: HTMLImageElement | HTMLCanvasElement,
  settings: ConvertSettings,
  palette: BeadColor[],
): ConversionResult {
  const source = renderConversionSource(img);
  if (!source) {
    return {
      grid: [],
      diagnostics: {
        pipeline: 'photo',
        detectedPipeline: 'photo',
        pipelineOverridden: false,
        effectiveColorCount: 0,
        confidence: 0,
        backgroundPixelsRemoved: 0,
        background: null,
        meanSourceLightness: 0,
        meanMatchedLightness: 0,
        lightnessBias: 0,
        meanDeltaE: 0,
        matches: [],
      },
    };
  }
  return convertImageDataToGrid(source.data, source.width, source.height, settings, palette);
}

export function imageToGrid(
  img: HTMLImageElement | HTMLCanvasElement,
  settings: ConvertSettings,
  palette: BeadColor[],
): (string | null)[][] {
  return imageToGridWithDiagnostics(img, settings, palette).grid;
}
