import { describe, expect, it } from 'vitest';
import {
  analyzeBackgroundIslands, applyBackgroundIslandCleanup, createBackgroundIslandMask,
  type BackgroundIslandAnalysis, type BackgroundIslandGrid,
} from './backgroundIslandCleanup';

const empty = (width: number, height: number): (string | null)[][] =>
  Array.from({ length: height }, () => Array<string | null>(width).fill(null));
const parse = (...rows: string[]) => rows.map(row => [...row].map(cell => cell === '.' ? null : cell));
const componentAt = (analysis: BackgroundIslandAnalysis, x: number, y: number) =>
  analysis.components[analysis.componentIds[y * analysis.width + x] - 1];
const count = (mask: Uint8Array) => mask.reduce((sum, value) => sum + value, 0);
const fill = (grid: (string | null)[][], x: number, y: number, width: number, height: number) => {
  for (let py = y; py < y + height; py += 1) for (let px = x; px < x + width; px += 1) {
    grid[py][px] = (px + py) % 2 ? 'red' : 'blue';
  }
};
const ringScene = () => {
  const grid = empty(13, 13);
  for (let offset = 3; offset <= 9; offset += 1) {
    grid[3][offset] = 'red'; grid[9][offset] = 'blue';
    grid[offset][3] = 'blue'; grid[offset][9] = 'red';
  }
  grid[6][6] = 'eye';
  grid[0][0] = 'eye';
  return grid;
};

