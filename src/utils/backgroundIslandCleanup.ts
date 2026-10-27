/** Post-background-removal grid cleanup; palette IDs are opaque, only null is empty. */
export type BackgroundIslandGrid = readonly (readonly (string | null)[])[];
export type BackgroundIslandProtection = 'subject' | 'enclosed' | 'subject-bounds' | 'near-subject';

export interface BackgroundIslandOptions {
  /** Inclusive component size in beads, defaults to 4. Zero disables removal. */
  maxIslandSize?: number;
  /** Foreground connectivity. Eight preserves diagonal, multicolor linework. */
  connectivity?: 4 | 8;
  /** Chebyshev distance between bead centers; 2 protects a one-blank-cell gap. */
  nearSubjectDistance?: number;
  /** Conservatively preserve details inside any subject's individual bounds. */
  protectSubjectBounds?: boolean;
}

export interface BackgroundIslandComponent {
  /** One-based row-major label, stable across option changes on the same grid. */
  id: number;
  /** Flat row-major cell indices; values refer to the analyzed grid dimensions. */
  indices: Uint32Array;
  size: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  touchesBoundary: boolean;
  touchesExterior: boolean;
  isSubject: boolean;
  /** Hard eligibility: small, outside, and not a subject. */
  eligible: boolean;
  candidate: boolean;
  protectionReasons: readonly BackgroundIslandProtection[];
}

export interface BackgroundIslandAnalysis {
  width: number;
  height: number;
  options: Required<BackgroundIslandOptions>;
  components: readonly BackgroundIslandComponent[];
  /** Flat row-major arrays, index = y * width + x; label zero means transparent. */
  componentIds: Uint32Array;
  candidateMask: Uint8Array;
  exteriorMask: Uint8Array;
  /** Independent snapshot used to reject applying a stale preview. */
  sourceGrid: BackgroundIslandGrid;
  stats: {
    totalCells: number;
    coloredCells: number;
    transparentCells: number;
    componentCount: number;
    subjectCount: number;
    candidateComponents: number;
    candidateCells: number;
    protectedComponents: number;
    protectedCells: number;
  };
}

export interface BackgroundIslandSelection {
  /** Omitted selects default candidates; [] selects nothing. Explicit selection
   * may override bounds/proximity protection, never subjects or enclosed eyes. */
  selectedComponentIds?: readonly number[];
  /** Per-component user protection always wins over selection. */
  protectedComponentIds?: readonly number[];
}

