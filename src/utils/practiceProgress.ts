/**
 * Practice progress + section math for the read-only community pattern workspace.
 *
 * Everything here is pure (no React, no canvas) so it can be unit-tested directly.
 * Progress is stored as one bit per grid cell: `index = y * width + x`.
 */

export interface PracticeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PracticeSection extends PracticeRect {
  /** 0-based section column (rendered as 1-based number, e.g. "3"). */
  col: number;
  /** 0-based section row (rendered as a letter, e.g. "B"). */
  row: number;
  /** Human readable label, e.g. "B3". */
  label: string;
  /** Beads that live inside this section. */
  beads: number;
  /** Beads already placed inside this section. */
  placed: number;
}

export interface PracticeCell {
  x: number;
  y: number;
  index: number;
}

type ProgressStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const PRACTICE_SECTION_SIZES = [10, 20, 25] as const;
export type PracticeSectionSize = (typeof PRACTICE_SECTION_SIZES)[number];
export const DEFAULT_PRACTICE_SECTION_SIZE: PracticeSectionSize = 20;
/**
 * Below this bead count the section map is pure noise: a tiny pattern fits in one
 * glance, so the block minimap, the block card, and the canvas section guides are
 * all suppressed. 50 beads is roughly one 10 × 10 board of work.
 */
export const PRACTICE_MIN_BEADS_FOR_SECTIONS = 50;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Stable localStorage key. The community work key is already namespaced ("community:<id>"). */
export function practiceProgressStorageKey(workKey: string): string {
  return `beadgrid_practice_progress_v1:${workKey}`;
}

/**
 * Resolve the storage target. `undefined` means "auto-detect localStorage",
 * `null` means "no persistence at all" (used by tests).
 */
function resolveStorage(storage?: ProgressStorage | null): ProgressStorage | null {
  if (storage === null) return null;
  if (storage !== undefined) return storage;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < bytes.length; index++) {
    buffer = (buffer << 8) | bytes[index];
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      output += BASE64_ALPHABET[(buffer >> bits) & 63];
    }
  }
  if (bits > 0) output += BASE64_ALPHABET[(buffer << (6 - bits)) & 63];
  return output;
}

function decodeBase64(text: string): Uint8Array | null {
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const char of text) {
    if (char === '=') break;
    const value = BASE64_ALPHABET.indexOf(char);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

/** Bitset -> compact base64. Empty progress encodes to an empty string. */
export function encodePracticeProgress(done: ReadonlySet<number>): string {
  let maxIndex = -1;
  for (const index of done) {
    if (!Number.isInteger(index) || index < 0) continue;
    if (index > maxIndex) maxIndex = index;
  }
  if (maxIndex < 0) return '';
  const bytes = new Uint8Array(Math.floor(maxIndex / 8) + 1);
  for (const index of done) {
    if (!Number.isInteger(index) || index < 0) continue;
    bytes[index >> 3] |= 1 << (index & 7);
  }
  let length = bytes.length;
  while (length > 0 && bytes[length - 1] === 0) length -= 1;
  return length ? encodeBase64(bytes.subarray(0, length)) : '';
}

/**
 * Base64 -> bitset. Indices above `maxIndex` are dropped: a pattern may have been
 * swapped for a smaller one, and stale indices must never paint over other cells.
 */
export function decodePracticeProgress(encoded: string, maxIndex = Number.MAX_SAFE_INTEGER): Set<number> {
  const done = new Set<number>();
  if (!encoded) return done;
  const bytes = decodeBase64(encoded);
  if (!bytes) return done;
  const limit = Number.isFinite(maxIndex) ? maxIndex : Number.MAX_SAFE_INTEGER;
  for (let byte = 0; byte < bytes.length; byte++) {
    const value = bytes[byte];
    if (!value) continue;
    for (let bit = 0; bit < 8; bit++) {
      if (!(value & (1 << bit))) continue;
      const index = byte * 8 + bit;
      if (index > limit) return done;
      done.add(index);
    }
  }
  return done;
}

/** Read saved progress. Any failure (no storage, corrupt payload) yields an empty set. */
export function loadPracticeProgress(
  workKey: string,
  maxIndex = Number.MAX_SAFE_INTEGER,
  storage?: ProgressStorage | null,
): Set<number> {
  const target = resolveStorage(storage);
  if (!target) return new Set<number>();
  try {
    return decodePracticeProgress(target.getItem(practiceProgressStorageKey(workKey)) ?? '', maxIndex);
  } catch {
    return new Set<number>();
  }
}

/** Write progress. Failures stay silent: practice must never block on storage. */
export function savePracticeProgress(
  workKey: string,
  done: ReadonlySet<number>,
  storage?: ProgressStorage | null,
): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(practiceProgressStorageKey(workKey), encodePracticeProgress(done));
    return true;
  } catch {
    return false;
  }
}

