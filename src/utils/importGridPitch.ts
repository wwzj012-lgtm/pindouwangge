import type { ImportImagePixels } from './importRecognition';

/**
 * 从照片里估"豆距"（一颗珠子占多少像素）。
 *
 * 这是用户最容易搞错、也最难自查的一步：坐标对了，但格数填成实际豆数的一半，
 * 每格就摊上 4~5 颗豆，识别结果必然是"糊的"——而且看起来仍然像对上了，
 * 因为网格线依然均匀。实测一张 908×1047 的成品照，用户填 44 列，
 * 而豆距只有 9 px（实际约 101 列），整张就糊成一团。
 *
 * 方法：先做高通（减去局部均值）去掉光照渐变，再算归一化自相关，
 * 取"第一个显著峰"作为基本周期。不能用"平均绝对差最小"那种做法——
 * 那样小位移永远更相似，平滑区域会一路收敛到 4 px。
 *
 * 结果只作为**建议**：置信度低时界面不该自动套用。
 */

export interface BeadPitchEstimate {
  /** 建议的方格边长（像素），已取横纵平均。 */
  cell: number;
  cellX: number;
  cellY: number;
  /** 0~1 的自相关系数，越大越可信；低于 0.2 建议不要直接采用。 */
  confidence: number;
  columns: number;
  rows: number;
}

const MIN_PITCH = 5;
const MAX_PITCH = 64;
const SAMPLE_LINES = 40;
/** 取"最强峰的这个比例"以上的最小峰，避免把两格并成一格。 */
const HARMONIC_RATIO = 0.85;

/**
 * 一条线的"边缘强度"序列：相邻像素亮度差的绝对值，再减去自身的均值。
 *
 * 两个坑都踩过：
 *  - 用原始亮度做自相关，小位移永远更相似（渐变图会一路收敛到 5 px），必须在高通之后做；
 *  - 用带符号的一阶差分做高通，边界两侧"变亮/变暗"的符号随机，自相关会被正负抵消，
 *    结果跑到周期的整数倍上。取绝对值就没有符号问题：每颗豆的边界都变成一个正尖峰。
 *
 * 减均值是为了去掉"整体有多粗糙"这个直流分量，只留下周期结构；
 * 完全平滑的渐变图会因此归零，置信度自然很低。
 */
function edgeLine(source: ImportImagePixels, axis: 'x' | 'y', line: number): Float32Array {
  const { data, width, height } = source;
  const length = axis === 'x' ? width : height;
  const base = axis === 'x' ? line * width : line;
  const stride = axis === 'x' ? 1 : width;
  const values = new Float32Array(length);
  let sum = 0;
  for (let i = 0; i + 1 < length; i += 1) {
    const a = (base + i * stride) * 4;
    const b = (base + (i + 1) * stride) * 4;
    const lumaA = 0.2126 * data[a] + 0.7152 * data[a + 1] + 0.0722 * data[a + 2];
    const lumaB = 0.2126 * data[b] + 0.7152 * data[b + 1] + 0.0722 * data[b + 2];
    values[i] = Math.abs(lumaB - lumaA);
    sum += values[i];
  }
  const mean = sum / Math.max(1, length - 1);
  for (let i = 0; i + 1 < length; i += 1) values[i] -= mean;
  return values;
}

interface AxisResult {
  lag: number;
  correlation: number;
}

function bestLag(source: ImportImagePixels, axis: 'x' | 'y'): AxisResult | null {
  const length = axis === 'x' ? source.width : source.height;
  const maxLag = Math.min(MAX_PITCH, Math.floor(length / 5));
  if (maxLag <= MIN_PITCH) return null;
  const lines = axis === 'x' ? source.height : source.width;
  const step = Math.max(1, Math.floor(lines / SAMPLE_LINES));

  const numerator = new Float64Array(maxLag + 1);
  let denominator = 0;
  let sampled = 0;
  for (let line = 0; line < lines; line += step) {
    const series = edgeLine(source, axis, line);
    let energy = 0;
    for (let i = 0; i + 1 < series.length; i += 1) energy += series[i] * series[i];
    if (energy <= 0) continue;
    sampled += 1;
    denominator += energy;
    for (let lag = MIN_PITCH; lag <= maxLag; lag += 1) {
      let sum = 0;
      for (let i = 0; i + lag < series.length - 1; i += 1) sum += series[i] * series[i + lag];
      numerator[lag] += sum;
    }
  }
  if (sampled === 0 || denominator <= 0) return null;

  const rho: number[] = [];
  for (let lag = MIN_PITCH; lag <= maxLag; lag += 1) rho[lag] = numerator[lag] / denominator;

  // 找局部极大：豆距是峰值，它的整数倍也是峰值；取"够强且最小"的那个。
  // 平台也要算峰：完全规则的图样，ρ(9)、ρ(10) 可能一模一样，
  // 用严格大于会把整个平台跳过，最后落到 4× 周期上去。
  const peaks: AxisResult[] = [];
  for (let lag = MIN_PITCH + 1; lag < maxLag; lag += 1) {
    if (rho[lag] >= rho[lag - 1] && rho[lag] >= rho[lag + 1] && rho[lag] > 0.06) {
      const previous = peaks[peaks.length - 1];
      if (previous && previous.correlation === rho[lag] && lag - previous.lag <= 2) continue;
      peaks.push({ lag, correlation: rho[lag] });
    }
  }
  if (peaks.length === 0) {
    let best = MIN_PITCH;
    for (let lag = MIN_PITCH; lag <= maxLag; lag += 1) if (rho[lag] > rho[best]) best = lag;
    return { lag: best, correlation: Math.max(0, rho[best]) };
  }
  const strongest = Math.max(...peaks.map(peak => peak.correlation));
  const winner = peaks.find(peak => peak.correlation >= strongest * HARMONIC_RATIO) ?? peaks[0];
  return { lag: winner.lag, correlation: Math.min(1, winner.correlation) };
}

export function estimateBeadPitch(source: ImportImagePixels): BeadPitchEstimate | null {
  if (!source || !source.data || source.width < 40 || source.height < 40) return null;
  const x = bestLag(source, 'x');
  const y = bestLag(source, 'y');
  if (!x || !y) return null;
  const cell = (x.lag + y.lag) / 2;
  return {
    cell,
    cellX: x.lag,
    cellY: y.lag,
    confidence: Math.min(x.correlation, y.correlation),
    columns: Math.max(1, Math.round(source.width / cell)),
    rows: Math.max(1, Math.round(source.height / cell)),
  };
}
