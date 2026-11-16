import type { ImportImagePixels } from './importRecognition';

/**
 * 从图片里估"豆距"（一颗珠子/一个格子占多少像素）。
 *
 * 这是用户最容易搞错、也最难自查的一步：坐标对了，但格数填成实际豆数的一半，
 * 每格就摊上 4~5 颗豆，识别结果必然是"糊的"——而且看起来仍然像对上了。
 *
 * v2：色差直方图 + 自相关 + 分数周期精修。
 * 旧版对若干条亮度边缘线逐条做自相关再平均——印刷图纸上有大量色号文字，
 * 文字笔画的自相关（笔画间距 ~10px）盖过了格线周期，妲己图实测报 10px、置信度 3%。
 *
 * 新方法的关键是把**整幅图折叠成一条一维曲线**再自相关：
 *  - colDiff[x] = 所有行在 (x-1,x) 处的颜色差之和。格边界在每个行位置都产生
 *    一道边，求和后**相干叠加**成尖峰；文字边缘位置随行漂移，求和后摊成背景。
 *  - 对这条曲线做自相关，峰值就是格距；再用相位相干搜索把整数周期精修到
 *    分数精度（印刷图纸格距 29.60 这种）。
 *
 * v2.1 增加两道护栏：
 *  - 拼豆网格必是正方形：横纵格距不一致的图（文字密集/格内纹理干扰）说明
 *    至少一轴锁错了周期，此时置信度强制压到自动套用门槛之下——宁可让用户
 *    手动校准，也不把半对半错的数字当"已检测"交付。
 *  - 多并保护：格内带纹理的图纸（十字绣 × 纹、网点印刷）会让 2× 大格在
 *    "格内平滑度"类判据下反超真格距；cell 恰为两轴中较小周期的 2 倍时
 *    按风险压低置信度。
 *
 * v2.2 新增"暗线投影"证据源，并让它**优先于**色差剖面：
 *  色差剖面（diffProfile）对"相邻像素色差大的位置"积分——格线和文字边缘
 *  都贡献，十字绣图纸的密集文字能把自相关整个带偏（小马图真值 9.6px，
 *  x 轴侥幸命中、y 轴锁到 2× 的 20.2，护栏只能拒绝不能纠错）。
 *  暗线投影换了一个物理量：格线是"暗于两侧 ±3px 邻域"的贯穿细线，
 *  逐像素统计后文字（不成贯穿线）被摊成背景，格线（每行都在）相干叠加。
 *  实测妲己图 29.6/29.62 相干 0.985/0.992、小马图 9.6/9.6 相干 0.965/0.788，
 *  两条基准一次全中。暗线峰不足（无格线的照片/截图）时自动回落旧路径。
 *
 * 结果只作为**建议**：置信度低时界面不该自动套用。
 */

export interface BeadPitchEstimate {
  /** 建议的方格边长（像素），已取横纵平均。 */
  cell: number;
  cellX: number;
  cellY: number;
  /** 格线相位原点（0 ≤ origin < pitch）：真实格线落在 origin + k·pitch 处。 */
  originX: number;
  originY: number;
  /**
   * 相位证据是否可信（分轴）。
   *
   * 初音图（131×151 格、格距 9.9px）实测教训：格线太浅/太密时暗线证据弱
   * （y 轴相干 0.641 勉强过线、x 轴覆盖率 0.55 被拒回落色差剖面），两条
   * 路径给出的相位（originX=0.4/originY=4.6）是文字污染下的垃圾相位——
   * 格距碰巧对、相位整格错，套用后 152 行 vs 真值 151 行。相位只有在
   * 强证据（暗线路径、相干×内点 ≥0.7）下才值得交付；弱证据轴应保留
   * 用户手动对齐的位置。
   */
  originTrustedX: boolean;
  originTrustedY: boolean;
  /** 0~1，自相关强度 × 峰位回归的内点率，越大越可信；低于 0.15 建议不要直接采用。 */
  confidence: number;
  columns: number;
  rows: number;
}

const MIN_PITCH = 5;
const MAX_PITCH = 64;
/** 取"最强峰的这个比例"以上的最小峰，避免把两格并成一格。 */
const HARMONIC_RATIO = 0.85;
/** 自相关峰的最低门槛：低于此不认为是周期结构。 */
const PEAK_MIN_RHO = 0.06;
/** 峰位回归时，偏离拟合周期超过该比例的尖峰按离群点剔除。 */
const REFINE_OUTLIER_RATIO = 0.25;
/** 两轴一致判定：正方形网格的横纵格距必须相等（相对容差）。 */
const AXIS_AGREEMENT_RATIO = 0.08;
/** 暗线证据的采信门槛：峰数、相位相干度不足时回落到色差剖面旧路径。 */
const LINE_MIN_SPIKES = 6;
const LINE_COHERENCE_MIN = 0.45;
/** 覆盖率门槛：选中周期的预期格线列至少要有多少被实际峰占住。 */
const LINE_COVERAGE_MIN = 0.6;
/** 相位交付门槛：暗线证据的相干×内点达到此值才把相位交给用户自动套用。 */
const ORIGIN_TRUST_MIN = 0.7;

/**
 * 一条轴的"颜色差剖面"：相邻像素的通道差绝对值之和，沿另一轴全部累加。
 * （旧版逐线做自相关再平均，文字线会主导结果；这里先求和再自相关，
 * 让"每行都在同一位置出现"的格边界相干叠加，文字边缘摊成背景。）
 */
