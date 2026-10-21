import type { BeadColor } from '../types';
import { deltaE2000, preparePaletteLab, rgbToLab, type PreparedPaletteColor } from './colorUtils';
import type { ImportGridCalibration } from './importGridCalibration';

/** Precision integrates all intersecting pixels; fast estimates area with uniform strata. */
export type ImportRecognitionMode = 'fast' | 'precision';
export type ImportSampleStatus = 'mapped' | 'blank' | 'invalid';
export type ImportQuality = 'good' | 'fair' | 'poor';

export interface ImportImagePixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface ImportRecognitionCell {
  row: number;
  column: number;
  status: ImportSampleStatus;
  color: BeadColor | null;
  colorId: string | null;
  /** Area-weighted representative RGB of the winning palette group only. */
  sampleRgb: [number, number, number] | null;
  /** Area-weighted mean perceptual distance within the winning group. */
  distance: number | null;
  /** Accepted source pixels (precision) or accepted stratum probes (fast). */
  sampleCount: number;
  /** Visible area in source-pixel units squared; estimated in fast mode. */
  coverage: number;
  /** Cell area intersecting the source, including transparent pixels. */
  sampledArea: number;
  /** Shares of coverage after grouping pixels by their nearest perceptual palette color. */
  dominantRatio: number | null;
  runnerUpRatio: number | null;
  /** Compatibility alias for dominantRatio: color dominance, not recognition accuracy. */
  confidence: number | null;
  quality: ImportQuality | null;
}

export interface ImportRecognitionSummary {
  total: number;
  mapped: number;
  blank: number;
  invalid: number;
  distinctColors: number;
  meanDistance: number | null;
  /** Mean color dominance, not an estimate of recognition accuracy. */
  meanConfidence: number | null;
  lowConfidence: number;
  quality: ImportQuality;
}

export interface ImportRecognitionResult {
  mode: ImportRecognitionMode;
  /** Fraction excluded on each cell edge during this run; zero retains whole-cell area. */
  edgeInsetRatio?: number;
  calibration: ImportGridCalibration;
  cells: ImportRecognitionCell[][];
  summary: ImportRecognitionSummary;
}

export interface ImportRecognitionOptions {
  /** Optional edge exclusion, clamped to 0..0.2 per side; default zero. */
  edgeInsetRatio?: number;
}

export interface ImportRecognitionAsyncOptions extends ImportRecognitionOptions {
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
  batchSize?: number;
}

const DEFAULT_ALPHA_CUTOFF = 24;
const LOW_CONFIDENCE = 0.6;
const RATIO_EPSILON = 1e-9;
const FAST_STRATA_PER_AXIS = 8;
const MAX_SLICE_WORK = 2048;
const MAX_SLICE_MS = 8;
const MAX_CACHED_COLORS = 32768;

function isValidSource(source: ImportImagePixels): boolean {
  return Number.isInteger(source.width)
    && Number.isInteger(source.height)
    && source.width > 0
    && source.height > 0
    && source.data.length >= source.width * source.height * 4;
}

function qualityFor(confidence: number, distance: number): ImportQuality {
  if (confidence + RATIO_EPSILON < LOW_CONFIDENCE || distance > 15) return 'poor';
  if (confidence < 0.8 || distance > 8) return 'fair';
  return 'good';
}

interface SampleMatch {
  prepared: PreparedPaletteColor;
  paletteIndex: number;
  distance: number;
}

function classifySample(rgb: [number, number, number], palette: PreparedPaletteColor[]): SampleMatch {
  const lab = rgbToLab(...rgb);
  let best = palette[0];
  let paletteIndex = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < palette.length; index += 1) {
    const candidate = palette[index];
    const candidateDistance = deltaE2000(lab, candidate.lab);
    if (candidateDistance < distance) {
      best = candidate;
      paletteIndex = index;
      distance = candidateDistance;
    }
    if (distance === 0) break;
  }
  return { prepared: best, paletteIndex, distance };
}

function emptyCell(row: number, column: number, status: 'blank' | 'invalid', sampledArea = 0): ImportRecognitionCell {
  return {
    row, column, status, color: null, colorId: null, sampleRgb: null,
    distance: null, sampleCount: 0, coverage: 0, sampledArea,
    dominantRatio: null, runnerUpRatio: null, confidence: null, quality: null,
  };
}

