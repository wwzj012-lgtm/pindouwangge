import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { consolidateStrayBeans, type RgbColor, type StrayBeanGridAdapter } from './strayBeanConsolidation';

type Cell = { id: string; color: RgbColor; alpha?: number } | null;

const WHITE: RgbColor = { r: 240, g: 240, b: 240 };
const LIGHT_GREY: RgbColor = { r: 220, g: 220, b: 220 };
const MID_GREY: RgbColor = { r: 185, g: 185, b: 185 };
const DARK_GREY: RgbColor = { r: 150, g: 150, b: 150 };

const adapter: StrayBeanGridAdapter<Cell> = {
  isFilled: (cell): cell is Exclude<Cell, null> => cell !== null && cell.alpha !== 0,
  getColorKey: (cell) => {
    const { r, g, b } = (cell as Exclude<Cell, null>).color;
    return `${r},${g},${b}`;
  },
  getColor: (cell) => (cell as Exclude<Cell, null>).color,
  replaceColor: (noise, replacement) => ({
    id: (noise as Exclude<Cell, null>).id,
    color: { ...(replacement as Exclude<Cell, null>).color },
  }),
};

function bean(id: string, color: RgbColor): Cell {
  return { id, color: { ...color } };
}

function countColour(grid: Cell[][], color: RgbColor): number {
  return grid.flat().filter((cell) => cell !== null
    && cell.color.r === color.r
    && cell.color.g === color.g
    && cell.color.b === color.b).length;
}

