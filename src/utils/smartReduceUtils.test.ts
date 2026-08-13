import { describe, expect, it } from 'vitest';
import type { BeadColor } from '../types';
import {
  getReducedGridDimensions,
  savingPercentToScale,
  smartReduceGrid,
  type ReductionOptions,
} from './smartReduceUtils';

const palette: BeadColor[] = [
  { id: 'dark', code: 'D', name: 'Dark', hex: '#111111', rgb: [17, 17, 17], brand: 'MARD' },
  { id: 'light', code: 'L', name: 'Light', hex: '#F0F0F0', rgb: [240, 240, 240], brand: 'MARD' },
  { id: 'red', code: 'R', name: 'Red', hex: '#EF4444', rgb: [239, 68, 68], brand: 'MARD' },
];

function options(saving: 0 | 15 | 25 | 40): ReductionOptions {
  return {
    intensity: 'light',
    protectSaliencyAndContours: true,
    protectVibrantColors: true,
    removeBackgroundBeads: false,
    removeIsolatedNoise: false,
    mergeMinorColors: false,
    downscaleRatio: savingPercentToScale(saving),
    autoCropEmptyBorder: false,
  };
}

function modalDefaults(saving: 0 | 15 | 25 | 40): ReductionOptions {
  return {
    ...options(saving),
    intensity: 'medium',
    removeIsolatedNoise: true,
    mergeMinorColors: true,
  };
}

