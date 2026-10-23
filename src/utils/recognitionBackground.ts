import type { ImportRecognitionResult } from './importRecognition';
import { recognitionCellKey } from './importRecognitionReview';

/** A strict majority of the whole border avoids guessing on ties or transparent borders. */
export function getRecognitionBackgroundCandidate(result: ImportRecognitionResult): string | null {
  const rows = result.cells.length;
  const columns = result.cells[0]?.length ?? 0;
  if (!rows || !columns) return null;
  const counts = new Map<string, number>();
  let borderCount = 0;
  let candidate: string | null = null;
  let largest = 0;
  const countCell = (row: number, column: number) => {
    borderCount += 1;
    const cell = result.cells[row][column];
    if (cell.status !== 'mapped' || !cell.colorId) return;
    const count = (counts.get(cell.colorId) ?? 0) + 1;
    counts.set(cell.colorId, count);
    if (count > largest) { largest = count; candidate = cell.colorId; }
  };
  for (let column = 0; column < columns; column += 1) {
    countCell(0, column);
    if (rows > 1) countCell(rows - 1, column);
  }
  for (let row = 1; row < rows - 1; row += 1) {
    countCell(row, 0);
    if (columns > 1) countCell(row, columns - 1);
  }
  return largest > borderCount / 2 ? candidate : null;
}

/** Four-neighbour flood fill. Blank cells are passable but are never removed. */
export function getRecognitionBackgroundCells(result: ImportRecognitionResult, colorId: string | null): string[] {
  const rows = result.cells.length;
  const columns = result.cells[0]?.length ?? 0;
  if (!colorId || !rows || !columns) return [];
  const visited = new Uint8Array(rows * columns);
  const queue = new Uint32Array(rows * columns);
  const removed: string[] = [];
  let head = 0;
  let tail = 0;
  const enqueue = (row: number, column: number) => {
    const index = row * columns + column;
    if (visited[index]) return;
    visited[index] = 1;
    const cell = result.cells[row][column];
    if (cell.status === 'blank' || (cell.status === 'mapped' && cell.colorId === colorId)) queue[tail++] = index;
  };
  for (let column = 0; column < columns; column += 1) {
    enqueue(0, column);
    enqueue(rows - 1, column);
  }
  for (let row = 1; row < rows - 1; row += 1) {
    enqueue(row, 0);
    enqueue(row, columns - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const row = Math.floor(index / columns);
    const column = index % columns;
    if (result.cells[row][column].status === 'mapped') removed.push(recognitionCellKey(row, column));
    if (row > 0) enqueue(row - 1, column);
    if (row + 1 < rows) enqueue(row + 1, column);
    if (column > 0) enqueue(row, column - 1);
    if (column + 1 < columns) enqueue(row, column + 1);
  }
  return removed;
}

/** Later explicit cell edits take precedence over every earlier background operation. */
export function releaseRecognitionBackgroundCell(history: string[][], key: string): string[][] {
  return history.map(batch => batch.filter(cellKey => cellKey !== key)).filter(batch => batch.length > 0);
}

export function recognitionBackgroundCorrections(history: string[][]): Record<string, null> {
  const corrections: Record<string, null> = {};
  for (const batch of history) {
    for (const key of batch) corrections[key] = null;
  }
  return corrections;
}
