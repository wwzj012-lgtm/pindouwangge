/** A rectangle with exclusive right/bottom edges (x + width, y + height). */
export interface SubjectBoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SubjectBoundsReason =
  | 'suggested' | 'invalid-image' | 'empty' | 'unsupported-background'
  | 'complex-content' | 'ambiguous-components' | 'subject-touches-edge'
  | 'already-filled' | 'low-confidence';

export interface SubjectBoundsSuggestion {
  pixelBounds: SubjectBoundsRect;
  normalizedBounds: SubjectBoundsRect;
  /** Foreground evidence exists; this alone does NOT authorize a crop. */
  detected: boolean;
  hasSuggestion: boolean;
  /** Heuristic confidence, not a calibrated probability or semantic detector. */
  confidence: number;
  /** Suggested rectangle area / original image area; 1 for every fallback. */
  coverage: number;
  /** Conservative lower bound on foreground fraction inside the rectangle. */
  retainedForeground: number;
  /** Preview must warn that isolated details may be cropped; never auto-apply. */
  mayExcludeDecorations: boolean;
  reason: SubjectBoundsReason;
  background: 'transparent' | 'near-white' | 'unknown';
  workingSize: { width: number; height: number };
}

export interface SubjectBoundsOptions {
  /** Clamped to 64..262144; longest working side is always <= 512. */
  maxWorkingPixels?: number;
  /** Per-axis subject padding, clamped to 3%..20%; default 5%. */
  marginRatio?: number;
}

type Component = {
  count: number; left: number; top: number; right: number; bottom: number;
};

/**
 * Pure, opt-in preview helper. Accepts browser ImageData or an equivalent RGBA
 * view; never changes pixels, performs conversion, or applies a crop.
 *
 * Assumptions: transparent margins or a stable, opaque near-white perimeter,
 * with predominantly flat illustration colors. This is NOT a general photo or
 * semantic subject detector. White-on-white content cannot be inferred. Broad
 * continuous-tone palettes, ambiguity, edge contact and weak evidence fail to full.
 * All substantial components are unioned, including secondary figures/text;
 * only much smaller isolated marks can be omitted, with an explicit warning.
 *
 * Every source pixel contributes to a bounded occupancy grid (no point sampling,
 * so thin/white/half-transparent subjects survive reduction). O(source pixels +
 * working pixels) time, O(working pixels) scratch space, no source-sized copy.
 * UI: require hasSuggestion, preview normalizedBounds, warn when
 * mayExcludeDecorations, and apply only after explicit user confirmation.
 */