function createInvalidCells(calibration: ImportGridCalibration): ImportRecognitionCell[][] {
  return Array.from({ length: calibration.rows }, (_, row) =>
    Array.from({ length: calibration.columns }, (_, column) => emptyCell(row, column, 'invalid')));
}

export function recognizeImportImage(
  source: ImportImagePixels,
  calibration: ImportGridCalibration,
  palette: BeadColor[],
  mode: ImportRecognitionMode,
  alphaCutoff = DEFAULT_ALPHA_CUTOFF,
  options: ImportRecognitionOptions = {},
): ImportRecognitionResult {
  const context = createRecognitionContext(source, calibration, palette, mode, alphaCutoff, options);
  if (context.invalidCells) return createRecognitionResult(mode, context.calibration, context.invalidCells, context.edgeInsetRatio);
  const cells: ImportRecognitionCell[][] = [];
  for (let row = 0; row < calibration.rows; row += 1) {
    cells.push(Array.from({ length: calibration.columns }, (_, column) => {
      const processing = processRecognitionCell(context, row, column);
      let step = processing.next();
      while (step.done === false) step = processing.next();
      return step.value;
    }));
  }
  return createRecognitionResult(mode, context.calibration, cells, context.edgeInsetRatio);
}

export async function recognizeImportImageAsync(
  source: ImportImagePixels,
  calibration: ImportGridCalibration,
  palette: BeadColor[],
  mode: ImportRecognitionMode,
  alphaCutoff = DEFAULT_ALPHA_CUTOFF,
  options: ImportRecognitionAsyncOptions = {},
): Promise<ImportRecognitionResult> {
  throwIfAborted(options.signal);
  const context = createRecognitionContext(source, calibration, palette, mode, alphaCutoff, options);
  let reportedProgress = 0;
  const report = (value: number) => {
    reportedProgress = Math.max(reportedProgress, value);
    options.onProgress?.(reportedProgress);
  };
  throwIfAborted(options.signal);
  report(0);
  throwIfAborted(options.signal);
  if (context.invalidCells) {
    throwIfAborted(options.signal);
    report(100);
    return createRecognitionResult(mode, context.calibration, context.invalidCells, context.edgeInsetRatio);
  }

  const cells: ImportRecognitionCell[][] = [];
  const batchSize = Number.isFinite(options.batchSize) ? Math.max(1, Math.floor(options.batchSize!)) : 256;
  const total = context.calibration.rows * context.calibration.columns;
  let completed = 0;
  let sliceStarted = performance.now();
  let row: ImportRecognitionCell[] = [];
  for (let index = 0; index < total; index += 1) {
    throwIfAborted(options.signal);
    const rowIndex = Math.floor(index / context.calibration.columns);
    const column = index % context.calibration.columns;
    if (column === 0) row = [];
    const processing = processRecognitionCell(context, rowIndex, column);
    let step = processing.next();
    while (step.done === false) {
      report(Math.min(99, (completed + step.value) / total * 100));
      throwIfAborted(options.signal);
      await yieldToEventLoop();
      throwIfAborted(options.signal);
      sliceStarted = performance.now();
      step = processing.next();
    }
    row.push(step.value);
    completed += 1;
    if (column === context.calibration.columns - 1) cells.push(row);
    if (completed % batchSize === 0 || completed === total || performance.now() - sliceStarted >= MAX_SLICE_MS) {
      report(Math.min(99, Math.floor(completed / total * 100)));
      throwIfAborted(options.signal);
      await yieldToEventLoop();
      sliceStarted = performance.now();
    }
  }
  throwIfAborted(options.signal);
  const result = createRecognitionResult(mode, context.calibration, cells, context.edgeInsetRatio);
  report(100);
  return result;
}

interface RecognitionContext {
  source: ImportImagePixels;
  alphaCutoff: number;
  calibration: ImportGridCalibration;
  mode: ImportRecognitionMode;
  edgeInsetRatio: number;
  preparedPalette: PreparedPaletteColor[];
  matchCache: Map<number, SampleMatch>;
  invalidCells?: ImportRecognitionCell[][];
}

