import type { ImportImagePixels } from './importRecognition';

/**
 * 分区相位场（方案 A，2026-11-16）：解决「实物拼豆照片只有一个区域能对齐」。
 *
 * 根因是模型表达力：单一刚性网格（一个 origin + 一个 cellSize）无法表达照片
 * 透视/镜头畸变带来的 ~1% 格距起伏——1% 看着小，63 列会累积漂移 ~9px ≈ 半格，
 * 于是只有锚定区附近对得齐，越远越歪（合成板实测：锚定区残差 0.02 格，
 * 对角区 1.02 格，见 .tmp/synth-perspective.mjs）。
 *
 * 方法：把图切成 tileCells×tileCells 格的小块，每块在暗线投影上做**局部相位
 * 相关**——对每条预测格线在 ±0.35 格窗口内找投影峰，峰位 - 预测位 = 该线偏移，
 * 取块内中位数得到块中心 (dx,dy)。采样格心时按双线性插值叠加偏移。
 *
 * 关键性质：
 *  - 格距/行列数/导出图纸完全不变，只动采样坐标（一张"贴上去的网格布"）；
 *  - 无透视时所有块偏移 < 0.12 格 → estimateGridWarp 返回 null，行为与
 *    现在逐位一致（图纸截图不受影响）；
 *  - 单块偏移 > 0.42 格视为相位滑锁（多半是格距错了），整体放弃返回 null
 *    ——宁可不对也不把错的场叠上去。
 */

export interface GridWarpField {
  /** 每块覆盖的格数（两轴相同）。 */
  tileCells: number;
  /** 水平/垂直块数。 */
  cols: number;
  rows: number;
  /** 估计时的网格锚点与格距（偏移场的图像空间坐标基准）。 */
  originX: number;
  originY: number;
  cellSize: number;
  /** 块中心处的偏移（图像像素），长度 cols*rows，索引 tj*cols+ti。 */
  dx: Float64Array;
  dy: Float64Array;
  /** 最大块偏移（格为单位），用于 UI 展示与启用判断。 */
  maxResidual: number;
}

/** 块偏移超过该格数视为相位滑锁，整体放弃（窗口是 ±0.35 格，留 0.07 余量）。 */
const PHASE_SLIP_LIMIT = 0.42;
/** 全场最大偏移低于该格数不值得启用（采样内缩后 0.12 格内基本无损）。 */
const ENABLE_MIN_RESIDUAL = 0.12;
/** 每块目标格数：块内弯曲 ≈ 全场漂移/块数，6 格块在 1% 透视下块内弯曲 < 0.1 格。 */
const TARGET_TILE_CELLS = 6;
const MIN_TILE_CELLS = 4;
const MAX_TILE_CELLS = 12;
/** 块内至少要这么多条有效峰线才可采信。 */
const MIN_VALID_LINES = 3;

interface AlignmentLike {
  originX: number;
  originY: number;
  cellSize: number;
}

/**
 * 单块的暗线投影：与 lineSpikeProfile 相同的"暗于两侧 ±3px"判据，
 * 但积分范围限制在块带内（避免邻块格线摊进本块的背景）。
 */
function tileLineProfile(source: ImportImagePixels, axis: 'x' | 'y', from: number, to: number): Float64Array {
  const { data, width, height } = source;
  const length = axis === 'x' ? width : height;
  const lines = axis === 'x' ? height : width;
  const lo = Math.max(0, Math.floor(from));
  const hi = Math.min(lines, Math.ceil(to));
  const profile = new Float64Array(length);
  const at = (line: number, i: number) => {
    const base = axis === 'x' ? (line * width + i) * 4 : (i * width + line) * 4;
    return (data[base] + data[base + 1] + data[base + 2]) / 3;
  };
  const step = hi - lo > 400 ? 2 : 1;
  for (let line = lo; line < hi; line += step) {
    for (let i = 3; i < length - 3; i += 1) {
      const center = at(line, i);
      if (at(line, i - 3) - center > 18 && at(line, i + 3) - center > 18) profile[i] += 1;
    }
  }
  return profile;
}

/** 抛物线亚像元内插：峰顶左右三点拟合顶点偏移。 */
function subpixelOffset(profile: Float64Array, peak: number): number | null {
  if (peak <= 0 || peak >= profile.length - 1) return 0;
  const left = profile[peak - 1];
  const right = profile[peak + 1];
  const denom = left - 2 * profile[peak] + right;
  if (denom >= 0) return 0;
  return Math.max(-1, Math.min(1, (0.5 * (left - right)) / denom));
}

