export interface VisibleGridRange {
  start: number;
  end: number;
}

/** Returns the half-open cell-index range intersecting one viewport axis. */
export function getVisibleGridRange(
  count: number,
  cellSize: number,
  gridOrigin: number,
  viewportSize: number,
): VisibleGridRange {
  if (!Number.isSafeInteger(count) || count <= 0
    || !Number.isFinite(cellSize) || cellSize <= 0
    || !Number.isFinite(gridOrigin)
    || !Number.isFinite(viewportSize) || viewportSize <= 0) {
    return { start: 0, end: 0 };
  }

  const start = Math.max(0, Math.min(count, Math.floor(-gridOrigin / cellSize)));
  const end = Math.max(start, Math.min(count, Math.ceil((viewportSize - gridOrigin) / cellSize)));
  return { start, end };
}
