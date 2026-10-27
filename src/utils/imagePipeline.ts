import type { BeadColor, ColorMatchAlgo, ConvertSettings } from '../types';
import { consolidateStrayBeans } from './strayBeanConsolidation';
import { projectCartoonInk } from './cartoonSampling';
import { clusterCellColors, cellForeground, resolveCellForeground, enclosedSourceWhite, sourceHasTransparency, type CellColorBin, type CellForeground } from './sourceSampling';
import { selectPerceptualPalette } from './perceptualPalette';
import {
  classifyGridRegions,
  classifySourceRegions,
  computeDitherAdaptationMap,
  preprocessSourceImage,
  suppressSmoothAreaClutterClusters,
  type PreprocessQuantizationMode,
  type RegionMasks,
} from './pipelineAuxiliaries';

export type Lab = [number, number, number];
type Rgb = [number, number, number];

export type ConversionPipeline = 'cartoon' | 'logo' | 'photo';
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
  meanSourceLightness: number;
  meanMatchedLightness: number;
  lightnessBias: number;
  meanDeltaE: number;
  matches: (ColorMatchDiagnostic | null)[][];
}

export interface ConversionResult {
  grid: (string | null)[][];
  /** UI compatibility only; the restored pipeline deliberately does not populate it. */
  alignedSourcePixels?: Uint8ClampedArray;
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
// Auto removal must have one clearly dominant edge colour. Ambiguous multi-colour
// borders stay intact until the user explicitly picks a chroma-key colour.
const MIN_AUTO_BACKGROUND_EDGE_COVERAGE = 0.35;
const MIN_AUTO_BACKGROUND_DOMINANCE_GAP = 0.12;

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

export function labToRgb([lightness, a, b]: Lab): Rgb {
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

function compareRankedEntries(first: RankedPaletteEntry, second: RankedPaletteEntry, targetChroma: number): number {
  if (targetChroma < 8 && Math.abs(first.distance - second.distance) <= 0.1) {
    return first.entry.chroma - second.entry.chroma || first.order - second.order;
  }
  return first.distance - second.distance || first.order - second.order;
}

function rankPaletteMatches(target: Lab, palette: PaletteEntry[], algorithm: 'cie76' | 'ciede2000'): RankedPaletteEntry[] {
  const targetChroma = Math.hypot(target[1], target[2]);
  let first: RankedPaletteEntry | null = null;
  let second: RankedPaletteEntry | null = null;
  for (let order = 0; order < palette.length; order += 1) {
    const entry = palette[order];
    const candidate = { entry, order, distance: paletteDistance(target, entry, algorithm) };
    if (!first || compareRankedEntries(candidate, first, targetChroma) < 0) {
      second = first;
      first = candidate;
    } else if (!second || compareRankedEntries(candidate, second, targetChroma) < 0) {
      second = candidate;
    }
  }
  return first ? (second ? [first, second] : [first]) : [];
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

  // A cartoon/illustration is not necessarily a low-colour logo. It usually
  // has large flat fills plus a relatively small number of high-contrast
  // contour transitions. The old colour-count-only classifier sent these
  // images down the photo path, where averaging and dithering create the
  // blurred double edges visible in character artwork.
  let flatSamples = 0;
  let strongEdgeSamples = 0;
  let darkOutlineSamples = 0;
  let analysedSamples = 0;
  if (width >= 12 && height >= 12) {
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        const index = y * width + x;
        const offset = index * 4;
        if (data[offset + 3] < normalizedAlphaCutoff) continue;
        const lab = rgbToLab([data[offset], data[offset + 1], data[offset + 2]]);
        let neighbours = 0;
        let maximumDifference = 0;
        let maximumLightnessDifference = 0;
        for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const nextOffset = (nextY * width + nextX) * 4;
          if (data[nextOffset + 3] < normalizedAlphaCutoff) continue;
          const nextLab = rgbToLab([data[nextOffset], data[nextOffset + 1], data[nextOffset + 2]]);
          neighbours += 1;
          maximumDifference = Math.max(maximumDifference, deltaE76(lab, nextLab));
          maximumLightnessDifference = Math.max(maximumLightnessDifference, Math.abs(lab[0] - nextLab[0]));
        }
        if (neighbours === 0) continue;
        analysedSamples += 1;
        if (maximumDifference <= 8) flatSamples += 1;
        if (maximumDifference >= 22) strongEdgeSamples += 1;
        if (lab[0] <= 30 && maximumLightnessDifference >= 28 && maximumDifference >= 24) darkOutlineSamples += 1;
      }
    }
  }
  const flatRatio = flatSamples / Math.max(1, analysedSamples);
  const strongEdgeRatio = strongEdgeSamples / Math.max(1, analysedSamples);
  const darkOutlineRatio = darkOutlineSamples / Math.max(1, analysedSamples);
  const cartoonDetected = analysedSamples > 80
    && effectiveColorCount > 5
    // Richly shaded scenes also contain flat walls/clothing and dark edges.
    // Keep their broad tonal range instead of collapsing them into flat inks.
    && effectiveColorCount <= 32
    && flatRatio >= 0.78
    && strongEdgeRatio >= 0.025
    && darkOutlineRatio >= 0.006;
  const confidence = Math.min(1, 0.5 + Math.min(0.4, boundaryGap * 0.12) + Math.min(0.1, coverage * 0.1));
  if (cartoonDetected) {
    return {
      pipeline: 'cartoon',
      effectiveColorCount,
      confidence: Math.min(1, confidence + 0.08),
    };
  }
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
  const runnerUpCoverage = (ranked[1]?.count ?? 0) / samples;
  if (coverage < MIN_AUTO_BACKGROUND_EDGE_COVERAGE
    || coverage - runnerUpCoverage < MIN_AUTO_BACKGROUND_DOMINANCE_GAP) return null;
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
  const minComponentSize = Math.max(4, Math.ceil(width * height * 0.02));
  const perimeter = width * 2 + Math.max(0, height - 2) * 2;
  const minEdgeCoverage = Math.max(2, Math.ceil(perimeter * 0.16));
  const isManualBackground = candidateBackground.inference.source === 'manual';
  // Reused for each component so large backgrounds do not allocate JS number arrays.
  const componentQueue = new Int32Array(width * height);
  const protectedCandidates = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    if (!candidate[index]) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    let localContrast = 0;
    const pixelOffset = index * 4;
    const pixelLab = rgbToLab([data[pixelOffset], data[pixelOffset + 1], data[pixelOffset + 2]]);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const neighbourOffset = (ny * width + nx) * 4;
      if (data[neighbourOffset + 3] < normalizedAlphaCutoff) continue;
      localContrast = Math.max(localContrast, deltaE76(pixelLab, rgbToLab([
        data[neighbourOffset], data[neighbourOffset + 1], data[neighbourOffset + 2],
      ])));
    }
    if (localContrast >= 24 && x > 0 && x + 1 < width && y > 0 && y + 1 < height) protectedCandidates[index] = 1;
  }
  const hasInteriorSubjectEvidence = protectedCandidates.reduce((count, value) => count + value, 0) >= 1;
  for (const start of edgePixelIndexes(width, height)) {
    if (!candidate[start] || visited[start]) continue;
    let componentLength = 1;
    componentQueue[0] = start;
    let edgeCoverage = 0;
    let protectedStructureCount = 0;
    visited[start] = 1;
    for (let cursor = 0; cursor < componentLength; cursor += 1) {
      const index = componentQueue[cursor];
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) edgeCoverage += 1;
      if (protectedCandidates[index]) protectedStructureCount += 1;
      const visit = (next: number) => {
        if (!candidate[next] || visited[next]) return;
        visited[next] = 1;
        componentQueue[componentLength] = next;
        componentLength += 1;
      };
      // 4-neighbour flood fill deliberately prevents diagonal leaks into protected holes.
      if (x > 0) visit(index - 1);
      if (x + 1 < width) visit(index + 1);
      if (y > 0) visit(index - width);
      if (y + 1 < height) visit(index + width);
    }
    const structureRatio = protectedStructureCount / Math.max(1, componentLength);
    const hasSubjectEvidence = hasInteriorSubjectEvidence && protectedStructureCount >= 1
      && structureRatio >= 0.02
      && componentLength < width * height * 0.8
      && !isManualBackground;
    if (!hasSubjectEvidence && (isManualBackground || (componentLength >= minComponentSize && edgeCoverage >= minEdgeCoverage))) {
      for (let index = 0; index < componentLength; index += 1) mask[componentQueue[index]] = 1;
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

function edgeAwareEnhance(
  pixels: GridPixel[],
  width: number,
  height: number,
  settings: ConvertSettings,
): void {
  const sharpening = Math.max(0, Math.min(100, normalizedSetting(settings.sharpening)));
  if (sharpening === 0 && !settings.outlineBoost) return;

  const labs = pixels.map((pixel) => pixel.alpha === 0 ? null : rgbToLab([pixel.r, pixel.g, pixel.b]));
  const enhanced: Array<Lab | null> = labs.map((lab) => lab ? [...lab] as Lab : null);
  const amount = sharpening / 100 * 0.75;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const lab = labs[index];
      if (!lab) continue;
      const neighbours: Lab[] = [];
      if (x > 0 && labs[index - 1]) neighbours.push(labs[index - 1]!);
      if (x + 1 < width && labs[index + 1]) neighbours.push(labs[index + 1]!);
      if (y > 0 && labs[index - width]) neighbours.push(labs[index - width]!);
      if (y + 1 < height && labs[index + width]) neighbours.push(labs[index + width]!);
      if (neighbours.length === 0) continue;

      const neighbourMean = neighbours.reduce((sum, neighbour) => sum + neighbour[0], 0) / neighbours.length;
      const gradient = neighbours.reduce((maximum, neighbour) => Math.max(maximum, Math.abs(lab[0] - neighbour[0])), 0);
      const edgeFactor = clampUnit((gradient - 4) / 36);
      const lightnessDelta = Math.max(-12, Math.min(12, (lab[0] - neighbourMean) * amount * edgeFactor));
      const outlineDelta = settings.outlineBoost && lab[0] <= 58 && gradient >= 32
        ? -Math.min(8, 2 + (gradient - 32) * 0.12)
        : 0;
      enhanced[index]![0] = Math.max(0, Math.min(100, lab[0] + lightnessDelta + outlineDelta));
    }
  }

  for (let index = 0; index < pixels.length; index += 1) {
    const lab = enhanced[index];
    if (!lab) continue;
    const rgb = labToRgb(lab);
    pixels[index].r = clampByte(rgb[0]);
    pixels[index].g = clampByte(rgb[1]);
    pixels[index].b = clampByte(rgb[2]);
  }
}