/** 对块带内每条预测格线测偏移，返回中位数（无足够有效线返回 NaN）。 */
function tileAxisOffset(
  source: ImportImagePixels,
  axis: 'x' | 'y',
  bandFrom: number,
  bandTo: number,
  origin: number,
  cellSize: number,
  from: number,
  to: number,
  shift: number,
): number {
  const profile = tileLineProfile(source, axis, bandFrom, bandTo);
  let max = 0;
  for (let i = 0; i < profile.length; i += 1) max = Math.max(max, profile[i]);
  if (max <= 0) return NaN;
  const firstK = Math.ceil((from - origin - shift) / cellSize);
  const lastK = Math.floor((to - origin - shift) / cellSize);
  const offsets: number[] = [];
  for (let k = firstK; k <= lastK; k += 1) {
    const predicted = origin + shift + k * cellSize;
    if (predicted < 3 || predicted > profile.length - 4) continue;
    const window = Math.max(2, Math.round(cellSize * 0.35));
    const lo = Math.max(3, Math.round(predicted - window));
    const hi = Math.min(profile.length - 4, Math.round(predicted + window));
    let peak = lo;
    for (let i = lo; i <= hi; i += 1) if (profile[i] > profile[peak]) peak = i;
    if (profile[peak] < max * 0.2) continue;
    const fine = subpixelOffset(profile, peak);
    offsets.push(peak + (fine ?? 0) - predicted);
  }
  if (offsets.length < MIN_VALID_LINES) return NaN;
  offsets.sort((a, b) => a - b);
  return offsets[offsets.length >> 1];
}

/** 3×3 中值滤波（跳过 NaN：只对有效邻居取中位，全无效保持 NaN）。 */
function medianFill(field: Float64Array, cols: number, rows: number): void {
  const out = new Float64Array(field);
  for (let tj = 0; tj < rows; tj += 1) {
    for (let ti = 0; ti < cols; ti += 1) {
      if (!Number.isNaN(field[tj * cols + ti])) continue;
      const neighbors: number[] = [];
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          if (tj + dj < 0 || tj + dj >= rows || ti + di < 0 || ti + di >= cols) continue;
          const v = field[(tj + dj) * cols + (ti + di)];
          if (!Number.isNaN(v)) neighbors.push(v);
        }
      }
      if (neighbors.length >= 3) {
        neighbors.sort((a, b) => a - b);
        out[tj * cols + ti] = neighbors[neighbors.length >> 1];
      }
    }
  }
  field.set(out);
}

/** 把残余 NaN 块用全体有效值的中位数兜底；有效块 < 3 返回 false。 */
function fillRemaining(field: Float64Array): boolean {
  const valid = [...field].filter(v => !Number.isNaN(v));
  if (valid.length < 3) return false;
  valid.sort((a, b) => a - b);
  const med = valid[valid.length >> 1];
  for (let i = 0; i < field.length; i += 1) if (Number.isNaN(field[i])) field[i] = med;
  return true;
}

/** 调试出口：返回估计中间态（块原始偏移），业务不调用。 */
export function debugGridWarp(source: ImportImagePixels, alignment: AlignmentLike): { dx: Float64Array; dy: Float64Array; cols: number; rows: number; tile: number; slip: boolean } | null {
  return estimateGridWarpInternal(source, alignment);
}

