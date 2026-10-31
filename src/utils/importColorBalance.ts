import type { ImportRecognitionCell } from './importRecognition';

/**
 * 色偏自校正（白平衡）。
 *
 * 现实里的图纸很少是纯净扫描件：白炽灯偏黄、阴天偏蓝、荧光灯偏绿，
 * 整幅图的三个通道被乘了不同系数。ΔE2000 对这种整体偏移很敏感——
 * 两支相近的红会被推到另一支上去。
 *
 * ## 为什么从「灰世界」改成「白片」
 *
 * 最早这里是灰世界假设：整幅图平均起来应当接近中性。它在拼豆这种题材上
 * **系统性地错**——深蓝背景、深色衣装常常占画面一半以上，均值本来就是蓝的，
 * 于是被算成「偏蓝」，增益把红抬上去、把蓝按下去，结果所有中性色与肤色一起变黄。
 * 实测一张实物拼豆照：全图均值 RGB(86, 92, 107)，灰世界给 R1.10 / G1.03 / B0.89，
 * 白珠 (212, 216, 226) 被推成 (233, 221, 201)——就是用户看到的「偏黄」。
 *
 * 现在用白片法（white patch）：只看**已经很亮且接近中性**的那批像素
 * （白珠、白纸、白高光），它们的离中性程度就是光照的色偏量。
 * 同样的照片，这批像素是 (212, 216, 226)，增益只有 R1.03 / G1.01 / B0.97。
 *
 * ## 三重保险
 *
 * 1. **必须存在白片**：找不到足够多「亮且近中性」的像素就返回 null，
 *    绝不退化成「整幅图平均」——那正是上一条错误的老路；
 * 2. **幅度上限**：增益超出 [0.90, 1.12] 直接放弃。真实光照色偏不会这么大，
 *    超出说明那些「白片」其实是画面里的浅色内容（米黄、浅蓝），硬掰只会更糟；
 * 3. **调用方还要验证**：见 importRecognition 里对同一批抽样格做的 ΔE 复核。
 */

export interface ChannelGains {
  r: number;
  g: number;
  b: number;
}

export const NEUTRAL_GAINS: ChannelGains = { r: 1, g: 1, b: 1 };

/** 白片法能接受的增益区间：超出说明"白片"其实是浅色内容，不该硬掰。 */
export const GAIN_MIN = 0.88;
export const GAIN_MAX = 1.14;

/** 至少要有这么多格才敢估计整体偏色。 */
export const MIN_CALIBRATION_CELLS = 8;

/** 增益幅度小于这个比例就当作没有色偏（避免对噪声做无意义的校正）。 */
export const GAIN_TRIGGER = 0.035;

/** 曝光归一时允许的增益区间（实物照片整体偏暗是常态，放宽但仍有上限）。 */
export const EXPOSURE_GAIN_MIN = 0.8;
export const EXPOSURE_GAIN_MAX = 1.3;
/** 亮度差小于这个比例就不做曝光归一。 */
const EXPOSURE_TRIGGER = 0.04;

/**
 * 白片候选的相对色度上限（通道最大差 / 亮度）。
 * 用相对值而不是绝对差：真有 10% 色偏时，白参考自己就已经偏了 20 级左右，
 * 用绝对阈值会把"唯一能当参考的那批像素"直接筛掉——那就永远校正不了。
 * 0.22 能容纳 ≈10% 的通道差，同时把淡黄、淡蓝这类真正的浅色内容挡在外面
 * （米黄 s≈0.42、肤色 s≈0.39、浅蓝 s≈0.25）。
 */
const WHITE_PATCH_MAX_CHROMA = 0.22;
/** 太暗的"中性"是阴影而不是白参考，不参与。 */
const WHITE_PATCH_MIN_LUMA = 60;

/**
 * 已经被截断的像素（任一通道贴边）不服从线性增益模型：
 * 白纸过曝到 255 后再乘 0.97 只会变灰，反而更差。估增益和验证时都排除它们。
 */
