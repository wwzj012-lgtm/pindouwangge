import { describe, expect, it } from 'vitest';
import { createAssemblyExampleCase, createAssemblyPartsFromViews, summarizeAssemblyParts } from './assemblyExampleCase';

const palette = new Map([
  ['MARD_B2', { hex: '#63F347', code: 'B2', name: '荧光绿' }],
  ['MARD_B9', { hex: '#27523A', code: 'B9', name: '深绿' }],
  ['MARD_H1', { hex: '#FDFBFF', code: 'H1', name: '白色' }],
]);

describe('assemblyExampleCase', () => {
  it('creates deterministic, non-empty camera part diagrams', () => {
    const example = createAssemblyExampleCase(palette);
    expect(example.parts.length).toBeGreaterThanOrEqual(6);
    expect(example.parts.every(part => part.width > 0 && part.height > 0 && part.cells.some(row => row.some(Boolean)))).toBe(true);
    expect(example.parts.every(part => part.partNumber && part.quantity > 0 && part.colorStats.length > 0)).toBe(true);
    expect(createAssemblyExampleCase(palette)).toEqual(example);
  });

  it('calculates quantities and aggregate colour statistics including repeated side panels', () => {
    const example = createAssemblyExampleCase(palette);
    const expectedPartCount = example.parts.reduce((total, part) => total + part.quantity, 0);
    const expectedStats = new Map<string, number>();
    for (const part of example.parts) for (const stat of part.colorStats) expectedStats.set(stat.colorId, (expectedStats.get(stat.colorId) ?? 0) + stat.count * part.quantity);
    expect(example.totalPartCount).toBe(expectedPartCount);
    expect(example.totalBeads).toBe([...expectedStats.values()].reduce((total, count) => total + count, 0));
    expect(example.colorStats).toEqual([...expectedStats.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([colorId, count]) => ({ colorId, count })));
  });

  it('safely falls back to an available palette colour when preferred codes are absent', () => {
    const fallbackPalette = new Map([['custom-green', { hex: '#00FF00', code: 'custom-green', name: '自定义绿' }]]);
    const example = createAssemblyExampleCase(fallbackPalette);
    expect(example.parts.flatMap(part => part.cells.flat())).toContain('custom-green');
    expect(new Set(example.parts.flatMap(part => part.colorStats.map(stat => stat.colorId)))).toEqual(new Set(['custom-green']));
  });

  it('creates one real part per non-empty uploaded view and keeps view sources separate from the demo', () => {
    const parts = createAssemblyPartsFromViews({
      front: [['MARD_B2', null], ['MARD_B9', 'MARD_H1']],
      side: [[null, 'MARD_B2']],
      back: [[null, null]],
    });
    expect(parts.map(part => [part.sourceView, part.partNumber, part.id])).toEqual([
      ['front', 'VIEW-01', 'uploaded-front'],
      ['side', 'VIEW-02', 'uploaded-side'],
    ]);
    expect(parts.every(part => part.cells.some(row => row.some(Boolean)))).toBe(true);
    expect(createAssemblyExampleCase(palette).parts.every(part => part.sourceView === 'demo')).toBe(true);
  });

  it('degrades deterministically to a single front part and aggregates real view statistics', () => {
    const frontOnly = createAssemblyPartsFromViews({ front: [['MARD_B2', 'MARD_B2'], [null, 'MARD_H1']] });
    expect(frontOnly).toHaveLength(1);
    expect(frontOnly[0].sourceView).toBe('front');
    expect(summarizeAssemblyParts(frontOnly)).toEqual({
      totalPartCount: 1,
      totalBeads: 3,
      colorStats: [{ colorId: 'MARD_B2', count: 2 }, { colorId: 'MARD_H1', count: 1 }],
    });
  });
});
