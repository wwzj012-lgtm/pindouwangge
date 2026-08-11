import type { BeadColor, ColorMatchAlgo, ConvertSettings } from '../types';

export type Lab = [number, number, number];
type Rgb = [number, number, number];

export type ConversionPipeline = 'logo' | 'photo';
export type BackgroundInferenceSource = 'auto' | 'manual';

export interface ImageClassification {
  pipeline: ConversionPipeline;
  effectiveColorCount: number;
  confidence: number;
}

export interface BackgroundInference {
  color: string;
  confidence: number;
  source: BackgroundInferenceSource;
}

export interface ColorMatchDiagnostic {
  /** Lab of the adjusted grid sample before any dithering error is received. */
  sourceLab: Lab;
  /** Lab that was actually used to choose the bead after Floyd-Steinberg diffusion. */
  matchingLab: Lab;
  matchedColorId: string;
  matchedColorCode: string;
  deltaE: number;
  secondColorId: string | null;
  secondColorCode: string | null;
  secondDeltaE: number | null;
  deltaEDifference: number | null;
}

export interface ConversionDiagnostics extends ImageClassification {
  detectedPipeline: ConversionPipeline;
  pipelineOverridden: boolean;
  backgroundPixelsRemoved: number;
  background: BackgroundInference | null;
  matches: (ColorMatchDiagnostic | null)[][];
}

export interface ConversionResult {
  grid: (string | null)[][];
  diagnostics: ConversionDiagnostics;
}

interface PaletteEntry {
  color: BeadColor;
  lab: Lab;
  chroma: number;
}

interface GridPixel {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

interface RankedPaletteEntry {
  entry: PaletteEntry;
  distance: number;
  order: number;
}

interface BackgroundCandidate {
  lab: Lab;
  inference: BackgroundInference;
}

interface BackgroundMaskResult {
  mask: Uint8Array;
  inference: BackgroundInference | null;
}

const MAX_ANALYSIS_SAMPLES = 4096;
const COLOR_CLUSTER_DELTA_E = 7;
const BACKGROUND_CLUSTER_DELTA_E = 8;
const MIN_AUTO_BACKGROUND_EDGE_COVERAGE = 0.2;

function clampByte(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : 0;
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function hasExpectedImageData(data: Uint8ClampedArray, width: number, height: number): boolean {
  return isPositiveInteger(width)
    && isPositiveInteger(height)
    && width <= Math.floor(data.length / 4 / height);
}

function normalizeAlphaCutoff(value: number): number {
  return Math.max(1, clampByte(value));
}

function normalizeColorLimit(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : 0;
}

function normalizedSetting(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clampByte(clamped <= 0.0031308 ? clamped * 12.92 * 255 : (1.055 * clamped ** (1 / 2.4) - 0.055) * 255);
}

export function rgbToLab([r, g, b]: Rgb): Lab {
  let x = (srgbToLinear(r) * 0.4124 + srgbToLinear(g) * 0.3576 + srgbToLinear(b) * 0.1805) / 0.95047;
  let y = srgbToLinear(r) * 0.2126 + srgbToLinear(g) * 0.7152 + srgbToLinear(b) * 0.0722;
  let z = (srgbToLinear(r) * 0.0193 + srgbToLinear(g) * 0.1192 + srgbToLinear(b) * 0.9505) / 1.08883;
  const transform = (value: number) => value > 0.008856 ? value ** (1 / 3) : 7.787 * value + 16 / 116;
  x = transform(x);
  y = transform(y);
  z = transform(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function labToRgb([lightness, a, b]: Lab): Rgb {
  let y = (lightness + 16) / 116;
  let x = a / 500 + y;
  let z = y - b / 200;
  const inverseTransform = (value: number) => {
    const cubed = value ** 3;
    return cubed > 0.008856 ? cubed : (value - 16 / 116) / 7.787;
  };
  x = inverseTransform(x) * 0.95047;
  y = inverseTransform(y);
  z = inverseTransform(z) * 1.08883;
  return [
    linearToSrgb(x * 3.2406 + y * -1.5372 + z * -0.4986),
    linearToSrgb(x * -0.9689 + y * 1.8758 + z * 0.0415),
    linearToSrgb(x * 0.0557 + y * -0.204 + z * 1.057),
  ];
}

export function deltaE76(first: Lab, second: Lab): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [l1, a1, b1] = lab1;
  const [l2, a2, b2] = lab2;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const hue = (first: number, second: number) => (Math.atan2(second, first) * 180 / Math.PI + 360) % 360;
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);
  const deltaLightness = l2 - l1;
  const deltaChroma = c2p - c1p;
  let deltaHue = h2p - h1p;
  if (c1p * c2p === 0) deltaHue = 0;
  else if (deltaHue > 180) deltaHue -= 360;
  else if (deltaHue < -180) deltaHue += 360;
  const deltaHueTerm = 2 * Math.sqrt(c1p * c2p) * Math.sin((deltaHue / 2) * Math.PI / 180);
  const lightnessMean = (l1 + l2) / 2;
  const chromaMean = (c1p + c2p) / 2;
  let hueMean = h1p + h2p;
  if (c1p * c2p !== 0 && Math.abs(h1p - h2p) <= 180) hueMean /= 2;
  else if (c1p * c2p !== 0) hueMean = hueMean < 360 ? (hueMean + 360) / 2 : (hueMean - 360) / 2;
  const t = 1 - 0.17 * Math.cos((hueMean - 30) * Math.PI / 180)
    + 0.24 * Math.cos(2 * hueMean * Math.PI / 180)
    + 0.32 * Math.cos((3 * hueMean + 6) * Math.PI / 180)
    - 0.2 * Math.cos((4 * hueMean - 63) * Math.PI / 180);
  const deltaTheta = 30 * Math.exp(-(((hueMean - 275) / 25) ** 2));
  const rotation = 2 * Math.sqrt(chromaMean ** 7 / (chromaMean ** 7 + 25 ** 7));
  const lightnessScale = 1 + 0.015 * (lightnessMean - 50) ** 2 / Math.sqrt(20 + (lightnessMean - 50) ** 2);
  const chromaScale = 1 + 0.045 * chromaMean;
  const hueScale = 1 + 0.015 * chromaMean * t;
  const rotationTerm = -Math.sin(2 * deltaTheta * Math.PI / 180) * rotation;
  return Math.sqrt(
    (deltaLightness / lightnessScale) ** 2
    + (deltaChroma / chromaScale) ** 2
    + (deltaHueTerm / hueScale) ** 2
    + rotationTerm * (deltaChroma / chromaScale) * (deltaHueTerm / hueScale),
  );
}

function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return match ? [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16), Number.parseInt(match[3], 16)] : null;
}

