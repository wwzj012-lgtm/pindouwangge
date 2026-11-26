import { describe, expect, it } from 'vitest';
import {
  countBeadsInRect, countPlacedByColor, countPlacedBeads, countPlacedInRect, decodePracticeProgress,
  encodePracticeProgress, findNextIncompleteSection, findNextUnplacedCell, findSectionByLabel,
  listPracticeSections, loadPracticeProgress, practiceMinimapColumns, practiceProgressStorageKey,
  practiceSectionForCell, practiceSectionLabel, practiceSectionLetter, practiceSectionRect,
  savePracticeProgress, togglePracticeCell,
} from './practiceProgress';

const grid = (): (string | null)[][] => [
  ['a', 'a', null, 'b', 'b', 'b'],
  ['a', null, null, 'b', null, 'b'],
  ['c', 'c', 'c', 'c', 'c', 'c'],
  [null, null, null, null, null, null],
];

describe('practice progress encoding', () => {
  it('round-trips any index set, including sparse and single-bit payloads', () => {
    const sets = [
      new Set<number>(),
      new Set([0]),
      new Set([7, 8]),
      new Set([0, 5, 63, 64, 1000, 14640]),
      new Set(Array.from({ length: 200 }, (_, index) => index * 13)),
    ];
    for (const done of sets) {
      const encoded = encodePracticeProgress(done);
      const decoded = decodePracticeProgress(encoded);
      expect([...decoded].sort((a, b) => a - b)).toEqual([...done].sort((a, b) => a - b));
    }
  });

  it('keeps large 900 x 900 payloads compact and lossless', () => {
    const done = new Set<number>();
    for (let index = 0; index < 810_000; index += 7) done.add(index);
    const encoded = encodePracticeProgress(done);
    // 810k cells as a bitmask fit in ~135KB of base64; a naive index JSON would be megabytes.
    expect(encoded.length).toBeLessThan(140_000);
    expect(decodePracticeProgress(encoded, 809_999).size).toBe(done.size);
  });

  it('encodes empty progress to an empty string and ignores corrupt payloads', () => {
    expect(encodePracticeProgress(new Set())).toBe('');
    expect(decodePracticeProgress('').size).toBe(0);
    expect(decodePracticeProgress('!!!!').size).toBe(0);
    expect(decodePracticeProgress('AA', 4).size).toBe(0);
  });

  it('drops indices that no longer fit a smaller pattern', () => {
    const decoded = decodePracticeProgress(encodePracticeProgress(new Set([3, 5000])), 99);
    expect([...decoded]).toEqual([3]);
  });

  it('ignores negative and non-integer indices', () => {
    const decoded = decodePracticeProgress(encodePracticeProgress(new Set([-4, 2.5, 9])), 10);
    expect([...decoded]).toEqual([9]);
  });
});

describe('practice progress storage', () => {
  const memory = () => {
    const cells = new Map<string, string>();
    return {
      cells,
      getItem: (key: string) => cells.get(key) ?? null,
      setItem: (key: string, value: string) => { cells.set(key, value); },
    };
  };

  it('namespaces the key per work', () => {
    expect(practiceProgressStorageKey('community:abc')).toBe('beadgrid_practice_progress_v1:community:abc');
  });

  it('saves and loads a work-scoped set', () => {
    const storage = memory();
    expect(savePracticeProgress('work-a', new Set([1, 2, 300]), storage)).toBe(true);
    savePracticeProgress('work-b', new Set([7]), storage);
    expect([...loadPracticeProgress('work-a', 500, storage)].sort((a, b) => a - b)).toEqual([1, 2, 300]);
    expect([...loadPracticeProgress('work-b', 500, storage)]).toEqual([7]);
    expect(loadPracticeProgress('work-c', 500, storage).size).toBe(0);
  });

  it('stays silent when storage throws', () => {
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
    };
    expect(savePracticeProgress('work', new Set([1]), broken)).toBe(false);
    expect(loadPracticeProgress('work', 10, broken).size).toBe(0);
    expect(loadPracticeProgress('work', 10, null).size).toBe(0);
    expect(savePracticeProgress('work', new Set([1]), null)).toBe(false);
  });
});