describe('membership bead-saving targets', () => {
  it.each([15, 25, 40] as const)('maps %s%% savings to the matching grid area', (saving) => {
    const grid = Array.from({ length: 100 }, () => Array(100).fill('dark'));
    const report = smartReduceGrid(grid, palette, options(saving));
    expect(report.savedPercent).toBeGreaterThanOrEqual(saving - 1);
    expect(report.savedPercent).toBeLessThanOrEqual(saving + 1);
  });

  it('keeps a repeated subject color dominant over one isolated high-contrast pixel', () => {
    const grid = Array.from({ length: 20 }, () => Array(20).fill('light'));
    grid[5][5] = 'dark';
    grid[10][10] = 'red';
    const report = smartReduceGrid(grid, palette, options(40));
    const counts = report.optimizedGrid.flat().reduce<Record<string, number>>((all, color) => {
      if (color) all[color] = (all[color] ?? 0) + 1;
      return all;
    }, {});
    expect(counts.light).toBeGreaterThan((counts.dark ?? 0) + (counts.red ?? 0));
  });

  it('does not let one protected edge pixel replace a two-pixel regional majority', () => {
    const grid = Array.from({ length: 20 }, () => Array(20).fill('light'));
    grid[0][0] = 'dark';
    const report = smartReduceGrid(grid, palette, {
      ...options(0),
      downscaleRatio: 0.5,
    });
    expect(report.optimizedGrid[0][0]).toBe('light');
  });

  it.each([0, 15, 25, 40] as const)('uses stable sqrt-area dimensions for %s%% saving', (saving) => {
    const grid = Array.from({ length: 30 }, () => Array(50).fill('light'));
    const report = smartReduceGrid(grid, palette, options(saving));
    const expected = getReducedGridDimensions(50, 30, savingPercentToScale(saving));

    expect(report.optimizedGrid).toHaveLength(expected.height);
    expect(report.optimizedGrid[0]).toHaveLength(expected.width);
    expect(report.gridAreaSavedPercent).toBeCloseTo(
      (1 - (expected.width * expected.height) / (50 * 30)) * 100,
      1,
    );
  });

  it('keeps 0% grids byte-for-byte unchanged when no explicit cleanup is enabled', () => {
    const grid = [
      ['dark', 'light', null, 'red'],
      ['light', 'red', 'dark', null],
    ];
    const report = smartReduceGrid(grid, palette, options(0));

    expect(report.optimizedGrid).toEqual(grid);
    expect(report.savedPercent).toBe(0);
    expect(report.gridAreaSavedPercent).toBe(0);
  });

  it('keeps 0% grids byte-for-byte unchanged with the modal default options', () => {
    const grid = [
      ['dark', 'light', null, 'red'],
      ['light', 'red', 'dark', null],
    ];
    expect(smartReduceGrid(grid, palette, modalDefaults(0)).optimizedGrid).toEqual(grid);
  });

  it('produces a dense smaller pattern from a dense source without transparent holes', () => {
    const grid = Array.from({ length: 40 }, (_, y) =>
      Array.from({ length: 40 }, (_, x) => (x === 20 || y === 20 ? 'dark' : 'light')),
    );
    const report = smartReduceGrid(grid, palette, { ...options(40), removeIsolatedNoise: true });

    expect(report.optimizedGrid.flat().every(Boolean)).toBe(true);
    expect(report.optimizedGrid.flat().filter((color) => color === 'dark')).not.toHaveLength(0);
    expect(report.savedPercent).toBeCloseTo(report.gridAreaSavedPercent, 1);
  });

  it('preserves an alpha-aware solid subject without new interior holes', () => {
    const grid = Array.from({ length: 30 }, (_, y) =>
      Array.from({ length: 30 }, (_, x) => (x >= 5 && x <= 24 && y >= 5 && y <= 24 ? 'red' : null)),
    );
    const report = smartReduceGrid(grid, palette, options(40));

    for (const row of report.optimizedGrid) {
      const first = row.findIndex(Boolean);
      const last = row.length - 1 - [...row].reverse().findIndex(Boolean);
      if (first >= 0) expect(row.slice(first, last + 1).every(Boolean)).toBe(true);
    }
  });

  it('does not duplicate one sparse source bead across downsampled regions', () => {
    const grid = Array.from({ length: 3 }, () => Array<string | null>(3).fill(null));
    grid[1][1] = 'red';
    const report = smartReduceGrid(grid, palette, { ...options(0), downscaleRatio: 2 / 3 });

    expect(report.optimizedTotalBeads).toBeLessThanOrEqual(1);
    expect(report.savedPercent).toBeGreaterThanOrEqual(-100);
    expect(Number.isFinite(report.savedPercent)).toBe(true);
  });

  it('does not inflate a thin transparent-background line during downsampling', () => {
    const grid = Array.from({ length: 9 }, () => Array<string | null>(9).fill(null));
    for (let x = 0; x < 9; x++) grid[4][x] = 'dark';
    const report = smartReduceGrid(grid, palette, { ...options(0), downscaleRatio: 2 / 3 });

    expect(report.optimizedTotalBeads).toBeGreaterThan(0);
    expect(report.optimizedTotalBeads).toBeLessThanOrEqual(4);
    expect(report.totalBeadChangeCount).toBeGreaterThanOrEqual(0);
  });

  it('uses proportional dimensions for a 79x44 grid at 25% saving', () => {
    expect(getReducedGridDimensions(79, 44, savingPercentToScale(25))).toEqual({ width: 68, height: 38 });
  });

  it.each([
    [79, 44, 15],
    [79, 44, 25],
    [79, 44, 40],
    [120, 47, 15],
    [120, 47, 25],
    [120, 47, 40],
  ] as const)('rounds both axes from the same scale for %sx%s at %s%%', (width, height, saving) => {
    const scale = savingPercentToScale(saving);
    const dimensions = getReducedGridDimensions(width, height, scale);

    expect(dimensions).toEqual({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    });
    expect(Math.abs(dimensions.width / dimensions.height - width / height)).toBeLessThanOrEqual(
      1 / dimensions.height + 1 / height,
    );
  });

  it.each([
    [1, 9, 40],
    [2, 2, 15],
    [2, 2, 25],
    [3, 3, 40],
  ] as const)('keeps tiny %sx%s grids within legal proportional bounds at %s%%', (width, height, saving) => {
    const dimensions = getReducedGridDimensions(width, height, savingPercentToScale(saving));
    expect(dimensions.width).toBeGreaterThanOrEqual(1);
    expect(dimensions.height).toBeGreaterThanOrEqual(1);
    expect(dimensions.width).toBeLessThanOrEqual(width);
    expect(dimensions.height).toBeLessThanOrEqual(height);
  });

  it('keeps dimensions unchanged at 0% saving', () => {
    expect(getReducedGridDimensions(79, 44, savingPercentToScale(0))).toEqual({ width: 79, height: 44 });
  });

  it('keeps the main solid component connected after alpha-aware downsampling', () => {
    const grid = Array.from({ length: 30 }, (_, y) =>
      Array.from({ length: 30 }, (_, x) => (x >= 5 && x <= 24 && y >= 5 && y <= 24 ? 'red' : null)),
    );
    const report = smartReduceGrid(grid, palette, options(40));
    const occupied = report.optimizedGrid.flat().filter(Boolean).length;
    const start = report.optimizedGrid.findIndex((row) => row.some(Boolean));
    const queue = start < 0 ? [] : report.optimizedGrid[start]
      .map((cell, x) => cell ? [x, start] as [number, number] : null)
      .filter((point): point is [number, number] => point !== null)
      .slice(0, 1);
    const visited = new Set<string>();
    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      const key = `${x},${y}`;
      if (visited.has(key) || !report.optimizedGrid[y]?.[x]) continue;
      visited.add(key);
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    expect(visited.size).toBe(occupied);
  });

  it('reports recoloring separately from actual bead savings', () => {
    const grid = [
      ['light', 'light', 'light'],
      ['light', 'red', 'light'],
      ['light', 'light', 'light'],
    ];
    const report = smartReduceGrid(grid, palette, { ...options(15), removeIsolatedNoise: true });

    expect(report.noiseBeadsSaved).toBe(0);
    expect(report.patchMergedBeadsSaved).toBe(0);
    expect(report.resamplingBeadsSaved).toBe(Math.max(0, report.resamplingBeadChangeCount));
  });

  it('is deterministic and retains a high-contrast facial-style feature', () => {
    const grid = Array.from({ length: 36 }, () => Array(36).fill('light'));
    for (let y = 12; y < 16; y++) {
      for (let x = 9; x < 13; x++) grid[y][x] = 'dark';
      for (let x = 23; x < 27; x++) grid[y][x] = 'dark';
    }

    const first = smartReduceGrid(grid, palette, options(40));
    const second = smartReduceGrid(grid, palette, options(40));
    expect(first.optimizedGrid).toEqual(second.optimizedGrid);
    expect(first.optimizedGrid.flat()).toContain('dark');
  });
});