function selectPalette(pixels: GridPixel[], palette: PaletteEntry[], colorLimit: number, algorithm: 'cie76' | 'ciede2000'): PaletteEntry[] {
  const normalizedColorLimit = normalizeColorLimit(colorLimit);
  if (normalizedColorLimit === 0 || palette.length <= normalizedColorLimit) return palette;
  const counts = new Map<string, number>();
  const inkCounts = new Map<string, number>();
  for (const pixel of pixels) {
    if (pixel.alpha === 0) continue;
    const source = rgbToLab([pixel.r, pixel.g, pixel.b]);
    const winner = rankPaletteMatches(source, palette, algorithm)[0];
    counts.set(winner.entry.color.id, (counts.get(winner.entry.color.id) ?? 0) + 1);
    if (source[0] <= 24 && winner.entry.lab[0] <= 28) {
      inkCounts.set(winner.entry.color.id, (inkCounts.get(winner.entry.color.id) ?? 0) + 1);
    }
  }
  const baselineIds = Array.from(counts.entries()).sort((first, second) => second[1] - first[1]).slice(0, normalizedColorLimit).map(([id]) => id);
  if (counts.size <= normalizedColorLimit || normalizedColorLimit === 1) {
    const ids = new Set(baselineIds);
    return palette.filter(entry => ids.has(entry.color.id));
  }
  // Bounded weighted histogram, but reconstruct each bin from ALL its actual
  // samples rather than arbitrarily keeping the first colour in that bin.
  const bins = new Map<number, { weight: number; l: number; a: number; b: number }>();
  for (const pixel of pixels) {
    if (pixel.alpha === 0) continue;
    const key = ((pixel.r >> 4) << 8) | ((pixel.g >> 4) << 4) | (pixel.b >> 4);
    const lab = rgbToLab([pixel.r, pixel.g, pixel.b]);
    const bin = bins.get(key) ?? { weight: 0, l: 0, a: 0, b: 0 };
    bin.weight++; bin.l += lab[0]; bin.a += lab[1]; bin.b += lab[2];
    bins.set(key, bin);
  }
  const samples = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, bin]) => ({
    lab: [bin.l / bin.weight, bin.a / bin.weight, bin.b / bin.weight] as Lab, weight: bin.weight,
  }));
  const ink = [...inkCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const opaque = samples.reduce((total, sample) => total + sample.weight, 0);
  // A recurring, genuinely source-dark tone is structural evidence. Keep its
  // actual nearest bead, never invent a pure-black outline for a bright image.
  const protectedIds = normalizedColorLimit >= 3 && ink && ink[1] >= Math.max(2, opaque * .002) ? [ink[0]] : [];
  return selectPerceptualPalette(palette.filter(entry => counts.has(entry.color.id)), samples, normalizedColorLimit,
    (source, entry) => paletteDistance(source, entry, algorithm), baselineIds, protectedIds);
}

