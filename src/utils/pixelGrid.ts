// Native pixel-grid detection and snapping.
//
// Pixel-art sources are authored on a small logical grid (a sprite, an
// avatar, a game asset) and usually arrive resampled to display size. Area
// averaging over an output cell then blends neighbouring logical pixels
// before any colour decision runs, so the pipeline can never recover the
// author's flat colours. Detecting the native grid and snapping the source
// back to it removes that entire error class.
//
// Detection logic: colour edges of pixel art align to a periodic lattice.
// For each candidate cell size the edge profile along both axes is folded
// into `cell` phase buckets and the best-phase boundary edge density is
// compared against the image-wide average edge density. Sprites score high
// because their edges concentrate on lattice lines (typically 20x+ above
// average) while photos and anti-aliased art score ~1 (no periodicity).
// The native size is the smallest candidate whose contrast ratio reaches
// 85% of the global best — integer divisors of the native size top out near
// half the ratio (half their boundary lines miss the lattice), multiples tie
// it — followed by an intra-block uniformity gate that rejects everything a
// periodic texture might have slipped past.

export interface PixelGridDetection {
  /** Native cell size in source pixels. */
  cell: number;
  phaseX: number;
  phaseY: number;
  /** Logical pixel dimensions of the detected native grid. */
  cols: number;
  rows: number;
  /** Best-phase boundary alignment score, 0..1. */
  confidence: number;
}

const EDGE_THRESHOLD = 26;
const SPREAD_THRESHOLD = 26;
const ALPHA_SPREAD_THRESHOLD = 16;
const MIN_LOGICAL_CELLS = 6;
const MAX_LOGICAL_CELLS = 512;
/** An image whose boundary lines carry less edge density than this has no lattice. */
const BOUNDARY_FLOOR = 0.005;
/** An image with less average edge density than this is flat or near-flat. */
const GLOBAL_EDGE_FLOOR = 0.0003;
/** Stabilises the contrast ratio when the image is almost edge-free. */
const EDGE_RATIO_EPSILON = 0.004;
/** Native size wins as soon as it reaches this share of the global best. */
const SCORE_WIN_SHARE = 0.85;
const UNIFORM_FRACTION = 0.85;
/**
 * The decisive lattice invariant: a genuine native grid must explain nearly
 * all STRUCTURAL edge mass — at most this share may fall off-lattice. Only
 * lines reaching this share of the strongest line count as structural, which
 * keeps JPEG block-boundary ringing (weak, off-lattice) out of the verdict
 * while forcing real content edges (an eye highlight inside a dark fill) to
 * sit on the lattice. Multiples of the native size leak structural lines
 * between their sparser boundaries (rejected), random textures concentrate
 * nothing (rejected), and divisors are harmless duplicates that simply score
 * lower on contrast.
 */
const OFF_LATTICE_MASS_MAX = 0.1;
const SIGNIFICANT_LINE_SHARE = 0.1;
/**
 * Large candidate cells have very few boundary positions, so chance
 * concentration of sparse edges inflates their raw contrast ratio. Shrink
 * each ratio toward 1 with a Beta-style prior of this many pseudo-samples,
 * which keeps dense native lattices on top and demotes lucky large cells.
 */
const RATIO_PRIOR_SAMPLES = 32;

function maxChannelDiff(a: number, b: number, c: number, d: number, e: number, f: number): number {
  return Math.max(Math.abs(a - d), Math.abs(b - e), Math.abs(c - f));
}

/** Fraction of scanned scanlines whose pixel at position t differs from t-1. */
function edgeProfile(data: Uint8ClampedArray, width: number, height: number, vertical: boolean): Float64Array {
  const size = vertical ? width : height;
  const scan = vertical ? height : width;
  const profile = new Float64Array(size);
  const stride = Math.max(1, Math.floor(scan / 512));
  for (let t = 1; t < size; t += 1) {
    let edges = 0;
    let samples = 0;
    for (let u = 0; u < scan; u += stride) {
      const o = vertical ? (u * width + t) * 4 : (t * width + u) * 4;
      const p = vertical ? o - 4 : o - width * 4;
      const diff = maxChannelDiff(data[p], data[p + 1], data[p + 2], data[o], data[o + 1], data[o + 2]);
      if (diff >= EDGE_THRESHOLD) edges += 1;
      samples += 1;
    }
    profile[t] = samples > 0 ? edges / samples : 0;
  }
  return profile;
}

function bestPhaseScore(profile: Float64Array, cell: number): { score: number; phase: number } {
  const sums = new Float64Array(cell);
  const counts = new Float64Array(cell);
  for (let t = 0; t < profile.length; t += 1) {
    sums[t % cell] += profile[t];
    counts[t % cell] += 1;
  }
  let score = 0;
  let phase = 0;
  for (let p = 0; p < cell; p += 1) {
    if (counts[p] === 0) continue;
    const candidate = sums[p] / counts[p];
    if (candidate > score) {
      score = candidate;
      phase = p;
    }
  }
  return { score, phase };
}

