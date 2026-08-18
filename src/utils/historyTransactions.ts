export type GridSnapshot = (string | null)[][];

export interface HistoryState {
  history: GridSnapshot[];
  historyIndex: number;
}

export interface HistoryCommitResult extends HistoryState {
  changed: boolean;
}

export const cloneGrid = (grid: GridSnapshot): GridSnapshot =>
  grid.map((row) => [...row]);

export const gridsEqual = (left: GridSnapshot, right: GridSnapshot): boolean => {
  if (left.length !== right.length) return false;

  return left.every((row, rowIndex) =>
    row.length === right[rowIndex]?.length &&
    row.every((cell, columnIndex) => cell === right[rowIndex][columnIndex]),
  );
};

/** Adds one snapshot for a completed user action, preserving a baseline for undo. */
export const commitHistorySnapshot = (
  history: GridSnapshot[],
  historyIndex: number,
  currentGrid: GridSnapshot,
  nextGrid: GridSnapshot,
): HistoryCommitResult => {
  if (gridsEqual(currentGrid, nextGrid)) {
    return { history, historyIndex, changed: false };
  }

  const branch =
    historyIndex >= 0 && gridsEqual(history[historyIndex], currentGrid)
      ? history.slice(0, historyIndex + 1)
      : [cloneGrid(currentGrid)];
  const nextHistory = [...branch, cloneGrid(nextGrid)];

  return {
    history: nextHistory,
    historyIndex: nextHistory.length - 1,
    changed: true,
  };
};

export const getUndoState = (history: GridSnapshot[], historyIndex: number): HistoryState | null => {
  if (historyIndex <= 0) return null;
  return { history, historyIndex: historyIndex - 1 };
};

export const getRedoState = (history: GridSnapshot[], historyIndex: number): HistoryState | null => {
  if (historyIndex < 0 || historyIndex >= history.length - 1) return null;
  return { history, historyIndex: historyIndex + 1 };
};
