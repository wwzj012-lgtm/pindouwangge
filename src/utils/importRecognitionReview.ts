import type { BeadColor } from '../types';
import { summarizeRecognition, type ImportRecognitionCell, type ImportRecognitionResult } from './importRecognition';

/** Local review edits. Null explicitly marks a cell blank; missing keys keep recognition. */
export type ImportRecognitionCorrections = Record<string, string | null>;

export function recognitionCellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

export function cellNeedsRecognitionReview(cell: ImportRecognitionCell): boolean {
  if (cell.status === 'invalid') return true;
  if (cell.status === 'blank') return false;
  if (cell.dominantRatio === null) return true;
  return cell.dominantRatio + 1e-9 < 0.6
    || cell.dominantRatio - (cell.runnerUpRatio ?? 0) + 1e-9 < 0.1
    || cell.distance === null || cell.distance > 15;
}

export function getRecognitionReviewCells(
  result: ImportRecognitionResult,
  corrections: ImportRecognitionCorrections = {},
): Array<{ row: number; column: number }> {
  const pending: Array<{ row: number; column: number }> = [];
  for (const row of result.cells) {
    for (const cell of row) {
      if (Object.hasOwn(corrections, recognitionCellKey(cell.row, cell.column))) continue;
      if (cellNeedsRecognitionReview(cell)) pending.push({ row: cell.row, column: cell.column });
    }
  }
  return pending;
}

/** Keeps original recognition and measured proportions intact; manual choices aren't measurements. */
export function applyRecognitionCorrections(
  result: ImportRecognitionResult,
  corrections: ImportRecognitionCorrections,
  palette: BeadColor[],
): ImportRecognitionResult {
  if (!Object.keys(corrections).length) return result;
  const colors = new Map(palette.filter(color => color.enabled !== false).map(color => [color.id, color]));
  let changed = false;
  const cells = result.cells.map(row => row.map(cell => {
    const key = recognitionCellKey(cell.row, cell.column);
    if (!Object.hasOwn(corrections, key)) return cell;
    const id = corrections[key];
    const color = id === null ? null : colors.get(id);
    if (color === undefined) return cell;
    changed = true;
    return {
      ...cell,
      status: color === null ? 'blank' as const : 'mapped' as const,
      color, colorId: color?.id ?? null,
      sampleRgb: null, distance: null, dominantRatio: null, runnerUpRatio: null,
      confidence: null, quality: null,
    };
  }));
  return changed ? { ...result, cells, summary: summarizeRecognition(cells) } : result;
}