function diagnosticForReplacement(
  sourceLab: Lab,
  replacement: PaletteEntry,
  palette: PaletteEntry[],
  algorithm: 'cie76' | 'ciede2000',
): ColorMatchDiagnostic {
  const ranked = rankPaletteMatches(sourceLab, palette, algorithm);
  const second = ranked.find((candidate) => candidate.entry.color.id !== replacement.color.id) ?? null;
  const deltaE = paletteDistance(sourceLab, replacement, algorithm);
  return {
    sourceLab,
    matchingLab: sourceLab,
    matchedColorId: replacement.color.id,
    matchedColorCode: replacement.color.code,
    deltaE,
    secondColorId: second?.entry.color.id ?? null,
    secondColorCode: second?.entry.color.code ?? null,
    secondDeltaE: second?.distance ?? null,
    deltaEDifference: second ? second.distance - deltaE : null,
  };
}

function hasEightNeighborComponent(
  grid: (string | null)[][],
  x: number,
  y: number,
  color: string,
): boolean {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) continue;
      const nx = x + ox;
      const ny = y + oy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && grid[ny][nx] === color) {
        return true;
      }
    }
  }
  return false;
}

function contentAwareSampleWeight(
  alphaWeight: number,
  x: number,
  y: number,
  startX: number,
  endX: number,
  startY: number,
  endY: number,
  r: number,
  g: number,
  b: number,
  detail: number,
  edgeMagnitude: number,
): number {
  const centerX = (startX + endX) / 2;
  const centerY = (startY + endY) / 2;
  const halfWidth = Math.max(0.5, (endX - startX) / 2);
  const halfHeight = Math.max(0.5, (endY - startY) / 2);
  const distance = Math.min(1, Math.hypot((x + 0.5 - centerX) / halfWidth, (y + 0.5 - centerY) / halfHeight) / Math.SQRT2);
  const centerBoost = 1 + 0.1 * (1 - distance);
  const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  const saturationBoost = 1 + 0.06 * saturation;
  const detailBoost = 1 + 0.6 * detail;
  const edgeBoost = 1 + 0.15 * clampUnit(edgeMagnitude / 35);
  return alphaWeight * Math.min(1.9, centerBoost * saturationBoost * detailBoost * edgeBoost);
}

function cleanPhotoNoise(
  grid: (string | null)[][],
  sourceLabs: Array<Lab | null>,
  width: number,
  palette: PaletteEntry[],
  matches: (ColorMatchDiagnostic | null)[][],
  regionMasks?: RegionMasks,
): void {
  const height = grid.length;
  const paletteById = new Map(palette.map((entry) => [entry.color.id, entry]));
  const updates: Array<{ x: number; y: number; color: string }> = [];

  for (let y = 1; y + 1 < height; y += 1) {
    for (let x = 1; x + 1 < width; x += 1) {
      const current = grid[y][x];
      if (!current) continue;
      if (regionMasks && regionMasks.regionType[y * width + x] !== 0) continue;
      if (hasEightNeighborComponent(grid, x, y, current)) continue;
      const neighbors = [grid[y - 1][x], grid[y + 1][x], grid[y][x - 1], grid[y][x + 1]];
      const replacement = neighbors[0];
      if (!replacement || replacement === current || !neighbors.every((color) => color === replacement)) continue;

      const source = sourceLabs[y * width + x];
      const neighbourLabs = [
        sourceLabs[(y - 1) * width + x],
        sourceLabs[(y + 1) * width + x],
        sourceLabs[y * width + x - 1],
        sourceLabs[y * width + x + 1],
      ];
      if (!source || neighbourLabs.some((lab) => !lab)) continue;
      const averageNeighbourDelta = neighbourLabs.reduce((sum, lab) => sum + deltaE2000(source, lab!), 0) / neighbors.length;
      // The source must be locally smooth. This leaves real high-contrast
      // details, one-cell lines, and faces untouched while removing a single
      // Floyd-Steinberg colour excursion inside a flat region.
      if (averageNeighbourDelta > 12) continue;

      updates.push({ x, y, color: replacement });
    }
  }

  for (const update of updates) {
    grid[update.y][update.x] = update.color;
    const sourceLab = sourceLabs[update.y * width + update.x];
    const replacement = paletteById.get(update.color);
    if (!sourceLab || !replacement) continue;
    matches[update.y][update.x] = diagnosticForReplacement(sourceLab, replacement, palette, 'ciede2000');
  }
}

function summarizeMatches(
  matches: (ColorMatchDiagnostic | null)[][],
  palette: PaletteEntry[],
): { meanSourceLightness: number; meanMatchedLightness: number; lightnessBias: number; meanDeltaE: number } {
  const paletteById = new Map(palette.map((entry) => [entry.color.id, entry]));
  let sourceLightnessTotal = 0;
  let matchedLightnessTotal = 0;
  let deltaETotal = 0;
  let matchedPixels = 0;

  for (const row of matches) {
    for (const match of row) {
      if (!match) continue;
      const matched = paletteById.get(match.matchedColorId);
      if (!matched) continue;
      sourceLightnessTotal += match.sourceLab[0];
      matchedLightnessTotal += matched.lab[0];
      deltaETotal += match.deltaE;
      matchedPixels += 1;
    }
  }

  return {
    meanSourceLightness: matchedPixels > 0 ? sourceLightnessTotal / matchedPixels : 0,
    meanMatchedLightness: matchedPixels > 0 ? matchedLightnessTotal / matchedPixels : 0,
    lightnessBias: matchedPixels > 0 ? (matchedLightnessTotal - sourceLightnessTotal) / matchedPixels : 0,
    meanDeltaE: matchedPixels > 0 ? deltaETotal / matchedPixels : 0,
  };
}

