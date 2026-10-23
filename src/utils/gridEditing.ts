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
