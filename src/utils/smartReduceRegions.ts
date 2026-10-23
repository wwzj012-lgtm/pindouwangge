import type { BeadColor } from '../types';
import { rgbToLab, deltaE2000 } from './colorUtils';

export type RegionIntensity = 'light' | 'medium' | 'strong';

interface Region {
  parent: number;
  color: string;
  size: number;
  locked: boolean;
  originalColors: Map<string, number>;
  borders: Map<number, number>;
}

/** Merge whole adjacent regions. Never invent colors, cross empty cells, move
 * outlines, or permit a chain of small changes to escape its original error bound. */
export function simplifyColorRegions(
  grid: (string | null)[][],
  palette: Map<string, BeadColor>,
  locked: boolean[][],
  intensity: RegionIntensity,
): (string | null)[][] {
  const h = grid.length, w = grid[0]?.length ?? 0;
  const labels = Array.from({ length: h }, () => new Int32Array(w).fill(-1));
  const regions: Region[] = [];
  let filled = 0;
  const around = (x: number, y: number): [number, number][] => (
    [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as [number, number][]
  ).filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < w && ny < h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const color = grid[y][x];
    if (!color || labels[y][x] !== -1) continue;
    const id = regions.length;
    const cells: [number, number][] = [[x, y]];
    labels[y][x] = id;
    let lockedCells = 0;
    for (let cursor = 0; cursor < cells.length; cursor++) {
      const [cx, cy] = cells[cursor];
      if (locked[cy]?.[cx]) lockedCells++;
      for (const [nx, ny] of around(cx, cy)) {
        if (labels[ny][nx] !== -1 || grid[ny][nx] !== color) continue;
        labels[ny][nx] = id;
        cells.push([nx, ny]);
      }
    }
    filled += cells.length;
    regions.push({ parent: id, color, size: cells.length,
      locked: cells.length <= 12 ? lockedCells > 0 : lockedCells / cells.length >= 0.6,
      originalColors: new Map([[color, cells.length]]), borders: new Map() });
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const id = labels[y][x];
    if (id < 0) continue;
    for (const [nx, ny] of around(x, y)) {
      const next = labels[ny][nx];
      if (next < 0 || next === id) continue;
      const borders = regions[id].borders;
      borders.set(next, (borders.get(next) ?? 0) + 1);
    }
  }
  const labs = new Map([...palette].map(([id, color]) => [id, rgbToLab(...color.rgb)]));
  const distances = new Map<string, number>();
  const distance = (a: string, b: string) => {
    if (a === b) return 0;
    const key = JSON.stringify(a < b ? [a, b] : [b, a]);
    const cached = distances.get(key);
    if (cached !== undefined) return cached;
    const la = labs.get(a), lb = labs.get(b);
    const result = la && lb ? deltaE2000(la, lb) : Infinity;
    distances.set(key, result);
    return result;
  };
  const root = (id: number): number => {
    let r = id;
    while (regions[r].parent !== r) r = regions[r].parent;
    while (id !== r) { const next = regions[id].parent; regions[id].parent = r; id = next; }
    return r;
  };
  const maxDelta = intensity === 'light' ? 5 : intensity === 'medium' ? 10 : 18;
  const sizeLimit = intensity === 'light' ? 3
    : intensity === 'medium' ? Math.max(8, Math.min(256, Math.ceil(filled * 0.08))) : Infinity;
  const minimumContact = intensity === 'light' ? 0.75 : intensity === 'medium' ? 0.25 : 0;
  let changed: boolean;
  do {
    changed = false;
    const sources = regions.map((_, id) => id).filter(id => root(id) === id)
      .sort((a, b) => regions[a].size - regions[b].size || regions[a].color.localeCompare(regions[b].color));
    for (const id of sources) {
      if (root(id) !== id) continue;
      const source = regions[id];
      if (source.locked || source.size > sizeLimit) continue;
      const neighbors = new Map<number, number>();
      for (const [other, count] of source.borders) {
        const next = root(other);
        if (next !== id) neighbors.set(next, (neighbors.get(next) ?? 0) + count);
      }
      const perimeter = [...neighbors.values()].reduce((sum, value) => sum + value, 0);
      let best = -1, bestCost = Infinity;
      for (const [next, contacts] of neighbors) {
        const target = regions[next];
        // Merge toward larger regions; deterministic color ordering resolves
        // ties without exchanging colors between equally sized specks.
        if (target.size < source.size || (target.size === source.size && target.color >= source.color)) continue;
        const share = contacts / perimeter;
        if (share < minimumContact) continue;
        let error = 0, allowed = true;
        for (const [color, count] of source.originalColors) {
          const delta = distance(color, target.color);
          if (delta > maxDelta) { allowed = false; break; }
          error += delta * count;
        }
        if (!allowed) continue;
        // A broad patch may touch a protected outline without being an outline
        // itself. It can merge only if all strong bordering contrasts survive.
        for (const other of neighbors.keys()) {
          if (other === next) continue;
          const contrastBefore = distance(source.color, regions[other].color);
          if (contrastBefore >= 25 && distance(target.color, regions[other].color) < contrastBefore * 0.7) {
            allowed = false; break;
          }
        }
        if (!allowed) continue;
        const cost = error / source.size + (1 - share) * 2;
        if (cost < bestCost || (cost === bestCost && target.color < (regions[best]?.color ?? '\uffff'))) {
          best = next; bestCost = cost;
        }
      }
      if (best < 0) continue;
      const target = regions[best];
      source.parent = best;
      target.size += source.size;
      for (const [color, count] of source.originalColors) target.originalColors.set(color, (target.originalColors.get(color) ?? 0) + count);
      for (const [other, count] of source.borders) target.borders.set(other, (target.borders.get(other) ?? 0) + count);
      changed = true;
    }
  } while (changed);
  return grid.map((row, y) => row.map((color, x) => color ? regions[root(labels[y][x])].color : color));
}