function blockSpread(data: Uint8ClampedArray, width: number, height: number,
  cell: number, x0: number, y0: number): number {
  const cx0 = x0 + Math.floor(cell * 0.25);
  const cx1 = Math.min(width, x0 + Math.ceil(cell * 0.75));
  const cy0 = y0 + Math.floor(cell * 0.25);
  const cy1 = Math.min(height, y0 + Math.ceil(cell * 0.75));
  const stepX = Math.max(1, Math.floor((cx1 - cx0) / 12));
  const stepY = Math.max(1, Math.floor((cy1 - cy0) / 12));
  let minR = 255; let maxR = 0;
  let minG = 255; let maxG = 0;
  let minB = 255; let maxB = 0;
  let seen = 0;
  for (let y = cy0; y < cy1; y += stepY) {
    for (let x = cx0; x < cx1; x += stepX) {
      const o = (y * width + x) * 4;
      if (data[o + 3] < 128) continue;
      if (data[o] < minR) minR = data[o];
      if (data[o] > maxR) maxR = data[o];
      if (data[o + 1] < minG) minG = data[o + 1];
      if (data[o + 1] > maxG) maxG = data[o + 1];
      if (data[o + 2] < minB) minB = data[o + 2];
      if (data[o + 2] > maxB) maxB = data[o + 2];
      seen += 1;
    }
  }
  if (seen === 0) return 0;
  return Math.max(maxR - minR, maxG - minG, maxB - minB);
}

function uniformFraction(data: Uint8ClampedArray, width: number, height: number,
  cell: number, phaseX: number, phaseY: number): number {
  const cols = Math.floor((width - phaseX) / cell);
  const rows = Math.floor((height - phaseY) / cell);
  if (cols < MIN_LOGICAL_CELLS || rows < MIN_LOGICAL_CELLS) return 0;
  const stride = Math.max(1, Math.floor(Math.sqrt((cols * rows) / 2500)));
  let uniform = 0;
  let total = 0;
  for (let by = 0; by < rows; by += stride) {
    for (let bx = 0; bx < cols; bx += stride) {
      total += 1;
      if (blockSpread(data, width, height, cell, phaseX + bx * cell, phaseY + by * cell) <= SPREAD_THRESHOLD) uniform += 1;
    }
  }
  return total > 0 ? uniform / total : 0;
}

/** Returns the native-grid geometry, or null when the source is not pixel art. */
export function detectPixelGrid(data: Uint8ClampedArray, width: number, height: number): PixelGridDetection | null {
  if (width < 4 * MIN_LOGICAL_CELLS || height < 4 * MIN_LOGICAL_CELLS) return null;
  const maxCell = Math.floor(Math.min(width, height) / MIN_LOGICAL_CELLS);
  if (maxCell < 2) return null;
  const columnProfile = edgeProfile(data, width, height, true);
  const rowProfile = edgeProfile(data, width, height, false);
  const columnMean = profileMean(columnProfile);
  const rowMean = profileMean(rowProfile);
  if (columnMean < GLOBAL_EDGE_FLOOR || rowMean < GLOBAL_EDGE_FLOOR) return null;
  // Contrast ratio: lattice-aligned boundary density vs the image average,
  // shrunk toward 1 in proportion to how few boundary positions the candidate
  // lattice actually has. The off-lattice mass gate enforces the invariant
  // that a real native grid explains nearly all edge energy. Candidates below
  // the boundary floor carry no coherent lattice lines at all.
  let best = 0;
  const candidates: Array<{ cell: number; score: number; phaseX: number; phaseY: number }> = [];
  for (let cell = 2; cell <= maxCell; cell += 1) {
    const x = bestPhaseScore(columnProfile, cell);
    const y = bestPhaseScore(rowProfile, cell);
    if (x.score < BOUNDARY_FLOOR || y.score < BOUNDARY_FLOOR) continue;
    if (offLatticeFraction(columnProfile, cell, x.phase) > OFF_LATTICE_MASS_MAX) continue;
    if (offLatticeFraction(rowProfile, cell, y.phase) > OFF_LATTICE_MASS_MAX) continue;
    const nx = Math.max(1, Math.floor(width / cell));
    const ny = Math.max(1, Math.floor(height / cell));
    const xShrunk = 1 + (x.score / (columnMean + EDGE_RATIO_EPSILON) - 1) * (nx / (nx + RATIO_PRIOR_SAMPLES));
    const yShrunk = 1 + (y.score / (rowMean + EDGE_RATIO_EPSILON) - 1) * (ny / (ny + RATIO_PRIOR_SAMPLES));
    const score = Math.min(xShrunk, yShrunk);
    candidates.push({ cell, score, phaseX: x.phase, phaseY: y.phase });
    if (score > best) best = score;
  }
  if (best < 2) return null;
  // The contrast ratio separates a lattice from its divisors (dividers dilute
  // their boundary density with edge-free lines); the off-lattice gate already
  // removed multiples that would leak structural edges. So the smallest
  // candidate within 85% of the best contrast is the native grid — or a
  // harmless submultiple of it.
  candidates.sort((a, b) => a.cell - b.cell);
  for (const candidate of candidates) {
    if (candidate.score < SCORE_WIN_SHARE * best) continue;
    const { cell, phaseX, phaseY } = candidate;
    const cols = Math.floor((width - phaseX) / cell);
    const rows = Math.floor((height - phaseY) / cell);
    if (cols < MIN_LOGICAL_CELLS || rows < MIN_LOGICAL_CELLS) continue;
    if (cols > MAX_LOGICAL_CELLS || rows > MAX_LOGICAL_CELLS) continue;
    if (uniformFraction(data, width, height, cell, phaseX, phaseY) < UNIFORM_FRACTION) continue;
    return { cell, phaseX, phaseY, cols, rows, confidence: Math.round(candidate.score * 1000) / 1000 };
  }
  return null;
}