describe('practice cell toggling', () => {
  it('adds, removes and never mutates the input set', () => {
    const start = new Set([2]);
    const added = togglePracticeCell(start, 5);
    expect([...added].sort((a, b) => a - b)).toEqual([2, 5]);
    expect([...start]).toEqual([2]);
    expect([...togglePracticeCell(added, 5)]).toEqual([2]);
    expect([...togglePracticeCell(start, -1)]).toEqual([2]);
    expect([...togglePracticeCell(start, 1.5)]).toEqual([2]);
  });
});

describe('practice counting', () => {
  it('counts placed beads per color', () => {
    // row-major indices: 0 a, 1 a, 3 b, 6 a (row 1 col 0), 11 b (row 1 col 5)
    const done = new Set([0, 1, 3, 6, 11]);
    const counts = countPlacedByColor(grid(), done);
    expect(counts.get('a')).toBe(3);
    expect(counts.get('b')).toBe(2);
    expect(counts.has('c')).toBe(false);
    expect(counts.has('missing')).toBe(false);
  });

  it('counts beads and placed cells inside a rect, clamping to the grid', () => {
    const all = grid();
    expect(countBeadsInRect(all, { x: 0, y: 0, width: 2, height: 2 })).toBe(3);
    expect(countBeadsInRect(all, { x: 2, y: 0, width: 2, height: 2 })).toBe(2);
    expect(countBeadsInRect(all, { x: -5, y: -5, width: 100, height: 100 })).toBe(14);
    expect(countBeadsInRect(all, { x: 40, y: 40, width: 5, height: 5 })).toBe(0);
    expect(countBeadsInRect([], { x: 0, y: 0, width: 4, height: 4 })).toBe(0);

    const done = new Set([0, 3, 6]);
    expect(countPlacedInRect(done, 6, { x: 0, y: 0, width: 2, height: 2 })).toBe(2);
    expect(countPlacedInRect(done, 6, { x: 0, y: 1, width: 6, height: 2 })).toBe(1);
    expect(countPlacedInRect(done, 0, { x: 0, y: 0, width: 2, height: 2 })).toBe(0);
  });

  it('ignores stale indices pointing at empty or out-of-range cells', () => {
    const all = grid();
    expect(countPlacedBeads(all, new Set([0, 2, 3, 999]))).toBe(2);
    expect(countPlacedBeads([], new Set([0]))).toBe(0);
  });
});

