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

/** 前两名几乎打平：人眼能真正做决定的那种"含糊"。 */
const AMBIGUOUS_GAP = 0.12;
/**
 * 但两支候选必须"肉眼可分"才算含糊。
 * 221 支的色卡里，次优常常只是相近的另一支（ΔE<4）——那种犹豫连人眼都看不出来，
 * 选哪支画面都一样，不该占用复核队列。这条一加，队列里剩下的才是真需要判断的格子。
 */
const AMBIGUOUS_MIN_SEPARATION = 4;
/** 色板里没有相近的色号（ΔE 很大），再怎么看也是"猜的"。 */
const FAR_DISTANCE = 12;
/** 与周围 8 格里的多数不一致，且多数票达到这个数：典型的孤立错格。 */
const OUTLIER_VOTES = 6;

/**
 * 复核队列 = **可能识别错**的格子，不是"格子脏"的格子。
 *
 * 之前用 `dominantRatio < 0.6`，等于把"这一格混了几种颜色"当成"这一格可能错"。
 * 手机拍的成品照里，每格除了豆子本体还有孔洞、豆缘反光和相邻豆的渗色，
 * 主色占比天然只有 55% 上下——于是整张图都被标成待核对（实测 5567/11500 = 48%），
 * 金色铺满画面，标记也就失去了意义。
 *
 * 现在改成三条"可能错"的判据，**不设数量上限**：识别准了数量自然就少，
 * 靠截断来让画面好看是自欺欺人。
 *
 * 1. **含糊**：主色与次色差 < 0.12，两支豆几乎打平；
 * 2. **离谱**：最近色号的 ΔE > 12，色板里根本没有这个颜色；
 * 3. **孤立**：与周围 8 格里的多数色号不一致（≥6 票）。拼豆作品大面积连续，
 *    一格里孤零零冒出来的另一个色号，绝大多数是错的——这条对柔和照片最有效。
 */
export function getRecognitionReviewCells(
  result: ImportRecognitionResult,
  corrections: ImportRecognitionCorrections = {},
): Array<{ row: number; column: number }> {
  const pending: Array<{ row: number; column: number }> = [];
  const idAt = (row: number, column: number) => {
    const cell = result.cells[row]?.[column];
    if (!cell || cell.status !== 'mapped') return null;
    return cell.colorId;
  };
  for (const row of result.cells) {
    for (const cell of row) {
      if (Object.hasOwn(corrections, recognitionCellKey(cell.row, cell.column))) continue;
      if (cell.status === 'invalid') { pending.push({ row: cell.row, column: cell.column }); continue; }
      if (cell.status !== 'mapped' || cell.dominantRatio === null) continue;
      const gap = cell.dominantRatio - (cell.runnerUpRatio ?? 0);
      const ambiguous = gap < AMBIGUOUS_GAP
        && (cell.runnerUpSeparation ?? Number.POSITIVE_INFINITY) >= AMBIGUOUS_MIN_SEPARATION;
      const far = cell.distance === null || cell.distance > FAR_DISTANCE;
      let outlier = false;
      if (!ambiguous && !far) {
        const votes = new Map<string, number>();
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            if (dr === 0 && dc === 0) continue;
            const id = idAt(cell.row + dr, cell.column + dc);
            if (id) votes.set(id, (votes.get(id) ?? 0) + 1);
          }
        }
        for (const [id, count] of votes) {
          if (id !== cell.colorId && count >= OUTLIER_VOTES) { outlier = true; break; }
        }
      }
      if (ambiguous || far || outlier) pending.push({ row: cell.row, column: cell.column });
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
