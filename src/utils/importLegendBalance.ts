import type { ImportRecognitionCell } from './importRecognition';
import { qualityFor } from './importRecognition';
import { deltaE2000, rgbToLab, type PreparedPaletteColor } from './colorUtils';

/**
 * 数量平衡（约束分配）：图例数量锁定把"每个色号恰好 N 粒"变成一次改写。
 *
 * 位置：整条 refine 链（shading → smooth → twinUnify；symbolAssist 路径在其
 * 覆写后）的**最后一步**，之后不再有任何阶段——任何"平衡在前、平滑在后"
 * 的顺序都会让邻域投票把刚让过来的格子再投回去（平衡目标色在局部可能是
 * 少数派），守卫形同虚设。放最后，结果即最终答案。
 *
 * 算法（迭代转让）：
 * 1. 统计 current[code]（按 code 计 mapped 格），与 quota 相减得 surplus/deficit；
 * 2. 每轮从 surplus 最大的色号出让格子：候选格按 (dominantRatio 升序,
 *    distance 降序) 排序——最没把握的先让；
 * 3. 目标色按 成本 = ΔE(采样色→目标色) − 相邻4格中目标色占比 × ADJ_BONUS
 *    选最小；加权上限 ≤ 6，不压过 ΔE 本身；
 * 4. 守卫：ΔE(采样色→目标色) > BAL_MAX_JUMP 的格子不可出让（只让"本来就
 *    半信半疑"的格子，不把错误放大到相邻色）；迭代上限 = Σsurplus + 8；
 * 5. 无可执行转让即停（satisfied=false + residual 如实上报）。
 *
 * 只让 surplus：色号永远不会被"让穿"到 target 以下，天然不需要出让比例上限。
 * Σquota < mapped 时余额格保持原分类（不发明"多余格"），residual 正值如实上报。
 */

/** 单格转让的距离守卫：采样色与目标色 ΔE2000 超过它就不许改写。 */
const BAL_MAX_JUMP = 25;
/** 相邻 4 格中目标色占比的加权上限（cost = ΔE − 占比 × ADJ_BONUS）。 */
const ADJ_BONUS = 6;

export interface BalanceResult {
  /** 改写后的新网格（未改动的格与输入共享引用；不改写输入数组）。 */
  cells: ImportRecognitionCell[][];
  /** 实际转让的格数。 */
  moved: number;
  /** 全部锁定配额恰好达成（所有 quota 色号 current == target）。 */
  satisfied: boolean;
  /** 未达成的 code → 差额（负 = 仍缺，正 = 超出）；为 0 的色号不出现。 */
  residual: Record<string, number>;
}

interface BalanceCellRef {
  rowIndex: number;
  columnIndex: number;
  cell: ImportRecognitionCell;
  lab: [number, number, number];
}

/**
 * 对已过全链的识别结果做数量平衡。
 *
 * @param cells refine 链最终输出（不会被改写）
 * @param quota code → 目标粒数（仅统计出现在 preparedPalette 内的 code）
 * @param preparedPalette 已锁定白名单的色板（Lab 预计算）
 */
