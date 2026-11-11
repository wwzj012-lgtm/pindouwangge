import type { SymmetryMode } from '../types';

export interface SymmetryAxes { x: number; y: number }
export type GridPoint = { x: number; y: number };
type Grid = (string | null)[][];

export function normalizeSymmetryAxes(axes: SymmetryAxes | null | undefined, width: number, height: number): SymmetryAxes {
  const normalize = (value: number | undefined, limit: number) => Number.isFinite(value)
    ? Math.max(0, Math.min(limit, Math.round(value! * 2) / 2)) : limit / 2;
  return { x: normalize(axes?.x, width), y: normalize(axes?.y, height) };
}

/** Axis coordinates use grid edges: 0 is the left/top edge, .5 the first cell center. */
export function reflectGridPoints(points: readonly GridPoint[], mode: SymmetryMode, width: number, height: number, axes?: SymmetryAxes | null): GridPoint[] {
  const axis = normalizeSymmetryAxes(axes, width, height);
  const result = new Map<string, GridPoint>();
  const add = (x: number, y: number) => {
    if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height) {
      result.set(`${x},${y}`, { x, y });
    }
  };
  for (const { x, y } of points) {
    add(x, y);
    const rx = 2 * axis.x - x - 1, ry = 2 * axis.y - y - 1;
    if (mode === 'horizontal' || mode === 'quad') add(rx, y);
    if (mode === 'vertical' || mode === 'quad') add(x, ry);
    if (mode === 'quad') add(rx, ry);
  }
  return [...result.values()];
}

export function flipGrid(grid: Grid, direction: 'horizontal' | 'vertical'): Grid {
  return direction === 'horizontal' ? grid.map(row => [...row].reverse()) : [...grid].reverse().map(row => [...row]);
}

export type WidthExpandSide = 'left' | 'right';

/**
 * 把网格对齐到目标尺寸（列数 width / 行数 height）。
 * 画板尺寸（settings.width/height）与 grid 数据必须同步：否则新列"看得见"
 * 但数据不存在，画进去的豆散落地撑长被碰到的行（行长度参差），保存时
 * codec 校验直接报 "grid row N does not match project width"。
 *
 * side 决定宽度变化时内容锚定在哪一侧：'left' 表示行首补列/裁列
 * （用户要"左边加一列"时配合翻转流程，或直接左扩），'right' 为默认行尾。
 * 行尾补 null 而不是 undefined（防稀疏数组写洞），保证 codec 可编码。
 */
export function alignGridToSize(grid: Grid, width: number, height: number, side: WidthExpandSide = 'right'): Grid {
  const result: Grid = [];
  for (let y = 0; y < height; y += 1) {
    const row = Array.isArray(grid[y]) ? grid[y] : [];
    const columnShift = width - row.length;
    const aligned: (string | null)[] = new Array(width);
    for (let x = 0; x < width; x += 1) {
      const sourceX = side === 'left' ? x - columnShift : x;
      const value = sourceX >= 0 && sourceX < row.length ? row[sourceX] : null;
      aligned[x] = value ?? null;
    }
    result.push(aligned);
  }
  return result;
}

/** Four-neighbor, same-color bucket clear; disconnected and diagonal beads survive. */
export function clearConnectedColorRegion(grid: Grid, x: number, y: number): Grid {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !grid[y]?.[x]) return grid;
  const color = grid[y][x];
  const result = [...grid];
  const cloned = new Set<number>();
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const queue = new Uint32Array(width * grid.length);
  const visited = new Uint8Array(queue.length);
  let tail = 0;
  const enqueue = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= width || py >= grid.length || grid[py]?.[px] !== color) return;
    const key = py * width + px;
    if (visited[key]) return;
    visited[key] = 1; queue[tail++] = key;
  };
  enqueue(x, y);
  for (let cursor = 0; cursor < tail; cursor++) {
    const py = Math.floor(queue[cursor] / width), px = queue[cursor] % width;
    if (!cloned.has(py)) { result[py] = [...grid[py]]; cloned.add(py); }
    result[py][px] = null;
    enqueue(px - 1, py); enqueue(px + 1, py); enqueue(px, py - 1); enqueue(px, py + 1);
  }
  return result;
}