describe('background island component analysis', () => {
  it('finds and removes a single exterior bead without changing its color elsewhere', () => {
    const grid = parse('.....', '.....', '..r..', '.....', '.....');
    const analysis = analyzeBackgroundIslands(grid, { maxIslandSize: 1 });
    expect(analysis.stats.candidateComponents).toBe(1);
    expect(analysis.components[0].indices).toEqual(new Uint32Array([12]));
    expect(analysis.components[0].bounds).toEqual({ minX: 2, minY: 2, maxX: 2, maxY: 2 });
    expect(analysis.candidateMask[12]).toBe(1);
    expect(applyBackgroundIslandCleanup(grid, analysis)).toEqual(empty(5, 5));
    expect(grid[2][2]).toBe('r');
  });

  it('treats a multicolor body and embedded eyes as one occupied component', () => {
    const grid = empty(17, 12);
    fill(grid, 6, 4, 4, 4);
    grid[5][7] = 'eye'; grid[0][0] = 'eye';
    const analysis = analyzeBackgroundIslands(grid);
    const body = componentAt(analysis, 6, 4);
    expect(body.size).toBe(16);
    expect(componentAt(analysis, 7, 5).id).toBe(body.id);
    expect(body.candidate).toBe(false);
    expect(analysis.components).toHaveLength(2);
    const result = applyBackgroundIslandCleanup(grid, analysis);
    expect(result[5][7]).toBe('eye');
    expect(result[0][0]).toBeNull();
  });

  it('preserves multiple unequal bodies rather than only the largest', () => {
    const grid = empty(30, 14);
    fill(grid, 3, 4, 5, 5); fill(grid, 22, 4, 2, 3); grid[12][15] = 'noise';
    const analysis = analyzeBackgroundIslands(grid);
    expect(analysis.stats.subjectCount).toBe(2);
    expect(analysis.stats.candidateCells).toBe(1);
    const result = applyBackgroundIslandCleanup(grid, analysis);
    expect(result[4][3]).toBe(grid[4][3]);
    expect(result[4][22]).toBe(grid[4][22]);
    expect(result[12][15]).toBeNull();
  });

  it('connects differently colored diagonal linework with eight neighbors by default', () => {
    const grid = empty(14, 14);
    for (let i = 2; i < 12; i += 1) grid[i][i] = i % 2 ? 'r' : 'b';
    const analysis = analyzeBackgroundIslands(grid);
    expect(analysis.options.connectivity).toBe(8);
    expect(analysis.components).toHaveLength(1);
    expect(analysis.components[0].size).toBe(10);
    expect(applyBackgroundIslandCleanup(grid, analysis)).toEqual(grid);
    const four = analyzeBackgroundIslands(grid, { connectivity: 4 });
    expect(four.components).toHaveLength(10);
  });

  it('keeps a small diagonal component intact when selecting it', () => {
    const grid = parse('r....', '.b...', '..g..', '.....', '.....');
    const analysis = analyzeBackgroundIslands(grid, { maxIslandSize: 3 });
    expect(analysis.components).toHaveLength(1);
    expect(analysis.components[0].size).toBe(3);
    expect(count(analysis.candidateMask)).toBe(3);
    expect(applyBackgroundIslandCleanup(grid, analysis)).toEqual(empty(5, 5));
  });

  it('hard-protects an isolated eye in an enclosed transparent cavity', () => {
    const grid = ringScene();
    const analysis = analyzeBackgroundIslands(grid, { nearSubjectDistance: 0, protectSubjectBounds: false });
    const eye = componentAt(analysis, 6, 6);
    expect(eye.touchesExterior).toBe(false);
    expect(eye.protectionReasons).toContain('enclosed');
    expect(analysis.exteriorMask[6 * 13 + 5]).toBe(0);
    expect(analysis.exteriorMask[1 * 13 + 1]).toBe(1);
    const result = applyBackgroundIslandCleanup(grid, analysis, { selectedComponentIds: analysis.components.map(c => c.id) });
    expect(result[6][6]).toBe('eye');
    expect(result[0][0]).toBeNull();
    expect(result[3][3]).toBe(grid[3][3]);
  });

  it('does not leak exterior background through diagonal foreground seams', () => {
    const grid = empty(15, 15);
    for (let y = 2; y <= 12; y += 1) for (let x = 2; x <= 12; x += 1) {
      if (Math.abs(x - 7) + Math.abs(y - 7) === 5) grid[y][x] = 'contour';
    }
    grid[7][7] = 'eye'; grid[0][0] = 'noise';
    const analysis = analyzeBackgroundIslands(grid, { nearSubjectDistance: 0, protectSubjectBounds: false });
    expect(componentAt(analysis, 7, 7).protectionReasons).toContain('enclosed');
    expect(applyBackgroundIslandCleanup(grid, analysis)[7][7]).toBe('eye');
    expect(analysis.stats.candidateCells).toBe(1);
  });

  it('protects an eye inside an open contour bounds without filling edge holes', () => {
    const grid = ringScene();
    grid[3][6] = null;
    const analysis = analyzeBackgroundIslands(grid, { nearSubjectDistance: 0 });
    const eye = componentAt(analysis, 6, 6);
    expect(eye.touchesExterior).toBe(true);
    expect(eye.protectionReasons).toEqual(['subject-bounds']);
    const result = applyBackgroundIslandCleanup(grid, analysis);
    expect(result[6][6]).toBe('eye');
    expect(result[3][6]).toBeNull();
    const unprotected = analyzeBackgroundIslands(grid, { nearSubjectDistance: 0, protectSubjectBounds: false });
    expect(componentAt(unprotected, 6, 6).candidate).toBe(true);
  });

  it('does not create a global bounding box across separate subjects', () => {
    const grid = empty(32, 12);
    fill(grid, 2, 4, 3, 3); fill(grid, 26, 4, 3, 3); grid[5][15] = 'noise';
    const analysis = analyzeBackgroundIslands(grid);
    expect(componentAt(analysis, 15, 5).candidate).toBe(true);
  });

  it('protects nearby decorations using Chebyshev distance, but not remote specks', () => {
    const grid = empty(16, 16);
    fill(grid, 4, 4, 3, 3); grid[8][8] = 'decoration'; grid[12][12] = 'noise';
    const analysis = analyzeBackgroundIslands(grid);
    expect(componentAt(analysis, 8, 8).protectionReasons).toEqual(['near-subject']);
    expect(componentAt(analysis, 12, 12).candidate).toBe(true);
    const disabled = analyzeBackgroundIslands(grid, { nearSubjectDistance: 0 });
    expect(componentAt(disabled, 8, 8).candidate).toBe(true);
  });

  it('uses an inclusive distance boundary and never propagates protection via noise', () => {
    const grid = empty(18, 14);
    fill(grid, 3, 4, 3, 3); grid[4][7] = 'near'; grid[8][8] = 'far'; grid[4][10] = 'other';
    const analysis = analyzeBackgroundIslands(grid);
    expect(componentAt(analysis, 7, 4).candidate).toBe(false);
    expect(componentAt(analysis, 8, 8).candidate).toBe(true);
    expect(componentAt(analysis, 10, 4).candidate).toBe(true);
  });

  it('protects substantial multiple subjects even when the removal threshold is very high', () => {
    const grid = empty(40, 18);
    fill(grid, 3, 4, 8, 8); fill(grid, 27, 4, 4, 4); grid[16][20] = 'noise';
    const analysis = analyzeBackgroundIslands(grid, { maxIslandSize: 1000 });
    expect(analysis.stats.subjectCount).toBe(2);
    expect(analysis.stats.candidateCells).toBe(1);
    const result = applyBackgroundIslandCleanup(grid, analysis, { selectedComponentIds: analysis.components.map(c => c.id) });
    expect(result[4][3]).toBe(grid[4][3]); expect(result[4][27]).toBe(grid[4][27]);
  });

  it('includes size equal to the threshold and excludes threshold plus one', () => {
    const grid = empty(22, 10);
    fill(grid, 2, 3, 2, 2); fill(grid, 14, 3, 5, 1);
    const analysis = analyzeBackgroundIslands(grid, { maxIslandSize: 4 });
    expect(componentAt(analysis, 2, 3).candidate).toBe(true);
    expect(componentAt(analysis, 14, 3).candidate).toBe(false);
    expect(analysis.stats.candidateCells).toBe(4);
    expect(analyzeBackgroundIslands(grid, { maxIslandSize: 3 }).stats.candidateCells).toBe(0);
    expect(analyzeBackgroundIslands(grid, { maxIslandSize: 0 }).stats.candidateCells).toBe(0);
  });

  it('keeps row-major IDs and indices stable across threshold changes', () => {
    const grid = parse('r.....g', '.......', '...bb..', '.......');
    const first = analyzeBackgroundIslands(grid, { maxIslandSize: 1 });
    const second = analyzeBackgroundIslands(grid, { maxIslandSize: 4 });
    expect(first.componentIds).toEqual(second.componentIds);
    expect(first.components.map(c => c.indices)).toEqual(second.components.map(c => c.indices));
    expect(first.components.map(c => c.id)).toEqual([1, 2, 3]);
  });

  it.each([[], [[], []], [[null]], empty(5, 4)].map(grid => ({ grid })))('handles empty and fully transparent grids: $grid', ({ grid }) => {
    const analysis = analyzeBackgroundIslands(grid);
    expect(analysis.stats.componentCount).toBe(0);
    expect(count(analysis.candidateMask)).toBe(0);
    expect(applyBackgroundIslandCleanup(grid, analysis)).toEqual(grid);
    expect(count(analysis.exteriorMask)).toBe(analysis.stats.totalCells);
  });

  it.each([parse('r'), parse('rb', 'gr'), parse('rrrrrrrrrr')].map(grid => ({ grid })))('preserves fully occupied grids: $grid', ({ grid }) => {
    const analysis = analyzeBackgroundIslands(grid, { maxIslandSize: 100 });
    expect(analysis.stats.candidateCells).toBe(0);
    expect(applyBackgroundIslandCleanup(grid, analysis)).toEqual(grid);
  });

  it('handles one-row, one-column, edge and corner islands', () => {
    for (const grid of [parse('r...b'), parse('r', '.', '.', '.', 'b')]) {
      const analysis = analyzeBackgroundIslands(grid);
      expect(analysis.stats.candidateComponents).toBe(2);
      expect(analysis.components.every(c => c.touchesBoundary)).toBe(true);
      expect(count(createBackgroundIslandMask(analysis))).toBe(2);
    }
  });

  it('treats opaque palette IDs literally rather than inspecting their color or truthiness', () => {
    const grid = [['', null, '#000000', null, 'white']];
    const analysis = analyzeBackgroundIslands(grid);
    expect(analysis.stats.coloredCells).toBe(3);
    expect(analysis.components).toHaveLength(3);
    expect(count(analysis.candidateMask)).toBe(3);
  });

  it('rejects ragged grids and unsupported cell types', () => {
    expect(() => analyzeBackgroundIslands([['r'], []])).toThrow(/rectangular/);
    expect(() => analyzeBackgroundIslands([[42]] as unknown as BackgroundIslandGrid)).toThrow(TypeError);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid numeric options: %s', value => {
    expect(() => analyzeBackgroundIslands([], { maxIslandSize: value })).toThrow(RangeError);
    expect(() => analyzeBackgroundIslands([], { nearSubjectDistance: value })).toThrow(RangeError);
  });

  it('rejects unsupported connectivity and bounds large valid distances to actual work', () => {
    expect(() => analyzeBackgroundIslands([], { connectivity: 6 as 8 })).toThrow(RangeError);
    const grid = empty(12, 12); fill(grid, 4, 4, 3, 3); grid[0][0] = 'decoration';
    expect(analyzeBackgroundIslands(grid, { nearSubjectDistance: Number.MAX_SAFE_INTEGER }).stats.candidateCells).toBe(0);
  });
});