function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((component) => clampByte(component).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function preparePalette(palette: BeadColor[]): PaletteEntry[] {
  return palette.filter((color) => color.enabled !== false).map((color) => {
    const lab = rgbToLab(color.rgb);
    return { color, lab, chroma: Math.hypot(lab[1], lab[2]) };
  });
}

function paletteDistance(target: Lab, candidate: PaletteEntry, algorithm: 'cie76' | 'ciede2000'): number {
  return algorithm === 'cie76' ? deltaE76(target, candidate.lab) : deltaE2000(target, candidate.lab);
}

function rankPaletteMatches(target: Lab, palette: PaletteEntry[], algorithm: 'cie76' | 'ciede2000'): RankedPaletteEntry[] {
  const targetChroma = Math.hypot(target[1], target[2]);
  return palette
    .map((entry, order) => ({ entry, order, distance: paletteDistance(target, entry, algorithm) }))
    .sort((first, second) => {
      if (targetChroma < 8 && Math.abs(first.distance - second.distance) <= 0.1) {
        return first.entry.chroma - second.entry.chroma || first.order - second.order;
      }
      return first.distance - second.distance || first.order - second.order;
    });
}

function diagnosticForMatch(sourceLab: Lab, matchingLab: Lab, ranked: RankedPaletteEntry[]): ColorMatchDiagnostic {
  const first = ranked[0];
  const second = ranked[1] ?? null;
  return {
    sourceLab,
    matchingLab,
    matchedColorId: first.entry.color.id,
    matchedColorCode: first.entry.color.code,
    deltaE: first.distance,
    secondColorId: second?.entry.color.id ?? null,
    secondColorCode: second?.entry.color.code ?? null,
    secondDeltaE: second?.distance ?? null,
    deltaEDifference: second ? second.distance - first.distance : null,
  };
}

export function classifyImageColors(data: Uint8ClampedArray, width: number, height: number, alphaCutoff = 16): ImageClassification {
  if (!hasExpectedImageData(data, width, height)) {
    return { pipeline: 'photo', effectiveColorCount: 0, confidence: 0 };
  }
  const normalizedAlphaCutoff = normalizeAlphaCutoff(alphaCutoff);
  const totalPixels = width * height;
  const stride = Math.max(1, Math.floor(Math.sqrt(totalPixels / MAX_ANALYSIS_SAMPLES)));
  const clusters: Array<{ lab: Lab; count: number }> = [];
  let sampled = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < normalizedAlphaCutoff) continue;
      sampled += 1;
      const lab = rgbToLab([data[offset], data[offset + 1], data[offset + 2]]);
      let nearest = -1;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < clusters.length; index += 1) {
        const distance = deltaE76(lab, clusters[index].lab);
        if (distance < nearestDistance) {
          nearest = index;
          nearestDistance = distance;
        }
      }
      if (nearest >= 0 && nearestDistance <= COLOR_CLUSTER_DELTA_E) {
        const cluster = clusters[nearest];
        cluster.count += 1;
        cluster.lab = [
          (cluster.lab[0] * (cluster.count - 1) + lab[0]) / cluster.count,
          (cluster.lab[1] * (cluster.count - 1) + lab[1]) / cluster.count,
          (cluster.lab[2] * (cluster.count - 1) + lab[2]) / cluster.count,
        ];
      } else if (clusters.length < 64) {
        clusters.push({ lab, count: 1 });
      } else if (nearest >= 0) {
        clusters[nearest].count += 1;
      }
    }
  }
  const significant = clusters.filter((cluster) => cluster.count / Math.max(1, sampled) >= 0.003);
  const effectiveColorCount = significant.length;
  const boundaryGap = Math.abs(effectiveColorCount - 5.5);
  const coverage = significant.reduce((sum, cluster) => sum + cluster.count, 0) / Math.max(1, sampled);
  const confidence = Math.min(1, 0.5 + Math.min(0.4, boundaryGap * 0.12) + Math.min(0.1, coverage * 0.1));
  return { pipeline: effectiveColorCount <= 5 ? 'logo' : 'photo', effectiveColorCount, confidence };
}