function diffProfile(source: ImportImagePixels, axis: 'x' | 'y'): Float64Array {
  const { data, width, height } = source;
  const length = axis === 'x' ? width : height;
  const lines = axis === 'x' ? height : width;
  const stride = axis === 'x' ? 1 : width;
  const profile = new Float64Array(length);
  // 逐线全量太慢没必要，隔行采样对相干峰毫无影响
  const step = lines > 400 ? 2 : 1;
  for (let line = 0; line < lines; line += step) {
    const base = axis === 'x' ? line * width : line;
    for (let i = 1; i < length; i += 1) {
      const a = (base + (i - 1) * stride) * 4;
      const b = (base + i * stride) * 4;
      profile[i] += Math.abs(data[b] - data[a]) + Math.abs(data[b + 1] - data[a + 1]) + Math.abs(data[b + 2] - data[a + 2]);
    }
  }
  return profile;
}

/** 剖面里的显著尖峰位置（局部极大、高于背景均值 + 3×MAD），按位置升序。 */
function profilePeaks(profile: Float64Array): number[] {
  let sum = 0;
  for (let i = 1; i < profile.length; i += 1) sum += profile[i];
  const count = profile.length - 1;
  const mean = sum / Math.max(1, count);
  const deviations = new Float64Array(count);
  for (let i = 1; i < profile.length; i += 1) deviations[i - 1] = Math.abs(profile[i] - mean);
  deviations.sort();
  const mad = deviations[Math.floor(count * 0.5)] || 0;
  const threshold = mean + mad * 3;
  const peaks: number[] = [];
  for (let i = 2; i < profile.length - 2; i += 1) {
    if (profile[i] < threshold) continue;
    if (profile[i] >= profile[i - 1] && profile[i] >= profile[i + 1]
      && profile[i] >= profile[i - 2] && profile[i] >= profile[i + 2]) {
      const last = peaks[peaks.length - 1];
      // 格线宽 2~3px 时剖面上会出成对极大（妲己图 147/150、295/298），
      // 必须并成一个峰，否则 30px 的间距被劈成 27+3，中位数初值直接失真
      if (last !== undefined && i - last <= 4) {
        if (profile[i] > profile[last]) peaks[peaks.length - 1] = i;
        continue;
      }
      peaks.push(i);
    }
  }
  return peaks;
}

interface AxisResult {
  pitch: number;
  correlation: number;
  /** 相位原点（0 ≤ origin < pitch），refinePitch 失败时为 null。 */
  origin: number | null;
}

/**
 * 暗线投影：统计每个坐标上"显著暗于两侧 ±3px 邻域"的像素数。
 *
 * 格线（印刷网格的深色细线）在每个采样位置都出现 → 沿轴积分后相干叠加成峰列；
 * 文字笔画短、不成贯穿线，位置又随行漂移 → 积分后摊成背景。
 * 邻距取 3px：格线宽 1~3px，太近分不出"线与底"，太远会跨进邻格。
 */
function lineSpikeProfile(source: ImportImagePixels, axis: 'x' | 'y'): Float64Array {
  const { data, width, height } = source;
  const length = axis === 'x' ? width : height;
  const lines = axis === 'x' ? height : width;
  const profile = new Float64Array(length);
  const at = (line: number, i: number) => {
    const base = axis === 'x' ? (line * width + i) * 4 : (i * width + line) * 4;
    return (data[base] + data[base + 1] + data[base + 2]) / 3;
  };
  // 大图隔线采样：投影峰是全轴积分，减半采样对峰形毫无影响
  const step = lines > 400 ? 2 : 1;
  for (let line = 0; line < lines; line += step) {
    for (let i = 3; i < length - 3; i += 1) {
      const center = at(line, i);
      if (at(line, i - 3) - center > 18 && at(line, i + 3) - center > 18) profile[i] += 1;
    }
  }
  return profile;
}

/** 暗线峰：局部极大（±4px）高于投影最大值的 25%，近邻（≤5px）并入最高峰。 */
function lineSpikes(source: ImportImagePixels, axis: 'x' | 'y'): number[] {
  return lineSpikesWithStrength(source, axis).map(spike => spike.position);
}

/**
 * 带强度的暗线峰。强度 = 该列暗线像素数 / 投影最大值（0~1）。
 *
 * 实物拼豆板的判别关键（2026-11-16 合成板实测）：缝列（珠间隙，贯穿全高）
 * 强度 ≈1.0，孔列（每颗豆中心的小孔，只在孔位行变暗）强度 ≈0.26——
 * 孔列在真周期处与缝列反相，把相干度破坏到 ~0.59，而半周期处全部同相
 * （相干 1.0、覆盖 1.0），估算器高置信锁死半周期（真值 17.05 估成 8.5）。
 */
function lineSpikesWithStrength(source: ImportImagePixels, axis: 'x' | 'y'): Array<{ position: number; weight: number }> {
  const profile = lineSpikeProfile(source, axis);
  let max = 0;
  for (let i = 0; i < profile.length; i += 1) max = Math.max(max, profile[i]);
  if (max <= 0) return [];
  const threshold = max * 0.25;
  const spikes: Array<{ position: number; weight: number }> = [];
  for (let i = 5; i < profile.length - 5; i += 1) {
    if (profile[i] < threshold) continue;
    let isPeak = true;
    for (let d = -4; d <= 4; d += 1) {
      if (d !== 0 && profile[i + d] > profile[i]) { isPeak = false; break; }
    }
    if (!isPeak) continue;
    const last = spikes[spikes.length - 1];
    if (last !== undefined && i - last.position <= 5) {
      if (profile[i] > profile[last.position]) spikes[spikes.length - 1] = { position: i, weight: profile[i] / max };
      continue;
    }
    spikes.push({ position: i, weight: profile[i] / max });
  }
  return spikes;
}