describe('background island preview and immutable application', () => {
  it('supports deselection, explicit selection and user protection with protection winning', () => {
    const grid = parse('r.....b', '.......', '...g...', '.......');
    const analysis = analyzeBackgroundIslands(grid);
    expect(count(createBackgroundIslandMask(analysis))).toBe(3);
    expect(count(createBackgroundIslandMask(analysis, { selectedComponentIds: [] }))).toBe(0);
    expect(count(createBackgroundIslandMask(analysis, { selectedComponentIds: [1, 1, 2], protectedComponentIds: [2] }))).toBe(1);
    const result = applyBackgroundIslandCleanup(grid, analysis, { protectedComponentIds: [1, 3] });
    expect(result[0][0]).toBe('r'); expect(result[0][6]).toBeNull(); expect(result[2][3]).toBe('g');
    expect(count(analysis.candidateMask)).toBe(3);
  });

  it('allows explicit user review to override proximity and open-bounds soft protection', () => {
    const grid = ringScene(); grid[3][6] = null; grid[1][6] = 'accent';
    const analysis = analyzeBackgroundIslands(grid);
    const eye = componentAt(analysis, 6, 6), accent = componentAt(analysis, 6, 1);
    expect(eye.candidate).toBe(false); expect(accent.candidate).toBe(false);
    const selection = { selectedComponentIds: [eye.id, accent.id], protectedComponentIds: [accent.id] };
    expect(count(createBackgroundIslandMask(analysis, selection))).toBe(1);
    const result = applyBackgroundIslandCleanup(grid, analysis, selection);
    expect(result[6][6]).toBeNull(); expect(result[1][6]).toBe('accent'); expect(result[0][0]).toBe('eye');
  });

  it.each([0, -1, 0.5, NaN, 99])('rejects unknown component IDs: %s', id => {
    const analysis = analyzeBackgroundIslands(parse('r.'));
    expect(() => createBackgroundIslandMask(analysis, { selectedComponentIds: [id] })).toThrow(RangeError);
    expect(() => createBackgroundIslandMask(analysis, { protectedComponentIds: [id] })).toThrow(RangeError);
  });

  it('rejects stale previews after recoloring, occupancy, shape or in-place changes', () => {
    const grid = parse('r..', '...');
    const analysis = analyzeBackgroundIslands(grid);
    for (const changed of [parse('b..', '...'), parse('...', '...'), parse('r..'), parse('r...', '....')]) {
      expect(() => applyBackgroundIslandCleanup(changed, analysis)).toThrow(/stale/);
    }
    grid[0][0] = 'changed';
    expect(analysis.sourceGrid[0][0]).toBe('r');
    expect(() => applyBackgroundIslandCleanup(grid, analysis)).toThrow(/stale/);
  });

  it('leaves frozen inputs, analysis data and undo snapshots unchanged, including no-ops', () => {
    const grid = Object.freeze(parse('r....', '.....', '..b..').map(row => Object.freeze(row)));
    const analysis = analyzeBackgroundIslands(grid);
    const originalMask = analysis.candidateMask.slice();
    const originalLabels = analysis.componentIds.slice();
    const selectedComponentIds = Object.freeze([1]);
    const result = applyBackgroundIslandCleanup(grid, analysis, { selectedComponentIds });
    expect(result).not.toBe(grid);
    for (let y = 0; y < grid.length; y += 1) expect(result[y]).not.toBe(grid[y]);
    expect(result[0][0]).toBeNull(); expect(result[2][2]).toBe('b');
    expect(grid[0][0]).toBe('r');
    result[2][2] = 'changed';
    expect(grid[2][2]).toBe('b'); expect(analysis.sourceGrid[2][2]).toBe('b');
    expect(analysis.candidateMask).toEqual(originalMask); expect(analysis.componentIds).toEqual(originalLabels);
    const mask = createBackgroundIslandMask(analysis); mask.fill(0);
    expect(createBackgroundIslandMask(analysis)).toEqual(originalMask);
    expect(applyBackgroundIslandCleanup(grid, analysis, { selectedComponentIds: [] })).toEqual(grid);
  });

  it('returns consistent component indices, masks, stats and independent deterministic results', () => {
    const grid = ringScene();
    const analysis = analyzeBackgroundIslands(grid);
    expect(analyzeBackgroundIslands(grid)).toEqual(analysis);
    const { stats } = analysis;
    expect(stats.coloredCells + stats.transparentCells).toBe(stats.totalCells);
    expect(stats.candidateCells + stats.protectedCells).toBe(stats.coloredCells);
    expect(stats.candidateComponents + stats.protectedComponents).toBe(stats.componentCount);
    expect(count(analysis.candidateMask)).toBe(stats.candidateCells);
    for (const component of analysis.components) {
      expect(component.indices.length).toBe(component.size);
      for (const index of component.indices) expect(analysis.componentIds[index]).toBe(component.id);
    }
    expect(createBackgroundIslandMask(analysis)).toEqual(analysis.candidateMask);
  });
});