describe('practice sections', () => {
  it('labels rows with letters and columns with 1-based numbers', () => {
    expect(practiceSectionLetter(0)).toBe('A');
    expect(practiceSectionLetter(1)).toBe('B');
    expect(practiceSectionLetter(25)).toBe('Z');
    expect(practiceSectionLetter(26)).toBe('AA');
    expect(practiceSectionLabel(0, 0)).toBe('A1');
    expect(practiceSectionLabel(2, 1)).toBe('B3');
    expect(practiceSectionLabel(9, 12)).toBe('M10');
  });

  it('computes clamped section rects, including residual last sections', () => {
    expect(practiceSectionRect(0, 0, 20, 121, 121)).toEqual({ x: 0, y: 0, width: 20, height: 20 });
    expect(practiceSectionRect(6, 6, 20, 121, 121)).toEqual({ x: 120, y: 120, width: 1, height: 1 });
    // A column that starts past the grid edge clamps to a zero-width (skippable) rect.
    expect(practiceSectionRect(3, 0, 10, 25, 25)).toEqual({ x: 25, y: 0, width: 0, height: 10 });
  });

  it('maps a cell to its section label', () => {
    expect(practiceSectionForCell(0, 0, 20).label).toBe('A1');
    expect(practiceSectionForCell(19, 19, 20).label).toBe('A1');
    expect(practiceSectionForCell(20, 5, 20).label).toBe('A2');
    expect(practiceSectionForCell(41, 40, 20).label).toBe('C3');
  });

  it('caps the minimap at the real block columns, never above 7', () => {
    // 121 x 121 is the classic community pattern size.
    expect(practiceMinimapColumns(121, 10)).toBe(7);
    expect(practiceMinimapColumns(121, 20)).toBe(7);
    expect(practiceMinimapColumns(121, 25)).toBe(5);
    expect(practiceMinimapColumns(60, 10)).toBe(6);
    expect(practiceMinimapColumns(40, 20)).toBe(2);
    expect(practiceMinimapColumns(900, 10)).toBe(7);
    expect(practiceMinimapColumns(1, 25)).toBe(1);
    expect(practiceMinimapColumns(121, 10, 12)).toBe(12);
  });

  it('lists every section with bead and placed counts in A1 -> A2 -> B1 order', () => {
    const all = grid();
    const sections = listPracticeSections(all, new Set([0, 1, 6]), 3);
    expect(sections.map(section => section.label)).toEqual(['A1', 'A2', 'B1', 'B2']);
    // A1 = rows 0-2 x cols 0-2: a,a,- / a,-,- / c,c,c
    expect(sections[0]).toMatchObject({ x: 0, y: 0, width: 3, height: 3, beads: 6, placed: 3 });
    // A2 = rows 0-2 x cols 3-5
    expect(sections[1]).toMatchObject({ x: 3, y: 0, width: 3, height: 3, beads: 8, placed: 0 });
    // B1/B2 = the empty last row (residual height 1)
    expect(sections[2]).toMatchObject({ x: 0, y: 3, width: 3, height: 1, beads: 0, placed: 0 });
    expect(sections.reduce((sum, section) => sum + section.beads, 0)).toBe(14);
  });

  it('handles empty and single-cell grids', () => {
    expect(listPracticeSections([], new Set(), 10)).toEqual([]);
    const single = listPracticeSections([['a']], new Set([0]), 25);
    expect(single).toHaveLength(1);
    expect(single[0]).toMatchObject({ label: 'A1', beads: 1, placed: 1, width: 1, height: 1 });
  });

  it('finds the next section with unplaced beads, cycling and skipping empty ones', () => {
    const sections = listPracticeSections(grid(), new Set([0, 1]), 3);
    expect(findNextIncompleteSection(sections, null)?.label).toBe('A1');
    expect(findNextIncompleteSection(sections, 'A1')?.label).toBe('A2');
    // B1/B2 have no beads at all, so the cycle wraps back to A1.
    expect(findNextIncompleteSection(sections, 'A2')?.label).toBe('A1');
    expect(findNextIncompleteSection([], null)).toBeNull();
    const finished = listPracticeSections([['a']], new Set([0]), 10);
    expect(findNextIncompleteSection(finished, null)).toBeNull();
    expect(findSectionByLabel(sections, 'B1')?.label).toBe('B1');
    expect(findSectionByLabel(sections, null)).toBeNull();
  });
});

describe('next unplaced bead', () => {
  it('prefers the active color and otherwise falls back to the first unplaced bead', () => {
    const all = grid();
    expect(findNextUnplacedCell(all, new Set(), 'b')).toEqual({ x: 3, y: 0, index: 3 });
    expect(findNextUnplacedCell(all, new Set([3]), 'b')).toEqual({ x: 4, y: 0, index: 4 });
    expect(findNextUnplacedCell(all, new Set(), null)).toEqual({ x: 0, y: 0, index: 0 });
    // Every bead of the fixture (indices 0,1,3,4,5 and 6,7,8,9,10,11 for row 1, plus row 2)
    const everyBead = [0, 1, 3, 4, 5, 6, 9, 11, 12, 13, 14, 15, 16, 17];
    expect(findNextUnplacedCell(all, new Set(everyBead), null)).toBeNull();
  });

  it('returns null for an empty grid', () => {
    expect(findNextUnplacedCell([], new Set(), 'a')).toBeNull();
    expect(findNextUnplacedCell([[]], new Set(), 'a')).toBeNull();
  });
});