function createRecognitionContext(
  source: ImportImagePixels,
  calibration: ImportGridCalibration,
  palette: BeadColor[],
  mode: ImportRecognitionMode,
  alphaCutoff: number,
  options: ImportRecognitionOptions,
): RecognitionContext {
  const outputCalibration = { ...calibration };
  const edgeInsetRatio = Number.isFinite(options.edgeInsetRatio) ? Math.max(0, Math.min(0.2, options.edgeInsetRatio!)) : 0;
  const validGeometry = [calibration.originX, calibration.originY, calibration.cellWidth, calibration.cellHeight].every(Number.isFinite)
    && calibration.cellWidth > 0 && calibration.cellHeight > 0;
  const preparedPalette = isValidSource(source) && validGeometry && palette.length > 0 ? preparePaletteLab(palette) : [];
  if (preparedPalette.length === 0) {
    return { source, alphaCutoff, calibration: outputCalibration, mode, edgeInsetRatio, preparedPalette, matchCache: new Map(), invalidCells: createInvalidCells(outputCalibration) };
  }
  return { source, alphaCutoff, calibration: outputCalibration, mode, edgeInsetRatio, preparedPalette, matchCache: new Map() };
}

interface PixelArea {
  rgb: [number, number, number];
  area: number;
}

interface ColorArea {
  match: SampleMatch;
  area: number;
  distance: number;
  rgb: [number, number, number];
}

/**
 * The histogram uses geometric pixel intersections; optional explicit inset excludes
 * edges before clipping to the source. Ratios describe only the analysed interior.
 * Alpha zero and alpha below the cutoff contribute neither coverage nor ratios.
 * Accepted pixels contribute their full geometric area (not alpha-weighted area);
 * partial opacity is not composited onto an invented background. Ratio denominator
 * is accepted visible coverage, excluding transparency and out-of-source area.
 * Fast mode approximates the same quantities with equal-area midpoint strata.
 * Yields split BOTH pixel accumulation and perceptual classification within a cell.
 */