function edgePixelIndexes(width: number, height: number): number[] {
  const indexes = new Set<number>();
  for (let x = 0; x < width; x += 1) {
    indexes.add(x);
    indexes.add((height - 1) * width + x);
  }
  for (let y = 1; y + 1 < height; y += 1) {
    indexes.add(y * width);
    indexes.add(y * width + width - 1);
  }
  return [...indexes];
}

function inferEdgeBackgroundCandidate(data: Uint8ClampedArray, width: number, height: number, alphaCutoff: number): BackgroundCandidate | null {
  if (!hasExpectedImageData(data, width, height)) return null;
  const normalizedAlphaCutoff = normalizeAlphaCutoff(alphaCutoff);
  const clusters: Array<{ lab: Lab; count: number }> = [];
  let samples = 0;
  for (const index of edgePixelIndexes(width, height)) {
    const offset = index * 4;
    if (data[offset + 3] < normalizedAlphaCutoff) continue;
    samples += 1;
    const lab = rgbToLab([data[offset], data[offset + 1], data[offset + 2]]);
    let nearest = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex += 1) {
      const distance = deltaE76(lab, clusters[clusterIndex].lab);
      if (distance < nearestDistance) {
        nearest = clusterIndex;
        nearestDistance = distance;
      }
    }
    if (nearest >= 0 && nearestDistance <= BACKGROUND_CLUSTER_DELTA_E) {
      const cluster = clusters[nearest];
      cluster.count += 1;
      cluster.lab = [
        (cluster.lab[0] * (cluster.count - 1) + lab[0]) / cluster.count,
        (cluster.lab[1] * (cluster.count - 1) + lab[1]) / cluster.count,
        (cluster.lab[2] * (cluster.count - 1) + lab[2]) / cluster.count,
      ];
    } else {
      clusters.push({ lab, count: 1 });
    }
  }
  if (samples === 0 || clusters.length === 0) return null;
  const ranked = [...clusters].sort((first, second) => second.count - first.count);
  const winner = ranked[0];
  const coverage = winner.count / samples;
  if (coverage < MIN_AUTO_BACKGROUND_EDGE_COVERAGE) return null;
  const runnerUpCoverage = (ranked[1]?.count ?? 0) / samples;
  const confidence = clampUnit(0.45 + coverage * 0.45 + Math.max(0, coverage - runnerUpCoverage) * 0.1);
  return {
    lab: winner.lab,
    inference: { color: rgbToHex(labToRgb(winner.lab)), confidence, source: 'auto' },
  };
}