function phaseCoherence(spikes: number[], pitch: number): number {
  let cosSum = 0;
  let sinSum = 0;
  for (const position of spikes) {
    const angle = (2 * Math.PI * position) / pitch;
    cosSum += Math.cos(angle);
    sinSum += Math.sin(angle);
  }
  return Math.hypot(cosSum, sinSum) / spikes.length;
}

/**
 * 暗线证据的独立估算：峰列在真周期处相位完全对齐，全范围扫描（步长 0.02px）。
 *
 * **约数陷阱**：等间距峰列在真周期的任何约数 p/n 处相位相干同样满分
 * （pos = origin + k·p 取 p/2 时相位只差常数项），相干度根本区分不了
 * 29.6 与 14.8（妲己图实测锁错半格，52 格会被切成 106 格）。能区分它们
 * 的是**覆盖率**：真周期下峰数 ≈ 图纸跨度/p（每条预期格线都有峰）；
 * 约数下预期线数翻倍、峰数不变（coverage → 1/n）。在相干满分候选里
 * 取覆盖率最高者，两种失败模式（漏峰锁 2×、整除锁 1/2）一并排除。
 */
function estimateAxisByLines(source: ImportImagePixels, axis: 'x' | 'y'): AxisResult | null {
  const spikeData = lineSpikesWithStrength(source, axis);
  const spikes = spikeData.map(spike => spike.position);
  if (spikes.length < LINE_MIN_SPIKES) return null;
  const span = Math.max(1, spikes[spikes.length - 1] - spikes[0]);
  let maxCoherence = 0;
  for (let p = MIN_PITCH; p <= MAX_PITCH; p += 0.02) {
    const coherence = phaseCoherence(spikes, p);
    if (coherence > maxCoherence) maxCoherence = coherence;
  }
  if (maxCoherence < LINE_COHERENCE_MIN) return null;
  // 相干满分（±5%）候选里选覆盖率最高；并列时取更大周期（宁真勿细）
  let bestPitch = 0;
  let bestCoverage = 0;
  for (let p = MIN_PITCH; p <= MAX_PITCH; p += 0.02) {
    if (phaseCoherence(spikes, p) < maxCoherence * 0.95) continue;
    const coverage = Math.min(1, ((spikes.length - 1) * p) / span);
    if (coverage > bestCoverage + 1e-9) { bestCoverage = coverage; bestPitch = p; }
  }
  if (bestPitch === 0 || bestCoverage < LINE_COVERAGE_MIN) return null;
  // 孔洞交替：实物拼豆板豆心孔列与缝列在半周期处同相骗过相干+覆盖裁决
  // （合成板实测 17.05→8.5 conf 0.96），强弱交替 + 强类 2p 相干一致才翻倍。
  // 翻倍后只用强类（缝列）精修周期与原点——孔列在真周期处反相，
  // 混进内点率会把解拖回 null（12.7 板实测回落色差剖面 37.3）。
  const alternation = detectHoleAlternation(spikeData, bestPitch);
  if (alternation) {
    const doubled = refinePitch(alternation, bestPitch * 2);
    if (!doubled) return null;
    return { pitch: doubled.pitch, correlation: Math.min(1, maxCoherence * doubled.inlierRatio), origin: doubled.origin };
  }
  // 相位均值 → 原点
  let cosSum = 0;
  let sinSum = 0;
  for (const position of spikes) {
    const angle = (2 * Math.PI * position) / bestPitch;
    cosSum += Math.cos(angle);
    sinSum += Math.sin(angle);
  }
  let origin = (Math.atan2(sinSum, cosSum) / (2 * Math.PI)) * bestPitch;
  if (origin < 0) origin += bestPitch;
  // 内点率：偏离格线列 ≥25% 周期的峰视为离群
  let matched = 0;
  for (const position of spikes) {
    const k = Math.round((position - origin) / bestPitch);
    if (k >= 1 && Math.abs(position - (origin + k * bestPitch)) <= bestPitch * REFINE_OUTLIER_RATIO) matched += 1;
  }
  const inlierRatio = matched / spikes.length;
  if (inlierRatio < 0.5) return null;
  return { pitch: bestPitch, correlation: Math.min(1, maxCoherence * inlierRatio), origin };
}


/**
 * 孔洞交替检测：半周期假解的判别（2026-11-16 实物拼豆板实测）。
 *
 * 拼豆板每个豆心的小孔在暗线投影里形成与缝列交替的**弱**峰列：半周期处
 * 缝+孔全部同相（相干 1.0、覆盖 1.0，覆盖率裁决失效），真周期处孔列反相
 * 相干崩塌。判据：按 bestPitch 把峰分成奇偶两类，若两类**强度**系统性
 * 悬殊（弱/强 ≤0.55）且强类在 2×bestPitch 处相位高度一致，则真周期翻倍——
 * 印刷图纸的均匀格线两类强度接近，不会误翻。
 */
