import { describe, expect, it } from 'vitest';
import type { BeadColor } from '../types';
import { simplifyColorRegions } from './smartReduceRegions';

const palette = new Map([100, 120, 130, 145].map(value => {
  const color: BeadColor = { id: `${value}`, code: `${value}`, name: 'grey',
    hex: `#${value.toString(16).repeat(3)}`, rgb: [value, value, value], brand: 'MARD' };
  return [color.id, color];
}));
const unlocked = (g: (string | null)[][]) => g.map(row => row.map(() => false));

describe('whole-region simplification', () => {
  it('removes weak patches as complete regions instead of eroding their corners', () => {
    const grid = Array.from({ length: 24 }, () => Array<string | null>(24).fill('100'));
    for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) grid[y][x] = '120';
    for (let y = 14; y < 20; y++) for (let x = 14; x < 20; x++) grid[y][x] = '130';
    const results = (['light', 'medium', 'strong'] as const)
      .map(level => simplifyColorRegions(grid, palette, unlocked(grid), level));
    expect(results.map(g => g.flat().filter(c => c !== '100').length)).toEqual([72, 36, 0]);
    expect(results[1][3].slice(3, 9)).toEqual(Array(6).fill('100'));
    expect(grid[3][3]).toBe('120');
  });

  it('does not copy colors through empty space or change protected regions', () => {
    const grid = [['100', '100', null, '120', '120'], ['100', '100', null, '120', '130']];
    const locked = unlocked(grid); locked[1][4] = true;
    expect(simplifyColorRegions(grid, palette, locked, 'strong')).toEqual(grid);
  });

  it('bounds cumulative drift against original colors even after multiple merges', () => {
    const grid = [['100', '120', '120', '145', '145', '145', '145']];
    const result = simplifyColorRegions(grid, palette, unlocked(grid), 'medium');
    // 100 -> 120 is allowed; subsequently changing those cells to 145 is not.
    expect(result[0][0]).toBe('120');
    expect(result[0].slice(3)).toEqual(Array(4).fill('145'));
  });

  it('is deterministic, mirror-equivalent, and keeps empty space unchanged', () => {
    const grid = [['100', '100', '120', '100', null], ['100', '130', '100', '100', null]];
    const direct = simplifyColorRegions(grid, palette, unlocked(grid), 'strong');
    const reversed = grid.map(row => [...row].reverse());
    expect(simplifyColorRegions(reversed, palette, unlocked(reversed), 'strong')
      .map(row => row.reverse())).toEqual(direct);
    expect(simplifyColorRegions(grid, palette, unlocked(grid), 'strong')).toEqual(direct);
    expect(direct[0][4]).toBeNull();
  });
});