/**
 * Keep diagnostics in lock-step with the final grid after structural cleanup.
 * The cleanup passes intentionally work on the grid (rather than the matching
 * pass) so they can repair one-cell edge breaks and false dither excursions.
 * Refresh only cells whose id changed to avoid another full palette search.
 */
function synchronizeGridDiagnostics(
  grid: (string | null)[][],
  sourceLabs: Array<Lab | null>,
  matches: (ColorMatchDiagnostic | null)[][],
  palette: PaletteEntry[],
  width: number,
  height: number,
  algorithm: 'cie76' | 'ciede2000',
): void {
  const paletteById = new Map(palette.map((entry) => [entry.color.id, entry]));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const id = grid[y][x];
      const previous = matches[y][x];
      if (!id) {
        matches[y][x] = null;
        continue;
      }
      if (previous?.matchedColorId === id) continue;
      const sourceLab = sourceLabs[index];
      const replacement = paletteById.get(id);
      if (sourceLab && replacement) {
        matches[y][x] = diagnosticForReplacement(sourceLab, replacement, palette, algorithm);
      }
    }
  }
}

/**
 * Fills only small, enclosed holes that were introduced by downsampling. A
 * hole is rejected when any cell is backed by transparency/background removal,
 * touches the grid edge, or has a mixed boundary. This keeps transparent
 * backgrounds, eye/letter counters, and logo cut-outs intact while restoring
 * tiny gaps inside a solid subject silhouette.
 */
function repairInternalGridHoles(
  grid: (string | null)[][],
  protectedEmpty: Uint8Array,
  width: number,
  height: number,
): number {
  const total = width * height;
  if (total === 0) return 0;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const maxHoleSize = Math.max(1, Math.min(64, Math.floor(total * 0.35)));
  let repaired = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (visited[start] || grid[y][x] !== null) continue;
      let length = 0;
      let cursor = 0;
      let touchesEdge = false;
      let hasProtectedCell = false;
      const boundary = new Map<string, number>();
      queue[length++] = start;
      visited[start] = 1;

      while (cursor < length) {
        const index = queue[cursor++];
        const cx = index % width;
        const cy = Math.floor(index / width);
        if (cx === 0 || cy === 0 || cx === width - 1 || cy === height - 1) touchesEdge = true;
        if (protectedEmpty[index]) hasProtectedCell = true;
        const neighbours: Array<[number, number]> = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
        for (const [nx, ny] of neighbours) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            touchesEdge = true;
            continue;
          }
          const nextIndex = ny * width + nx;
          const colour = grid[ny][nx];
          if (colour === null) {
            if (!visited[nextIndex]) {
              visited[nextIndex] = 1;
              queue[length++] = nextIndex;
            }
          } else {
            boundary.set(colour, (boundary.get(colour) ?? 0) + 1);
          }
        }
      }

      if (touchesEdge || hasProtectedCell || length > maxHoleSize || boundary.size === 0) continue;
      const ranked = [...boundary.entries()].sort((first, second) => second[1] - first[1]);
      const [replacement, support] = ranked[0];
      const boundaryTotal = ranked.reduce((sum, [, count]) => sum + count, 0);
      // Mixed boundaries usually indicate intentional eye/letter counters or
      // a true transparent cut-out. Require a strongly uniform enclosure.
      if (support < Math.max(3, Math.ceil(boundaryTotal * 0.75))) continue;
      for (let index = 0; index < length; index += 1) {
        const holeIndex = queue[index];
        grid[Math.floor(holeIndex / width)][holeIndex % width] = replacement;
        repaired += 1;
      }
    }
  }
  return repaired;
}

/** Cheap, conservative gap repair for a single downsampled subject cell. */
function repairSingleCellGaps(grid: (string | null)[][], protectedEmpty: Uint8Array, width: number, height: number): void {
  for (let y = 1; y + 1 < height; y += 1) {
    for (let x = 1; x + 1 < width; x += 1) {
      const index = y * width + x;
      if (protectedEmpty[index] || grid[y][x] !== null) continue;
      const up = grid[y - 1][x];
      const down = grid[y + 1][x];
      const left = grid[y][x - 1];
      const right = grid[y][x + 1];
      if (up && up === down && up === left && up === right) grid[y][x] = up;
    }
  }
}

