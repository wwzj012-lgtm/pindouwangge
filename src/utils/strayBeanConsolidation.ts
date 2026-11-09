import { deltaE2000, rgbToLab } from './colorUtils';

export type StrayBeanStrength = 'light' | 'standard' | 'strong';

export interface StrayBeanContext {
  mode?: 'photo' | 'cartoon' | 'logo';
  /** Omitted context preserves the explicit/manual tool's historical availability. */
  intent?: 'auto' | 'manual';
  /**
   * 自定义并入阈值（颗）：色号**全图总颗数** ≤N 才并入相邻色块，覆盖轻度/
   * 标准/强力的预设档位。用户界面提供数字输入；省略时用档位默认值。
   */
  maxClusterSize?: number;
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

/**
 * 手动档位的并入阈值（绝对颗数，含）：某色号**在全图的总颗数** ≤N 才算
 * "散豆色号"，该色号的所有豆（无论散落几处）整批并入相邻色块。
 * 轻度只清全图仅 1 颗的色号，标准清全图 1-5 颗的，强力清到 10 颗。
 * 判定维度是色号总量而不是单个连通块：同一色号要么整体处理、要么整体不动，
 * 绝不允许"眼睛处的 H2 被吞、帽子处的 H2 还在"这种撕裂结果。
 */
const CLUSTER_CAPS: Record<StrayBeanStrength, number> = {
  light: 1,
  standard: 5,
  strong: 10,
};

/**
 * 自动管线（intent: 'auto'）保留旧的按比例阈值：整图转换的清理量应随图纸规模
 * 自适应（大图允许清更大的块），这是管线验证过的既有行为，不随手动档位改动。
 */
const AUTO_RATIOS: Record<StrayBeanStrength, number> = {
  light: 0.005,
  standard: 0.01,
  strong: 0.015,
};

/** 卡通装饰豁免的"高反差"门槛（ΔE2000）：低于它的杂点照常并入，高于它的小块视为有意点缀。 */
const DECORATION_MIN_DELTA_E = 15;

const ADJACENT_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],             [0, 1],
  [1, -1],  [1, 0],  [1, 1],
] as const;

/** ΔE2000 感知色距：比 RGB 欧氏距离更符合"肉眼相近"，选并入目标更准。 */
function colorDistance(left: RgbColor, right: RgbColor): number {
  return deltaE2000(rgbToLab(left.r, left.g, left.b), rgbToLab(right.r, right.g, right.b));
}

/**
 * Two eligibility semantics, selected by `context.intent`:
 *
 * - **manual**（散豆整合按钮）：eligibility is decided per **colour totals** —
 *   a palette colour whose total bead count across the whole grid is ≤ the cap
 *   (light ≤1, standard ≤5, strong ≤10, or user-defined `maxClusterSize`) has
 *   *every* occurrence merged toward the nearest adjacent stable colour. The
 *   same colour is never split into "merged here, kept there"; occurrences
 *   without a stable neighbour are safely left untouched.
 * - **auto**（整图转换管线）：legacy behaviour — per-component size against a
 *   ratio threshold, with thin-linework and cartoon-decoration exemptions.
 *
 * Both paths pick the replacement as the adjacent stable component with the
 * closest ΔE2000 colour, replace simultaneously, and never mutate input cells.
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
  // 双语义：auto（整图转换管线）按**连通块**大小清——阈值随全图豆数比例自适应，
  // 这是管线验证过的既有行为；manual（散豆整合按钮）按**色号全图总颗数**清——
  // 同一色号要么整批并入、要么整批保留，与它在图上拆成几个连通块无关。
  const isAuto = context.intent === 'auto';
  const cap = Math.max(1, Math.floor(context.maxClusterSize ?? CLUSTER_CAPS[strength]));
  const keyCounts = new Map<string, number>();
  for (const key of keys) {
    if (key === null) continue;
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  const threshold = isAuto ? Math.max(2, Math.floor(filled * AUTO_RATIOS[strength])) : 0;
  // manual 下"稳定"= 色号总量超出档位；这些块既是替换目标，也是绝不改写的一方。
  const stable = (component: Component<T>) => (isAuto
    ? component.count > threshold || component.lineDetail
    : (keyCounts.get(component.key) ?? 0) > cap);
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

  const isCartoonDecoration = (source: Component<T>, replacement: Component<T>, contacts: number): boolean => {
    if (context.mode !== 'cartoon' || colorDistance(source.color, replacement.color) < DECORATION_MIN_DELTA_E) return false;
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
        if (stable(contour) && luma <= 80 && colorDistance(contour.color, replacement.color) >= DECORATION_MIN_DELTA_E) return true;
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
    if (!replacement) continue;
    // 卡通高反差点缀豁免只在自动管线生效：手动按钮是用户主动执行、且 manual
    // 的判定已升级为色号总量——豁免若同时生效会把同一色号撕成"部分保留"，
    // 正是手动档位要消灭的不一致。
    if (isAuto && isCartoonDecoration(source, replacement, contacts)) continue;
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

export interface IsolatedBeanClearAdapter<T> {
  /** Return false for cells which are intentionally blank and must stay blank. */
  isFilled(cell: T): boolean;
  /** A stable identity (usually the colour id): adjacent same-key cells form one cluster. */
  getColorKey(cell: T): string;
  /** Builds the blank state for a cell. Must not mutate the argument. */
  clearCell(cell: T): T;
}

export interface IsolatedBeanClearStats {
  /** Number of beads turned blank. */
  removed: number;
  /** Clusters (inclusive cap) actually cleared this run. */
  clusters: number;
  /** Effective per-cluster cap: clusters larger than this survive. */
  threshold: number;
}

