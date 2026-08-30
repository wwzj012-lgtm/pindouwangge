import { describe, expect, it } from 'vitest';
import { filterBeadColors } from './ColorReplaceModal';

const palette = [
  {
    id: 'm01',
    code: 'M01',
    name: '白色',
    hex: '#FFFFFF',
    rgb: [255, 255, 255] as [number, number, number],
    brand: 'MARD' as const,
  },
  {
    id: 'p01',
    code: 'P01',
    name: '樱花粉',
    hex: '#FFB7C5',
    rgb: [255, 183, 197] as [number, number, number],
    brand: 'PERLER' as const,
  },
];

describe('ColorReplaceModal palette search', () => {
  it('matches code, name, and brand without case sensitivity', () => {
    expect(filterBeadColors(palette, 'm01')).toEqual([palette[0]]);
    expect(filterBeadColors(palette, '樱花')).toEqual([palette[1]]);
    expect(filterBeadColors(palette, 'perler')).toEqual([palette[1]]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterBeadColors(palette, '不存在')).toEqual([]);
  });

  it('restores the full palette after clearing the search', () => {
    expect(filterBeadColors(palette, '')).toBe(palette);
    expect(filterBeadColors(palette, '   ')).toBe(palette);
  });
});