export function inferEdgeBackground(data: Uint8ClampedArray, width: number, height: number, alphaCutoff = 16): BackgroundInference | null {
  return inferEdgeBackgroundCandidate(data, width, height, alphaCutoff)?.inference ?? null;
}

function resolveBackgroundCandidate(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  backgroundHex: string | null,
  alphaCutoff: number,
): BackgroundCandidate | null {
  if (backgroundHex === null) return inferEdgeBackgroundCandidate(data, width, height, alphaCutoff);
  const rgb = hexToRgb(backgroundHex);
  if (!rgb) return null;
  return {
    lab: rgbToLab(rgb),
    inference: { color: rgbToHex(rgb), confidence: 1, source: 'manual' },
  };
}

function createEdgeConnectedBackgroundMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  backgroundHex: string | null,
  tolerancePercent: number,
  alphaCutoff: number,
): BackgroundMaskResult {
  if (!hasExpectedImageData(data, width, height)) {
    return { mask: new Uint8Array(0), inference: null };
  }
  const mask = new Uint8Array(width * height);
  const normalizedAlphaCutoff = normalizeAlphaCutoff(alphaCutoff);
  const candidateBackground = resolveBackgroundCandidate(data, width, height, backgroundHex, normalizedAlphaCutoff);
  if (!candidateBackground) return { mask, inference: null };

  const baseTolerance = 2 + Math.max(0, Math.min(100, tolerancePercent)) * 0.28;
  const tolerance = candidateBackground.inference.source === 'auto' ? Math.max(8, baseTolerance) : baseTolerance;
  const candidate = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    // Alpha is authoritative and cannot be reclassified by any background heuristic.
    if (data[offset + 3] >= normalizedAlphaCutoff
      && deltaE76(rgbToLab([data[offset], data[offset + 1], data[offset + 2]]), candidateBackground.lab) <= tolerance) {
      candidate[index] = 1;
    }
  }

  const visited = new Uint8Array(width * height);
  const minComponentSize = Math.max(4, Math.ceil(width * height * 0.01));
  const perimeter = width * 2 + Math.max(0, height - 2) * 2;
  const minEdgeCoverage = Math.max(2, Math.ceil(perimeter * 0.08));
  for (const start of edgePixelIndexes(width, height)) {
    if (!candidate[start] || visited[start]) continue;
    const component: number[] = [];
    const queue = [start];
    let edgeCoverage = 0;
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      component.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) edgeCoverage += 1;
      const visit = (next: number) => {
        if (!candidate[next] || visited[next]) return;
        visited[next] = 1;
        queue.push(next);
      };
      // 4-neighbour flood fill deliberately prevents diagonal leaks into protected holes.
      if (x > 0) visit(index - 1);
      if (x + 1 < width) visit(index + 1);
      if (y > 0) visit(index - width);
      if (y + 1 < height) visit(index + width);
    }
    if (component.length >= minComponentSize && edgeCoverage >= minEdgeCoverage) {
      for (const index of component) mask[index] = 1;
    }
  }
  return { mask, inference: candidateBackground.inference };
}

export function edgeConnectedBackgroundMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  backgroundHex: string | null,
  tolerancePercent: number,
  alphaCutoff: number,
): Uint8Array {
  return createEdgeConnectedBackgroundMask(data, width, height, backgroundHex, tolerancePercent, alphaCutoff).mask;
}

function adjustColor(rgb: Rgb, settings: ConvertSettings): Rgb {
  let [r, g, b] = rgb;
  const brightness = normalizedSetting(settings.brightness) / 100 * 255;
  r += brightness;
  g += brightness;
  b += brightness;
  const contrast = normalizedSetting(settings.contrast);
  if (contrast !== 0) {
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    r = factor * (r - 128) + 128;
    g = factor * (g - 128) + 128;
    b = factor * (b - 128) + 128;
  }
  const saturation = normalizedSetting(settings.saturation);
  if (saturation !== 0) {
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const factor = 1 + saturation / 100;
    r = gray + (r - gray) * factor;
    g = gray + (g - gray) * factor;
    b = gray + (b - gray) * factor;
  }
  return [clampByte(r), clampByte(g), clampByte(b)];
}