function detectHoleAlternation(
  spikeData: Array<{ position: number; weight: number }>,
  pitch: number,
): number[] | null {
  const assigned = spikeData
    .map(spike => ({ ...spike, k: Math.round(spike.position / pitch) }))
    .filter(spike => Math.abs(spike.position - spike.k * pitch) <= pitch * REFINE_OUTLIER_RATIO);
  const even = assigned.filter(spike => spike.k % 2 === 0);
  const odd = assigned.filter(spike => spike.k % 2 !== 0);
  if (even.length < 2 || odd.length < 2) return null;
  const mean = (list: typeof assigned) => list.reduce((sum, spike) => sum + spike.weight, 0) / list.length;
  const meanEven = mean(even);
  const meanOdd = mean(odd);
  const ratio = Math.min(meanEven, meanOdd) / Math.max(meanEven, meanOdd);
  if (ratio > 0.55) return null;
  // 强类在 2×pitch 处必须相位一致（孔洞假设下强类=真格线）
  const strong = meanEven >= meanOdd ? even : odd;
  let cosSum = 0;
  let sinSum = 0;
  for (const spike of strong) {
    const angle = (2 * Math.PI * spike.position) / (2 * pitch);
    cosSum += Math.cos(angle);
    sinSum += Math.sin(angle);
  }
  if (Math.hypot(cosSum, sinSum) / strong.length < 0.85) return null;
  return strong.map(spike => spike.position);
}

function estimateAxis(profile: Float64Array, length: number): AxisResult | null {
  const maxLag = Math.min(MAX_PITCH, Math.floor(length / 5));
  if (maxLag <= MIN_PITCH) return null;

  // 去均值后的自相关：完全平滑的剖面（渐变图）能量为零，直接放弃
  let mean = 0;
  for (let i = 1; i < length; i += 1) mean += profile[i];
  mean /= Math.max(1, length - 1);
  let energy = 0;
  for (let i = 1; i < length; i += 1) { const v = profile[i] - mean; energy += v * v; }
  if (energy <= 0) return null;

  const rho: number[] = [];
  for (let lag = MIN_PITCH; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 1; i + lag < length; i += 1) sum += (profile[i] - mean) * (profile[i + lag] - mean);
    rho[lag] = sum / energy;
  }

  // 局部极大中取"够强且最小"的峰：格距的整数倍也是峰，宁细勿粗
  const peaks: Array<{ lag: number; rho: number }> = [];
  for (let lag = MIN_PITCH + 1; lag < maxLag; lag += 1) {
    if (rho[lag] >= rho[lag - 1] && rho[lag] >= rho[lag + 1] && rho[lag] > PEAK_MIN_RHO) {
      const previous = peaks[peaks.length - 1];
      if (previous && Math.abs(previous.rho - rho[lag]) < 1e-12 && lag - previous.lag <= 2) continue;
      peaks.push({ lag, rho: rho[lag] });
    }
  }
  let integerLag: number;
  let confidence: number;
  if (peaks.length === 0) {
    let best = MIN_PITCH;
    for (let lag = MIN_PITCH; lag <= maxLag; lag += 1) if (rho[lag] > rho[best]) best = lag;
    if (rho[best] <= 0) return null;
    integerLag = best;
    confidence = rho[best];
  } else {
    const strongest = Math.max(...peaks.map(peak => peak.rho));
    const winner = peaks.find(peak => peak.rho >= strongest * HARMONIC_RATIO) ?? peaks[0];
    integerLag = winner.lag;
    confidence = Math.min(1, winner.rho);
  }

  // 分数周期精修：用剖面的真实尖峰位置做相位相干搜索。
  // 印刷图纸的格距普遍不是整数（妲己图 29.60），整数自相关只能给出 29~30。
  const refined = refinePitch(profilePeaks(profile), integerLag);
  if (refined) {
    return { pitch: refined.pitch, correlation: Math.min(1, confidence * refined.inlierRatio), origin: refined.origin };
  }
  return { pitch: integerLag, correlation: Math.min(1, confidence), origin: null };
}

/**
 * 已知整数周期 lag，用尖峰位置的相位相干搜索精修分数周期。
 *
 * 原理：pos = origin + k·pitch 的尖峰，对真周期取模后全部同相；
 * 相干分数 |Σe^(2πi·pos/p)| / n 在真周期处最大。搜索窗口 ±1.5px、步长 0.02px。
 *
 * 为什么不用"指派 k → 最小二乘"：整数初值 30 对真周期 29.6，在第 52 个格
 * 处累积漂移 20px，指派会错（1539 被指到 k=51 而非 52），一个错点就把
 * 斜率拽到 30.2（妲己图列方向实测）。相位法逐点独立取模，无累积漂移问题。
 *
 * 相干分数在真周期与其整数倍/约简处也会偏高，但窗口只有
 * ±1.5px，最近的退化解也远在窗外。返回 null 表示尖峰太少或内点率太低。
 */
function refinePitch(spikes: number[], lag: number): { pitch: number; origin: number; inlierRatio: number } | null {
  if (spikes.length < 3) return null;
  let bestPitch = lag;
  let bestScore = -1;
  for (let p = lag - 1.5; p <= lag + 1.5; p += 0.02) {
    let cosSum = 0, sinSum = 0;
    for (const position of spikes) {
      const angle = (2 * Math.PI * position) / p;
      cosSum += Math.cos(angle);
      sinSum += Math.sin(angle);
    }
    const score = Math.hypot(cosSum, sinSum) / spikes.length;
    if (score > bestScore) { bestScore = score; bestPitch = p; }
  }
  // 相位均值 → 原点
  let cosSum = 0, sinSum = 0;
  for (const position of spikes) {
    const angle = (2 * Math.PI * position) / bestPitch;
    cosSum += Math.cos(angle);
    sinSum += Math.sin(angle);
  }
  let origin = (Math.atan2(sinSum, cosSum) / (2 * Math.PI)) * bestPitch;
  if (origin < 0) origin += bestPitch;
  // 内点率进置信度：文字噪声峰多时压低置信
  let matched = 0;
  for (const position of spikes) {
    const k = Math.round((position - origin) / bestPitch);
    if (k >= 1 && Math.abs(position - (origin + k * bestPitch)) <= bestPitch * REFINE_OUTLIER_RATIO) matched += 1;
  }
  const inlierRatio = matched / spikes.length;
  if (inlierRatio < 0.5) return null;
  return { pitch: bestPitch, origin, inlierRatio };
}