function* processRecognitionCell(context: RecognitionContext, row: number, column: number): Generator<number, ImportRecognitionCell> {
  const { source, alphaCutoff, calibration, mode, edgeInsetRatio, preparedPalette, matchCache } = context;
  const left = Math.max(0, calibration.originX + (column + edgeInsetRatio) * calibration.cellWidth);
  const top = Math.max(0, calibration.originY + (row + edgeInsetRatio) * calibration.cellHeight);
  const right = Math.min(source.width, calibration.originX + (column + 1 - edgeInsetRatio) * calibration.cellWidth);
  const bottom = Math.min(source.height, calibration.originY + (row + 1 - edgeInsetRatio) * calibration.cellHeight);
  if (right <= left || bottom <= top) return emptyCell(row, column, 'invalid');

  const sampledArea = (right - left) * (bottom - top);
  const histogram = new Map<number, PixelArea>();
  let sampleCount = 0;
  let coverage = 0;
  const addPixel = (x: number, y: number, area: number) => {
    // Never replicate border pixels for samples outside the source.
    if (x < 0 || y < 0 || x >= source.width || y >= source.height) return;
    const offset = (y * source.width + x) * 4;
    const alpha = source.data[offset + 3];
    if (alpha === 0 || alpha < alphaCutoff) return;
    const red = source.data[offset];
    const green = source.data[offset + 1];
    const blue = source.data[offset + 2];
    const key = (red << 16) | (green << 8) | blue;
    const entry = histogram.get(key);
    if (entry) entry.area += area;
    else histogram.set(key, { rgb: [red, green, blue], area });
    sampleCount += 1;
    coverage += area;
  };

  const startX = Math.floor(left);
  const startY = Math.floor(top);
  const columns = mode === 'precision' ? Math.ceil(right) - startX : Math.min(FAST_STRATA_PER_AXIS, Math.ceil(right - left));
  const rows = mode === 'precision' ? Math.ceil(bottom) - startY : Math.min(FAST_STRATA_PER_AXIS, Math.ceil(bottom - top));
  const probes = columns * rows;
  const stratumArea = sampledArea / probes;
  let visited = 0;
  let sliceWork = 0;
  let sliceStarted = performance.now();
  for (let yIndex = 0; yIndex < rows; yIndex += 1) {
    const y = mode === 'precision' ? startY + yIndex : Math.floor(top + (yIndex + 0.5) * (bottom - top) / rows);
    const height = Math.min(bottom, y + 1) - Math.max(top, y);
    for (let xIndex = 0; xIndex < columns; xIndex += 1) {
      const x = mode === 'precision' ? startX + xIndex : Math.floor(left + (xIndex + 0.5) * (right - left) / columns);
      const area = mode === 'precision' ? (Math.min(right, x + 1) - Math.max(left, x)) * height : stratumArea;
      addPixel(x, y, area);
      visited += 1;
      sliceWork += 1;
      if (sliceWork >= MAX_SLICE_WORK || (sliceWork % 64 === 0 && performance.now() - sliceStarted >= MAX_SLICE_MS)) {
        yield 0.5 * visited / probes;
        sliceWork = 0;
        sliceStarted = performance.now();
      }
    }
  }
  if (sampleCount === 0) return emptyCell(row, column, 'blank', sampledArea);

  // Group near RGB shades by perceptual palette identity before comparing areas.
  const groups = new Map<string, ColorArea>();
  let classified = 0;
  for (const [key, entry] of histogram) {
    let match = matchCache.get(key);
    if (!match) {
      match = classifySample(entry.rgb, preparedPalette);
      if (matchCache.size >= MAX_CACHED_COLORS) matchCache.clear();
      matchCache.set(key, match);
    }
    const id = match.prepared.color.id;
    let group = groups.get(id);
    if (!group) {
      group = { match, area: 0, distance: 0, rgb: [0, 0, 0] };
      groups.set(id, group);
    }
    group.area += entry.area;
    group.distance += match.distance * entry.area;
    for (let channel = 0; channel < 3; channel += 1) group.rgb[channel] += entry.rgb[channel] * entry.area;
    classified += 1;
    sliceWork += 1;
    if (sliceWork >= MAX_SLICE_WORK || performance.now() - sliceStarted >= MAX_SLICE_MS) {
      yield 0.5 + 0.5 * classified / histogram.size;
      sliceWork = 0;
      sliceStarted = performance.now();
    }
  }

  const ordered = [...groups.values()].sort((a, b) => b.area - a.area
    || a.distance / a.area - b.distance / b.area || a.match.paletteIndex - b.match.paletteIndex);
  const dominant = ordered[0];
  const color = dominant.match.prepared.color;
  const sampleRgb = dominant.rgb.map(value => Math.round(value / dominant.area)) as [number, number, number];
  const distance = dominant.distance / dominant.area;
  const dominantRatio = Math.min(1, dominant.area / coverage);
  const runnerUpRatio = Math.min(1, (ordered[1]?.area ?? 0) / coverage);
  return {
    row, column, status: 'mapped', color, colorId: color.id, sampleRgb, distance,
    sampleCount, coverage, sampledArea, dominantRatio, runnerUpRatio,
    confidence: dominantRatio, quality: qualityFor(dominantRatio, distance),
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function createRecognitionResult(mode: ImportRecognitionMode, calibration: ImportGridCalibration, cells: ImportRecognitionCell[][], edgeInsetRatio: number): ImportRecognitionResult {
  return { mode, calibration, edgeInsetRatio, cells, summary: summarizeRecognition(cells) };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Recognition was cancelled.', 'AbortError');
}

export function summarizeRecognition(cells: ImportRecognitionCell[][]): ImportRecognitionSummary {
  const flat = cells.flat();
  const mapped = flat.filter(cell => cell.status === 'mapped');
  const distances = mapped.flatMap(cell => cell.distance === null ? [] : [cell.distance]);
  const confidences = mapped.flatMap(cell => cell.confidence === null ? [] : [cell.confidence]);
  const meanDistance = distances.length ? distances.reduce((sum, value) => sum + value, 0) / distances.length : null;
  const meanConfidence = confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null;
  const quality = !mapped.length || (meanConfidence ?? 0) + RATIO_EPSILON < LOW_CONFIDENCE || (meanDistance ?? 0) > 15
    ? 'poor'
    : (meanConfidence ?? 0) < 0.8 || (meanDistance ?? 0) > 8 ? 'fair' : 'good';
  return {
    total: flat.length,
    mapped: mapped.length,
    blank: flat.filter(cell => cell.status === 'blank').length,
    invalid: flat.filter(cell => cell.status === 'invalid').length,
    distinctColors: new Set(mapped.map(cell => cell.colorId)).size,
    meanDistance,
    meanConfidence,
    lowConfidence: mapped.filter(cell => (cell.confidence ?? 0) + RATIO_EPSILON < LOW_CONFIDENCE || cell.quality === 'poor').length,
    quality,
  };
}

export function recognitionResultToCodeMatrix(result: ImportRecognitionResult): string[][] {
  return result.cells.map(row => row.map(cell => cell.status === 'mapped' ? cell.color?.code ?? '' : ''));
}
