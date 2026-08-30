import { describe, expect, it } from 'vitest';
import { clearAssemblyGrid, commitAssemblyGridHistory, countAssemblyGridColors, createAssemblyGridHistory, paintAssemblyGridCell, redoAssemblyGridHistory, replaceAssemblyGridColor, restoreAssemblyGridBaseline, undoAssemblyGridHistory } from './assemblyGridEditor';

describe('assemblyGridEditor', () => {
  it('paints and erases immutably with bounds protection', () => {
    const grid = [['A', null]];
    const painted = paintAssemblyGridCell(grid, 1, 0, 'B');
    expect(grid).toEqual([['A', null]]);
    expect(painted).toEqual([['A', 'B']]);
    expect(paintAssemblyGridCell(painted, 4, 0, 'C')).toBe(painted);
    expect(paintAssemblyGridCell(painted, 1, 0, null)).toEqual([['A', null]]);
  });

  it('replaces colours and keeps counts consistent', () => {
    const grid = [['A', 'B'], ['A', null]];
    const replaced = replaceAssemblyGridColor(grid, 'A', 'C');
    expect(grid).toEqual([['A', 'B'], ['A', null]]);
    expect(replaced).toEqual([['C', 'B'], ['C', null]]);
    expect([...countAssemblyGridColors(replaced)]).toEqual([['C', 2], ['B', 1]]);
    expect(clearAssemblyGrid(replaced)).toEqual([[null, null], [null, null]]);
  });

  it('supports bounded history, undo, redo, and baseline restore', () => {
    const base = [['A']];
    const first = commitAssemblyGridHistory(createAssemblyGridHistory(base), [['B']], 2);
    const second = commitAssemblyGridHistory(first, [['C']], 2);
    expect(undoAssemblyGridHistory(second).present).toEqual([['B']]);
    expect(redoAssemblyGridHistory(undoAssemblyGridHistory(second)).present).toEqual([['C']]);
    expect(restoreAssemblyGridBaseline(second).present).toEqual([['A']]);
  });
});