/** 诊断导出：暴露某条轴的尖峰位置与估算结果（豆距调试用，不参与业务）。 */
export function debugPitchAxis(source: ImportImagePixels, axis: 'x' | 'y'): {
  spikes: number[];
  estimate: AxisResult | null;
  profile: Float64Array;
} {
  const profile = diffProfile(source, axis);
  return { spikes: profilePeaks(profile), estimate: estimateAxis(profile, axis === 'x' ? source.width : source.height), profile };
}

export function estimateBeadPitch(source: ImportImagePixels): BeadPitchEstimate | null {
  if (!source || !source.data || source.width < 40 || source.height < 40) return null;
  // 精修到 1 位小数：与向导的输入精度一致，也保证合成测试里 9.0 === 9
  const round1 = (value: number) => Number(value.toFixed(1));
  // v2.2：暗线证据优先（格线位置是直接观测，不是周期猜测），
  // 峰不足或相干不够时回落 v2 色差剖面路径
  const xLines = estimateAxisByLines(source, 'x');
  const x = xLines ?? estimateAxis(diffProfile(source, 'x'), source.width);
  const yLines = estimateAxisByLines(source, 'y');
  const y = yLines ?? estimateAxis(diffProfile(source, 'y'), source.height);
  if (!x || !y) return null;
  const cellX = round1(x.pitch);
  const cellY = round1(y.pitch);
  const cell = round1((cellX + cellY) / 2);
  // 相位信任（分轴）：只有暗线路径的强证据（相干×内点 ≥0.7）才交付相位；
  // 色差剖面的相位被文字污染后是随机的（初音图 originY=4.6 整格错的实测），
  // 格距碰巧能对、相位不能要——套用方对不信任的轴保留用户手动位置。
  const originTrustedX = xLines !== null && xLines.origin !== null && xLines.correlation >= ORIGIN_TRUST_MIN;
  const originTrustedY = yLines !== null && yLines.origin !== null && yLines.correlation >= ORIGIN_TRUST_MIN;
  // 护栏 1（正方形一致）：两轴各锁到差 8% 以上的周期，至少一轴是文字/纹理
  // 伪峰（平均之后两边都不沾）——压到门槛之下不自动套用，交给用户手动校准。
  const axisAgreement = Math.abs(cellX - cellY) / Math.max(cellX, cellY) <= AXIS_AGREEMENT_RATIO;
  // 护栏 2（多并风险）：cell 恰约为两轴中较小周期的 2 倍时，可能是把 2×2 豆
  // 并成了一格（十字绣纹理图的实测失败模式）。按风险压置信度。
  const halfOf = Math.min(x.pitch, y.pitch);
  const multiMergeRisk = Math.abs(cell - halfOf * 2) / cell <= AXIS_AGREEMENT_RATIO;
  const guard = axisAgreement ? (multiMergeRisk ? 0.35 : 1) : 0.3;
  // 相位原点按取整后的 cell 归一到 [0, cell)，保证与套用的格距自洽
  const wrap = (origin: number | null) => round1(origin === null ? 0 : ((origin % cell) + cell) % cell);
  return {
    cell,
    cellX,
    cellY,
    originX: wrap(x.origin),
    originY: wrap(y.origin),
    originTrustedX,
    originTrustedY,
    confidence: Math.min(x.correlation, y.correlation) * guard,
    columns: Math.max(1, Math.round(source.width / cell)),
    rows: Math.max(1, Math.round(source.height / cell)),
  };
}

export interface GridAlignmentRefinement {
  applied: boolean;
  cell: number;
  originX: number;
  originY: number;
  /** 0~1，两轴相干度×内点率的较小者；仅供展示。 */
  confidence: number;
  coherenceX: number;
  coherenceY: number;
  /** 横纵格距差超 1.5%：图大概率被非等比拉伸，正方形网格只能近似对齐。 */
  stretched: boolean;
  /** 可直接展示的人话结论（失败原因或成功摘要的统计部分）。 */
  message: string;
}

/**
 * 单轴局部精修：以当前对齐的格距为先验，只在 ±8% 窗口内搜索。
 *
 * 为什么不用 estimateBeadPitch 的全范围扫描：全局扫描要面对约数陷阱
 * （29.6 与 14.8 相位相干同样满分，必须靠覆盖率裁决），而用户已经手动
 * 对齐过大方向，真周期必然在当前值的 ±8% 内——14.8 距 29.6 有 50%，
 * 根本进不了窗口，约数陷阱在物理上被排除，覆盖率裁决也不需要了。
 * 步长 0.01px（印刷图纸格距 29.60 这类小数也能锁准）。
 *
 * 相位原点取峰列相位均值（全图所有格线的最优对齐），而非当前 origin——
 * 用户手动只对齐了局部，远端漂移正是要被这一步抹平的。
 */
