import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { clearIsolatedBeans, consolidateStrayBeans, type RgbColor, type StrayBeanGridAdapter } from './strayBeanConsolidation';

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

  const caps = [
    { strength: 'light', cap: 1 },
    { strength: 'standard', cap: 5 },
    { strength: 'strong', cap: 10 },
  ] as const;
  it.each(caps)('$strength merges clusters of up to $cap beads', ({ strength, cap }) => {
    const grid = solid(50);
    patch(grid, cap);
    expect(countColour(consolidateStrayBeans(grid, adapter, strength), LIGHT_GREY)).toBe(0);
  });

  it.each(caps)('$strength keeps clusters of $cap plus one beads', ({ strength, cap }) => {
    const grid = solid(50);
    patch(grid, cap + 1);
    expect(countColour(consolidateStrayBeans(grid, adapter, strength), LIGHT_GREY)).toBe(cap + 1);
  });

  it('user-defined maxClusterSize overrides the preset caps in both directions', () => {
    // 自定义 ≤3：标准档（≤5）本会并掉总数 4 的色号，收紧后整体保留
    const tight = solid(30);
    patch(tight, 2);
    patch(tight, 2, LIGHT_GREY, 12, 12);
    expect(countColour(consolidateStrayBeans(tight, adapter, 'standard', { maxClusterSize: 3 }), LIGHT_GREY)).toBe(4);
    // 自定义 ≤4：轻度档（≤1）本会保留，放宽后总数 4 的色号整批并入
    const wide = solid(30);
    patch(wide, 3);
    patch(wide, 1, LIGHT_GREY, 12, 12);
    expect(countColour(consolidateStrayBeans(wide, adapter, 'light', { maxClusterSize: 4 }), LIGHT_GREY)).toBe(0);
  });

  it('blank, transparent and null padding do not change the absolute bead-count cap', () => {
    const filled = solid(20); // 标准档 ≤5 颗：6 颗的连通块保留，与画布外留白无关
    patch(filled, 6);
    const transparent = { id: 'transparent', color: WHITE, alpha: 0 };
    const grid = Array.from({ length: 100 }, (_, y) => Array.from({ length: 100 }, (_, x): Cell => (
      y < 20 && x < 20 ? filled[y][x] : (x % 2 ? null : transparent)
    )));
    const result = consolidateStrayBeans(grid, adapter);
    expect(countColour(result, LIGHT_GREY)).toBe(6);
    expect(result[50][50]).toBe(transparent);
    expect(result[50][51]).toBeNull();
  });

  it.each([
    { grid: [] }, { grid: [[]] }, { grid: [[null, null]] },
    { grid: [[{ id: 'transparent', color: WHITE, alpha: 0 }]] },
  ])('blank grids remain unchanged: $grid', ({ grid }) => {
    expect(consolidateStrayBeans(grid as Cell[][], adapter)).toEqual(grid);
  });

  it('manual eligibility is decided by total colour count, not per-component size', () => {
    // 64 颗同色号散点：单块都只有 1 颗，但色号总量 64 远超档位 → 一颗都不动
    const grid = solid(40);
    for (let y = 4; y < 36; y += 4) for (let x = 4; x < 36; x += 4) grid[y][x] = bean('noise', LIGHT_GREY);
    expect(countColour(grid, LIGHT_GREY)).toBe(64);
    expect(countColour(consolidateStrayBeans(grid, adapter), LIGHT_GREY)).toBe(64);
  });

  it('the same colour is never split: occurrences above the cap all survive', () => {
    // 用户场景：H2 同时出现在眼睛（小块）和帽子（大块），色号总量 11 > 5
    // → 眼睛处的 H2 绝不能被单独吞掉
    const grid = solid(30);
    patch(grid, 10, LIGHT_GREY, 4, 4);   // 帽子：10 颗的块
    patch(grid, 1, LIGHT_GREY, 20, 8);   // 眼睛：孤颗
    const result = consolidateStrayBeans(grid, adapter);
    expect(countColour(result, LIGHT_GREY)).toBe(11);
    expect(result[8][20]?.color).toEqual(LIGHT_GREY);
  });

  it('the same colour is never split: occurrences within the cap all merge', () => {
    // 色号总量 3 ≤ 5：两处小块（含一处 2 颗）整批并入相邻的相近稳定色
    const grid = solid(30);
    patch(grid, 2, LIGHT_GREY, 4, 4);
    patch(grid, 1, LIGHT_GREY, 20, 8);
    const result = consolidateStrayBeans(grid, adapter);
    expect(countColour(result, LIGHT_GREY)).toBe(0);
    expect(result[4][4]?.color).toEqual(WHITE);
    expect(result[8][20]?.color).toEqual(WHITE);
  });

  it('a rare colour merges toward the nearest stable neighbour per occurrence', () => {
    const grid = solid(20);
    patch(grid, 4);
    grid[15][15] = bean('island', LIGHT_GREY);
    const result = consolidateStrayBeans(grid, adapter);
    expect(countColour(result, LIGHT_GREY)).toBe(0);
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

  it('cartoon auto protects a high-contrast contour decoration, but merges ordinary noise', (ctx) => {
    const grid = cartoon();
    const result = consolidateStrayBeans(grid, adapter, 'standard', { mode: 'cartoon', intent: 'auto' });
    expect(result[14][12]).toBe(grid[14][12]);
    expect(result[25][25]?.color).toEqual(WHITE);
    expect(result[30][30]?.color).toEqual(WHITE);
  });

  it('cartoon manual: ordinary noise merges; the decoration colour survives by its total count, not by exemption', () => {
    const grid = cartoon();
    const result = consolidateStrayBeans(grid, adapter, 'standard', { mode: 'cartoon', intent: 'manual' });
    // manual 无豁免机制，但黑色总量 30 > 5 → 装饰与暗噪点都因超档保留
    expect(result[14][12]).toBe(grid[14][12]);
    expect(result[30][30]).toBe(grid[30][30]);
    expect(result[25][25]?.color).toEqual(WHITE); // 唯一 rare 的 LIGHT_GREY 照常并入
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

  describe('clearIsolatedBeans', () => {
    const clearAdapter = {
      isFilled: (cell: Cell): boolean => cell !== null,
      getColorKey: (cell: Cell): string => (cell ? `${cell.color.r},${cell.color.g},${cell.color.b}` : ''),
      clearCell: () => null,
    };

    function blankCanvas(size: number): Cell[][] {
      // 清除工具的语义是"离散残点"：残渣远离主体（不与任何大簇相邻）。
      // 测试画布用空白打底，主体 patch 在中央，残渣放四角。
      return Array.from({ length: size }, () => Array.from({ length: size }, (): Cell => null));
    }

    it('clears disconnected residue specks but keeps the main pattern', () => {
      // 6×6 主体 + 两个 1 格残渣 + 一个 2×2 残渣簇（标准档 ≤5 全清）
      const grid = blankCanvas(14);
      patch(grid, 36, WHITE, 4, 4); // 主体：36 格最大块，永不清
      grid[1][1] = bean('residue-a', LIGHT_GREY);
      grid[12][12] = bean('residue-b', MID_GREY);
      patch(grid, 4, DARK_GREY, 9, 11); // 2×2 残渣簇，与主体隔开空白
      const { grid: next, stats } = clearIsolatedBeans(grid, clearAdapter, 'standard');
      expect(stats).toEqual({ removed: 6, clusters: 3, threshold: 5 }); // 1 + 1 + 2×2 簇 = 6 颗
      expect(next[1][1]).toBeNull();
      expect(next[12][12]).toBeNull();
      expect(next[11][9]).toBeNull();
      expect(countColour(next, WHITE)).toBe(36); // 主体原样
      expect(grid[1][1]).not.toBeNull(); // 输入不被修改
    });

    it('protects small clusters touching a large region (embedded details, not residue)', () => {
      const grid = blankCanvas(14);
      patch(grid, 36, WHITE, 4, 4);
      grid[1][1] = bean('speck-a', LIGHT_GREY); // 远离主体的残点 → 清
      grid[3][10] = bean('detail', MID_GREY); // 贴着主体右缘 (4..9,4..9) 的细节点 → 保护
      const { grid: next, stats } = clearIsolatedBeans(grid, clearAdapter, 'standard');
      expect(stats).toEqual({ removed: 1, clusters: 1, threshold: 5 });
      expect(next[1][1]).toBeNull();
      expect(next[3][10]?.color).toEqual(MID_GREY);
    });

    it('respects strength caps and custom size in both directions', () => {
      const grid = blankCanvas(12);
      patch(grid, 30, WHITE, 3, 3);
      patch(grid, 2, LIGHT_GREY, 0, 0);
      // 轻度（≤1）：2 颗的簇保留
      expect(clearIsolatedBeans(grid, clearAdapter, 'light').stats).toBeNull();
      // 自定义 ≤2：清掉
      const { stats } = clearIsolatedBeans(grid, clearAdapter, 'light', { maxClusterSize: 2 });
      expect(stats).toEqual({ removed: 2, clusters: 1, threshold: 2 });
    });

    it('protects thin line details and never clears the largest component', () => {
      const grid = blankCanvas(14);
      patch(grid, 25, WHITE, 5, 5);
      for (let x = 2; x < 9; x += 1) grid[2][x] = bean('line', LIGHT_GREY); // 7 格细线（1×7，lineDetail）
      const { grid: next, stats } = clearIsolatedBeans(grid, clearAdapter, 'strong');
      expect(stats).toBeNull(); // 细线 + 最大块全保留 → 无可清
      expect(countColour(next, LIGHT_GREY)).toBe(7);
    });

    it('diagonal touching counts as connected for the residue cluster', () => {
      const grid = blankCanvas(10);
      patch(grid, 16, WHITE, 2, 2);
      grid[7][7] = bean('d1', LIGHT_GREY);
      grid[8][8] = bean('d2', LIGHT_GREY); // 对角相触 → 一个 2 颗簇
      const { stats } = clearIsolatedBeans(grid, clearAdapter, 'light', { maxClusterSize: 2 });
      expect(stats).toEqual({ removed: 2, clusters: 1, threshold: 2 });
    });
  });
});