const FOUR = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const EIGHT = [...FOUR, [-1, -1], [1, -1], [-1, 1], [1, 1]] as const;

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative safe integer`);
  return value;
}

/**
 * O(width * height) time/storage, iterative throughout; no same-color grouping,
 * pairwise component comparisons, per-subject full-grid scans or recursive fill.
 * Subjects are every component above the removal threshold, plus substantial
 * components (at least 8 beads and 10% of the largest) even at high thresholds.
 * Each subject keeps its own bounding box, not one box spanning multiple subjects.
 * Small detached motifs cannot be distinguished semantically from noise: preview
 * and explicit user protection remain necessary. Input must be rectangular.
 */
export function analyzeBackgroundIslands(
  grid: BackgroundIslandGrid,
  options: BackgroundIslandOptions = {},
): BackgroundIslandAnalysis {
  const resolved: Required<BackgroundIslandOptions> = {
    maxIslandSize: nonnegativeInteger(options.maxIslandSize ?? 4, 'maxIslandSize'),
    connectivity: options.connectivity ?? 8,
    nearSubjectDistance: nonnegativeInteger(options.nearSubjectDistance ?? 2, 'nearSubjectDistance'),
    protectSubjectBounds: options.protectSubjectBounds ?? true,
  };
  if (resolved.connectivity !== 4 && resolved.connectivity !== 8) throw new RangeError('connectivity must be 4 or 8');
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const total = width * height;
  if (!Number.isSafeInteger(total) || total > 0x7ffffffe) throw new RangeError('Grid is too large');
  const sourceGrid = grid.map(row => {
    if (row.length !== width) throw new RangeError('Grid must be rectangular');
    return row.map(cell => {
      if (cell !== null && typeof cell !== 'string') throw new TypeError('Grid cells must be palette IDs or null');
      return cell;
    });
  });
  const labels = new Uint32Array(total);
  const exterior = new Uint8Array(total);
  const queue = new Uint32Array(total);
  const components: BackgroundIslandComponent[] = [];
  const offsets = resolved.connectivity === 8 ? EIGHT : FOUR;
  let coloredCells = 0;
  let largestSize = 0;

  for (let seed = 0; seed < total; seed += 1) {
    const seedY = Math.floor(seed / width), seedX = seed % width;
    if (sourceGrid[seedY][seedX] === null || labels[seed]) continue;
    const component: BackgroundIslandComponent = {
      id: components.length + 1, indices: new Uint32Array(0), size: 0,
      bounds: { minX: seedX, minY: seedY, maxX: seedX, maxY: seedY },
      touchesBoundary: false, touchesExterior: false, isSubject: false,
      eligible: false, candidate: false, protectionReasons: [],
    };
    components.push(component);
    let head = 0, tail = 1;
    queue[0] = seed;
    labels[seed] = component.id;
    while (head < tail) {
      const index = queue[head++];
      const y = Math.floor(index / width), x = index % width;
      component.size += 1;
      component.bounds.minX = Math.min(component.bounds.minX, x);
      component.bounds.maxX = Math.max(component.bounds.maxX, x);
      component.bounds.minY = Math.min(component.bounds.minY, y);
      component.bounds.maxY = Math.max(component.bounds.maxY, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) component.touchesBoundary = true;
      for (const [dx, dy] of offsets) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (!labels[next] && sourceGrid[ny][nx] !== null) {
          labels[next] = component.id;
          queue[tail++] = next;
        }
      }
    }
    component.indices = queue.slice(0, tail);
    coloredCells += component.size;
    largestSize = Math.max(largestSize, component.size);
  }

  const subjectFloor = Math.max(8, Math.ceil(largestSize * 0.1));
  for (const component of components) {
    component.isSubject = component.size > resolved.maxIslandSize || component.size >= subjectFloor;
  }

  // Dual topology: 8-connected foreground uses 4-connected background. With
  // explicit 4-connected foreground use 8-connected background instead.
  const backgroundOffsets = resolved.connectivity === 8 ? FOUR : EIGHT;
  let head = 0, tail = 0;
  const enqueueExterior = (x: number, y: number) => {
    const index = y * width + x;
    if (!labels[index] && !exterior[index]) { exterior[index] = 1; queue[tail++] = index; }
  };
  if (total) {
    for (let x = 0; x < width; x += 1) { enqueueExterior(x, 0); enqueueExterior(x, height - 1); }
    for (let y = 1; y < height - 1; y += 1) { enqueueExterior(0, y); enqueueExterior(width - 1, y); }
  }
  while (head < tail) {
    const index = queue[head++];
    const y = Math.floor(index / width), x = index % width;
    for (const [dx, dy] of backgroundOffsets) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) enqueueExterior(nx, ny);
    }
  }

  // Rectangle union via a 2D difference array: overlapping subject bounds do
  // not multiply the amount of work. No global multi-subject bounding box.
  const stride = width + 1;
  const boundsCoverage = new Int32Array(total && resolved.protectSubjectBounds ? stride * (height + 1) : 0);
  if (boundsCoverage.length) {
    for (const component of components) {
      if (!component.isSubject) continue;
      const { minX, minY, maxX, maxY } = component.bounds;
      boundsCoverage[minY * stride + minX] += 1;
      boundsCoverage[minY * stride + maxX + 1] -= 1;
      boundsCoverage[(maxY + 1) * stride + minX] -= 1;
      boundsCoverage[(maxY + 1) * stride + maxX + 1] += 1;
    }
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = y * stride + x;
      boundsCoverage[index] += (x ? boundsCoverage[index - 1] : 0)
        + (y ? boundsCoverage[index - stride] : 0)
        - (x && y ? boundsCoverage[index - stride - 1] : 0);
    }
  }

  // One bounded multi-source BFS gives distance to every subject together.
  const distance = new Int32Array(total);
  distance.fill(-1);
  head = 0; tail = 0;
  if (resolved.nearSubjectDistance > 0) {
    for (let index = 0; index < total; index += 1) {
      if (labels[index] && components[labels[index] - 1].isSubject) {
        distance[index] = 0; queue[tail++] = index;
      }
    }
    while (head < tail) {
      const index = queue[head++];
      if (distance[index] >= resolved.nearSubjectDistance) continue;
      const y = Math.floor(index / width), x = index % width;
      for (const [dx, dy] of EIGHT) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (distance[next] < 0) { distance[next] = distance[index] + 1; queue[tail++] = next; }
      }
    }
  }

  const insideBounds = new Uint8Array(components.length);
  const nearSubject = new Uint8Array(components.length);
  for (let index = 0; index < total; index += 1) {
    const id = labels[index];
    if (!id) continue;
    const component = components[id - 1];
    const y = Math.floor(index / width), x = index % width;
    if (boundsCoverage.length && boundsCoverage[y * stride + x] > 0) insideBounds[id - 1] = 1;
    if (distance[index] >= 0) nearSubject[id - 1] = 1;
    if (component.touchesBoundary && coloredCells < total) component.touchesExterior = true;
    for (const [dx, dy] of backgroundOffsets) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && exterior[ny * width + nx]) {
        component.touchesExterior = true;
      }
    }
  }

  const stats: BackgroundIslandAnalysis['stats'] = {
    totalCells: total, coloredCells, transparentCells: total - coloredCells,
    componentCount: components.length, subjectCount: 0, candidateComponents: 0,
    candidateCells: 0, protectedComponents: 0, protectedCells: 0,
  };
  for (const component of components) {
    const reasons: BackgroundIslandProtection[] = [];
    if (component.isSubject) { reasons.push('subject'); stats.subjectCount += 1; }
    if (!component.touchesExterior) reasons.push('enclosed');
    if (!component.isSubject && insideBounds[component.id - 1]) reasons.push('subject-bounds');
    if (!component.isSubject && nearSubject[component.id - 1]) reasons.push('near-subject');
    component.protectionReasons = reasons;
    component.eligible = component.size <= resolved.maxIslandSize && !component.isSubject && component.touchesExterior;
    component.candidate = component.eligible && reasons.length === 0;
    if (component.candidate) { stats.candidateComponents += 1; stats.candidateCells += component.size; }
    else { stats.protectedComponents += 1; stats.protectedCells += component.size; }
  }
  const candidateMask = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    if (labels[index] && components[labels[index] - 1].candidate) candidateMask[index] = 1;
  }
  return { width, height, options: resolved, components, componentIds: labels, candidateMask, exteriorMask: exterior, sourceGrid, stats };
}

/** Build a fresh preview mask. Explicit selections override only soft guards. */
export function createBackgroundIslandMask(
  analysis: BackgroundIslandAnalysis,
  selection: BackgroundIslandSelection = {},
): Uint8Array {
  const ids = (values: readonly number[]) => {
    for (const id of values) {
      if (!Number.isInteger(id) || id < 1 || id > analysis.components.length) throw new RangeError('Unknown background island component ID');
    }
    return new Set(values);
  };
  const selected = selection.selectedComponentIds === undefined ? undefined : ids(selection.selectedComponentIds);
  const protectedIds = ids(selection.protectedComponentIds ?? []);
  const flags = new Uint8Array(analysis.components.length + 1);
  for (const component of analysis.components) {
    if (component.eligible && !protectedIds.has(component.id) && (selected ? selected.has(component.id) : component.candidate)) {
      flags[component.id] = 1;
    }
  }
  return Uint8Array.from(analysis.componentIds, id => flags[id]);
}

/** Immutable application after preview confirmation. Caller owns undo/redo. */
export function applyBackgroundIslandCleanup(
  grid: BackgroundIslandGrid,
  analysis: BackgroundIslandAnalysis,
  selection: BackgroundIslandSelection = {},
): (string | null)[][] {
  if (grid.length !== analysis.height) throw new RangeError('Background island preview is stale; analyze the current grid again');
  for (let y = 0; y < analysis.height; y += 1) {
    if (grid[y].length !== analysis.width) throw new RangeError('Background island preview is stale; analyze the current grid again');
    for (let x = 0; x < analysis.width; x += 1) {
      if (grid[y][x] !== analysis.sourceGrid[y][x]) throw new RangeError('Background island preview is stale; analyze the current grid again');
    }
  }
  const mask = createBackgroundIslandMask(analysis, selection);
  return grid.map((row, y) => row.map((cell, x) => mask[y * analysis.width + x] ? null : cell));
}