function refineAxisByLines(source: ImportImagePixels, axis: 'x' | 'y', currentPitch: number): {
  pitch: number; origin: number; coherence: number; inlierRatio: number;
} | null {
  const spikes = lineSpikes(source, axis);
  if (spikes.length < LINE_MIN_SPIKES) return null;
  const window = currentPitch * 0.08;
  let bestPitch = 0;
  let bestCoherence = 0;
  for (let p = Math.max(MIN_PITCH, currentPitch - window); p <= currentPitch + window; p += 0.01) {
    const coherence = phaseCoherence(spikes, p);
    if (coherence > bestCoherence) { bestCoherence = coherence; bestPitch = p; }
  }
  if (bestPitch === 0 || bestCoherence < LINE_COHERENCE_MIN) return null;
  // 相位均值 → 原点
  let cosSum = 0;
  let sinSum = 0;
  for (const position of spikes) {
    const angle = (2 * Math.PI * position) / bestPitch;
    cosSum += Math.cos(angle);
    sinSum += Math.sin(angle);
  }
  let origin = (Math.atan2(sinSum, cosSum) / (2 * Math.PI)) * bestPitch;
  if (origin < 0) origin += bestPitch;
  // 内点率：偏离格线列 ≥25% 周期的峰视为离群（与全局估算同口径）
  let matched = 0;
  for (const position of spikes) {
    const k = Math.round((position - origin) / bestPitch);
    if (k >= 1 && Math.abs(position - (origin + k * bestPitch)) <= bestPitch * REFINE_OUTLIER_RATIO) matched += 1;
  }
  const inlierRatio = matched / spikes.length;
  if (inlierRatio < 0.5) return null;
  return { pitch: bestPitch, origin, coherence: bestCoherence, inlierRatio };
}

/**
 * 折叠直方图回退（v3.2，2026-11-16 芝宝实物图）：矢量求和相干对**双峰族**
 * 失效——实物豆板的缝列（豆间隙）与孔列（豆心小孔）相距半格，两组峰矢量
 * 相互抵消，coherence 掉到阈值之下，refine 直接放弃（applied=false）。
 *
 * 折叠法不要求峰列同相：把所有峰按周期折叠进相位桶，双族会形成两个峰包，
 * 取主峰相位即可。峰族归属（缝 or 孔）1D 投影区分不了，也不需要区分——
 * 返回「主峰相位」与「+半格备选相位」两个候选，交给格内纯度投票裁决
 * （选错的族会把格心放到另一族上，格内方差显著更高）。
 *
 * 仅在矢量相干路径失败后调用，已成功的图零影响。
 */
function foldAxisPhase(
  spikeData: Array<{ position: number; weight: number }>,
  pitch: number,
): { phase: number; sharpness: number } | null {
  const bins = 64;
  const hist = new Float64Array(bins);
  for (const { position, weight } of spikeData) {
    const ph = ((position % pitch) + pitch) % pitch;
    const f = (ph / pitch) * bins;
    const i0 = Math.floor(f) % bins;
    const frac = f - Math.floor(f);
    hist[i0] += weight * (1 - frac);
    hist[(i0 + 1) % bins] += weight * frac;
  }
  // 环形平滑（±1 桶），容忍峰位抖动与亚桶分布
  const smooth = new Float64Array(bins);
  for (let i = 0; i < bins; i += 1) {
    smooth[i] = (hist[(i + bins - 1) % bins] + 2 * hist[i] + hist[(i + 1) % bins]) / 4;
  }
  let max = 0;
  let maxI = 0;
  let sum = 0;
  for (let i = 0; i < bins; i += 1) {
    sum += smooth[i];
    if (smooth[i] > max) { max = smooth[i]; maxI = i; }
  }
  if (sum <= 0) return null;
  const left = smooth[(maxI + bins - 1) % bins];
  const right = smooth[(maxI + 1) % bins];
  const denom = left - 2 * smooth[maxI] + right;
  const sub = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denom)) : 0;
  // 桶 i 覆盖相位 [(i)/bins, (i+1)/bins)，主峰中心 = (maxI + 0.5 + sub)/bins
  const phase = (((maxI + 0.5 + sub) / bins) % 1) * pitch;
  return { phase, sharpness: max / (sum / bins) };
}

/** 折叠回退的轴结果：周期 + 主峰相位 + 锐度（>1.25 才算有折叠结构）。 */
const FOLD_SHARPNESS_MIN = 1.25;

function refineAxisByFold(
  source: ImportImagePixels,
  axis: 'x' | 'y',
  currentPitch: number,
): { pitch: number; phase: number; sharpness: number } | null {
  const spikeData = lineSpikesWithStrength(source, axis);
  if (spikeData.length < LINE_MIN_SPIKES) return null;
  const window = currentPitch * 0.08;
  let bestPitch = 0;
  let bestSharpness = 0;
  let bestPhase = 0;
  for (let p = Math.max(MIN_PITCH, currentPitch - window); p <= currentPitch + window; p += 0.01) {
    const fold = foldAxisPhase(spikeData, p);
    if (!fold) continue;
    if (fold.sharpness > bestSharpness) { bestSharpness = fold.sharpness; bestPitch = p; bestPhase = fold.phase; }
  }
  if (bestPitch === 0 || bestSharpness < FOLD_SHARPNESS_MIN) return null;
  return { pitch: bestPitch, phase: bestPhase, sharpness: bestSharpness };
}

