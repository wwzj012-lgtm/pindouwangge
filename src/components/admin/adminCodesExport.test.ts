import { describe, expect, it } from 'vitest';
import { generatedCodesCsv, generatedCodesFilename } from './AdminLogsCodes';

describe('generated codes CSV export (批次 5 P2)', () => {
  it('exports one plain row per generated code with a UTF-8 BOM', () => {
    const csv = generatedCodesCsv(['AAA111', 'BBB222', 'CCC333']);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const rows = csv.slice(1).split('\r\n');
    expect(rows).toEqual(['AAA111', 'BBB222', 'CCC333']);
    expect(rows).toHaveLength(3);
  });

  it('escapes CSV metacharacters inside codes', () => {
    const csv = generatedCodesCsv(['A"B', 'C,D']);
    expect(csv.slice(1).split('\r\n')).toEqual(['"A""B"', '"C,D"']);
  });

  it('builds a dated filename carrying the batch size', () => {
    expect(generatedCodesFilename(50, new Date('2025-06-01T08:00:00Z'))).toBe('generated-codes-2025-06-01-50.csv');
  });
});