function selectPalette(pixels: GridPixel[], palette: PaletteEntry[], colorLimit: number, algorithm: 'cie76' | 'ciede2000'): PaletteEntry[] {
  const normalizedColorLimit = normalizeColorLimit(colorLimit);
  if (normalizedColorLimit === 0 || palette.length <= normalizedColorLimit) return palette;
  const counts = new Map<string, number>();
  for (const pixel of pixels) {
    if (pixel.alpha === 0) continue;
    const winner = rankPaletteMatches(rgbToLab([pixel.r, pixel.g, pixel.b]), palette, algorithm)[0];
    counts.set(winner.entry.color.id, (counts.get(winner.entry.color.id) ?? 0) + 1);
  }
  const ids = new Set(Array.from(counts.entries()).sort((first, second) => second[1] - first[1]).slice(0, normalizedColorLimit).map(([id]) => id));
  return palette.filter((entry) => ids.has(entry.color.id));
}

function cleanLogoNoise(grid: (string | null)[][]): void {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const updates: Array<{ x: number; y: number; color: string }> = [];
  for (let y = 1; y + 1 < height; y += 1) {
    for (let x = 1; x + 1 < width; x += 1) {
      const current = grid[y][x];
      if (!current) continue;
      const neighbors = [grid[y - 1][x], grid[y + 1][x], grid[y][x - 1], grid[y][x + 1]];
      if (neighbors.includes(current) || neighbors.some((value) => !value)) continue;
      if (neighbors.every((value) => value === neighbors[0])) updates.push({ x, y, color: neighbors[0]! });
    }
  }
  for (const update of updates) grid[update.y][update.x] = update.color;
}

function emptyResult(): ConversionResult {
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
      matches: [],
    },
  };
}