export function isClippedRgb(rgb: [number, number, number]): boolean {
  return rgb[0] >= 250 || rgb[1] >= 250 || rgb[2] >= 250 || rgb[0] <= 5 || rgb[1] <= 5 || rgb[2] <= 5;
}

function clampGain(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(GAIN_MAX, Math.max(GAIN_MIN, value));
}

function lumaOf([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 白片估计：从「亮度靠前 + 通道接近相等」的格子里取各通道中位数。
 *
 * - 不给 `targetLuma`：拉平到中性（只修色偏，亮度不动）；
 * - 给 `targetLuma`：连亮度一起归一（修色偏 + 曝光）。实物照片走这一条——
 *   拍下来的白珠往往只有 200 上下，而色板里的白是 236，差这一档就会让
 *   白→浅灰、浅灰→中灰，整片错一格。`targetLuma` 由调用方取色板里最亮的色。
 *
 * 透明格、无效格、贴边（过曝/纯黑）格不参与。
 */
export function estimateChannelGains(cells: ImportRecognitionCell[][], targetLuma?: number): ChannelGains | null {
  const samples: Array<{ rgb: [number, number, number]; luma: number; spread: number }> = [];
  for (const row of cells) {
    for (const cell of row) {
      if (cell.status !== 'mapped' || !cell.sampleRgb || isClippedRgb(cell.sampleRgb)) continue;
      const rgb = cell.sampleRgb;
      samples.push({
        rgb,
        luma: lumaOf(rgb),
        spread: Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]),
      });
    }
  }
  if (samples.length < MIN_CALIBRATION_CELLS) return null;

  // 第一步：近中性。只用相对色度，不用绝对差，也不先按分位数切——
  // 白色参考往往就占画面的 20%~40%，分位数会直接把它切开（实测 6 个白格只剩 3 个）。
  const neutral = samples.filter(sample => sample.luma >= WHITE_PATCH_MIN_LUMA
    && sample.spread / Math.max(1, sample.luma) <= WHITE_PATCH_MAX_CHROMA);
  // 没有白片就不猜。这里绝不能退回"全图平均"。
  if (neutral.length < Math.max(6, Math.ceil(samples.length * 0.03))) return null;

  // 第二步：白片 = 近中性像素里最亮的那一簇（亮度在最高值 90% 以内）。
  // 取最亮的一簇而不是"所有近中性"：浅灰、中灰也近中性，但它们的色度被
  // 噪声和阴影拉得很随便，只有最亮的那批才是可靠的白参考。
  let brightest = 0;
  for (const sample of neutral) if (sample.luma > brightest) brightest = sample.luma;
  const whites = neutral.filter(sample => sample.luma >= brightest * 0.9);
  if (whites.length < 3) return null;

  const medianR = median(whites.map(sample => sample.rgb[0]));
  const medianG = median(whites.map(sample => sample.rgb[1]));
  const medianB = median(whites.map(sample => sample.rgb[2]));
  const observed = (medianR + medianG + medianB) / 3;
  if (!Number.isFinite(observed) || observed <= 1) return null;

  const exposure = Number.isFinite(targetLuma) && (targetLuma as number) > 1;
  const target = exposure ? (targetLuma as number) : observed;
  if (!Number.isFinite(target) || target <= 1) return null;

  const raw: ChannelGains = {
    r: target / medianR,
    g: target / medianG,
    b: target / medianB,
  };
  // 没有曝光归一（纯色偏）时区间更窄：超出说明"白片"其实是浅色内容（米黄/浅蓝），宁可不动。
  // 有曝光归一（实物照片）时允许更大的幅度，因为整张照片偏暗是常态。
  const low = exposure ? EXPOSURE_GAIN_MIN : GAIN_MIN;
  const high = exposure ? EXPOSURE_GAIN_MAX : GAIN_MAX;
  if (Math.min(raw.r, raw.g, raw.b) < low || Math.max(raw.r, raw.g, raw.b) > high) return null;

  if (exposure) {
    // 一次性给出"色偏 + 曝光"，但**拆成两半分别限幅**：
    //   曝光 = 三通道增益的几何平均（整体亮度差多少）
    //   色偏 = 各通道相对这个平均的偏离（谁多谁少）
    // 只限幅其中之一都会丢掉另一半：上一版为了"不偏色"把色偏扔了，
    // 结果冷光下拍摄的蓝灰被读成中性灰（实测 H5 #48464E，ΔE 8.3 且没有更近的色号）。
    const rawFactor = target / observed;
    if (!Number.isFinite(rawFactor)) return null;
    const rawGains = { r: target / medianR, g: target / medianG, b: target / medianB };
    const exposureFactor = Math.cbrt(rawGains.r * rawGains.g * rawGains.b);
    if (!Number.isFinite(exposureFactor) || exposureFactor <= 0) return null;
    const exposureClamped = Math.min(EXPOSURE_GAIN_MAX, Math.max(EXPOSURE_GAIN_MIN, exposureFactor));
    if (Math.abs(exposureClamped - 1) < EXPOSURE_TRIGGER) {
      // 亮度没问题，只剩色偏；色偏太小就整体放弃
      const castOnly = Math.max(Math.abs(rawGains.r / exposureFactor - 1), Math.abs(rawGains.g / exposureFactor - 1), Math.abs(rawGains.b / exposureFactor - 1));
      if (castOnly < GAIN_TRIGGER) return null;
    }
    const result = {
      r: exposureClamped * Math.min(GAIN_MAX, Math.max(GAIN_MIN, rawGains.r / exposureFactor)),
      g: exposureClamped * Math.min(GAIN_MAX, Math.max(GAIN_MIN, rawGains.g / exposureFactor)),
      b: exposureClamped * Math.min(GAIN_MAX, Math.max(GAIN_MIN, rawGains.b / exposureFactor)),
    };
    if (Math.max(result.r, result.g, result.b) > EXPOSURE_GAIN_MAX || Math.min(result.r, result.g, result.b) < EXPOSURE_GAIN_MIN) return null;
    return result;
  }

  const gains: ChannelGains = { r: clampGain(raw.r), g: clampGain(raw.g), b: clampGain(raw.b) };
  const spread = Math.max(gains.r, gains.g, gains.b) / Math.min(gains.r, gains.g, gains.b);
  if (spread - 1 < GAIN_TRIGGER) return null;
  return gains;
}

/** 0–100 的"偏色程度"，用于界面提示：两个通道之间的最大相对差。 */
export function colorCastPercent(gains: ChannelGains): number {
  const max = Math.max(gains.r, gains.g, gains.b);
  const min = Math.min(gains.r, gains.g, gains.b);
  return Math.round((max / Math.max(0.01, min) - 1) * 100);
}

export function describeGains(gains: ChannelGains): string {
  const mean = (gains.r + gains.g + gains.b) / 3;
  const cast = colorCastPercent(gains);
  // 三个通道同向按比例变化 = 曝光问题，不是色偏。分开说，否则界面会写"色偏很小"却明明提亮了 19%。
  if (cast < 3) {
    if (mean > 1.03) return `画面偏暗，已整体提亮 ${Math.round((mean - 1) * 100)}%`;
    if (mean < 0.97) return `画面偏亮，已整体压暗 ${Math.round((1 - mean) * 100)}%`;
    return '色偏很小，按原色匹配';
  }
  const warm = gains.r > gains.b;
  return `检测到整体偏${warm ? '暖（黄）' : '冷（蓝）'}，已按 R${gains.r.toFixed(2)} / G${gains.g.toFixed(2)} / B${gains.b.toFixed(2)} 校正`;
}
