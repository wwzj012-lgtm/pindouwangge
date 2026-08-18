export type CanvasGrid = (string | null)[][];

export interface CanvasResetState {
  grid: CanvasGrid;
  history: CanvasGrid[];
  historyIndex: number;
}

export function resolveCanvasReset(
  confirmed: boolean,
  grid: CanvasGrid,
): CanvasResetState | null {
  if (!confirmed) return null;

  return {
    grid: grid.map(row => row.map(() => null)),
    history: [],
    historyIndex: -1,
  };
}