describe('background island iterative large-grid behavior', () => {
  it.each([312, 1024])('analyzes and applies a %s-square multicolor grid without recursion', size => {
    const grid = empty(size, size);
    const margin = Math.floor(size / 4);
    fill(grid, margin, margin, size - 2 * margin, size - 2 * margin);
    grid[0][0] = 'speck'; grid[size - 1][size - 1] = 'speck';
    const start = performance.now();
    const analysis = analyzeBackgroundIslands(grid);
    const result = applyBackgroundIslandCleanup(grid, analysis);
    expect(analysis.stats.componentCount).toBe(3);
    expect(analysis.stats.candidateCells).toBe(2);
    expect(result[0][0]).toBeNull(); expect(result[size - 1][size - 1]).toBeNull();
    expect(result[margin][margin]).toBe(grid[margin][margin]);
    expect(grid[0][0]).toBe('speck');
    // Broad regression guard for CI: detects accidental repeated global scans.
    expect(performance.now() - start).toBeLessThan(8000);
  }, 15000);

  it('handles thousands of subjects with individual overlapping protection distances', () => {
    const grid = empty(312, 312);
    let subjectCount = 0;
    for (let y = 2; y < 309; y += 4) for (let x = 2; x < 309; x += 4) {
      fill(grid, x, y, 2, 2); subjectCount += 1;
    }
    const start = performance.now();
    const analysis = analyzeBackgroundIslands(grid, { maxIslandSize: 1 });
    expect(analysis.stats.subjectCount).toBe(subjectCount);
    expect(analysis.stats.componentCount).toBe(subjectCount);
    expect(analysis.stats.candidateCells).toBe(0);
    expect(performance.now() - start).toBeLessThan(4000);
  });

  it('handles many small exterior islands without promoting one arbitrary largest body', () => {
    const grid = empty(312, 312);
    let islands = 0;
    for (let y = 0; y < 312; y += 3) for (let x = 0; x < 312; x += 3) {
      grid[y][x] = (x + y) % 2 ? 'r' : 'b'; islands += 1;
    }
    const analysis = analyzeBackgroundIslands(grid, { maxIslandSize: 1 });
    expect(analysis.stats.subjectCount).toBe(0);
    expect(analysis.stats.candidateComponents).toBe(islands);
    expect(analysis.stats.candidateCells).toBe(islands);
  });
});