/**
 * 格内颜色纯度评分：整图均匀采样 K×K 个格子，每格取中心 + 四象限 5 个
 * 样点，返回格内颜色方差的均值（越低 = 每格越接近同一颗豆的颜色 = 相位越准）。
 *
 * 用途：精修算出的全图最优相位与用户拖动的原点差得远时，谁对谁错不能只
 * 信投影峰（v2 教训：文字污染的投影相位天然偏半格）——让图片直接投票：
 * 相位正确时每个采样格落在同一颗豆/同一片色块内部，格内方差小；错半格时
 * 每格骑在豆子边界上，格内方差显著变大。
 */
function gridCellVarianceScore(
  source: ImportImagePixels,
  cellSize: number,
  originX: number,
  originY: number,
): number {
  const { data, width, height } = source;
  const K = 24;
  const offsets: Array<[number, number]> = [
    [0, 0],
    [-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22],
  ];
  let total = 0;
  let cells = 0;
  for (let ky = 0; ky < K; ky += 1) {
    for (let kx = 0; kx < K; kx += 1) {
      const cx = originX + (kx + 0.5) * cellSize;
      const cy = originY + (ky + 0.5) * cellSize;
      if (cx < 2 || cy < 2 || cx > width - 3 || cy > height - 3) continue;
      const samples: Array<[number, number, number]> = [];
      for (const [ox, oy] of offsets) {
        const x = Math.round(cx + ox * cellSize);
        const y = Math.round(cy + oy * cellSize);
        const i = (y * width + x) * 4;
        samples.push([data[i], data[i + 1], data[i + 2]]);
      }
      const meanR = samples.reduce((sum, s) => sum + s[0], 0) / samples.length;
      const meanG = samples.reduce((sum, s) => sum + s[1], 0) / samples.length;
      const meanB = samples.reduce((sum, s) => sum + s[2], 0) / samples.length;
      let variance = 0;
      for (const s of samples) {
        variance += (s[0] - meanR) ** 2 + (s[1] - meanG) ** 2 + (s[2] - meanB) ** 2;
      }
      total += variance / samples.length;
      cells += 1;
    }
  }
  return cells > 0 ? total / cells : Number.POSITIVE_INFINITY;
}

/** 把相位差折算到 (-p/2, p/2]，用于"离用户原点最近的等价相位"。 */
function wrapPhaseDiff(target: number, current: number, pitch: number): number {
  let diff = (target - current) % pitch;
  if (diff > pitch / 2) diff -= pitch;
  if (diff < -pitch / 2) diff += pitch;
  return diff;
}

/**
 * 「手动对齐了局部、远端漂移」的自动修复：把用户当前对齐当先验，
 * 用暗线投影在全图峰列上把**格距**精修到位。原点默认不动。
 *
 * 原点为什么默认不动（两版教训）：
 *  - v1 把原点套用成全图相位均值（wrap 到 [0,pitch)）→ 网格整格"跳走"，
 *    用户拖的锚点被覆盖。
 *  - v2 把相位均值折算成离用户原点最近的等价原点（±半格微调）→ 实测
 *    浅格线图纸（格线浅青、探测不到）的投影峰来自**每格中央的色号文字**
 *    与深色豆块边界，其相位天然偏真实格线半格——"半格微调"正好把用户
 *    本来对齐的网格挪到文字中心上，整图错位半格。
 *  - 结论：用户看得见格线，原点拖得准；拖不准的是格距（蓝点基线只有
 *    3 格）。精修默认只修格距：原点在真格线上时，修正格距后近端几乎不动、
 *    远端逐格收敛到真格线，正是理想行为。
 *
 * v3.1 相位吸附（唯一例外）：投影相位与用户原点差 ≥0.15 格时，用户多半
 * 没拖准（瑶图实测：起点 (270,110) 相位差 1/3 格，精修后采样仍骑在豆子
 * 边界上，识别整图混色）。此时生成"吸附候选"，用格内颜色纯度让图片投票
 * ——吸附后格内方差显著更低（<92%）才采纳。文字污染的假相位在纯度投票
 * 下会输给用户原本正确的原点，v2 的失败模式被这条判据挡住。
 *
 * 输入的对齐只需粗略正确（±8% 内），输出可直接套用；格线证据不足
 * （照片/截图无印刷网格）时 applied=false 并说明原因，不碰当前对齐。
 */