export function applyCountBalance(
  cells: ImportRecognitionCell[][],
  quota: Record<string, number>,
  preparedPalette: PreparedPaletteColor[],
): BalanceResult {
  const byCode = new Map(preparedPalette.map(entry => [entry.color.code, entry]));
  const codeOfId = new Map(preparedPalette.map(entry => [entry.color.id, entry.color.code]));

  // 现状计数：按 code 统计 mapped 格。
  const current = new Map<string, number>();
  for (const row of cells) {
    for (const cell of row) {
      if (cell.status !== 'mapped' || !cell.colorId) continue;
      const code = codeOfId.get(cell.colorId);
      if (code) current.set(code, (current.get(code) ?? 0) + 1);
    }
  }

  // surplus / deficit：只统计 quota 里存在于色板的 code。
  const surplus = new Map<string, number>();
  const deficit = new Map<string, number>();
  let totalSurplus = 0;
  for (const [code, targetRaw] of Object.entries(quota)) {
    const target = Math.max(0, Math.round(Number(targetRaw) || 0));
    if (!byCode.has(code) || target === 0) continue;
    const cur = current.get(code) ?? 0;
    const over = cur - target;
    if (over > 0) { surplus.set(code, over); totalSurplus += over; }
    else if (over < 0) deficit.set(code, -over);
  }
  if (totalSurplus === 0 || deficit.size === 0) {
    return { cells, moved: 0, satisfied: isSatisfied(quota, byCode, current), residual: buildResidual(quota, byCode, current) };
  }

  // 每个 surplus 色号的可让格清单：dominantRatio 升序（最没把握的先让），
  // 同占比时 distance 降序，再按行列序保证确定性。
  const candidates = new Map<string, BalanceCellRef[]>();
  for (let rowIndex = 0; rowIndex < cells.length; rowIndex += 1) {
    const row = cells[rowIndex];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cell = row[columnIndex];
      if (cell.status !== 'mapped' || !cell.colorId || !cell.sampleRgb) continue;
      const code = codeOfId.get(cell.colorId);
      if (!code || !surplus.has(code)) continue;
      const list = candidates.get(code) ?? [];
      list.push({ rowIndex, columnIndex, cell, lab: rgbToLab(...cell.sampleRgb) });
      candidates.set(code, list);
    }
  }
  for (const [code, list] of candidates) {
    list.sort((a, b) => (a.cell.dominantRatio ?? 1) - (b.cell.dominantRatio ?? 1)
      || (b.cell.distance ?? 0) - (a.cell.distance ?? 0)
      || a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex);
    candidates.set(code, list);
  }

  // 固定遍历顺序：surplus 降序，同值按 code 升序（确定性）。
  const surplusOrder = [...surplus.keys()].sort((a, b) =>
    surplus.get(b)! - surplus.get(a)! || (a < b ? -1 : a > b ? 1 : 0));
  const deficitCodes = [...deficit.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // 输出网格：克隆外层数组与每一行，未改动的格共享引用——输入不被原地改写。
  const output: ImportRecognitionCell[][] = cells.map(row => row.slice());

  // 每格对每个 deficit 目标的 ΔE 只与格子有关，先算一遍（邻域占比每轮重算）。
  const targetLabs = new Map(deficitCodes.map(code => [code, byCode.get(code)!.lab]));

  /** 候选格是否已被让出：让出后网格里的对象被替换，按引用即可判别。 */
  const isConsumed = (code: string, index: number): boolean => {
    const list = candidates.get(code)!;
    const ref = list[index];
    return output[ref.rowIndex][ref.columnIndex] !== ref.cell;
  };

  let moved = 0;
  const remainingDeficit = new Map(deficit);
  const remainingSurplus = new Map(surplus);
  // 每个色号候选清单的扫描起点：让出的格永远在游标之前，不必回头。
  const cursor = new Map<string, number>();
  const iterationCap = totalSurplus + 8;
  for (let iteration = 0; iteration < iterationCap; iteration += 1) {
    let best: { code: string; ref: BalanceCellRef; target: string; cost: number; deltaE: number } | null = null;
    for (const code of surplusOrder) {
      if ((remainingSurplus.get(code) ?? 0) <= 0) continue;
      const list = candidates.get(code) ?? [];
      for (let index = cursor.get(code) ?? 0; index < list.length; index += 1) {
        if (isConsumed(code, index)) continue;
        const ref = list[index];
        for (const target of deficitCodes) {
          if ((remainingDeficit.get(target) ?? 0) <= 0) continue;
          const deltaE = deltaE2000(ref.lab, targetLabs.get(target)!);
          if (deltaE > BAL_MAX_JUMP) continue;
          const adjRatio = adjacentRatio(output, ref, codeOfId, target);
          const cost = deltaE - adjRatio * ADJ_BONUS;
          if (cost >= BAL_MAX_JUMP) continue;
          if (!best || cost < best.cost
            || (cost === best.cost && (deltaE < best.deltaE
              || (deltaE === best.deltaE && (ref.rowIndex < best.ref.rowIndex
                || (ref.rowIndex === best.ref.rowIndex && (ref.columnIndex < best.ref.columnIndex
                  || (ref.columnIndex === best.ref.columnIndex && target < best.target)))))))) {
            best = { code, ref, target, cost, deltaE };
          }
        }
      }
    }
    if (!best) break;
    // 执行转让：改写为新色号，distance 按新色号重算（ΔE 语义与 smoothCells/unify 一致）。
    const { code, ref, target } = best;
    const targetEntry = byCode.get(target)!;
    const distance = deltaE2000(ref.lab, targetEntry.lab);
    output[ref.rowIndex][ref.columnIndex] = {
      ...ref.cell,
      color: targetEntry.color,
      colorId: targetEntry.color.id,
      distance,
      quality: qualityFor(ref.cell.dominantRatio ?? 0, distance),
    };
    moved += 1;
    remainingSurplus.set(code, (remainingSurplus.get(code) ?? 0) - 1);
    remainingDeficit.set(target, (remainingDeficit.get(target) ?? 0) - 1);
  }

  const finalCount = recount(output, codeOfId);
  return {
    cells: output,
    moved,
    satisfied: isSatisfied(quota, byCode, finalCount),
    residual: buildResidual(quota, byCode, finalCount),
  };
}