function profileMean(profile: Float64Array): number {
  let sum = 0;
  for (let t = 1; t < profile.length; t += 1) sum += profile[t];
  return sum / Math.max(1, profile.length - 1);
}

/**
 * Share of structural edge mass that the lattice misses. Lines weaker than
 * SIGNIFICANT_LINE_SHARE of the strongest line are ringing/noise and do not
 * count against the lattice. A ±1px tolerance absorbs JPEG edge smear, which
 * shifts the steepest-gradient sample of a genuine lattice edge to the
 * neighbouring pixel.
 */
function offLatticeFraction(profile: Float64Array, cell: number, phase: number): number {
  let maxLine = 0;
  for (let t = 1; t < profile.length; t += 1) maxLine = Math.max(maxLine, profile[t]);
  const threshold = maxLine * SIGNIFICANT_LINE_SHARE;
  let onLattice = 0;
  let structural = 0;
  for (let t = 1; t < profile.length; t += 1) {
    if (profile[t] < threshold) continue;
    structural += profile[t];
    if (onLatticeLine(t, cell, phase)) onLattice += profile[t];
  }
  return structural > 0 ? 1 - onLattice / structural : 1;
}

function onLatticeLine(t: number, cell: number, phase: number): boolean {
  const r = (((t - phase) % cell) + cell) % cell;
  return r <= 1 || r >= cell - 1;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Rewrite the source so every detected native block carries one flat colour
 * (per-channel median of its central region, robust to JPEG ringing at block
 * edges). Blocks with mixed alpha are left untouched — that is genuine
 * transparency detail, not lattice structure. Pixels outside the lattice
 * (phase margins) keep their original values.
 */
export function snapToPixelGrid(data: Uint8ClampedArray, width: number, height: number,
  detection: PixelGridDetection): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  const { cell, phaseX, phaseY, cols, rows } = detection;
  for (let by = 0; by < rows; by += 1) {
    for (let bx = 0; bx < cols; bx += 1) {
      const x0 = phaseX + bx * cell;
      const y0 = phaseY + by * cell;
      const cx0 = x0 + Math.floor(cell * 0.2);
      const cx1 = Math.min(width, x0 + Math.ceil(cell * 0.8));
      const cy0 = y0 + Math.floor(cell * 0.2);
      const cy1 = Math.min(height, y0 + Math.ceil(cell * 0.8));
      const step = Math.max(1, Math.floor(Math.sqrt(((cx1 - cx0) * (cy1 - cy0)) / 256)));
      const reds: number[] = [];
      const greens: number[] = [];
      const blues: number[] = [];
      const alphas: number[] = [];
      for (let y = cy0; y < cy1; y += step) {
        for (let x = cx0; x < cx1; x += step) {
          const o = (y * width + x) * 4;
          alphas.push(data[o + 3]);
          if (data[o + 3] >= 128) {
            reds.push(data[o]);
            greens.push(data[o + 1]);
            blues.push(data[o + 2]);
          }
        }
      }
      if (alphas.length === 0) continue;
      const alphaSpread = Math.max(...alphas) - Math.min(...alphas);
      if (alphaSpread > ALPHA_SPREAD_THRESHOLD) continue;
      const hasColor = reds.length > 0;
      const r = hasColor ? median(reds) : 0;
      const g = hasColor ? median(greens) : 0;
      const b = hasColor ? median(blues) : 0;
      const a = median(alphas);
      const y1 = Math.min(height, y0 + cell);
      const x1 = Math.min(width, x0 + cell);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const o = (y * width + x) * 4;
          out[o] = r;
          out[o + 1] = g;
          out[o + 2] = b;
          out[o + 3] = a;
        }
      }
    }
  }
  return out;
}