export function convertImageDataToGrid(data: Uint8ClampedArray, sourceWidth: number, sourceHeight: number, settings: ConvertSettings, palette: BeadColor[]): ConversionResult {
  if (!hasExpectedImageData(data, sourceWidth, sourceHeight)
    || !isPositiveInteger(settings.width)
    || !isPositiveInteger(settings.height)
    || !Array.isArray(palette)) return emptyResult();
  const activePalette = preparePalette(palette);
  if (activePalette.length === 0) return emptyResult();

  const alphaCutoff = normalizeAlphaCutoff(settings.transparentCutoff);

  const detected = classifyImageColors(data, sourceWidth, sourceHeight, alphaCutoff);
  const override = settings.pipelineOverride ?? 'auto';
  const pipeline = override === 'auto' ? detected.pipeline : override;
  const backgroundResult = createEdgeConnectedBackgroundMask(
    data,
    sourceWidth,
    sourceHeight,
    settings.chromaKeyColor,
    normalizedSetting(settings.chromaKeyTolerance),
    alphaCutoff,
  );
  const targetPixels: GridPixel[] = [];
  const scaleX = sourceWidth / settings.width;
  const scaleY = sourceHeight / settings.height;
  for (let gridY = 0; gridY < settings.height; gridY += 1) {
    for (let gridX = 0; gridX < settings.width; gridX += 1) {
      const startX = gridX * scaleX;
      const endX = (gridX + 1) * scaleX;
      const startY = gridY * scaleY;
      const endY = (gridY + 1) * scaleY;
      let total = 0;
      let valid = 0;
      let linearR = 0;
      let linearG = 0;
      let linearB = 0;
      const dominant = new Map<string, { weight: number; rgb: Rgb }>();
      for (let y = Math.floor(startY); y < Math.min(sourceHeight, Math.ceil(endY)); y += 1) {
        const verticalWeight = Math.max(0, Math.min(y + 1, endY) - Math.max(y, startY));
        for (let x = Math.floor(startX); x < Math.min(sourceWidth, Math.ceil(endX)); x += 1) {
          const horizontalWeight = Math.max(0, Math.min(x + 1, endX) - Math.max(x, startX));
          const weight = horizontalWeight * verticalWeight;
          total += weight;
          const sourceIndex = y * sourceWidth + x;
          const offset = sourceIndex * 4;
          if (backgroundResult.mask[sourceIndex] || data[offset + 3] < alphaCutoff) continue;
          const alphaWeight = weight * data[offset + 3] / 255;
          valid += alphaWeight;
          const r = data[offset];
          const g = data[offset + 1];
          const b = data[offset + 2];
          linearR += srgbToLinear(r) * alphaWeight;
          linearG += srgbToLinear(g) * alphaWeight;
          linearB += srgbToLinear(b) * alphaWeight;
          const key = `${r >> 4}:${g >> 4}:${b >> 4}`;
          const entry = dominant.get(key) ?? { weight: 0, rgb: [r, g, b] };
          entry.weight += alphaWeight;
          dominant.set(key, entry);
        }
      }
      if (valid / Math.max(total, 0.00001) < 0.35) {
        targetPixels.push({ r: 0, g: 0, b: 0, alpha: 0 });
        continue;
      }
      const rgb: Rgb = pipeline === 'logo'
        ? Array.from(dominant.values()).sort((first, second) => second.weight - first.weight)[0].rgb
        : [linearToSrgb(linearR / valid), linearToSrgb(linearG / valid), linearToSrgb(linearB / valid)];
      const adjusted = adjustColor(rgb, settings);
      targetPixels.push({ r: adjusted[0], g: adjusted[1], b: adjusted[2], alpha: 255 });
    }
  }

  const matchAlgorithm: 'cie76' | 'ciede2000' = pipeline === 'logo' ? 'cie76' : 'ciede2000';
  const selectedPalette = selectPalette(targetPixels, activePalette, settings.colorLimit, matchAlgorithm);
  const mappingPalette = selectedPalette.length > 0 ? selectedPalette : activePalette;
  // targetPixels remains immutable so diagnostics always represent the source grid sample.
  const sourceLabs = targetPixels.map((pixel) => pixel.alpha === 0 ? null : rgbToLab([pixel.r, pixel.g, pixel.b]));
  const working = targetPixels.map((pixel) => ({ ...pixel }));
  const grid = Array.from({ length: settings.height }, () => Array<string | null>(settings.width).fill(null));
  const matches = Array.from({ length: settings.height }, () => Array<ColorMatchDiagnostic | null>(settings.width).fill(null));
  const ditherStrength = clampUnit(settings.ditherStrength ?? 0.65);
  const useFloydSteinberg = pipeline === 'photo' && settings.dither === 'floyd' && ditherStrength > 0;
  for (let y = 0; y < settings.height; y += 1) {
    const direction = useFloydSteinberg && y % 2 === 1 ? -1 : 1;
    for (let step = 0; step < settings.width; step += 1) {
      const x = direction === 1 ? step : settings.width - 1 - step;
      const index = y * settings.width + x;
      const pixel = working[index];
      if (pixel.alpha === 0) continue;
      const matchingLab = rgbToLab([clampByte(pixel.r), clampByte(pixel.g), clampByte(pixel.b)]);
      const sourceLab = sourceLabs[index];
      if (!sourceLab) continue;
      const ranked = rankPaletteMatches(matchingLab, mappingPalette, matchAlgorithm);
      const diagnostic = diagnosticForMatch(sourceLab, matchingLab, ranked);
      const matched = ranked[0].entry.color;
      grid[y][x] = matched.id;
      matches[y][x] = diagnostic;
      if (!useFloydSteinberg) continue;
      const error: Rgb = [pixel.r - matched.rgb[0], pixel.g - matched.rgb[1], pixel.b - matched.rgb[2]];
      const diffuse = (nextX: number, nextY: number, weight: number) => {
        if (nextX < 0 || nextX >= settings.width || nextY < 0 || nextY >= settings.height) return;
        const neighbor = working[nextY * settings.width + nextX];
        if (neighbor.alpha === 0) return;
        const lumaDifference = Math.abs((pixel.r + pixel.g + pixel.b - neighbor.r - neighbor.g - neighbor.b) / 3);
        if (lumaDifference > 55) return;
        const scaledWeight = weight * ditherStrength;
        neighbor.r += Math.max(-48, Math.min(48, error[0])) * scaledWeight;
        neighbor.g += Math.max(-48, Math.min(48, error[1])) * scaledWeight;
        neighbor.b += Math.max(-48, Math.min(48, error[2])) * scaledWeight;
      };
      diffuse(x + direction, y, 7 / 16);
      diffuse(x - direction, y + 1, 3 / 16);
      diffuse(x, y + 1, 5 / 16);
      diffuse(x + direction, y + 1, 1 / 16);
    }
  }
  if (pipeline === 'logo') cleanLogoNoise(grid);
  return {
    grid,
    diagnostics: {
      pipeline,
      detectedPipeline: detected.pipeline,
      pipelineOverridden: override !== 'auto',
      effectiveColorCount: detected.effectiveColorCount,
      confidence: detected.confidence,
      backgroundPixelsRemoved: backgroundResult.mask.reduce((sum, value) => sum + value, 0),
      background: backgroundResult.inference,
      matches,
    },
  };
}

export function standardAlgorithm(algorithm: ColorMatchAlgo): 'cie76' | 'ciede2000' {
  return algorithm === 'cie76' ? 'cie76' : 'ciede2000';
}
