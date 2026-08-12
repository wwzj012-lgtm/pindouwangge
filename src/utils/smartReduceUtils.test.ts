import { describe, expect, it } from 'vitest';
import type { BeadColor } from '../types';
import { savingPercentToScale, smartReduceGrid, type ReductionOptions } from './smartReduceUtils';

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
});