export function refineGridAlignment(
  source: ImportImagePixels,
  alignment: { originX: number; originY: number; cellSize: number },
): GridAlignmentRefinement {
  const untouched: GridAlignmentRefinement = {
    applied: false,
    cell: alignment.cellSize,
    originX: alignment.originX,
    originY: alignment.originY,
    confidence: 0,
    coherenceX: 0,
    coherenceY: 0,
    stretched: false,
    message: '',
  };
  if (!source || !source.data || source.width < 40 || source.height < 40) {
    return { ...untouched, message: '图片太小，无法精修网格。' };
  }
  const base = Math.max(MIN_PITCH, alignment.cellSize);
  const x = refineAxisByLines(source, 'x', base);
  const y = refineAxisByLines(source, 'y', base);
  // 折叠回退（v3.2）：矢量相干对缝/孔双峰族失效（矢量抵消）——两轴都失败时
  // 改用折叠直方图求周期与主峰相位，相位归属交给格内纯度投票。
  let cell: number;
  let stretched: boolean;
  let foldCandidates: { x: number[]; y: number[] } | null = null;
  let foldSharpness = 0;
  if (x && y) {
    cell = Number(((x.pitch + y.pitch) / 2).toFixed(2));
    stretched = Math.abs(x.pitch - y.pitch) / Math.max(x.pitch, y.pitch) > 0.015;
  } else {
    const fx = x ? null : refineAxisByFold(source, 'x', base);
    const fy = y ? null : refineAxisByFold(source, 'y', base);
    if ((!x && !fx) || (!y && !fy)) {
      return { ...untouched, message: '图上检测不到足够的贯穿格线（照片或无格线的截图精修不了），请保持手动微调。' };
    }
    const pitchX = x ? x.pitch : fx!.pitch;
    const pitchY = y ? y.pitch : fy!.pitch;
    cell = Number(((pitchX + pitchY) / 2).toFixed(2));
    stretched = Math.abs(pitchX - pitchY) / Math.max(pitchX, pitchY) > 0.015;
    foldSharpness = Math.min(x ? Number.POSITIVE_INFINITY : fx!.sharpness, y ? Number.POSITIVE_INFINITY : fy!.sharpness);
    // 峰族归属（缝 or 孔）1D 投影区分不了：主峰 + 主峰+半格两组候选都给投票；
    // 矢量相干成功的轴不需要候选，保留用户相位（空数组 = 不动该轴）
    const phaseX0 = ((alignment.originX % cell) + cell) % cell;
    const phaseY0 = ((alignment.originY % cell) + cell) % cell;
    foldCandidates = {
      x: x ? [phaseX0] : [fx!.phase, fx!.phase + cell / 2],
      y: y ? [phaseY0] : [fy!.phase, fy!.phase + cell / 2],
    };
  }
  const drift = Math.abs(cell - base) / base;

  // 相位吸附（v3.1）：格内纯度投票，显著更纯才动原点。
  let originX = alignment.originX;
  let originY = alignment.originY;
  let snapNote = '';
  const phaseX = ((alignment.originX % cell) + cell) % cell;
  const phaseY = ((alignment.originY % cell) + cell) % cell;
  if (foldCandidates) {
    // 折叠路径：4 个相位组合（各轴主峰 / 主峰+半格）让图片投票，显著更纯才动原点
    const userScore = gridCellVarianceScore(source, cell, phaseX, phaseY);
    let best = { score: Number.POSITIVE_INFINITY, px: phaseX, py: phaseY };
    for (const px of foldCandidates.x) {
      for (const py of foldCandidates.y) {
        const score = gridCellVarianceScore(source, cell, px, py);
        if (score < best.score) best = { score, px, py };
      }
    }
    if (Number.isFinite(userScore) && best.score < userScore * 0.92) {
      const dxF = wrapPhaseDiff(best.px, phaseX, cell);
      const dyF = wrapPhaseDiff(best.py, phaseY, cell);
      originX = alignment.originX + dxF;
      originY = alignment.originY + dyF;
      snapNote = `；投影为缝/孔双峰族，折叠相位经格内纯度投票吸附 ${Math.round(Math.hypot(dxF, dyF))} px（吸附后格内颜色更纯）`;
    } else {
      snapNote = '；折叠相位候选未通过格内纯度投票，保持你拖动的原点';
    }
  } else {
    const dx = wrapPhaseDiff(x!.origin, phaseX, cell);
    const dy = wrapPhaseDiff(y!.origin, phaseY, cell);
    const snapGate = cell * 0.15;
    if (Math.abs(dx) >= snapGate || Math.abs(dy) >= snapGate) {
      const snapX = Math.abs(dx) >= snapGate ? dx : 0;
      const snapY = Math.abs(dy) >= snapGate ? dy : 0;
      const userScore = gridCellVarianceScore(source, cell, phaseX, phaseY);
      const snappedScore = gridCellVarianceScore(source, cell, phaseX + snapX, phaseY + snapY);
      if (Number.isFinite(userScore) && snappedScore < userScore * 0.92) {
        originX = alignment.originX + snapX;
        originY = alignment.originY + snapY;
        snapNote = `；原点吸附 ${Math.round(Math.hypot(snapX, snapY))} px（你拖动的相位与全图格线差得较远，吸附后格内颜色更纯，已按图片投票确认）`;
      }
    }
  }

  const foldPath = !x || !y;
  const confidence = foldPath
    ? Math.min(1, foldSharpness / 8)
    : Math.min(x!.coherence * x!.inlierRatio, y!.coherence * y!.inlierRatio);
  const pitchText = foldPath
    ? `格距 ${base.toFixed(2)} → ${cell.toFixed(2)} px（折叠直方图，锐度 ${foldSharpness.toFixed(1)}）`
    : `格距 ${base.toFixed(2)} → ${x!.pitch.toFixed(2)} / ${y!.pitch.toFixed(2)} px，相位相干 ${(x!.coherence * 100).toFixed(0)}% / ${(y!.coherence * 100).toFixed(0)}%`;
  return {
    applied: true,
    cell,
    originX,
    originY,
    confidence,
    coherenceX: x ? x.coherence : 0,
    coherenceY: y ? y.coherence : 0,
    stretched,
    message: `全图格线精修完成：${pitchText}`
      + (snapNote || '；网格位置保留你拖动的原点，未做任何移动，格线偏移随距离逐渐收敛')
      + '。'
      + (drift > 0.03 ? `本次格距修正幅度 ${ (drift * 100).toFixed(1) }% 较大，请核对绿色区域行列数是否与图纸一致。` : '')
      + (stretched ? '横纵格距相差超过 1.5%，图片可能被非等比拉伸过——正方形网格只能取平均近似。' : '')
      + '若精修后反而错位（图纸格线太浅、系统读到的是文字边缘），请撤销后以手动对齐为准。',
  };
}