/** 上下左右 4 格中已是目标色号的占比（未映射格不计入分母）。 */
function adjacentRatio(
  cells: ImportRecognitionCell[][],
  ref: BalanceCellRef,
  codeOfId: Map<string, string>,
  targetCode: string,
): number {
  let matched = 0;
  let total = 0;
  const neighbors: Array<ImportRecognitionCell | undefined> = [
    cells[ref.rowIndex - 1]?.[ref.columnIndex],
    cells[ref.rowIndex + 1]?.[ref.columnIndex],
    cells[ref.rowIndex]?.[ref.columnIndex - 1],
    cells[ref.rowIndex]?.[ref.columnIndex + 1],
  ];
  for (const neighbor of neighbors) {
    if (!neighbor || neighbor.status !== 'mapped' || !neighbor.colorId) continue;
    total += 1;
    if (codeOfId.get(neighbor.colorId) === targetCode) matched += 1;
  }
  return total === 0 ? 0 : matched / total;
}

function recount(cells: ImportRecognitionCell[][], codeOfId: Map<string, string>): Map<string, number> {
  const current = new Map<string, number>();
  for (const row of cells) {
    for (const cell of row) {
      if (cell.status !== 'mapped' || !cell.colorId) continue;
      const code = codeOfId.get(cell.colorId);
      if (code) current.set(code, (current.get(code) ?? 0) + 1);
    }
  }
  return current;
}

/** 全部 quota 色号 current == target 才算达成（恰好语义）。 */
function isSatisfied(
  quota: Record<string, number>,
  byCode: Map<string, PreparedPaletteColor>,
  current: Map<string, number>,
): boolean {
  for (const [code, targetRaw] of Object.entries(quota)) {
    const target = Math.max(0, Math.round(Number(targetRaw) || 0));
    if (!byCode.has(code) || target === 0) continue;
    if ((current.get(code) ?? 0) !== target) return false;
  }
  return true;
}

/** 未达成色号的差额（负 = 仍缺，正 = 超出）；0 不出现。 */
function buildResidual(
  quota: Record<string, number>,
  byCode: Map<string, PreparedPaletteColor>,
  current: Map<string, number>,
): Record<string, number> {
  const residual: Record<string, number> = {};
  for (const [code, targetRaw] of Object.entries(quota)) {
    const target = Math.max(0, Math.round(Number(targetRaw) || 0));
    if (!byCode.has(code) || target === 0) continue;
    const diff = (current.get(code) ?? 0) - target;
    if (diff !== 0) residual[code] = diff;
  }
  return residual;
}