export function practiceProgressAvailable(storage?: ProgressStorage | null): boolean {
  return resolveStorage(storage) !== null;
}

/** Immutable single-cell toggle (used by both click and undo). */
export function togglePracticeCell(done: ReadonlySet<number>, index: number): Set<number> {
  const next = new Set(done);
  if (!Number.isInteger(index) || index < 0) return next;
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

export function countPlacedByColor(
  grid: readonly (readonly (string | null)[])[],
  done: ReadonlySet<number>,
): Map<string, number> {
  const counts = new Map<string, number>();
  const width = grid[0]?.length ?? 0;
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < width; x++) {
      const id = row[x];
      if (id === null || id === undefined) continue;
      if (!done.has(y * width + x)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/** Clamp a rect to the grid before counting, so callers may pass raw viewport rects. */
function clampRect(rect: PracticeRect, width: number, height: number): PracticeRect {
  const x = Math.max(0, Math.min(width, Math.floor(rect.x)));
  const y = Math.max(0, Math.min(height, Math.floor(rect.y)));
  const right = Math.max(x, Math.min(width, Math.ceil(rect.x + rect.width)));
  const bottom = Math.max(y, Math.min(height, Math.ceil(rect.y + rect.height)));
  return { x, y, width: right - x, height: bottom - y };
}

export function countBeadsInRect(
  grid: readonly (readonly (string | null)[])[],
  rect: PracticeRect,
): number {
  const height = grid.length;
  const width = height ? grid[0].length : 0;
  if (!width || !height) return 0;
  const area = clampRect(rect, width, height);
  let total = 0;
  for (let y = area.y; y < area.y + area.height; y++) {
    const row = grid[y];
    for (let x = area.x; x < area.x + area.width; x++) {
      if (row[x] !== null && row[x] !== undefined) total += 1;
    }
  }
  return total;
}

/** Count placed cells inside a rect. `height` is optional (unbounded when omitted). */
export function countPlacedInRect(
  done: ReadonlySet<number>,
  width: number,
  rect: PracticeRect,
  height = Number.MAX_SAFE_INTEGER,
): number {
  if (width <= 0) return 0;
  const area = clampRect(rect, width, height);
  let total = 0;
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      if (done.has(y * width + x)) total += 1;
    }
  }
  return total;
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function practiceSectionLetter(row: number): string {
  let value = Math.max(0, Math.floor(row));
  let label = '';
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

export function practiceSectionLabel(col: number, row: number): string {
  return `${practiceSectionLetter(row)}${Math.max(0, Math.floor(col)) + 1}`;
}

export function practiceSectionColumns(width: number, sectionSize: number): number {
  const size = Math.max(1, Math.floor(sectionSize));
  return Math.max(1, Math.ceil(Math.max(0, width) / size));
}

/** The minimap mirrors the real block layout, but never wider than 7 columns. */
export const PRACTICE_MINIMAP_MAX_COLUMNS = 7;

export function practiceMinimapColumns(
  width: number,
  sectionSize: number,
  limit = PRACTICE_MINIMAP_MAX_COLUMNS,
): number {
  const columns = practiceSectionColumns(width, sectionSize);
  const cap = Math.max(1, Math.floor(limit));
  return Math.max(1, Math.min(columns, cap));
}

export function practiceSectionCount(width: number, height: number, sectionSize: number): number {
  const size = Math.max(1, Math.floor(sectionSize));
  return practiceSectionColumns(width, size) * Math.max(1, Math.ceil(Math.max(0, height) / size));
}

/** Clamped rect of one section. The last column/row may be a partial (residual) section. */
export function practiceSectionRect(
  col: number,
  row: number,
  sectionSize: number,
  width: number,
  height: number,
): PracticeRect {
  const size = Math.max(1, Math.floor(sectionSize));
  const x = Math.max(0, Math.min(width, Math.floor(col) * size));
  const y = Math.max(0, Math.min(height, Math.floor(row) * size));
  return {
    x,
    y,
    width: Math.max(0, Math.min(width, x + size) - x),
    height: Math.max(0, Math.min(height, y + size) - y),
  };
}

export function practiceSectionForCell(x: number, y: number, sectionSize: number): {
  col: number;
  row: number;
  label: string;
} {
  const size = Math.max(1, Math.floor(sectionSize));
  const col = Math.max(0, Math.floor(x / size));
  const row = Math.max(0, Math.floor(y / size));
  return { col, row, label: practiceSectionLabel(col, row) };
}

/**
 * All sections in A1, A2, ... B1 order with bead and placed counts.
 * One pass over the grid; sections without beads report `beads: 0`.
 */
export function listPracticeSections(
  grid: readonly (readonly (string | null)[])[],
  done: ReadonlySet<number>,
  sectionSize: number,
): PracticeSection[] {
  const height = grid.length;
  const width = height ? grid[0].length : 0;
  if (!width || !height) return [];
  const size = Math.max(1, Math.floor(sectionSize));
  const cols = practiceSectionColumns(width, size);
  const rows = Math.max(1, Math.ceil(height / size));
  const beads = new Array<number>(cols * rows).fill(0);
  const placed = new Array<number>(cols * rows).fill(0);
  for (let y = 0; y < height; y++) {
    const row = grid[y];
    const band = Math.floor(y / size) * cols;
    for (let x = 0; x < width; x++) {
      if (row[x] === null || row[x] === undefined) continue;
      const slot = band + Math.floor(x / size);
      beads[slot] += 1;
      if (done.has(y * width + x)) placed[slot] += 1;
    }
  }
  const sections: PracticeSection[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const slot = row * cols + col;
      sections.push({
        col,
        row,
        label: practiceSectionLabel(col, row),
        ...practiceSectionRect(col, row, size, width, height),
        beads: beads[slot],
        placed: placed[slot],
      });
    }
  }
  return sections;
}

export function findSectionByLabel(
  sections: readonly PracticeSection[],
  label: string | null,
): PracticeSection | null {
  if (!label) return null;
  return sections.find(section => section.label === label) ?? null;
}

/**
 * Next section that still has unplaced beads, cycling A1 -> A2 -> ... -> B1.
 * Starts strictly after `currentLabel`; without a current section it starts at A1.
 */
export function findNextIncompleteSection(
  sections: readonly PracticeSection[],
  currentLabel: string | null,
): PracticeSection | null {
  if (!sections.length) return null;
  const startIndex = currentLabel ? sections.findIndex(section => section.label === currentLabel) : -1;
  const start = startIndex >= 0 ? startIndex + 1 : 0;
  for (let offset = 0; offset < sections.length; offset++) {
    const section = sections[(start + offset) % sections.length];
    if (section.beads > section.placed) return section;
  }
  return null;
}

/**
 * First unplaced bead, preferring `preferredColorId` when given.
 * Row-major order so "next bead" always moves forward through the pattern.
 */
export function findNextUnplacedCell(
  grid: readonly (readonly (string | null)[])[],
  done: ReadonlySet<number>,
  preferredColorId: string | null = null,
): PracticeCell | null {
  const width = grid[0]?.length ?? 0;
  if (!width) return null;
  let fallback: PracticeCell | null = null;
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < width; x++) {
      const id = row[x];
      if (id === null || id === undefined) continue;
      const index = y * width + x;
      if (done.has(index)) continue;
      if (preferredColorId !== null && id === preferredColorId) return { x, y, index };
      if (!fallback) fallback = { x, y, index };
    }
  }
  return fallback;
}

export function countPlacedBeads(
  grid: readonly (readonly (string | null)[])[],
  done: ReadonlySet<number>,
): number {
  const width = grid[0]?.length ?? 0;
  if (!width) return 0;
  let placed = 0;
  for (const index of done) {
    if (!Number.isInteger(index) || index < 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    if (grid[y]?.[x] != null) placed += 1;
  }
  return placed;
}
