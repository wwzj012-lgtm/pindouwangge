export type StrayBeanStrength = 'light' | 'standard' | 'strong';

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface StrayBeanGridAdapter<T> {
  /** Return false for cells which are intentionally blank and must remain blank. */
  isFilled(cell: T): boolean;
  /** A stable palette-colour identifier. */
  getColorKey(cell: T): string;
  /** A stable RGB value for colour comparison. */
  getColor(cell: T): RgbColor;
  /** Creates the replacement cell. It must not mutate either argument. */
  replaceColor(noise: T, replacement: T): T;
}

interface Candidate<T> {
  key: string;
  cell: T;
  color: RgbColor;
  count: number;
  adjacentCount: number;
}

const MAXIMUM_COUNTS: Record<StrayBeanStrength, number> = {
  light: 10,
  standard: 20,
  strong: 30,
};

const ADJACENT_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],             [0, 1],
  [1, -1],  [1, 0],  [1, 1],
] as const;

function colorDistance(left: RgbColor, right: RgbColor): number {
  const red = left.r - right.r;
  const green = left.g - right.g;
  const blue = left.b - right.b;
  return Math.sqrt(red * red + green * green + blue * blue);
}

function at<T>(grid: readonly (readonly T[])[], row: number, column: number): T | undefined {
  return grid[row]?.[column];
}

function collectColorGroups<T>(
  grid: readonly (readonly T[])[],
  adapter: StrayBeanGridAdapter<T>,
): Map<string, Candidate<T>> {
  const groups = new Map<string, Candidate<T>>();
  for (const row of grid) {
    for (const cell of row) {
      if (!adapter.isFilled(cell)) continue;
      const key = adapter.getColorKey(cell);
      const existing = groups.get(key);
      if (existing) existing.count += 1;
      else groups.set(key, { key, cell, color: adapter.getColor(cell), count: 1, adjacentCount: 0 });
    }
  }
  return groups;
}

function collectCandidates<T>(
  grid: readonly (readonly T[])[],
  sourceKey: string,
  eliminatedKeys: ReadonlySet<string>,
  adapter: StrayBeanGridAdapter<T>,
): Candidate<T>[] {
  const candidates = new Map<string, Candidate<T>>();

  for (let row = 0; row < grid.length; row += 1) {
    for (let column = 0; column < grid[row].length; column += 1) {
      const source = grid[row][column];
      if (!adapter.isFilled(source) || adapter.getColorKey(source) !== sourceKey) continue;
      for (const [rowOffset, columnOffset] of ADJACENT_OFFSETS) {
        const neighbour = at(grid, row + rowOffset, column + columnOffset);
        if (neighbour === undefined || !adapter.isFilled(neighbour)) continue;
        const key = adapter.getColorKey(neighbour);
        if (key === sourceKey || eliminatedKeys.has(key)) continue;
        const existing = candidates.get(key);
        if (existing) existing.adjacentCount += 1;
        else candidates.set(key, { key, cell: neighbour, color: adapter.getColor(neighbour), count: 0, adjacentCount: 1 });
      }
    }
  }

  return [...candidates.values()];
}

/**
 * Consolidates each low-usage palette colour globally in one deterministic pass.
 * Blank cells are never filled, and the source grid and its existing cells are never mutated.
 */
export function consolidateStrayBeans<T>(
  beanGrid: readonly (readonly T[])[],
  adapter: StrayBeanGridAdapter<T>,
  strength: StrayBeanStrength = 'standard',
): T[][] {
  const groups = collectColorGroups(beanGrid, adapter);
  const eliminatedKeys = new Set(
    [...groups.values()]
      .filter((group) => group.count <= MAXIMUM_COUNTS[strength])
      .map((group) => group.key),
  );
  const replacements = new Map<string, Candidate<T>>();

  for (const sourceKey of [...eliminatedKeys].sort((left, right) => left.localeCompare(right))) {
    const source = groups.get(sourceKey);
    if (!source) continue;
    const replacement = collectCandidates(beanGrid, sourceKey, eliminatedKeys, adapter)
      .sort((left, right) => {
        const distanceDifference = colorDistance(source.color, left.color) - colorDistance(source.color, right.color);
        return distanceDifference || right.adjacentCount - left.adjacentCount || left.key.localeCompare(right.key);
      })[0];
    if (replacement) replacements.set(sourceKey, replacement);
  }

  return beanGrid.map((row) => row.map((cell) => {
    if (!adapter.isFilled(cell)) return cell;
    const replacement = replacements.get(adapter.getColorKey(cell));
    return replacement ? adapter.replaceColor(cell, replacement.cell) : cell;
  }));
}
