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
  { id: 'near', code: 'N', name: 'Near light', hex: '#E6E6E6', rgb: [230, 230, 230], brand: 'MARD' },
  { id: 'shadowA', code: 'A', name: 'Shadow A', hex: '#141414', rgb: [20, 20, 20], brand: 'MARD' },
  { id: 'shadowB', code: 'B', name: 'Shadow B', hex: '#1C1C1C', rgb: [28, 28, 28], brand: 'MARD' },
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

function structuralOptions(saving: 15 | 25 | 40): ReductionOptions {
  return {
    ...options(saving),
    intensity: 'medium',
    removeIsolatedNoise: false,
    mergeMinorColors: false,
  };
}

function expectSingleFourConnected(grid: (string | null)[][]) {
  const occupied: [number, number][] = [];
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x]) occupied.push([x, y]);
    }
  }
  expect(occupied.length).toBeGreaterThan(0);

  const visited = new Set<string>();
  const queue = [occupied[0]];
  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    const key = `${x},${y}`;
    if (visited.has(key) || !grid[y]?.[x]) continue;
    visited.add(key);
    queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
  }
  expect(visited.size).toBe(occupied.length);
}

function countInteriorHoles(grid: (string | null)[][]): number {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const exterior = Array.from({ length: height }, () => Array(width).fill(false));
  const queue: [number, number][] = [];
  for (let x = 0; x < width; x++) {
    queue.push([x, 0]);
    if (height > 1) queue.push([x, height - 1]);
  }
  for (let y = 1; y < height - 1; y++) {
    queue.push([0, y]);
    if (width > 1) queue.push([width - 1, y]);
  }

  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    if (x < 0 || x >= width || y < 0 || y >= height || exterior[y][x] || grid[y][x]) continue;
    exterior[y][x] = true;
    queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
  }

  let holes = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] || exterior[y][x]) continue;
      holes++;
      const holeQueue: [number, number][] = [[x, y]];
      exterior[y][x] = true;
      while (holeQueue.length > 0) {
        const [holeX, holeY] = holeQueue.pop()!;
        for (const [nextX, nextY] of [[holeX - 1, holeY], [holeX + 1, holeY], [holeX, holeY - 1], [holeX, holeY + 1]]) {
          if (
            nextX >= 0
            && nextX < width
            && nextY >= 0
            && nextY < height
            && !grid[nextY][nextX]
            && !exterior[nextY][nextX]
          ) {
            exterior[nextY][nextX] = true;
            holeQueue.push([nextX, nextY]);
          }
        }
      }
    }
  }
  return holes;
}

function createRingGrid(): (string | null)[][] {
  return Array.from({ length: 24 }, (_, y) => Array.from({ length: 24 }, (_, x) => (
    x >= 2 && x <= 21 && y >= 2 && y <= 21 && (x < 7 || x > 16 || y < 7 || y > 16)
      ? 'dark'
      : null
  )));
}

function createBridgeGrid(bridgeWidth: 1 | 2): (string | null)[][] {
  const grid = Array.from({ length: 30 }, () => Array<string | null>(30).fill(null));
  for (let y = 9; y <= 20; y++) {
    for (let x = 3; x <= 11; x++) grid[y][x] = 'light';
    for (let x = 18; x <= 26; x++) grid[y][x] = 'light';
  }
  for (let y = 14; y < 14 + bridgeWidth; y++) {
    for (let x = 12; x <= 17; x++) grid[y][x] = 'dark';
  }
  return grid;
}

function createLetterHGrid(): (string | null)[][] {
  const grid = Array.from({ length: 30 }, () => Array<string | null>(30).fill(null));
  for (let y = 4; y <= 25; y++) {
    for (let x = 5; x <= 6; x++) grid[y][x] = 'dark';
    for (let x = 22; x <= 23; x++) grid[y][x] = 'dark';
  }
  for (let y = 13; y <= 14; y++) {
    for (let x = 7; x <= 21; x++) grid[y][x] = 'dark';
  }
  return grid;
}