function normalizeCartoonOuterOutline(
  grid: (string | null)[][],
  sourceLabs: Array<Lab | null>,
  protectedEmpty: Uint8Array,
  width: number,
  palette: PaletteEntry[],
  matches: (ColorMatchDiagnostic | null)[][],
  algorithm: 'cie76' | 'ciede2000',
): void {
  const height = grid.length;
  const paletteById = new Map(palette.map((entry) => [entry.color.id, entry]));
  const dark = (id: string | null): boolean => {
    const entry = id ? paletteById.get(id) : null;
    return Boolean(entry && entry.lab[0] <= 34);
  };
  const offsets: ReadonlyArray<readonly [number, number]> = [
    [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
  ];
  const boundaryDark = new Uint8Array(width * height);
  const outerConnected = new Uint8Array(width * height);
  const queue: number[] = [];

  const touchesRemovedBackground = (x: number, y: number): boolean => {
    for (const [ox, oy] of offsets) {
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) return true;
      const index = ny * width + nx;
      if (grid[ny][nx] === null && protectedEmpty[index]) return true;
    }
    return false;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (dark(grid[y][x]) && touchesRemovedBackground(x, y)) boundaryDark[index] = 1;
    }
  }

  // Trace only the dark component that actually belongs to the subject's
  // outside boundary. Internal eyes/mouth lines are not removed unless they
  // are mistakenly fused into a thick outer contour.
  for (let start = 0; start < boundaryDark.length; start += 1) {
    if (!boundaryDark[start] || outerConnected[start]) continue;
    queue.length = 0;
    queue.push(start);
    outerConnected[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      const x = index % width;
      const y = Math.floor(index / width);
      for (const [ox, oy] of offsets) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (dark(grid[ny][nx]) && !outerConnected[next]) {
          outerConnected[next] = 1;
          queue.push(next);
        }
      }
    }
  }

  const fillPalette = palette.filter((entry) => entry.lab[0] > 34);
  const replaceWithSourceColour = (index: number): void => {
    const sourceLab = sourceLabs[index];
    if (!sourceLab || fillPalette.length === 0) return;
    const ranked = rankPaletteMatches(sourceLab, fillPalette, algorithm);
    const replacement = ranked[0]?.entry;
    if (!replacement) return;
    const x = index % width;
    const y = Math.floor(index / width);
    grid[y][x] = replacement.color.id;
    matches[y][x] = diagnosticForReplacement(sourceLab, replacement, palette, algorithm);
  };

  // Thin only dense interior layers. Boundary-touching pixels are retained;
  // interior pixels in a 2x2/3x3 dark block are removed when the source cell
  // itself is not dark. This collapses generated double lines while retaining
  // genuine black source pixels and internal facial strokes.
  for (let pass = 0; pass < 2; pass += 1) {
    const remove: number[] = [];
    for (let index = 0; index < outerConnected.length; index += 1) {
      if (!outerConnected[index] || boundaryDark[index] || !dark(grid[Math.floor(index / width)][index % width])) continue;
      const x = index % width;
      const y = Math.floor(index / width);
      const sourceLab = sourceLabs[index];
      let darkNeighbours = 0;
      let boundaryNeighbours = 0;
      for (const [ox, oy] of offsets) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (dark(grid[ny][nx])) darkNeighbours += 1;
        if (boundaryDark[next]) boundaryNeighbours += 1;
      }
      if (sourceLab && sourceLab[0] > 42 && darkNeighbours >= 3 && boundaryNeighbours >= 1) remove.push(index);
    }
    for (const index of remove) replaceWithSourceColour(index);
  }
}

/**
 * Add a connected, palette-backed outline to artwork when the user opts in. The outline
 * is built from the darker side of a strong boundary, then gaps of one cell
 * are bridged only when they are supported by the same local edge. This avoids
 * the dotted black specks produced by independently recolouring every light
 * cell beside a contrast change.
 */