export function suggestSubjectBounds(
  image: Pick<ImageData, 'width' | 'height' | 'data'>,
  options: SubjectBoundsOptions = {},
): SubjectBoundsSuggestion {
  const width = image?.width;
  const height = image?.height;
  const validDimensions = Number.isSafeInteger(width) && width > 0
    && Number.isSafeInteger(height) && height > 0
    && Number.isSafeInteger(width * height * 4);
  const full = { x: 0, y: 0, width: validDimensions ? width : 0, height: validDimensions ? height : 0 };
  const result: SubjectBoundsSuggestion = {
    pixelBounds: full, normalizedBounds: { x: 0, y: 0, width: 1, height: 1 },
    detected: false, hasSuggestion: false, confidence: 0, coverage: 1,
    retainedForeground: 1, mayExcludeDecorations: false, reason: 'invalid-image',
    background: 'unknown', workingSize: { width: 0, height: 0 },
  };
  const data = image?.data;
  if (!validDimensions || !(data instanceof Uint8ClampedArray) || data.length !== width * height * 4) return result;
  const fallback = (reason: SubjectBoundsReason): SubjectBoundsSuggestion => ({ ...result, reason });

  // Inspect the actual perimeter, not just corners (one pass, no allocations).
  let borderCount = 0, clearBorder = 0, whiteBorder = 0;
  let red = 0, green = 0, blue = 0;
  const inspectBorder = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    borderCount++;
    if (a <= 8) clearBorder++;
    if (a >= 250 && Math.min(r, g, b) >= 235 && Math.max(r, g, b) - Math.min(r, g, b) <= 16) {
      whiteBorder++; red += r; green += g; blue += b;
    }
  };
  for (let x = 0; x < width; x++) {
    inspectBorder(x, 0);
    if (height > 1) inspectBorder(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    inspectBorder(0, y);
    if (width > 1) inspectBorder(width - 1, y);
  }
  const transparent = clearBorder / borderCount >= 0.97;
  if (!transparent && whiteBorder / borderCount < 0.97) return fallback('unsupported-background');
  result.background = transparent ? 'transparent' : 'near-white';
  red /= whiteBorder || 1; green /= whiteBorder || 1; blue /= whiteBorder || 1;

  const requestedBudget = options.maxWorkingPixels;
  const budget = Number.isFinite(requestedBudget)
    ? Math.max(64, Math.min(262144, Math.floor(requestedBudget!))) : 262144;
  // The per-axis budget terms also cap extreme panoramas whose other axis
  // rounds up to one working pixel (sqrt(area budget) alone would overshoot).
  const scale = Math.min(1, 512 / width, 512 / height,
    Math.sqrt(budget / (width * height)), budget / width, budget / height);
  const ww = Math.max(1, Math.floor(width * scale));
  const wh = Math.max(1, Math.floor(height * scale));
  result.workingSize = { width: ww, height: wh };
  const counts = new Uint32Array(ww * wh);
  const histogram = new Uint32Array(4096);
  let foreground = 0;
  let horizontalPairs = 0, verticalPairs = 0, horizontalFlat = 0, verticalFlat = 0;
  const isForeground = (i: number) => data[i + 3] > 8 && (transparent
    || Math.max(Math.abs(data[i] - red), Math.abs(data[i + 1] - green), Math.abs(data[i + 2] - blue)) * data[i + 3] / 255 > 18);
  const sameColor = (i: number, j: number) => data[i] === data[j] && data[i + 1] === data[j + 1]
    && data[i + 2] === data[j + 2] && data[i + 3] === data[j + 3];
  // Max occupancy, rather than averaged color, protects small source features.
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y * wh / height) * ww;
    let previousForeground = false;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!isForeground(i)) { previousForeground = false; continue; }
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (previousForeground) {
        horizontalPairs++;
        if (sameColor(i, i - 4)) horizontalFlat++;
      }
      if (y > 0 && isForeground(i - width * 4)) {
        verticalPairs++;
        if (sameColor(i, i - width * 4)) verticalFlat++;
      }
      previousForeground = true;
      counts[row + Math.floor(x * ww / width)]++;
      histogram[(r >> 4) * 256 + (g >> 4) * 16 + (b >> 4)]++;
      foreground++;
    }
  }
  if (!foreground) return fallback('empty');
  // Reject broad continuous-tone palettes even when a photo has white margins.
  // This gate applies to alpha images too; alpha alone is not illustration proof.
  const sortedColors = Array.from(histogram).sort((a, b) => b - a);
  const topColors = sortedColors.slice(0, 16).reduce((sum, count) => sum + count, 0) / foreground;
  let entropy = 0;
  for (const count of histogram) if (count) {
    const p = count / foreground;
    entropy -= p * Math.log2(p);
  }
  // Few colors alone are insufficient: monochrome photos and smooth gradients
  // can fit 16 bins. Require substantial flat runs in both supported axes.
  const minimumPairs = Math.max(32, foreground * 0.1);
  if (topColors < 0.58 || entropy > 5.2
    || horizontalPairs >= minimumPairs && horizontalFlat / horizontalPairs < 0.3
    || verticalPairs >= minimumPairs && verticalFlat / verticalPairs < 0.3) return fallback('complex-content');

  const visited = new Uint8Array(counts.length);
  const queue = new Int32Array(counts.length);
  const components: Component[] = [];
  // Eight-connected components keep diagonal outlines and adjacent colors together.
  for (let start = 0; start < counts.length; start++) {
    if (!counts[start] || visited[start]) continue;
    if (components.length >= 2048) return fallback('ambiguous-components');
    let head = 0, tail = 1;
    queue[0] = start; visited[start] = 1;
    const component: Component = { count: 0, left: ww, top: wh, right: 0, bottom: 0 };
    while (head < tail) {
      const cell = queue[head++];
      const x = cell % ww, y = Math.floor(cell / ww);
      component.count += counts[cell];
      component.left = Math.min(component.left, x); component.right = Math.max(component.right, x + 1);
      component.top = Math.min(component.top, y); component.bottom = Math.max(component.bottom, y + 1);
      for (let ny = Math.max(0, y - 1); ny <= Math.min(wh - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(ww - 1, x + 1); nx++) {
          const neighbor = ny * ww + nx;
          if (!counts[neighbor] || visited[neighbor]) continue;
          visited[neighbor] = 1; queue[tail++] = neighbor;
        }
      }
    }
    components.push(component);
  }
  let largest = components[0];
  for (const component of components) if (component.count > largest.count) largest = component;
  if (largest.count / (width * height) < 0.003) return fallback('low-confidence');
  const area = (c: Component) => (c.right - c.left) * (c.bottom - c.top);
  const extent = (c: Component) => Math.max((c.right - c.left) / ww, (c.bottom - c.top) / wh);
  const selected = components.filter(c => c.count >= largest.count * 0.04
    // Protect large outlined secondary figures, even with sparse interior ink.
    || c.count >= largest.count * 0.005 && area(c) >= area(largest) * 0.18
    || c.count >= largest.count * 0.015 && extent(c) >= extent(largest) * 0.35);
  const selectedCount = selected.reduce((sum, c) => sum + c.count, 0);
  if (selectedCount / foreground < 0.85) return fallback('ambiguous-components');
  const left = Math.min(...selected.map(c => c.left));
  const top = Math.min(...selected.map(c => c.top));
  const right = Math.max(...selected.map(c => c.right));
  const bottom = Math.max(...selected.map(c => c.bottom));
  result.detected = true;
  if (left === 0 || top === 0 || right === ww || bottom === wh) return fallback('subject-touches-edge');

  // Outward rounding of both grid-to-source edges, then padding, never inward.
  const sourceLeft = Math.floor(left * width / ww);
  const sourceTop = Math.floor(top * height / wh);
  const sourceRight = Math.ceil(right * width / ww);
  const sourceBottom = Math.ceil(bottom * height / wh);
  const margin = Number.isFinite(options.marginRatio) ? Math.max(0.03, Math.min(0.2, options.marginRatio!)) : 0.05;
  const padX = Math.max(2 * width / ww, (sourceRight - sourceLeft) * margin);
  const padY = Math.max(2 * height / wh, (sourceBottom - sourceTop) * margin);
  const x0 = Math.max(0, Math.floor(sourceLeft - padX));
  const y0 = Math.max(0, Math.floor(sourceTop - padY));
  const x1 = Math.min(width, Math.ceil(sourceRight + padX));
  const y1 = Math.min(height, Math.ceil(sourceBottom + padY));
  const coverage = (x1 - x0) * (y1 - y0) / (width * height);
  if (coverage >= 0.9) return fallback('already-filled');

  // Count fully contained occupied cells, not just selected components. Partly
  // intersected cells conservatively count as lost, so the warning never hides
  // a cropped decoration. Some unselected marks still lie inside the final box.
  let retained = 0;
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    if (Math.floor(x * width / ww) >= x0 && Math.ceil((x + 1) * width / ww) <= x1
      && Math.floor(y * height / wh) >= y0 && Math.ceil((y + 1) * height / wh) <= y1) retained += counts[y * ww + x];
  }
  const mayExcludeDecorations = retained < foreground;
  const confidence = (transparent ? 0.96 : 0.91)
    - (mayExcludeDecorations ? 0.04 : 0) - (scale < 1 ? 0.02 : 0);
  if (confidence < 0.82) return fallback('low-confidence');
  return {
    ...result,
    pixelBounds: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    normalizedBounds: { x: x0 / width, y: y0 / height, width: (x1 - x0) / width, height: (y1 - y0) / height },
    confidence, coverage, retainedForeground: retained / foreground,
    hasSuggestion: true, mayExcludeDecorations, reason: 'suggested',
  };
}
