export type StrayBeanStrength = 'light' | 'standard' | 'strong';

export interface StrayBeanContext {
  mode?: 'photo' | 'cartoon' | 'logo';
  /** Omitted context preserves the explicit/manual tool's historical availability. */
  intent?: 'auto' | 'manual';
}

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
  /** Optional source-image guard. A veto preserves the entire connected component. */
  canReplace?(noise: T, replacement: T, row: number, column: number): boolean;
}

interface Component<T> {
  key: string;
  cell: T;
  color: RgbColor;
  start: number;
  count: number;
  minRow: number;
  maxRow: number;
  minColumn: number;
  maxColumn: number;
  touchesBlank: boolean;
  lineDetail: boolean;
}

const RATIOS: Record<StrayBeanStrength, number> = {
  light: 0.005,
  standard: 0.01,
  strong: 0.015,
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

/**
 * Merge small eight-connected islands, NOT every occurrence of a rare colour.
 * The inclusive threshold is max(2, floor(nonblank beads * strength ratio)), with
 * no fixed upper cap. Stable neighbouring components and thin linework survive.
 * Cached keys, one component flood fill and bounded local geometry keep work O(N)
 * and storage O(N), independent of the number of rare palette colours.
 * Blank cells and all input cells/rows remain untouched; replacements are simultaneous.
 */
export function consolidateStrayBeans<T>(
  beanGrid: readonly (readonly T[])[],
  adapter: StrayBeanGridAdapter<T>,
  strength: StrayBeanStrength = 'standard',
  context: StrayBeanContext = {},
): T[][] {
  const result = beanGrid.map(row => [...row]);
  if (context.mode === 'logo' && context.intent === 'auto') return result;

  const rowStarts = [0];
  for (const row of beanGrid) rowStarts.push(rowStarts[rowStarts.length - 1] + row.length);
  const total = rowStarts[beanGrid.length];
  const rows = new Uint32Array(total);
  const keys: (string | null)[] = Array(total).fill(null);
  const colors = new Map<string, RgbColor>();
  let filled = 0;
  for (let row = 0; row < beanGrid.length; row += 1) {
    rows.fill(row, rowStarts[row], rowStarts[row + 1]);
    for (let column = 0; column < beanGrid[row].length; column += 1) {
      const cell = beanGrid[row][column];
      if (!adapter.isFilled(cell)) continue;
      const key = adapter.getColorKey(cell);
      keys[rowStarts[row] + column] = key;
      if (!colors.has(key)) colors.set(key, adapter.getColor(cell));
      filled += 1;
    }
  }
  if (!filled) return result;
  const threshold = Math.max(2, Math.floor(filled * RATIOS[strength]));
  const labels = new Uint32Array(total);
  // All components occupy contiguous spans in this single bounded BFS buffer.
  const queue = new Uint32Array(filled);
  let end = 0;
  const components: Component<T>[] = [];
  const neighbourIndex = (row: number, column: number): number => (
    row >= 0 && row < beanGrid.length && column >= 0 && column < beanGrid[row].length
      ? rowStarts[row] + column : -1
  );

  for (let seed = 0; seed < total; seed += 1) {
    const key = keys[seed];
    if (key === null || labels[seed]) continue;
    const row = rows[seed];
    const column = seed - rowStarts[row];
    const component: Component<T> = {
      key, cell: beanGrid[row][column], color: colors.get(key)!, start: end, count: 0,
      minRow: row, maxRow: row, minColumn: column, maxColumn: column,
      touchesBlank: false, lineDetail: false,
    };
    components.push(component);
    const label = components.length;
    labels[seed] = label;
    queue[end++] = seed;
    for (let cursor = component.start; cursor < end; cursor += 1) {
      const index = queue[cursor];
      const y = rows[index];
      const x = index - rowStarts[y];
      component.minRow = Math.min(component.minRow, y);
      component.maxRow = Math.max(component.maxRow, y);
      component.minColumn = Math.min(component.minColumn, x);
      component.maxColumn = Math.max(component.maxColumn, x);
      for (const [oy, ox] of ADJACENT_OFFSETS) {
        const next = neighbourIndex(y + oy, x + ox);
        if (next < 0) continue;
        if (keys[next] === null) component.touchesBlank = true;
        else if (keys[next] === key && !labels[next]) {
          labels[next] = label;
          queue[end++] = next;
        }
      }
    }
    component.count = end - component.start;
    const height = component.maxRow - component.minRow + 1;
    const width = component.maxColumn - component.minColumn + 1;
    component.lineDetail = Math.max(width, height) >= 3 && (
      Math.max(width, height) / Math.min(width, height) >= 3
      || component.count / (width * height) <= 0.5
    );
  }

  const stable = (component: Component<T>) => component.count > threshold || component.lineDetail;
  const isCartoonDecoration = (source: Component<T>, replacement: Component<T>, contacts: number): boolean => {
    if (context.mode !== 'cartoon' || colorDistance(source.color, replacement.color) < 64) return false;
    const height = source.maxRow - source.minRow + 1;
    const width = source.maxColumn - source.minColumn + 1;
    if (Math.max(width, height) / Math.min(width, height) > 2.5
      || source.count / (width * height) < 0.5) return false;
    // A compact, contrasting accent attached to a transparent silhouette.
    if (source.touchesBlank && contacts >= 2) return true;
    // Or a contrasting compact point within three cells of a coherent dark
    // contour. Low-contrast specks and unrelated dots in flat fills still merge.
    for (let cursor = source.start; cursor < source.start + source.count; cursor += 1) {
      const index = queue[cursor];
      const y = rows[index];
      const x = index - rowStarts[y];
      for (let oy = -3; oy <= 3; oy += 1) for (let ox = -3; ox <= 3; ox += 1) {
        const near = neighbourIndex(y + oy, x + ox);
        if (near < 0 || !labels[near] || labels[near] === labels[index]) continue;
        const contour = components[labels[near] - 1];
        const luma = contour.color.r * 0.2126 + contour.color.g * 0.7152 + contour.color.b * 0.0722;
        if (stable(contour) && luma <= 80 && colorDistance(contour.color, replacement.color) >= 64) return true;
      }
    }
    return false;
  };

  for (const source of components) {
    if (stable(source)) continue;
    const candidates = new Map<number, number>();
    for (let cursor = source.start; cursor < source.start + source.count; cursor += 1) {
      const index = queue[cursor];
      const row = rows[index];
      const column = index - rowStarts[row];
      for (const [oy, ox] of ADJACENT_OFFSETS) {
        const next = neighbourIndex(row + oy, column + ox);
        if (next < 0 || !labels[next] || labels[next] === labels[index]) continue;
        const label = labels[next];
        if (stable(components[label - 1])) candidates.set(label, (candidates.get(label) ?? 0) + 1);
      }
    }
    let replacement: Component<T> | undefined;
    let distance = Infinity;
    let contacts = 0;
    for (const [label, adjacentCount] of candidates) {
      const candidate = components[label - 1];
      const candidateDistance = colorDistance(source.color, candidate.color);
      if (candidateDistance < distance || (candidateDistance === distance && (
        adjacentCount > contacts || (adjacentCount === contacts && candidate.key < replacement!.key)
      ))) {
        replacement = candidate;
        distance = candidateDistance;
        contacts = adjacentCount;
      }
    }
    if (!replacement || isCartoonDecoration(source, replacement, contacts)) continue;
    if (adapter.canReplace) {
      let allowed = true;
      for (let cursor = source.start; cursor < source.start + source.count; cursor += 1) {
        const index = queue[cursor];
        const row = rows[index];
        const column = index - rowStarts[row];
        if (!adapter.canReplace(beanGrid[row][column], replacement.cell, row, column)) { allowed = false; break; }
      }
      if (!allowed) continue;
    }
    for (let cursor = source.start; cursor < source.start + source.count; cursor += 1) {
      const index = queue[cursor];
      const row = rows[index];
      const column = index - rowStarts[row];
      result[row][column] = adapter.replaceColor(beanGrid[row][column], replacement.cell);
    }
  }
  return result;
}
