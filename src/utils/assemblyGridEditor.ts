export type AssemblyEditableCell = string | null;
export type AssemblyEditableGrid = AssemblyEditableCell[][];

export interface AssemblyGridHistory {
  baseline: AssemblyEditableGrid;
  past: AssemblyEditableGrid[];
  present: AssemblyEditableGrid;
  future: AssemblyEditableGrid[];
}

export function cloneAssemblyGrid(grid: AssemblyEditableGrid): AssemblyEditableGrid { return grid.map(row => [...row]); }

export function paintAssemblyGridCell(grid: AssemblyEditableGrid, x: number, y: number, color: AssemblyEditableCell): AssemblyEditableGrid {
  if (x < 0 || y < 0 || y >= grid.length || x >= (grid[y]?.length ?? 0) || grid[y][x] === color) return grid;
  const next = [...grid]; next[y] = [...grid[y]]; next[y][x] = color;
  return next;
}

export function replaceAssemblyGridColor(grid: AssemblyEditableGrid, from: string, to: AssemblyEditableCell): AssemblyEditableGrid {
  if (from === to) return grid;
  let changed = false;
  const next = grid.map(row => row.map(cell => { if (cell !== from) return cell; changed = true; return to; }));
  return changed ? next : grid;
}

export function clearAssemblyGrid(grid: AssemblyEditableGrid): AssemblyEditableGrid {
  let changed = false;
  const next = grid.map(row => row.map(cell => { if (cell === null) return cell; changed = true; return null; }));
  return changed ? next : grid;
}

export function countAssemblyGridColors(grid: AssemblyEditableGrid): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of grid) for (const cell of row) if (cell) counts.set(cell, (counts.get(cell) ?? 0) + 1);
  return counts;
}

export function createAssemblyGridHistory(grid: AssemblyEditableGrid): AssemblyGridHistory {
  return { baseline: cloneAssemblyGrid(grid), past: [], present: grid, future: [] };
}

export function commitAssemblyGridHistory(history: AssemblyGridHistory, next: AssemblyEditableGrid, limit = 80): AssemblyGridHistory {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  return { ...history, past: past.slice(Math.max(0, past.length - limit)), present: next, future: [] };
}

export function undoAssemblyGridHistory(history: AssemblyGridHistory): AssemblyGridHistory {
  const previous = history.past.at(-1); if (!previous) return history;
  return { ...history, past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redoAssemblyGridHistory(history: AssemblyGridHistory): AssemblyGridHistory {
  const next = history.future[0]; if (!next) return history;
  return { ...history, past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}

export function restoreAssemblyGridBaseline(history: AssemblyGridHistory): AssemblyGridHistory {
  return commitAssemblyGridHistory(history, cloneAssemblyGrid(history.baseline));
}