describe('consolidateStrayBeans', () => {
  function solid(size: number): Cell[][] {
    return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => bean(`${y}:${x}`, WHITE)));
  }

  function patch(grid: Cell[][], count: number, color = LIGHT_GREY, x = 2, y = 2): void {
    const width = Math.ceil(Math.sqrt(count));
    for (let index = 0; index < count; index += 1) {
      grid[y + Math.floor(index / width)][x + index % width] = bean(`patch-${index}`, color);
    }
  }

  const percentages = [['light', 0.005], ['standard', 0.01], ['strong', 0.015]] as const;
  const matrix = percentages.flatMap(([strength, ratio]) => [10, 50, 100].map(size => ({
    strength, size, threshold: Math.max(2, Math.floor(size * size * ratio)),
  })));

  it.each(matrix)('percentage inclusive $strength at $size square ($threshold cells), no fixed cap', ({ strength, size, threshold }) => {
    const grid = solid(size);
    patch(grid, threshold);
    expect(countColour(consolidateStrayBeans(grid, adapter, strength), LIGHT_GREY)).toBe(0);
  });

  it.each(matrix)('percentage keeps threshold plus one: $strength at $size square', ({ strength, size, threshold }) => {
    const grid = solid(size);
    patch(grid, threshold + 1);
    expect(countColour(consolidateStrayBeans(grid, adapter, strength), LIGHT_GREY)).toBe(threshold + 1);
  });

  it('percentage floors a fractional count rather than rounding up', () => {
    const grid = solid(19); // 361 * 1% = 3.61
    patch(grid, 4);
    expect(countColour(consolidateStrayBeans(grid, adapter), LIGHT_GREY)).toBe(4);
  });

  it('blank, transparent and null padding do not increase the percentage denominator', () => {
    const filled = solid(20); // 400 valid beads -> threshold 4, not 100
    patch(filled, 5);
    const transparent = { id: 'transparent', color: WHITE, alpha: 0 };
    const grid = Array.from({ length: 100 }, (_, y) => Array.from({ length: 100 }, (_, x): Cell => (
      y < 20 && x < 20 ? filled[y][x] : (x % 2 ? null : transparent)
    )));
    const result = consolidateStrayBeans(grid, adapter);
    expect(countColour(result, LIGHT_GREY)).toBe(5);
    expect(result[50][50]).toBe(transparent);
    expect(result[50][51]).toBeNull();
  });

  it.each([
    { grid: [] }, { grid: [[]] }, { grid: [[null, null]] },
    { grid: [[{ id: 'transparent', color: WHITE, alpha: 0 }]] },
  ])('blank grids remain unchanged: $grid', ({ grid }) => {
    expect(consolidateStrayBeans(grid as Cell[][], adapter)).toEqual(grid);
  });

  it('components, not total palette frequency, determine eligibility', () => {
    const grid = solid(40);
    for (let y = 4; y < 36; y += 4) for (let x = 4; x < 36; x += 4) grid[y][x] = bean('noise', LIGHT_GREY);
    expect(countColour(grid, LIGHT_GREY)).toBe(64); // total colour count > 16
    expect(countColour(consolidateStrayBeans(grid, adapter), LIGHT_GREY)).toBe(0);
  });

  it('components preserve the large region but merge a separate island of the same rare colour', () => {
    const grid = solid(20);
    patch(grid, 25);
    grid[15][15] = bean('island', LIGHT_GREY);
    const result = consolidateStrayBeans(grid, adapter);
    expect(countColour(result, LIGHT_GREY)).toBe(25);
    expect(result[15][15]?.color).toEqual(WHITE);
  });

  it('components do not recolour a distant island with no actual filled neighbour', () => {
    const grid = solid(10);
    grid[5][5] = bean('near', LIGHT_GREY);
    grid.push([], [bean('distant', LIGHT_GREY)]);
    const result = consolidateStrayBeans(grid, adapter);
    expect(result[5][5]?.color).toEqual(WHITE);
    expect(result[11][0]?.color).toEqual(LIGHT_GREY);
  });

  it('components preserve thin lines and eight-connected diagonal detail below the threshold', () => {
    const grid = solid(40);
    for (let x = 8; x < 16; x += 1) grid[8][x] = bean('line', LIGHT_GREY);
    for (let offset = 0; offset < 6; offset += 1) grid[20 + offset][20 + offset] = bean('diagonal', LIGHT_GREY);
    expect(countColour(consolidateStrayBeans(grid, adapter), LIGHT_GREY)).toBe(14);
  });

  it('chooses the closest stable actual neighbouring component deterministically', () => {
    const grid = solid(10);
    for (let y = 0; y < 10; y += 1) for (let x = 0; x < 5; x += 1) grid[y][x] = bean('near', MID_GREY);
    for (let y = 0; y < 10; y += 1) for (let x = 6; x < 10; x += 1) grid[y][x] = bean('far', DARK_GREY);
    grid[5][5] = bean('source', LIGHT_GREY);
    expect(consolidateStrayBeans(grid, adapter)[5][5]?.color).toEqual(WHITE);
    // WHITE is even closer than MID_GREY; remove it from the local boundary.
    grid[4][5] = grid[6][5] = bean('near', MID_GREY);
    expect(consolidateStrayBeans(grid, adapter)[5][5]?.color).toEqual(MID_GREY);
  });

  it('safely keeps components without a stable replacement', () => {
    const grid = [[bean('a', LIGHT_GREY), bean('b', WHITE)]];
    expect(consolidateStrayBeans(grid, adapter)).toEqual(grid);
  });

  it('source guard veto preserves a whole component instead of partially eroding it', () => {
    const grid = solid(20);
    patch(grid, 4);
    const result = consolidateStrayBeans(grid, {
      ...adapter, canReplace: (_noise, _replacement, row, column) => row !== 3 || column !== 3,
    });
    expect(countColour(result, LIGHT_GREY)).toBe(4);
  });

  function cartoon(): Cell[][] {
    const grid = solid(40);
    const black = { r: 20, g: 20, b: 20 };
    for (let y = 6; y < 34; y += 1) grid[y][10] = bean('outline', black);
    grid[14][12] = bean('decoration', black);
    grid[25][25] = bean('noise', LIGHT_GREY);
    grid[30][30] = bean('unrelated-dark-noise', black);
    return grid;
  }

  it.each(['auto', 'manual'] as const)('cartoon %s protects a high-contrast contour decoration, but merges ordinary noise', (intent) => {
    const grid = cartoon();
    const result = consolidateStrayBeans(grid, adapter, 'standard', { mode: 'cartoon', intent });
    expect(result[14][12]).toBe(grid[14][12]);
    expect(result[25][25]?.color).toEqual(WHITE);
    expect(result[30][30]?.color).toEqual(WHITE);
  });

  it('cartoon does not exempt a low-contrast compact noise point merely because it is near a contour', () => {
    const grid = cartoon();
    grid[14][12] = bean('near-outline-noise', LIGHT_GREY);
    expect(consolidateStrayBeans(grid, adapter, 'standard', { mode: 'cartoon', intent: 'auto' })[14][12]?.color).toEqual(WHITE);
  });

  it('cartoon protects a contrasting compact decoration on a transparent silhouette boundary', () => {
    const grid = solid(20);
    for (let y = 0; y < 20; y += 1) grid[y][0] = null;
    grid[10][1] = bean('boundary-dot', DARK_GREY);
    expect(consolidateStrayBeans(grid, adapter, 'standard', { mode: 'cartoon', intent: 'auto' })[10][1]).toBe(grid[10][1]);
  });

  it('logo automatic intent changes zero cells; explicit manual intent still merges', () => {
    const grid = solid(20);
    patch(grid, 3);
    expect(consolidateStrayBeans(grid, adapter, 'strong', { mode: 'logo', intent: 'auto' })).toEqual(grid);
    expect(countColour(consolidateStrayBeans(grid, adapter, 'standard', { mode: 'logo', intent: 'manual' }), LIGHT_GREY)).toBe(0);
  });

  it('default mode and omitted strength are compatible with explicit photo/manual standard', () => {
    const grid = solid(20);
    patch(grid, 3);
    expect(consolidateStrayBeans(grid, adapter)).toEqual(consolidateStrayBeans(grid, adapter, 'standard', { mode: 'photo', intent: 'manual' }));
  });

  it('is deterministic and does not mutate input rows, blank cells or existing objects', () => {
    const grid = solid(20);
    patch(grid, 3);
    grid[19][19] = null;
    const original = grid[2][2];
    const snapshot = JSON.stringify(grid);
    for (const row of grid) {
      for (const cell of row) if (cell) { Object.freeze(cell.color); Object.freeze(cell); }
      Object.freeze(row);
    }
    Object.freeze(grid);
    const first = consolidateStrayBeans(grid, adapter);
    expect(first).toEqual(consolidateStrayBeans(grid, adapter));
    expect(grid[2][2]).toBe(original);
    expect(JSON.stringify(grid)).toBe(snapshot);
    expect(first[2][2]?.id).toBe(original?.id);
    expect(first[19][19]).toBeNull();
    expect(first[0]).not.toBe(grid[0]);
  });

  it('App manual entry passes actual mode and intent, not helper-only policy', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const handler = app.slice(app.indexOf('const handleConsolidateStrayBeads'), app.indexOf('const beginHistoryTransaction'));
    expect(handler).toMatch(/intent:\s*'manual'/);
    expect(handler).toMatch(/mode:/);
    expect(handler).toContain('conversionDiagnostics');
    expect(handler).toContain('settings.pipelineOverride');
  });

  it.each([128, 256, 900])('performance %s square with thousands of rare keys is linear, bounded and immutable', (size) => {
    const background = Object.freeze({ id: 'background', color: Object.freeze({ ...WHITE }) });
    const grid: Cell[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => background));
    let noise = 0;
    for (let y = 4; y < size - 1; y += 8) for (let x = 4; x < size - 1; x += 8) {
      grid[y][x] = Object.freeze({ id: `noise-${noise++}`, color: Object.freeze({ ...LIGHT_GREY }) });
    }
    for (const row of grid) Object.freeze(row);
    Object.freeze(grid);
    let reads = 0;
    const measuredAdapter: StrayBeanGridAdapter<Cell> = {
      ...adapter,
      isFilled: cell => { reads += 1; return adapter.isFilled(cell); },
      getColorKey: cell => (cell as NonNullable<Cell>).id,
    };
    const start = performance.now();
    const result = consolidateStrayBeans(grid, measuredAdapter);
    const elapsed = performance.now() - start;
    console.info(`STRAY_PERF size=${size} cells=${size * size} noise=${noise} ms=${elapsed.toFixed(2)} filledReads=${reads}`);
    expect(countColour(result, LIGHT_GREY)).toBe(0);
    expect(grid[4][4]?.id).toBe('noise-0');
    expect(reads).toBeLessThanOrEqual(size * size * 3);
    expect(elapsed).toBeLessThan(15000);
  }, 20000);
});