function createSolidFigureGrid(): (string | null)[][] {
  const grid = Array.from({ length: 36 }, () => Array<string | null>(32).fill(null));
  // Rounded head
  for (let y = 3; y <= 15; y++) {
    for (let x = 9; x <= 22; x++) {
      const dx = x - 15.5;
      const dy = y - 9;
      if ((dx * dx) / 50 + (dy * dy) / 43 <= 1) grid[y][x] = 'dark';
    }
  }
  // Torso, arms, and joined legs create one irregular but solid silhouette.
  for (let y = 14; y <= 27; y++) {
    for (let x = 11; x <= 20; x++) grid[y][x] = 'dark';
  }
  for (let y = 17; y <= 20; y++) {
    for (let x = 4; x <= 27; x++) grid[y][x] = 'dark';
  }
  for (let y = 28; y <= 34; y++) {
    for (let x = 9; x <= 13; x++) grid[y][x] = 'dark';
    for (let x = 18; x <= 22; x++) grid[y][x] = 'dark';
  }
  return grid;
}

describe('membership bead-saving targets', () => {
  it.each([15, 25, 40] as const)('maps %s%% savings to the matching grid area', (saving) => {
    const grid = Array.from({ length: 100 }, () => Array(100).fill('dark'));
    const report = smartReduceGrid(grid, palette, options(saving));
    expect(report.savedPercent).toBeGreaterThanOrEqual(saving - 1);
    expect(report.savedPercent).toBeLessThanOrEqual(saving + 1);
  });

  it('uses distinct target budgets for all three tiers after background removal', () => {
    // Synthetic foreground on removable border background; isolate the tier
    // budget from optional denoise/color-merging passes.
    const grid = Array.from({ length: 100 }, () => Array<string | null>(100).fill('light'));
    for (let y = 20; y < 80; y += 1) {
      for (let x = 20; x < 80; x += 1) grid[y][x] = 'red';
    }
    const reports = ([15, 25, 40] as const).map(saving => smartReduceGrid(grid, palette, {
      ...structuralOptions(saving),
      removeBackgroundBeads: true,
    }));

    expect(reports[0].bgBeadsSaved).toBeGreaterThan(0);
    expect(reports[0].optimizedGrid).toHaveLength(92);
    expect(reports[1].optimizedGrid).toHaveLength(87);
    expect(reports[2].optimizedGrid).toHaveLength(77);
    expect(reports[0].optimizedGrid.length * reports[0].optimizedGrid[0].length)
      .toBeGreaterThan(reports[1].optimizedGrid.length * reports[1].optimizedGrid[0].length);
    expect(reports[1].optimizedGrid.length * reports[1].optimizedGrid[0].length)
      .toBeGreaterThan(reports[2].optimizedGrid.length * reports[2].optimizedGrid[0].length);
    for (const report of reports) {
      const baseline = report.originalTotalBeads - report.bgBeadsSaved;
      const actualPercent = baseline > 0
        ? Math.round(((baseline - report.optimizedTotalBeads) / baseline) * 1000) / 10
        : 0;
      expect(report.savedPercent).toBe(actualPercent);
    }
  });

  it('does not invent opaque bridges across border background during sparse downsampling', () => {
    const grid = Array.from({ length: 60 }, () => Array<string | null>(60).fill('light'));
    for (let y = 2; y < 58; y += 4) for (let x = 2; x < 58; x += 4) grid[y][x] = 'red';
    const report = smartReduceGrid(grid, palette, {
      ...structuralOptions(15),
      removeBackgroundBeads: true,
    });
    expect(report.bgBeadsSaved).toBeGreaterThan(0);
    expect(report.optimizedTotalBeads).toBeLessThanOrEqual(report.originalTotalBeads - report.bgBeadsSaved);
  });

  it('only removes the border background when its option is enabled', () => {
    const grid = Array.from({ length: 15 }, () => Array<string | null>(15).fill('light'));
    for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) grid[y][x] = 'red';
    const baseOptions: ReductionOptions = {
      ...options(0), downscaleRatio: 0.99, protectSaliencyAndContours: false,
      protectVibrantColors: false, removeIsolatedNoise: false, mergeMinorColors: false,
    };
    const untouched = smartReduceGrid(grid, palette, { ...baseOptions, removeBackgroundBeads: false });
    const removed = smartReduceGrid(grid, palette, { ...baseOptions, removeBackgroundBeads: true });
    expect(untouched.bgBeadsSaved).toBe(0);
    expect(removed.bgBeadsSaved).toBeGreaterThan(0);
    expect(removed.optimizedGrid[0][0]).toBeNull();
    expect(untouched.optimizedGrid[0][0]).toBe('light');
  });

  it('does not change background tolerance when a color-simplification level changes', () => {
    const grid = Array.from({ length: 20 }, () => Array<string | null>(20).fill('light'));
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) grid[y][x] = 'red';
    const reports = (['light', 'medium', 'strong'] as const).map(intensity => smartReduceGrid(grid, palette, {
      ...options(0), intensity, downscaleRatio: 0.99,
      protectSaliencyAndContours: false, removeBackgroundBeads: true, backgroundTolerance: 5,
    }));
    expect(reports.map(r => r.bgBeadsSaved)).toEqual([300, 300, 300]);
  });

  it('does not move a contour or erase a saturated accent when the protection switches are enabled', () => {
    const grid = Array.from({ length: 12 }, () => Array<string | null>(12).fill('near'));
    grid[6][6] = 'red';
    const common = { ...modalDefaults(15), downscaleRatio: 0.99, protectSaliencyAndContours: false };
    const protectedResult = smartReduceGrid(grid, palette, { ...common, protectVibrantColors: true });
    const unprotectedResult = smartReduceGrid(grid, palette, { ...common, protectVibrantColors: false });
    expect(protectedResult.optimizedGrid[6][6]).toBe('red');
    expect(unprotectedResult.optimizedGrid[6][6]).toBe('near');
  });

  it('only recolours isolated noise when its option is enabled', () => {
    const grid = Array.from({ length: 9 }, () => Array<string | null>(9).fill('dark'));
    grid[4][4] = 'red';
    const baseOptions: ReductionOptions = {
      ...options(0), intensity: 'strong', downscaleRatio: 0.99,
      protectSaliencyAndContours: false, protectVibrantColors: false,
      removeBackgroundBeads: false, mergeMinorColors: false,
    };
    const retained = smartReduceGrid(grid, palette, { ...baseOptions, removeIsolatedNoise: false });
    const cleaned = smartReduceGrid(grid, palette, { ...baseOptions, removeIsolatedNoise: true });
    expect(retained.optimizedGrid[4][4]).toBe('red');
    expect(cleaned.optimizedGrid[4][4]).toBe('dark');
    expect(cleaned.recoloredNoiseCount).toBeGreaterThan(0);
  });

  it('only merges low-frequency colors when its option is enabled', () => {
    const grid = Array.from({ length: 9 }, () => Array<string | null>(9).fill('shadowA'));
    grid[3][3] = grid[3][4] = grid[4][3] = grid[4][4] = 'shadowA';
    grid[3][5] = grid[4][5] = 'shadowB';
    const baseOptions: ReductionOptions = {
      ...options(0), intensity: 'light', downscaleRatio: 0.99,
      protectSaliencyAndContours: false, protectVibrantColors: false,
      removeBackgroundBeads: false, removeIsolatedNoise: false,
    };
    const retained = smartReduceGrid(grid, palette, { ...baseOptions, mergeMinorColors: false });
    const merged = smartReduceGrid(grid, palette, { ...baseOptions, mergeMinorColors: true });
    expect(retained.optimizedGrid[3][5]).toBe('shadowB');
    expect(retained.optimizedGrid[4][5]).toBe('shadowB');
    expect(merged.optimizedGrid[3][5]).toBe('shadowA');
    expect(merged.optimizedGrid[4][5]).toBe('shadowA');
  });

  it('gives light, medium and strong different smoothing results on the same source', () => {
    const shades: BeadColor[] = [100, 120, 140].map(value => ({
      id: `grey-${value}`, code: `${value}`, name: 'grey',
      hex: `#${value.toString(16).repeat(3)}`, rgb: [value, value, value], brand: 'MARD',
    }));
    const grid = Array.from({ length: 16 }, () => Array<string | null>(16).fill('grey-100'));
    grid[4][4] = 'grey-120';
    grid[11][11] = 'grey-140';
    const results = (['light', 'medium', 'strong'] as const).map(intensity => smartReduceGrid(grid, shades, {
      ...options(0), downscaleRatio: 0.99, intensity,
      protectSaliencyAndContours: false, protectVibrantColors: false,
      mergeMinorColors: true,
    }));
    expect(results.map(report => report.optimizedGrid.flat().filter(cell => cell !== 'grey-100').length))
      .toEqual([2, 1, 0]);
    expect(results.map(report => report.recoloredSourceBeads)).toEqual([0, 1, 2]);
    expect(grid[4][4]).toBe('grey-120');
    expect(grid[11][11]).toBe('grey-140');
  });

  it('merges repeated small color islands even when the global color count is above the threshold', () => {
    const grid = Array.from({ length: 16 }, () => Array<string | null>(16).fill('shadowA'));
    for (const offset of [2, 9]) {
      grid[offset][offset] = grid[offset][offset + 1] = 'shadowA';
      grid[offset + 1][offset] = grid[offset + 1][offset + 1] = 'shadowA';
      grid[offset][offset + 2] = grid[offset + 1][offset + 2] = 'shadowB';
    }
    const report = smartReduceGrid(grid, palette, {
      ...options(0), downscaleRatio: 0.99, intensity: 'light',
      protectSaliencyAndContours: false, protectVibrantColors: false,
      mergeMinorColors: true,
    });
    expect(report.optimizedGrid.flat()).not.toContain('shadowB');
    expect(grid.flat().filter(cell => cell === 'shadowB')).toHaveLength(4);
  });

  it('keeps intensity differences with detail protection enabled on a shaded block', () => {
    const shades: BeadColor[] = [100, 120, 130].map(value => ({
      id: `grey-${value}`, code: `${value}`, name: 'grey',
      hex: `#${value.toString(16).repeat(3)}`, rgb: [value, value, value], brand: 'MARD',
    }));
    const grid = Array.from({ length: 24 }, () => Array<string | null>(24).fill('grey-100'));
    for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) grid[y][x] = 'grey-120';
    for (let y = 14; y < 20; y++) for (let x = 14; x < 20; x++) grid[y][x] = 'grey-130';
    const reports = (['light', 'medium', 'strong'] as const).map(intensity => smartReduceGrid(grid, shades, {
      ...modalDefaults(15), downscaleRatio: 0.99, intensity,
    }));
    expect(reports[0].optimizedGrid).not.toEqual(reports[1].optimizedGrid);
    expect(reports[1].optimizedGrid).not.toEqual(reports[2].optimizedGrid);
    expect(reports[0].recoloredSourceBeads).toBeLessThan(reports[1].recoloredSourceBeads);
    expect(reports[1].recoloredSourceBeads).toBeLessThan(reports[2].recoloredSourceBeads);
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

  it('does not flood-delete a near-background subject highlight attached to a protected border contour', () => {
    const grid = Array.from({ length: 9 }, () => Array(9).fill('light'));
    for (let y = 3; y <= 5; y++) {
      grid[y][0] = 'near';
      grid[y][1] = 'dark';
    }

    const report = smartReduceGrid(grid, palette, {
      ...modalDefaults(15),
      downscaleRatio: 0.99,
      removeBackgroundBeads: true,
    });

    expect(report.optimizedGrid[3][0]).toBe('near');
    expect(report.optimizedGrid[4][0]).toBe('near');
    expect(report.optimizedGrid[5][0]).toBe('near');
  });

  it('does not merge a protected low-frequency feature colour into a global dominant colour', () => {
    const grid = Array.from({ length: 9 }, () => Array(9).fill('light'));
    grid[4][4] = 'red';

    const report = smartReduceGrid(grid, palette, {
      ...modalDefaults(15),
      downscaleRatio: 0.99,
      removeIsolatedNoise: false,
      mergeMinorColors: true,
    });

    expect(report.optimizedGrid[4][4]).toBe('red');
  });

  it('keeps a thin bridge and its endpoints during destructive cleanup passes', () => {
    const grid = Array.from({ length: 9 }, () => Array<string | null>(9).fill(null));
    for (let y = 3; y <= 5; y++) {
      for (let x = 1; x <= 2; x++) grid[y][x] = 'light';
      for (let x = 6; x <= 7; x++) grid[y][x] = 'light';
    }
    for (let x = 3; x <= 5; x++) grid[4][x] = 'dark';

    const report = smartReduceGrid(grid, palette, {
      ...modalDefaults(15),
      intensity: 'strong',
      downscaleRatio: 0.99,
      removeIsolatedNoise: true,
      mergeMinorColors: true,
    });

    expect(report.optimizedGrid[4].slice(3, 6)).toEqual(['dark', 'dark', 'dark']);
  });

  it('is mirror-equivalent after cleanup so a scan direction cannot create one-way colour spread', () => {
    const grid = [
      ['shadowA', 'shadowA', 'shadowB', 'shadowA', 'shadowA'],
      ['shadowA', 'shadowB', 'shadowB', 'shadowB', 'shadowA'],
      ['shadowA', 'shadowA', 'shadowB', 'shadowA', 'shadowA'],
    ];
    const optionsWithoutProtection: ReductionOptions = {
      ...modalDefaults(15),
      intensity: 'strong',
      downscaleRatio: 0.99,
      protectSaliencyAndContours: false,
      protectVibrantColors: false,
      removeIsolatedNoise: false,
      mergeMinorColors: false,
    };

    const direct = smartReduceGrid(grid, palette, optionsWithoutProtection).optimizedGrid;
    const mirrored = smartReduceGrid(
      grid.map(row => [...row].reverse()),
      palette,
      optionsWithoutProtection,
    ).optimizedGrid.map(row => [...row].reverse());

    expect(direct).toEqual(mirrored);
  });

  it('counts a multi-cell enclosed transparent region as one hole', () => {
    const grid = Array.from({ length: 5 }, () => Array<string | null>(5).fill('dark'));
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) grid[y][x] = null;
    }
    expect(countInteriorHoles(grid)).toBe(1);
  });

  it('counts two separated enclosed transparent regions as distinct holes', () => {
    const grid = Array.from({ length: 5 }, () => Array<string | null>(7).fill('dark'));
    grid[2][1] = null;
    grid[2][5] = null;
    expect(countInteriorHoles(grid)).toBe(2);
  });

  it.each([15, 25, 40] as const)('keeps an O-shaped ring connected with exactly one protected counter at %s%%', (saving) => {
    const report = smartReduceGrid(createRingGrid(), palette, structuralOptions(saving));

    expectSingleFourConnected(report.optimizedGrid);
    expect(countInteriorHoles(report.optimizedGrid)).toBe(1);
  });

  it.each([
    [15, 'light'], [25, 'light'], [40, 'light'],
    [15, 'medium'], [25, 'medium'], [40, 'medium'],
    [15, 'strong'], [25, 'strong'], [40, 'strong'],
  ] as const)('does not introduce interior holes into a solid figure at %s%% / %s', (saving, intensity) => {
    const report = smartReduceGrid(createSolidFigureGrid(), palette, {
      ...structuralOptions(saving),
      intensity,
    });

    expectSingleFourConnected(report.optimizedGrid);
    expect(countInteriorHoles(report.optimizedGrid)).toBe(0);
  });

  it.each([1, 2] as const)('keeps a %s-cell bridge connected at every saving target', (bridgeWidth) => {
    for (const saving of [15, 25, 40] as const) {
      const report = smartReduceGrid(createBridgeGrid(bridgeWidth), palette, structuralOptions(saving));
      expectSingleFourConnected(report.optimizedGrid);
    }
  });

  it.each([15, 25, 40] as const)('keeps an H-shaped thin-stroke glyph 4-connected at %s%%', (saving) => {
    const report = smartReduceGrid(createLetterHGrid(), palette, structuralOptions(saving));
    expectSingleFourConnected(report.optimizedGrid);
  });

  it.each([15, 25, 40] as const)('retains both eyes and a detached salient highlight at %s%%', (saving) => {
    const grid = Array.from({ length: 36 }, () => Array<string | null>(36).fill(null));
    for (let y = 4; y <= 29; y++) {
      for (let x = 4; x <= 29; x++) grid[y][x] = 'light';
    }
    for (let y = 12; y <= 16; y++) {
      for (let x = 9; x <= 13; x++) grid[y][x] = 'dark';
      for (let x = 20; x <= 24; x++) grid[y][x] = 'dark';
    }
    for (let y = 13; y <= 14; y++) {
      for (let x = 10; x <= 11; x++) grid[y][x] = 'red';
      for (let x = 21; x <= 22; x++) grid[y][x] = 'red';
    }
    grid[32][2] = 'red';
    grid[32][3] = 'red';

    const report = smartReduceGrid(grid, palette, structuralOptions(saving));
    const midpoint = Math.floor(report.optimizedGrid[0].length / 2);
    const leftEye = report.optimizedGrid.flatMap(row => row.slice(0, midpoint));
    const rightEye = report.optimizedGrid.flatMap(row => row.slice(midpoint));

    expect(leftEye.some(color => color === 'dark' || color === 'red')).toBe(true);
    expect(rightEye.some(color => color === 'dark' || color === 'red')).toBe(true);
    expect(report.optimizedGrid.flat()).toContain('red');
  });

  it.each([15, 25, 40] as const)('is deterministic across repeated constrained downsampling at %s%%', (saving) => {
    const grid = createBridgeGrid(2);
    const first = smartReduceGrid(grid, palette, structuralOptions(saving));
    for (let run = 0; run < 4; run++) {
      expect(smartReduceGrid(grid, palette, structuralOptions(saving))).toEqual(first);
    }
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