function estimateGridWarpInternal(source: ImportImagePixels, alignment: AlignmentLike) {
  const { width, height } = source;
  const cellSize = alignment.cellSize;
  if (!(cellSize > 0) || width < cellSize * 2 || height < cellSize * 2) return null;
  const cellsX = width / cellSize;
  const cellsY = height / cellSize;
  const targetTiles = Math.max(3, Math.min(8, Math.round(Math.min(cellsX, cellsY) / TARGET_TILE_CELLS)));
  const tile = Math.max(MIN_TILE_CELLS, Math.min(MAX_TILE_CELLS, Math.floor(Math.min(cellsX, cellsY) / targetTiles)));
  const cols = Math.max(1, Math.floor(cellsX / tile));
  const rows = Math.max(1, Math.floor(cellsY / tile));
  if (cols < 2 && rows < 2) return null;
  const dx = new Float64Array(cols * rows).fill(NaN);
  const dy = new Float64Array(cols * rows).fill(NaN);
  let slip = false;
  for (let tj = 0; tj < rows && !slip; tj += 1) {
    for (let ti = 0; ti < cols && !slip; ti += 1) {
      const xFrom = alignment.originX + ti * tile * cellSize;
      const xTo = Math.min(width, xFrom + tile * cellSize);
      const yFrom = alignment.originY + tj * tile * cellSize;
      const yTo = Math.min(height, yFrom + tile * cellSize);
      const accX = ti > 0 ? dx[tj * cols + ti - 1] : (tj > 0 ? dx[(tj - 1) * cols] : 0);
      const accY = tj > 0 ? dy[(tj - 1) * cols + ti] : (ti > 0 ? dy[ti - 1] : 0);
      const baseX = Number.isNaN(accX) ? (tj > 0 && !Number.isNaN(dy[(tj - 1) * cols + ti]) ? dy[(tj - 1) * cols + ti] : 0) : accX;
      const baseY = Number.isNaN(accY) ? (ti > 0 && !Number.isNaN(dx[tj * cols + ti - 1]) ? dx[tj * cols + ti - 1] : 0) : accY;
      const ox = tileAxisOffset(source, 'x', yFrom, yTo, alignment.originX, cellSize, xFrom, xTo, baseX);
      const oy = tileAxisOffset(source, 'y', xFrom, xTo, alignment.originY, cellSize, yFrom, yTo, baseY);
      if (Number.isNaN(ox) || Number.isNaN(oy)) continue;
      if (Math.abs(ox) > cellSize * PHASE_SLIP_LIMIT || Math.abs(oy) > cellSize * PHASE_SLIP_LIMIT) { slip = true; break; }
      dx[tj * cols + ti] = baseX + ox;
      dy[tj * cols + ti] = baseY + oy;
    }
  }
  return { dx, dy, cols, rows, tile, slip };
}

function finishWarp(alignment: AlignmentLike, tile: number, cols: number, rows: number, dx: Float64Array, dy: Float64Array): GridWarpField | null {
  let maxResidual = 0;
  for (let i = 0; i < dx.length; i += 1) {
    maxResidual = Math.max(maxResidual, Math.abs(dx[i]), Math.abs(dy[i]));
  }
  const maxCells = maxResidual / alignment.cellSize;
  // 注意：这里不做全场滑锁否决——合法透视的全场漂移本来就 >0.4 格（那正是要修的目标）。
  // 滑锁防护靠估计时的单块 |增量| 检查（±0.35 格窗口内不可能测出更大的可信增量）。
  if (maxCells < ENABLE_MIN_RESIDUAL) return null;
  return {
    tileCells: tile, cols, rows,
    originX: alignment.originX, originY: alignment.originY, cellSize: alignment.cellSize,
    dx, dy, maxResidual: maxCells,
  };
}

/** 估计分区相位场；残差不足或证据不可信时返回 null（不启用）。 */
export function estimateGridWarp(
  source: ImportImagePixels,
  alignment: AlignmentLike,
): GridWarpField | null {
  const internal = estimateGridWarpInternal(source, alignment);
  if (!internal || internal.slip) return null;
  medianFill(internal.dx, internal.cols, internal.rows);
  medianFill(internal.dy, internal.cols, internal.rows);
  if (!fillRemaining(internal.dx) || !fillRemaining(internal.dy)) return null;
  return finishWarp(alignment, internal.tile, internal.cols, internal.rows, internal.dx, internal.dy);
}

/** 双线性插值取图像点 (x,y) 处的格偏移（返回图像像素偏移）。 */
export function warpOffsetAt(warp: GridWarpField, x: number, y: number): { dx: number; dy: number } {
  const sample = (field: Float64Array, cols: number, rows: number, u: number, v: number) => {
    const t = Math.max(0, Math.min(cols - 1, u));
    const s = Math.max(0, Math.min(rows - 1, v));
    const i0 = Math.floor(t); const j0 = Math.floor(s);
    const i1 = Math.min(cols - 1, i0 + 1); const j1 = Math.min(rows - 1, j0 + 1);
    const fx = t - i0; const fy = s - j0;
    const v00 = field[j0 * cols + i0]; const v10 = field[j0 * cols + i1];
    const v01 = field[j1 * cols + i0]; const v11 = field[j1 * cols + i1];
    return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
  };
  // 块 ti 的中心在格坐标 (ti+0.5)*tileCells 的格心 = 图像 (ti+0.5)*tileCells*cell + 0.5*cell
  const u = ((x - warp.originX) / warp.cellSize - 0.5) / warp.tileCells - 0.5;
  const v = ((y - warp.originY) / warp.cellSize - 0.5) / warp.tileCells - 0.5;
  return {
    dx: sample(warp.dx, warp.cols, warp.rows, u, v),
    dy: sample(warp.dy, warp.cols, warp.rows, u, v),
  };
}