/**
 * 清除孤立豆（画板手动工具）：手动擦除/去背景后残留的离散小点，
 * 按 8 连通把 ≤N 颗的连通块整块置空（N = 档位颗数或自定义 `maxClusterSize`）。
 * 与 `consolidateStrayBeans` 的 manual 语义不同——清除面对的是**杂色残渣**
 * （每处颜色往往互不相同），色号总量语义不适用，因此判定维度是连通块颗数。
 *
 * 保护规则：
 *  - 全图最大的连通块永不清除：满图碎块的病态输入不会被清空；
 *  - `lineDetail` 细长结构（胡须、轮廓线）不清除——它们是有意的细节；
 *  - 全部替换同时进行，输入网格与格子对象不被修改；结果网格可撤销。
 * 没有任何块满足条件时 `stats` 为 null（调用方据此跳过反馈）。
 */
export function clearIsolatedBeans<T>(
  beanGrid: readonly (readonly T[])[],
  adapter: IsolatedBeanClearAdapter<T>,
  strength: StrayBeanStrength = 'standard',
  context: { maxClusterSize?: number } = {},
): { grid: T[][]; stats: IsolatedBeanClearStats | null } {
  const result = beanGrid.map(row => [...row]);
  const rowStarts = [0];
  for (const row of beanGrid) rowStarts.push(rowStarts[rowStarts.length - 1] + row.length);
  const total = rowStarts[beanGrid.length];
  if (!total) return { grid: result, stats: null };
  const rows = new Uint32Array(total);
  const filled = new Uint8Array(total);
  for (let row = 0; row < beanGrid.length; row += 1) {
    rows.fill(row, rowStarts[row], rowStarts[row + 1]);
    for (let column = 0; column < beanGrid[row].length; column += 1) {
      if (!adapter.isFilled(beanGrid[row][column])) continue;
      filled[rowStarts[row] + column] = 1;
    }
  }
  const cap = Math.max(1, Math.floor(context.maxClusterSize ?? CLUSTER_CAPS[strength]));
  // 连通域按**同色号**分组（与 consolidateStrayBeans 的组件语义一致）：
  // 残渣点通常紧贴主体，若不分色 flood fill 会把整张图连成一个组件、
  // 残渣全部被"最大块保护"吞掉——清除就永远失效（首版实测踩坑）。
  const keys: (string | null)[] = Array(total).fill(null);
  for (let index = 0; index < total; index += 1) {
    if (!filled[index]) continue;
    keys[index] = adapter.getColorKey(beanGrid[rows[index]][index - rowStarts[rows[index]]]);
  }
  // 8 连通 flood fill（复用单缓冲 BFS 的内存形态），同时记录 lineDetail。
  const labels = new Uint32Array(total);
  const queue = new Uint32Array(total);
  let end = 0;
  const components: { start: number; count: number; lineDetail: boolean; minRow: number; maxRow: number; minColumn: number; maxColumn: number }[] = [];
  const neighbourIndex = (row: number, column: number): number => (
    row >= 0 && row < beanGrid.length && column >= 0 && column < beanGrid[row].length
      ? rowStarts[row] + column : -1
  );
  for (let seed = 0; seed < total; seed += 1) {
    if (!filled[seed] || labels[seed]) continue;
    const row = rows[seed];
    const column = seed - rowStarts[row];
    const key = keys[seed]!;
    const component = { start: end, count: 0, lineDetail: false, minRow: row, maxRow: row, minColumn: column, maxColumn: column };
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
        if (next < 0 || !filled[next] || labels[next] || keys[next] !== key) continue;
        labels[next] = label;
        queue[end++] = next;
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
  let largest = 0;
  for (const component of components) largest = Math.max(largest, component.count);
  // 大簇集合（>cap）：与它们相邻的小簇是嵌在主体中的细节（高光、饰片），
  // 不是"离散的残点"——相邻大簇的小簇一律保护。真正的残渣远离主体，
  // 周围只有同样微小的簇或空白。
  const bigLabels = new Uint8Array(components.length + 1);
  for (let index = 0; index < components.length; index += 1) {
    if (components[index].count > cap) bigLabels[index + 1] = 1;
  }
  let removed = 0;
  let clusters = 0;
  for (const component of components) {
    // 最大连通块永不清除；细长结构是有意的细节，也不清除。
    if (component.count === largest || component.count > cap || component.lineDetail) continue;
    // 相邻大簇保护：遍历簇内每格的 8 邻，碰到大簇即保留整簇。
    let touchesBig = false;
    for (let cursor = component.start; cursor < component.start + component.count && !touchesBig; cursor += 1) {
      const index = queue[cursor];
      const row = rows[index];
      const column = index - rowStarts[row];
      for (const [oy, ox] of ADJACENT_OFFSETS) {
        const next = neighbourIndex(row + oy, column + ox);
        if (next < 0 || !filled[next]) continue;
        const neighbourLabel = labels[next];
        if (neighbourLabel !== labels[index] && bigLabels[neighbourLabel]) { touchesBig = true; break; }
      }
    }
    if (touchesBig) continue;
    clusters += 1;
    for (let cursor = component.start; cursor < component.start + component.count; cursor += 1) {
      const index = queue[cursor];
      const row = rows[index];
      const column = index - rowStarts[row];
      result[row][column] = adapter.clearCell(beanGrid[row][column]);
      removed += 1;
    }
  }
  if (!removed) return { grid: result, stats: null };
  return { grid: result, stats: { removed, clusters, threshold: cap } };
}