function applyOutlineProtection(
  grid: (string | null)[][],
  sourceLabs: Array<Lab | null>,
  protectedEmpty: Uint8Array,
  width: number,
  height: number,
  palette: PaletteEntry[],
  matches: (ColorMatchDiagnostic | null)[][],
  algorithm: 'cie76' | 'ciede2000',
): void {
  if (width === 0 || height === 0 || palette.length === 0) return;
  const outline = [...palette].sort((first, second) => (first.lab[0] - second.lab[0])
    || (first.chroma - second.chroma))[0];
  if (!outline) return;

  const candidate = new Uint8Array(width * height);
  const edgeSignal = new Uint8Array(width * height);
  const edgeEvidence = new Uint8Array(width * height);
  const neighbours = (x: number, y: number): Array<[number, number]> => {
    const result: Array<[number, number]> = [];
    if (x > 0) result.push([x - 1, y]);
    if (x + 1 < width) result.push([x + 1, y]);
    if (y > 0) result.push([x, y - 1]);
    if (y + 1 < height) result.push([x, y + 1]);
    return result;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const currentLab = sourceLabs[index];
      if (!grid[y][x] || !currentLab || protectedEmpty[index] || currentLab[0] <= 32) continue;

      let boundaryScore = 0;
      let touchesSubjectEdge = false;
      for (const [nx, ny] of neighbours(x, y)) {
        const neighbourIndex = ny * width + nx;
        const neighbourLab = sourceLabs[neighbourIndex];
        if (!grid[ny][nx]) {
          if (protectedEmpty[neighbourIndex]) touchesSubjectEdge = true;
          continue;
        }
        if (!neighbourLab) continue;
        const difference = deltaE2000(currentLab, neighbourLab);
        const darkerSide = currentLab[0] <= neighbourLab[0] - 8;
        const stronglyDifferent = difference >= 20 && (darkerSide || currentLab[0] <= 48);
        if (difference >= 20) {
          edgeEvidence[index] = 1;
          edgeEvidence[neighbourIndex] = 1;
        }
        if (stronglyDifferent) boundaryScore = Math.max(boundaryScore, difference);
      }

      // Prefer the darker side of an internal boundary. It produces one
      // readable contour instead of blackening both sides of a colour change.
      if (touchesSubjectEdge) edgeEvidence[index] = 1;
      if (boundaryScore >= 20 || touchesSubjectEdge) {
        candidate[index] = 1;
        edgeSignal[index] = 1;
      }
    }
  }

  // Remove isolated detections and bridge a single missing cell between two
  // aligned detections. These two small topology passes are what make the
  // result read as a continuous line rather than scattered dots.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!candidate[index]) continue;
      let nearby = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && candidate[ny * width + nx]) nearby += 1;
        }
      }
      if (nearby === 0) candidate[index] = 0;
    }
  }

  const bridge = new Uint8Array(candidate);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (candidate[index] || edgeSignal[index] || !edgeEvidence[index] || protectedEmpty[index] || !grid[y][x]) continue;
      const horizontal = x > 0 && x + 1 < width && candidate[index - 1] && candidate[index + 1];
      const vertical = y > 0 && y + 1 < height && candidate[index - width] && candidate[index + width];
      const diagonal = x > 0 && x + 1 < width && y > 0 && y + 1 < height
        && ((candidate[index - width - 1] && candidate[index + width + 1])
          || (candidate[index - width + 1] && candidate[index + width - 1]));
      if (horizontal || vertical || diagonal) bridge[index] = 1;
    }
  }

  const replacement = outline.color.id;
  for (let index = 0; index < bridge.length; index += 1) {
    if (!bridge[index]) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    if (grid[y][x] === replacement) continue;
    grid[y][x] = replacement;
    const sourceLab = sourceLabs[index];
    if (sourceLab) matches[y][x] = diagnosticForReplacement(sourceLab, outline, palette, algorithm);
  }
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
      meanSourceLightness: 0,
      meanMatchedLightness: 0,
      lightnessBias: 0,
      meanDeltaE: 0,
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
  // Detect before preprocessing. Explicit cartoon, photo, and logo requests
  // remain separate end-to-end; only auto falls back to the lightweight
  // photo/logo classifier.
  const detected = classifyImageColors(data, sourceWidth, sourceHeight, alphaCutoff);
  const override = settings.pipelineOverride ?? 'auto';
  const requestedPipeline = override === 'auto' ? detected.pipeline : override;
  const pipeline: ConversionPipeline = requestedPipeline;
  // One consistent premultiplied-light regime for genuinely alpha-bearing
  // sources; fully opaque inputs retain A's display-colour averaging.
  // Less than one output cell of missing alpha cannot switch every opaque
  // interior cell's colour regime because of an isolated transparent speck.
  const linearPhoto = pipeline === 'photo' && sourceHasTransparency(data, sourceWidth * sourceHeight,
    sourceWidth * sourceHeight / (settings.width * settings.height));
  const quantizationMode: PreprocessQuantizationMode = settings.kmeansClustering === false && pipeline !== 'photo'
    ? 'none'
    : pipeline;

  const preprocessed = preprocessSourceImage(
    data,
    sourceWidth,
    sourceHeight,
    alphaCutoff,
    quantizationMode,
    settings.kmeansClustering === false && pipeline === 'photo' ? 0 : settings.quantizationStrength ?? 55,
  );
  const sourceRegions = classifySourceRegions(preprocessed.detailMask, sourceWidth, sourceHeight);
  const sampleData = preprocessed.sampleData ?? preprocessed.denoised;
  const sampleWidth = preprocessed.sampleWidth ?? sourceWidth;
  const sampleHeight = preprocessed.sampleHeight ?? sourceHeight;
  const sampleScaleX = sampleWidth / sourceWidth;
  const sampleScaleY = sampleHeight / sourceHeight;

  const backgroundResult = settings.backgroundRemovalEnabled === true
    ? createEdgeConnectedBackgroundMask(
      data,
      sourceWidth,
      sourceHeight,
      settings.chromaKeyColor,
      normalizedSetting(settings.chromaKeyTolerance),
      alphaCutoff,
    )
    : { mask: new Uint8Array(sourceWidth * sourceHeight), inference: null };
  const sourceWhite = pipeline === 'photo' ? null
    : enclosedSourceWhite(data, sourceWidth, sourceHeight, alphaCutoff, backgroundResult.mask);
  const protectedCounters = new Map<number, Rgb>();
  const targetPixels: GridPixel[] = [];
  const cellCandidates: Array<CellForeground | null> = [];
  const representedInk = pipeline !== 'photo' ? new Uint8Array(settings.width * settings.height) : null;
  const protectedEmpty = new Uint8Array(settings.width * settings.height);
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
      let sampleR = 0;
      let sampleG = 0;
      let sampleB = 0;
      let linearR = 0, linearG = 0, linearB = 0;
      let centerR = 0, centerG = 0, centerB = 0, centerWeight = 0;
      let centerWhiteWeight = 0;
      let whiteR = 0, whiteG = 0, whiteB = 0, whiteWeight = 0;
      let weightedValid = 0;
      let backgroundWeight = 0;
      let opaqueWeight = 0;
      const dominant = new Map<number, CellColorBin & { maxDetail: number }>();
      const original = new Map<number, CellColorBin>();
      for (let y = Math.floor(startY); y < Math.min(sourceHeight, Math.ceil(endY)); y += 1) {
        const verticalWeight = Math.max(0, Math.min(y + 1, endY) - Math.max(y, startY));
        for (let x = Math.floor(startX); x < Math.min(sourceWidth, Math.ceil(endX)); x += 1) {
          const horizontalWeight = Math.max(0, Math.min(x + 1, endX) - Math.max(x, startX));
          const weight = horizontalWeight * verticalWeight;
          total += weight;
          const sourceIndex = y * sourceWidth + x;
          const offset = sourceIndex * 4;
          if (backgroundResult.mask[sourceIndex]) {
            backgroundWeight += weight;
            continue;
          }
          if (data[offset + 3] < alphaCutoff) continue;
          opaqueWeight += weight;
          const alphaWeight = weight * data[offset + 3] / 255;
          valid += alphaWeight;
          if (sourceWhite?.[sourceIndex]) {
            whiteWeight += alphaWeight;
            whiteR += data[offset] * alphaWeight; whiteG += data[offset + 1] * alphaWeight;
            whiteB += data[offset + 2] * alphaWeight;
          }
          const sampleX = Math.min(sampleWidth - 1, Math.floor((x + 0.5) * sampleScaleX));
          const sampleY = Math.min(sampleHeight - 1, Math.floor((y + 0.5) * sampleScaleY));
          const sampleOffset = (sampleY * sampleWidth + sampleX) * 4;
          const detail = sourceRegions.detailProtection[sourceIndex] ?? 0;
          // Alpha and edge colour must refer to the same source footprint.
          // Flat interiors retain the existing quantized work-buffer colour;
          // source-supported details recover colour lost before sampling.
          const protection = pipeline === 'photo' ? (sampleData[sampleOffset + 3] < alphaCutoff ? 1 : detail) : 0;
          const r = sampleData[sampleOffset] + (data[offset] - sampleData[sampleOffset]) * protection;
          const g = sampleData[sampleOffset + 1] + (data[offset + 1] - sampleData[sampleOffset + 1]) * protection;
          const b = sampleData[sampleOffset + 2] + (data[offset + 2] - sampleData[sampleOffset + 2]) * protection;
          const contentWeight = pipeline !== 'logo' ? alphaWeight : contentAwareSampleWeight(
            alphaWeight,
            x,
            y,
            startX,
            endX,
            startY,
            endY,
            r,
            g,
            b,
            detail,
            sourceRegions.edgeMagnitude[sourceIndex] ?? 0,
          );
          weightedValid += contentWeight;
          sampleR += r * contentWeight;
          sampleG += g * contentWeight;
          sampleB += b * contentWeight;
          if (pipeline === 'photo') {
            linearR += srgbToLinear(r) * contentWeight;
            linearG += srgbToLinear(g) * contentWeight;
            linearB += srgbToLinear(b) * contentWeight;
          }
          const localX = (x + 0.5 - startX) / scaleX, localY = (y + 0.5 - startY) / scaleY;
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          const entry = dominant.get(key) ?? { weight: 0, rgb: [0, 0, 0], maxDetail: 0,
            area: 0, x: 0, y: 0, xx: 0, yy: 0 };
          entry.weight += contentWeight;
          entry.rgb[0] += r * contentWeight;
          entry.rgb[1] += g * contentWeight;
          entry.rgb[2] += b * contentWeight;
          entry.maxDetail = Math.max(entry.maxDetail, detail);
          entry.area += alphaWeight;
          entry.x += localX * alphaWeight; entry.y += localY * alphaWeight;
          entry.xx += localX * localX * alphaWeight; entry.yy += localY * localY * alphaWeight;
          dominant.set(key, entry);
          if (pipeline !== 'photo') {
            if (localX >= 0.375 && localX <= 0.625 && localY >= 0.375 && localY <= 0.625) {
              centerWeight += alphaWeight;
              if (sourceWhite?.[sourceIndex]) centerWhiteWeight += alphaWeight;
              centerR += data[offset] * alphaWeight; centerG += data[offset + 1] * alphaWeight;
              centerB += data[offset + 2] * alphaWeight;
            }
            const rawKey = ((data[offset] >> 4) << 8) | ((data[offset + 1] >> 4) << 4) | (data[offset + 2] >> 4);
            const raw = original.get(rawKey) ?? { weight: 0, rgb: [0, 0, 0] as Rgb,
              area: 0, x: 0, y: 0, xx: 0, yy: 0 };
            raw.weight += alphaWeight; raw.area += alphaWeight;
            for (let c = 0; c < 3; c++) raw.rgb[c] += data[offset + c] * alphaWeight;
            raw.x += localX * alphaWeight; raw.y += localY * alphaWeight;
            raw.xx += localX * localX * alphaWeight; raw.yy += localY * localY * alphaWeight;
            original.set(rawKey, raw);
          }
        }
      }
      if (valid / Math.max(total, 0.00001) < 0.35) {
        const targetIndex = gridY * settings.width + gridX;
        if (backgroundWeight > 0 || opaqueWeight / Math.max(total, 0.00001) < 0.2) protectedEmpty[targetIndex] = 1;
        targetPixels.push({ r: 0, g: 0, b: 0, alpha: 0 });
        cellCandidates.push(null);
        continue;
      }
      const dominantEntries = Array.from(dominant.values());
      const eligibleDominant = dominantEntries.filter((entry) => (
        entry.weight / Math.max(weightedValid, 0.00001) >= 0.08 || entry.maxDetail >= 0.65
      ));
      const dominantCandidates = eligibleDominant.length > 0 ? eligibleDominant : dominantEntries;
      const logoEntry = dominantCandidates
        .sort((first, second) => second.weight - first.weight)[0];
      const clustered = pipeline === 'photo' ? null : clusterCellColors(dominant.values())[0];
      const normalRgb = logoEntry ? logoEntry.rgb.map(value => clampByte(value / logoEntry.weight)) as Rgb : [0, 0, 0] as Rgb;
      let shapeRgb = clustered && Math.max(...normalRgb) > 64
        ? clustered.rgb.map(value => clampByte(value / clustered.weight)) as Rgb : normalRgb;
      const centerRgb: Rgb = centerWeight ? [centerR / centerWeight, centerG / centerWeight, centerB / centerWeight] : normalRgb;
      const near = (a: Rgb, b: Rgb) => Math.max(...a.map((v, c) => Math.abs(v - b[c]))) <= 8;
      // A source-white centre is negative space, even when surrounding ink
      // occupies several nearby colours. Do not fill it by combining their votes.
      if (near(centerRgb, normalRgb)) shapeRgb = normalRgb;
      const candidate = pipeline === 'photo' ? null : cellForeground(clusterCellColors(original.values()), valid);
      cellCandidates.push(candidate && !near(centerRgb, candidate.background) ? candidate : null);
      // Coverage of an existing closed source hole vetoes ink aggregation.
      // This does not synthesize a white bridge or a missing target-grid hole.
      const sourceWhiteCoverage = whiteWeight / Math.max(total, 0.00001);
      // Source-majority negative space must not depend on the work buffer
      // still being white: content weighting can already have selected ink.
      if (sourceWhiteCoverage > 0.5 || (Math.min(...normalRgb) >= 235 && sourceWhiteCoverage >= 0.35
        && centerWhiteWeight / Math.max(centerWeight, 0.00001) > 0.5)) {
        shapeRgb = [whiteR / whiteWeight, whiteG / whiteWeight, whiteB / whiteWeight].map(clampByte) as Rgb;
        cellCandidates[cellCandidates.length - 1] = null;
        protectedCounters.set(gridY * settings.width + gridX, adjustColor(shapeRgb, settings));
      }
      // Cartoon cells use their dominant source colour instead of averaging
      // adjacent fills. Averaging is appropriate for photographs, but it
      // creates muddy intermediate colours and halo-like double contours in
      // flat character art.
      const rgb: Rgb = pipeline === 'logo' || pipeline === 'cartoon'
        ? shapeRgb
        : linearPhoto || valid < total - 0.000001 ? [
          linearToSrgb(linearR / Math.max(weightedValid, 0.00001)),
          linearToSrgb(linearG / Math.max(weightedValid, 0.00001)),
          linearToSrgb(linearB / Math.max(weightedValid, 0.00001)),
        ] : [
          // A bead represents display colour over this area, rather than a
          // light-emitting integration of its pixels. Coverage averaging avoids
          // bright grey fringes on small high-contrast features in photo mode.
          clampByte(sampleR / Math.max(weightedValid, 0.00001)),
          clampByte(sampleG / Math.max(weightedValid, 0.00001)),
          clampByte(sampleB / Math.max(weightedValid, 0.00001)),
        ];
      if (representedInk && Math.max(...rgb) <= 64 && Math.max(...rgb) - Math.min(...rgb) <= 32) {
        representedInk[gridY * settings.width + gridX] = 1;
      }
      const adjusted = pipeline === 'photo' ? adjustColor(rgb, settings) : rgb;
      targetPixels.push({ r: adjusted[0], g: adjusted[1], b: adjusted[2], alpha: 255 });
    }
  }

  if (pipeline !== 'photo') {
    // Selection uses only colours actually present in each cell. Neighbours
    // confirm source support; no strokes, bridges or target cells are projected.
    resolveCellForeground(cellCandidates, targetPixels, settings.width, settings.height);
    targetPixels.forEach(pixel => {
      if (pixel.alpha === 0) return;
      const adjusted = adjustColor([pixel.r, pixel.g, pixel.b], settings);
      pixel.r = adjusted[0]; pixel.g = adjusted[1]; pixel.b = adjusted[2];
    });
  }

  if (representedInk && (sourceWidth > settings.width || sourceHeight > settings.height)) {
    // The same source-connected stroke policy protects fine logo lettering.
    // Photo mode keeps area sampling and never receives synthesized ink cells.
    const sourceInk = projectCartoonInk(data, sourceWidth, sourceHeight, settings.width, settings.height,
      alphaCutoff, backgroundResult.mask, representedInk);
    sourceInk.forEach((rgb, index) => {
      if (!rgb || targetPixels[index].alpha === 0 || protectedCounters.has(index)) return;
      const adjusted = adjustColor(rgb, settings);
      targetPixels[index] = { r: adjusted[0], g: adjusted[1], b: adjusted[2], alpha: 255 };
    });
  }

  // Grid lightness sharpening adds colour bands to flat fills; cartoon ink is source-supported.
  edgeAwareEnhance(targetPixels, settings.width, settings.height,
    pipeline === 'cartoon' ? { ...settings, sharpening: 0 } : settings);
  for (const [i, rgb] of protectedCounters) {
    targetPixels[i] = { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 255 };
  }

  const matchAlgorithm: 'cie76' | 'ciede2000' = pipeline === 'logo' ? 'cie76' : 'ciede2000';
  const selectedPalette = selectPalette(targetPixels, activePalette, settings.colorLimit, matchAlgorithm);
  const mappingPalette = selectedPalette.length > 0 ? [...selectedPalette] : [...activePalette];
  // Outline protection needs a dark bead even when the source image contains
  // no black pixels. Keep the normal palette-limit behaviour when a limit is
  // explicitly requested; the unrestricted default reserves the darkest
  // enabled bead for the opt-in outline pass.
  if (settings.outlineBoost && normalizeColorLimit(settings.colorLimit) === 0) {
    const darkest = [...activePalette].sort((first, second) => (first.lab[0] - second.lab[0])
      || (first.chroma - second.chroma))[0];
    if (darkest && !mappingPalette.some((entry) => entry.color.id === darkest.color.id)) mappingPalette.push(darkest);
  }
  // targetPixels remains immutable so diagnostics always represent the source grid sample.
  const sourceLabs = targetPixels.map((pixel) => pixel.alpha === 0 ? null : rgbToLab([pixel.r, pixel.g, pixel.b]));
  const gridRegions = classifyGridRegions(sourceLabs, settings.width, settings.height);
  const ditherAdaptation = computeDitherAdaptationMap(
    sourceLabs,
    mappingPalette.map((entry) => entry.lab),
    gridRegions,
  );
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
        const receivingIndex = nextY * settings.width + nextX;
        const scaledWeight = weight * ditherStrength * ditherAdaptation[index] * ditherAdaptation[receivingIndex];
        if (scaledWeight <= 0) return;
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
  // Logo conversions never auto-merge islands; the explicit App tool remains
  // available with manual intent. Photo keeps its source-aware dither cleanup.
  if (useFloydSteinberg) cleanPhotoNoise(grid, sourceLabs, settings.width, mappingPalette, matches, gridRegions);

  const paletteMap = new Map(mappingPalette.map((entry) => [entry.color.id, { lab: entry.lab, color: entry.color }]));
  if (useFloydSteinberg) {
    suppressSmoothAreaClutterClusters(
      grid,
      gridRegions,
      sourceLabs,
      paletteMap,
      settings.width,
      settings.height,
      (x, y, replacementId) => {
        const sourceLab = sourceLabs[y * settings.width + x];
        const replacement = mappingPalette.find((entry) => entry.color.id === replacementId);
        if (!sourceLab || !replacement) return;
        matches[y][x] = diagnosticForReplacement(sourceLab, replacement, mappingPalette, matchAlgorithm);
      },
    );
  }

  if (pipeline === 'cartoon') {
    // One component-aware pass replaces the old majority/fixed-size island
    // passes, so they cannot erase protected decorations before this policy.
    const consolidated = consolidateStrayBeans(grid, {
      isFilled: id => id !== null && paletteMap.has(id),
      getColorKey: id => id!,
      getColor: id => {
        const [r, g, b] = paletteMap.get(id!)!.color.rgb;
        return { r, g, b };
      },
      replaceColor: (_noise, replacement) => replacement,
      canReplace: (_noise, replacement, row, column) => {
        const index = row * settings.width + column;
        const source = sourceLabs[index];
        const target = paletteMap.get(replacement!);
        return Boolean(source && target && gridRegions.regionType[index] === 0
          && deltaE2000(source, target.lab) <= 32);
      },
    }, 'standard', { mode: pipeline, intent: 'auto' });
    for (let row = 0; row < grid.length; row += 1) grid[row] = consolidated[row];
  }

  if (settings.outlineBoost) {
    applyOutlineProtection(
      grid,
      sourceLabs,
      protectedEmpty,
      settings.width,
      settings.height,
      mappingPalette,
      matches,
      matchAlgorithm,
    );
  }

  if (pipeline === 'cartoon' && settings.outlineBoost) {
    normalizeCartoonOuterOutline(
      grid,
      sourceLabs,
      protectedEmpty,
      settings.width,
      mappingPalette,
      matches,
      matchAlgorithm,
    );
  }

  repairSingleCellGaps(grid, protectedEmpty, settings.width, settings.height);
  synchronizeGridDiagnostics(grid, sourceLabs, matches, mappingPalette, settings.width, settings.height, matchAlgorithm);

  const summary = summarizeMatches(matches, mappingPalette);
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
      ...summary,
      matches,
    },
  };
}

export function standardAlgorithm(algorithm: ColorMatchAlgo): 'cie76' | 'ciede2000' {
  return algorithm === 'cie76' ? 'cie76' : 'ciede2000';
}
