import type { BeadColor } from '../types';
import { deltaE2000, preparePaletteLab, rgbToLab, type PreparedPaletteColor } from './colorUtils';
import { NEUTRAL_GAINS, estimateChannelGains, isClippedRgb, type ChannelGains } from './importColorBalance';
import type { ImportGridCalibration } from './importGridCalibration';

/** Precision integrates all intersecting pixels; fast estimates area with uniform strata. */
export type ImportRecognitionMode = 'fast' | 'precision';
export type ImportSampleStatus = 'mapped' | 'blank' | 'invalid';
export type ImportQuality = 'good' | 'fair' | 'poor';

export interface ImportImagePixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface ImportRecognitionCell {
  row: number;
  column: number;
  status: ImportSampleStatus;
  color: BeadColor | null;
  colorId: string | null;
  /** Area-weighted representative RGB of the winning palette group only. */
  sampleRgb: [number, number, number] | null;
  /** Area-weighted mean perceptual distance within the winning group. */
  distance: number | null;
  /** Accepted source pixels (precision) or accepted stratum probes (fast). */
  sampleCount: number;
  /** Visible area in source-pixel units squared; estimated in fast mode. */
  coverage: number;
  /** Cell area intersecting the source, including transparent pixels. */
  sampledArea: number;
  /** Shares of coverage after grouping pixels by their nearest perceptual palette color. */
  dominantRatio: number | null;
  runnerUpRatio: number | null;
  /**
   * 次优色号，以及它与最优色号之间的 ΔE。
   * 用来说明"这个含糊值不值得人看"：同一个画面里两支几乎一样的米白（ΔE<4）之间
   * 犹豫，人眼也分不出来，不该占用复核队列。
   */
  runnerUpColorId?: string | null;
  runnerUpSeparation?: number | null;
  /** Compatibility alias for dominantRatio: color dominance, not recognition accuracy. */
  confidence: number | null;
  quality: ImportQuality | null;
}

export interface ImportRecognitionSummary {
  total: number;
  mapped: number;
  blank: number;
  invalid: number;
  distinctColors: number;
  meanDistance: number | null;
  /** Mean color dominance, not an estimate of recognition accuracy. */
  meanConfidence: number | null;
  lowConfidence: number;
  quality: ImportQuality;
}

export interface ImportRecognitionResult {
  mode: ImportRecognitionMode;
  /** 去杂色实际改写了多少格；未开启时不存在。 */
  smoothing?: { changed: number; threshold: number };
  /** 双胞胎归一改写了多少格；未开启时不存在。 */
  twinUnification?: { remapped: number };
  /** 自适应校正的实际结果；未触发时保留中性值，界面据此解释"这次做了什么"。 */
  autoCorrection?: {
    colorGains: ChannelGains | null;
    gridOffset: ImportGridOffset;
    offsetGain: number;
    sampledCells: number;
  };
  /** Fraction excluded on each cell edge during this run; zero retains whole-cell area. */
  edgeInsetRatio?: number;
  calibration: ImportGridCalibration;
  cells: ImportRecognitionCell[][];
  summary: ImportRecognitionSummary;
}

export interface ImportRecognitionOptions {
  /** Optional edge exclusion, clamped to 0..0.2 per side; default zero. */
  edgeInsetRatio?: number;
  /**
   * 色偏自校正：用"白片"（画面里已经很亮且接近中性的像素）估计通道增益。
   * **默认关闭**——它对纯数字图纸没有意义，而对深色背景的图容易误伤。
   */
  autoColorBalance?: boolean;
  /**
   * 全局网格偏移估计：抽样投票找出"整张图偏了半格"，再统一补偿。
   * **默认关闭**：网格本来就对准时，任何补偿都会把每格推偏。
   */
  autoAlign?: boolean;
  /**
   * 实物照片模式：每格按亮度裁掉最暗 15%（珠子孔洞、缝隙阴影）与最亮 10%（反光），
   * 再用剩下的像素统计主色。**默认关闭**，只建议对"拍下来的成品/豆板"打开。
   */
  beadPhoto?: boolean;
  /**
   * 双胞胎归一：ΔE 小于 `TWIN_RADIUS` 的两支色号，全图只保留出现多的那支。
   * 221 支的色卡里有 41% 的色号存在 ΔE<4 的"双胞胎"（HAMA 只有 20%、PERLER 9%），
   * 同一片颜色在几支几乎一样的色号之间来回跳，就是用户看到的"花"。
   * 默认跟随 `beadPhoto`：照片才需要，数字原图里两支相近色可能是有意为之。
   */
  unifyTwins?: boolean;
  /**
   * 去杂色：把主色占比很低的格子换成周围 8 格里出现最多的色号。
   * 照片识别最大的观感问题是"胡椒盐"式的孤立错格，而拼豆作品本身大面积连续。
   * **默认关闭**：会抹掉真正的单颗细节。
   */
  smooth?: boolean;
}

/** 全局网格偏移，单位是"格"：{ x: -0.16, y: 0 } 表示整张图向左偏了 16% 格。 */
export interface ImportGridOffset {
  x: number;
  y: number;
}

export interface ImportRecognitionAsyncOptions extends ImportRecognitionOptions {
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
  batchSize?: number;
}

const DEFAULT_ALPHA_CUTOFF = 24;
const LOW_CONFIDENCE = 0.6;
const RATIO_EPSILON = 1e-9;
const FAST_STRATA_PER_AXIS = 8;
const MAX_SLICE_WORK = 2048;
const MAX_SLICE_MS = 8;
const MAX_CACHED_COLORS = 32768;
/** 全局对齐探测：±0.16 格、3×3 位置、6×6 分层探针。 */
const ALIGN_OFFSETS = [-0.16, 0, 0.16];
const ALIGN_PROBE_STRATA = 6;
/** 少于这个抽样点就不敢判断网格是否整体偏移（小图交给用户自己看）。 */
const MIN_ALIGN_SAMPLES = 6;
/** 至少这么大比例的抽样点认可同一个偏移，才算"整体偏了"。 */
const ALIGN_AGREEMENT = 0.75;
/** 采纳偏移要求的最小平均得分提升（保守：宁可不动，也不要整体推偏）。 */
const ALIGN_MIN_GAIN = 0.14;
/** 复核：换成候选偏移后，整批抽样点的平均主色占比至少要提高这么多。 */
const ALIGN_MIN_CONFIDENCE_GAIN = 0.04;
/** 实物照片模式：按亮度裁掉最暗/最亮的一段。 */
const BEAD_DARK_TRIM = 0.15;
const BEAD_BRIGHT_TRIM = 0.1;
const BEAD_TRIM_MIN_SAMPLES = 16;
/** 实物照片模式：选色时给 ΔL 打的折扣。0.55 足够吸收阴影，又不至于混淆深浅两支豆。 */
const BEAD_LIGHTNESS_WEIGHT = 0.55;
/** 比面积之前先合并 ΔE 小于这个值的色号：同一颗豆的明暗条纹不该劈成两个颜色。 */
const GROUP_MERGE_RADIUS = 4;
/** 实物照片：只采圆豆本体。外边界取 r=0.92（避开豆缘与缝），中心 r=0.22 挖掉孔洞。 */
const BEAD_BODY_RADIUS2 = 0.85;
const BEAD_HOLE_RADIUS2 = 0.05;
/** 双胞胎判定：两支色号 ΔE 小于这个值就视为同一种颜色。 */
const TWIN_RADIUS = 4;
/** 去杂色：只处理主色占比低于这个值的格子（高置信格一个都不动）。 */
const SMOOTH_MIN_CONFIDENCE = 0.75;
/** 去杂色：周围 8 格里至少这么多票才替换，避免把噪声扩散成大片。 */
const SMOOTH_MIN_VOTES = 5;
/** 去杂色也处理"前两名打平"的格子：两支候选至少差这么多才算真的需要决定。 */
const SMOOTH_MIN_SEPARATION = 4;
/** 以及打平到什么程度（主次占比差）。 */
const SMOOTH_MAX_GAP = 0.12;
/** 定标白平衡至少需要的可信格数。 */
const MIN_BALANCE_CELLS = 8;
/** 校正后平均色差至少要降到原来的这个比例以下，才认为白平衡成立。 */
const GAIN_ACCEPT_RATIO = 0.98;

function isValidSource(source: ImportImagePixels): boolean {
  return Number.isInteger(source.width)
    && Number.isInteger(source.height)
    && source.width > 0
    && source.height > 0
    && source.data.length >= source.width * source.height * 4;
}

function qualityFor(confidence: number, distance: number): ImportQuality {
  if (confidence + RATIO_EPSILON < LOW_CONFIDENCE || distance > 15) return 'poor';
  if (confidence < 0.8 || distance > 8) return 'fair';
  return 'good';
}

interface SampleMatch {
  prepared: PreparedPaletteColor;
  paletteIndex: number;
  distance: number;
}

/**
 * 选色。
 *
 * `lightnessWeight < 1` 时（实物照片模式）改用"明度打折"的 CIE76 选色：
 * 拍下来的成品，同一支豆在画面中央和被边缘阴影压过的地方，L* 能差 15 以上，
 * 但它是同一支豆。把 ΔL 的权重降下来，选色就跟着 a、b（色相与饱和度）走。
 *
 * 注意两点：
 *  1. 只有**选色**用打折后的度量；返回的 distance 仍然是标准 ΔE2000，
 *     否则 qualityFor 的 8/15 阈值就失去意义了；
 *  2. 默认（权重 1）走原来的 ΔE2000 选色，结果与历史实现逐位一致。
 */
function classifySample(rgb: [number, number, number], palette: PreparedPaletteColor[], lightnessWeight = 1): SampleMatch {
  const lab = rgbToLab(...rgb);
  if (lightnessWeight < 1) {
    let bestWeighted = palette[0];
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let index = 0; index < palette.length; index += 1) {
      const candidate = palette[index];
      const dL = (lab[0] - candidate.lab[0]) * lightnessWeight;
      const da = lab[1] - candidate.lab[1];
      const db = lab[2] - candidate.lab[2];
      const score = dL * dL + da * da + db * db;
      if (score < bestScore) {
        bestScore = score;
        bestWeighted = candidate;
        bestIndex = index;
      }
      if (score === 0) break;
    }
    return { prepared: bestWeighted, paletteIndex: bestIndex, distance: deltaE2000(lab, bestWeighted.lab) };
  }
  let best = palette[0];
  let paletteIndex = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < palette.length; index += 1) {
    const candidate = palette[index];
    const candidateDistance = deltaE2000(lab, candidate.lab);
    if (candidateDistance < distance) {
      best = candidate;
      paletteIndex = index;
      distance = candidateDistance;
    }
    if (distance === 0) break;
  }
  return { prepared: best, paletteIndex, distance };
}

function emptyCell(row: number, column: number, status: 'blank' | 'invalid', sampledArea = 0): ImportRecognitionCell {
  return {
    row, column, status, color: null, colorId: null, sampleRgb: null,
    distance: null, sampleCount: 0, coverage: 0, sampledArea,
    dominantRatio: null, runnerUpRatio: null, runnerUpColorId: null, runnerUpSeparation: null,
    confidence: null, quality: null,
  };
}

function createInvalidCells(calibration: ImportGridCalibration): ImportRecognitionCell[][] {
  return Array.from({ length: calibration.rows }, (_, row) =>
    Array.from({ length: calibration.columns }, (_, column) => emptyCell(row, column, 'invalid')));
}

interface RecognitionContext {
  source: ImportImagePixels;
  alphaCutoff: number;
  calibration: ImportGridCalibration;
  mode: ImportRecognitionMode;
  edgeInsetRatio: number;
  preparedPalette: PreparedPaletteColor[];
  matchCache: Map<number, SampleMatch>;
  /** 通道增益与全局网格偏移：先抽样估计，再整幅统一使用。 */
  gains: ChannelGains;
  offset: ImportGridOffset;
  autoAlign: boolean;
  beadPhoto: boolean;
  invalidCells?: ImportRecognitionCell[][];
}

function createRecognitionContext(
  source: ImportImagePixels,
  calibration: ImportGridCalibration,
  palette: BeadColor[],
  mode: ImportRecognitionMode,
  alphaCutoff: number,
  options: ImportRecognitionOptions,
): RecognitionContext {
  const outputCalibration = { ...calibration };
  const edgeInsetRatio = Number.isFinite(options.edgeInsetRatio) ? Math.max(0, Math.min(0.2, options.edgeInsetRatio!)) : 0;
  const validGeometry = [calibration.originX, calibration.originY, calibration.cellWidth, calibration.cellHeight].every(Number.isFinite)
    && calibration.cellWidth > 0 && calibration.cellHeight > 0;
  const preparedPalette = isValidSource(source) && validGeometry && palette.length > 0 ? preparePaletteLab(palette) : [];
  const base = {
    source, alphaCutoff, calibration: outputCalibration, mode, edgeInsetRatio, preparedPalette,
    gains: NEUTRAL_GAINS, offset: { x: 0, y: 0 },
    autoAlign: options.autoAlign === true, beadPhoto: options.beadPhoto === true,
  };
  if (preparedPalette.length === 0) {
    return { ...base, matchCache: new Map(), invalidCells: createInvalidCells(outputCalibration) };
  }
  return { ...base, matchCache: new Map() };
}

interface PixelArea {
  rgb: [number, number, number];
  area: number;
}

interface ColorArea {
  match: SampleMatch;
  area: number;
  distance: number;
  rgb: [number, number, number];
}

/**
 * 采样一格，统计口径与历史实现完全一致：按像素与格子的几何相交面积加权，
 * alpha 低于阈值不计入覆盖度与占比，先按色板 id 分组再比面积。
 *
 * `overrideOffset` 只给"抽样探测"用；正式统计走 context.offset（全局统一）。
 * `probeStrata > 0` 时改用固定分层探针并多收一点边，作为廉价的对齐打分。
 */
function* sampleCellGen(
  context: RecognitionContext,
  row: number,
  column: number,
  overrideOffset?: ImportGridOffset,
  probeStrata = 0,
): Generator<number, ImportRecognitionCell> {
  const { source, alphaCutoff, calibration, mode, edgeInsetRatio, preparedPalette, matchCache, gains } = context;
  const offset = overrideOffset ?? context.offset;
  const inset = probeStrata > 0 ? Math.min(0.2, edgeInsetRatio + 0.08) : edgeInsetRatio;
  const left = Math.max(0, calibration.originX + (column + offset.x + inset) * calibration.cellWidth);
  const top = Math.max(0, calibration.originY + (row + offset.y + inset) * calibration.cellHeight);
  const right = Math.min(source.width, calibration.originX + (column + offset.x + 1 - inset) * calibration.cellWidth);
  const bottom = Math.min(source.height, calibration.originY + (row + offset.y + 1 - inset) * calibration.cellHeight);
  if (right <= left || bottom <= top) return emptyCell(row, column, 'invalid');

  const sampledArea = (right - left) * (bottom - top);
  const startX = Math.floor(left);
  const startY = Math.floor(top);
  const precise = mode === 'precision' && probeStrata === 0;
  const strata = probeStrata > 0 ? probeStrata : FAST_STRATA_PER_AXIS;
  const columns = precise ? Math.ceil(right) - startX : Math.min(strata, Math.ceil(right - left));
  const rows = precise ? Math.ceil(bottom) - startY : Math.min(strata, Math.ceil(bottom - top));
  const probes = Math.max(1, columns * rows);
  const stratumArea = sampledArea / probes;

  const histogram = new Map<number, PixelArea>();
  let sampleCount = 0;
  let coverage = 0;
  const gainR = gains.r;
  const gainG = gains.g;
  const gainB = gains.b;
  const neutral = gainR === 1 && gainG === 1 && gainB === 1;
  // 实物照片模式只在正式统计时生效（分层探针不做裁剪）。
  // 先把像素收进缓冲区，最后按亮度裁掉两端：珠子孔洞偏黑、反光偏白，
  // 它们都不代表这支豆的颜色，却会实打实地抢走面积。
  const collect = context.beadPhoto && probeStrata === 0;
  const bufKey = collect ? new Uint32Array(probes) : null;
  const bufArea = collect ? new Float32Array(probes) : null;
  const bufLuma = collect ? new Uint8Array(probes) : null;
  let buffered = 0;

  // 实物照片的格子是"方形框住一颗圆豆"：四角其实是豆子之间的暗缝（约占面积 21%），
  // 中心又是孔洞。方形窗口会把这两块暗区一起算进主色，主色占比被压到 50% 上下，
  // 颜色也被拖黑。按圆形取样（只取豆子本体的环带）可以同时解决这两件事。
  const disc = context.beadPhoto && probeStrata === 0;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const halfWidth = Math.max(0.5, (right - left) / 2);
  const halfHeight = Math.max(0.5, (bottom - top) / 2);

  const addPixel = (x: number, y: number, area: number) => {
    // Never replicate border pixels for samples outside the source.
    if (x < 0 || y < 0 || x >= source.width || y >= source.height) return;
    if (disc) {
      const nx = (x + 0.5 - centerX) / halfWidth;
      const ny = (y + 0.5 - centerY) / halfHeight;
      const radius2 = nx * nx + ny * ny;
      if (radius2 > BEAD_BODY_RADIUS2 || radius2 < BEAD_HOLE_RADIUS2) return;
    }
    const offsetInData = (y * source.width + x) * 4;
    const alpha = source.data[offsetInData + 3];
    if (alpha === 0 || alpha < alphaCutoff) return;
    const rawR = source.data[offsetInData];
    const rawG = source.data[offsetInData + 1];
    const rawB = source.data[offsetInData + 2];
    // 已经贴边（过曝/纯黑）的像素不参与增益：255 乘 0.97 只会把白纸变成灰纸。
    const clipped = rawR >= 250 || rawG >= 250 || rawB >= 250 || rawR <= 5 || rawG <= 5 || rawB <= 5;
    const red = neutral || clipped ? rawR : Math.min(255, Math.round(rawR * gainR));
    const green = neutral || clipped ? rawG : Math.min(255, Math.round(rawG * gainG));
    const blue = neutral || clipped ? rawB : Math.min(255, Math.round(rawB * gainB));
    const key = (red << 16) | (green << 8) | blue;
    if (bufKey && bufArea && bufLuma) {
      if (buffered >= probes) return;
      bufKey[buffered] = key;
      bufArea[buffered] = area;
      bufLuma[buffered] = Math.round(lumaFor(red, green, blue));
      buffered += 1;
      return;
    }
    const entry = histogram.get(key);
    if (entry) entry.area += area;
    else histogram.set(key, { rgb: [red, green, blue], area });
    sampleCount += 1;
    coverage += area;
  };

  let visited = 0;
  let sliceWork = 0;
  let sliceStarted = performance.now();
  for (let yIndex = 0; yIndex < rows; yIndex += 1) {
    const y = precise ? startY + yIndex : Math.floor(top + (yIndex + 0.5) * (bottom - top) / rows);
    const height = Math.min(bottom, y + 1) - Math.max(top, y);
    for (let xIndex = 0; xIndex < columns; xIndex += 1) {
      const x = precise ? startX + xIndex : Math.floor(left + (xIndex + 0.5) * (right - left) / columns);
      const area = precise ? (Math.min(right, x + 1) - Math.max(left, x)) * height : stratumArea;
      addPixel(x, y, area);
      visited += 1;
      sliceWork += 1;
      if (sliceWork >= MAX_SLICE_WORK || (sliceWork % 64 === 0 && performance.now() - sliceStarted >= MAX_SLICE_MS)) {
        yield 0.5 * visited / probes;
        sliceWork = 0;
        sliceStarted = performance.now();
      }
    }
  }

  if (bufKey && bufArea && bufLuma) {
    let lowLuma = 0;
    let highLuma = 255;
    if (buffered >= BEAD_TRIM_MIN_SAMPLES) {
      const counts = new Uint32Array(256);
      for (let index = 0; index < buffered; index += 1) counts[bufLuma[index]] += 1;
      const lowTarget = buffered * BEAD_DARK_TRIM;
      const highTarget = buffered * (1 - BEAD_BRIGHT_TRIM);
      let acc = 0;
      for (let luma = 0; luma < 256; luma += 1) {
        if (acc + counts[luma] > lowTarget) { lowLuma = luma; break; }
        acc += counts[luma];
      }
      acc = 0;
      for (let luma = 255; luma >= 0; luma -= 1) {
        if (acc + counts[luma] > buffered - highTarget) { highLuma = luma; break; }
        acc += counts[luma];
      }
    }
    for (let index = 0; index < buffered; index += 1) {
      const luma = bufLuma[index];
      if (luma < lowLuma || luma > highLuma) continue;
      const key = bufKey[index];
      const area = bufArea[index];
      const entry = histogram.get(key);
      if (entry) entry.area += area;
      else histogram.set(key, { rgb: [(key >> 16) & 255, (key >> 8) & 255, key & 255], area });
      sampleCount += 1;
      coverage += area;
    }
  }
  if (sampleCount === 0) return emptyCell(row, column, 'blank', sampledArea);

  // Group near RGB shades by perceptual palette identity before comparing areas.
  const groups = new Map<string, ColorArea>();
  let classified = 0;
  for (const [key, entry] of histogram) {
    let match = matchCache.get(key);
    if (!match) {
      match = classifySample(entry.rgb, preparedPalette, context.beadPhoto ? BEAD_LIGHTNESS_WEIGHT : 1);
      if (matchCache.size >= MAX_CACHED_COLORS) matchCache.clear();
      matchCache.set(key, match);
    }
    const id = match.prepared.color.id;
    let group = groups.get(id);
    if (!group) {
      group = { match, area: 0, distance: 0, rgb: [0, 0, 0] };
      groups.set(id, group);
    }
    group.area += entry.area;
    group.distance += match.distance * entry.area;
    for (let channel = 0; channel < 3; channel += 1) group.rgb[channel] += entry.rgb[channel] * entry.area;
    classified += 1;
    sliceWork += 1;
    if (sliceWork >= MAX_SLICE_WORK || performance.now() - sliceStarted >= MAX_SLICE_MS) {
      yield 0.5 + 0.5 * classified / Math.max(1, histogram.size);
      sliceWork = 0;
      sliceStarted = performance.now();
    }
  }

  // 合并"肉眼几乎一样"的组：同一颗豆被拍出明暗条纹时，像素会分投到两支相近色号上，
  // 面积被劈成 60/35 两半——按色号比面积就变成了"两个颜色打平"，于是整格被判为待核对。
  // 先按 ΔE 半径做一次并查集合并，再比面积，才是"这颗豆到底是什么颜色"。
  const merged = mergeNearbyGroups(groups);
  const ordered = merged.sort((a, b) => b.area - a.area
    || a.distance / a.area - b.distance / b.area || a.match.paletteIndex - b.match.paletteIndex);
  const dominant = ordered[0];
  const color = dominant.match.prepared.color;
  const sampleRgb = dominant.rgb.map(value => Math.round(value / dominant.area)) as [number, number, number];
  const distance = dominant.distance / dominant.area;
  const dominantRatio = Math.min(1, dominant.area / coverage);
  const runnerUpRatio = Math.min(1, (ordered[1]?.area ?? 0) / coverage);
  const runnerUp = ordered[1];
  const runnerUpColorId = runnerUp ? runnerUp.match.prepared.color.id : null;
  const runnerUpSeparation = runnerUp ? deltaE2000(dominant.match.prepared.lab, runnerUp.match.prepared.lab) : null;
  return {
    row, column, status: 'mapped', color, colorId: color.id, sampleRgb, distance,
    sampleCount, coverage, sampledArea, dominantRatio, runnerUpRatio, runnerUpColorId, runnerUpSeparation,
    confidence: dominantRatio, quality: qualityFor(dominantRatio, distance),
  };
}

/**
 * 把 ΔE 小于 `GROUP_MERGE_RADIUS` 的组并成一个（并查集，支持传递合并）。
 * 合并后的组：面积相加、色差按面积加权、代表色取面积加权平均。
 * 代表色对应的色号不在这里决定——下游仍用整组的加权平均 RGB 去重新匹配一次。
 */
function mergeNearbyGroups(groups: Map<string, ColorArea>): ColorArea[] {
  const list = [...groups.values()];
  if (list.length <= 1) return list;
  const parent = list.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (deltaE2000(list[i].match.prepared.lab, list[j].match.prepared.lab) >= GROUP_MERGE_RADIUS) continue;
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[b] = a;
    }
  }
  const buckets = new Map<number, ColorArea>();
  for (let index = 0; index < list.length; index += 1) {
    const root = find(index);
    const source = list[index];
    const bucket = buckets.get(root);
    if (!bucket) {
      buckets.set(root, { ...source, rgb: [...source.rgb] as [number, number, number] });
      continue;
    }
    bucket.area += source.area;
    bucket.distance += source.distance;
    for (let channel = 0; channel < 3; channel += 1) bucket.rgb[channel] += source.rgb[channel];
  }
  return [...buckets.values()];
}

function* processRecognitionCell(context: RecognitionContext, row: number, column: number): Generator<number, ImportRecognitionCell> {
  return yield* sampleCellGen(context, row, column);
}

/** 探测用同步采样：探针很小，不需要让出主线程。 */
function sampleCellSync(
  context: RecognitionContext,
  row: number,
  column: number,
  overrideOffset?: ImportGridOffset,
  probeStrata = 0,
): ImportRecognitionCell {
  const iterator = sampleCellGen(context, row, column, overrideOffset, probeStrata);
  let step = iterator.next();
  while (step.done === false) step = iterator.next();
  return step.value;
}

/** 对齐打分：主色占比为主，色差做小幅惩罚，避免"更干净但颜色更离谱"的偏移胜出。 */
function alignmentScore(cell: ImportRecognitionCell): number {
  if (cell.status !== 'mapped') return -1;
  return (cell.dominantRatio ?? 0) - Math.min(cell.distance ?? 40, 40) / 200;
}

/** 色板里最亮那支豆的亮度，用作曝光归一的靶子；没有真正的浅色就不给靶子。 */
function brightestPaletteLuma(palette: PreparedPaletteColor[]): number | undefined {
  let brightest = 0;
  for (const entry of palette) {
    const [r, g, b] = entry.color.rgb;
    const luma = lumaFor(r, g, b);
    // 只认**近中性**的浅色（白、米白、浅灰）。取"最亮的那支"会把荧光黄当成白参考，
    // 拿它做曝光靶子等于把整张图往黄里推。
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread / Math.max(1, luma) > 0.1) continue;
    if (luma > brightest) brightest = luma;
  }
  return brightest >= 200 ? brightest : undefined;
}

function lumaFor(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function meanConfidenceOf(cells: ImportRecognitionCell[]): number {
  let sum = 0;
  let count = 0;
  for (const cell of cells) {
    if (cell.status !== 'mapped' || cell.dominantRatio === null) continue;
    sum += cell.dominantRatio;
    count += 1;
  }
  return count ? sum / count : 0;
}

function meanProbeDistance(cells: ImportRecognitionCell[]): number {
  let sum = 0;
  let count = 0;
  for (const cell of cells) {
    if (cell.status !== 'mapped' || cell.distance === null) continue;
    if (cell.sampleRgb && isClippedRgb(cell.sampleRgb)) continue;
    sum += cell.distance;
    count += 1;
  }
  return count ? sum / count : Number.POSITIVE_INFINITY;
}

/** 抽样点：最多 400 格，均匀跨行跨列，避免只看某一角。 */
function sampleGridPoints(context: RecognitionContext): Array<{ row: number; column: number }> {
  const { rows, columns } = context.calibration;
  const total = rows * columns;
  if (total <= 0) return [];
  const target = Math.min(400, total);
  if (target === total) {
    return Array.from({ length: rows }, (_, row) => row)
      .flatMap(row => Array.from({ length: columns }, (_, column) => ({ row, column })));
  }
  const step = Math.max(1, Math.floor(Math.sqrt(total / target)));
  const points: Array<{ row: number; column: number }> = [];
  for (let row = 0; row < rows; row += step) {
    for (let column = 0; column < columns; column += step) {
      points.push({ row, column });
      if (points.length >= target) return points;
    }
  }
  return points;
}

interface CalibrationProbe {
  gains: ChannelGains | null;
  offset: ImportGridOffset;
  /** 采纳偏移后，抽样点的平均得分提升。 */
  offsetGain: number;
  sampled: number;
}

/**
 * 一次抽样同时回答两个问题：
 *  1. 整幅图偏色多少（用高置信格反推通道增益）；
 *  2. 网格整体偏了多远（每个抽样点各自的 3×3 邻域最优偏移，取"多数派"）。
 *
 * 只认**多数派一致**的偏移：局部脏格各选各的，会被这层共识过滤掉，
 * 所以"格子脏但不歪"的图片不会被误挪。
 */
function probeCalibration(
  context: RecognitionContext,
  wantBalance: boolean,
  wantAlign: boolean,
): CalibrationProbe {
  const points = sampleGridPoints(context);
  const samples: ImportRecognitionCell[] = points.map(point => sampleCellSync(context, point.row, point.column, { x: 0, y: 0 }, ALIGN_PROBE_STRATA));

  // 实物照片模式额外给一个"曝光靶子"：把画面里的白片归一到色板最亮的那支豆。
  // 拍下来的白珠通常只有 200 上下，而色板白是 236；不归一，整片就会各暗一档。
  const exposureTarget = context.beadPhoto ? brightestPaletteLuma(context.preparedPalette) : undefined;
  let gains = wantBalance && samples.length >= MIN_BALANCE_CELLS
    ? estimateChannelGains([samples], exposureTarget)
    : null;
  if (gains) {
    // 灰世界只是假设，必须用色差验证：同一批抽样格换成校正后增益再算一遍，
    // 只有平均 ΔE 确实下降才采纳，否则宁可不动（避免把"整图偏红"硬掰成中性）。
    const tunedContext: RecognitionContext = { ...context, gains };
    const tunedSamples = points.map(point => sampleCellSync(tunedContext, point.row, point.column, { x: 0, y: 0 }, ALIGN_PROBE_STRATA));
    const before = meanProbeDistance(samples);
    const after = meanProbeDistance(tunedSamples);
    if (!Number.isFinite(before) || !Number.isFinite(after) || after > before * GAIN_ACCEPT_RATIO) gains = null;
  }

  let offset: ImportGridOffset = { x: 0, y: 0 };
  let offsetGain = 0;
  if (wantAlign && points.length >= MIN_ALIGN_SAMPLES) {
    const votes = new Map<string, { count: number; gain: number }>();
    let validPoints = 0;
    for (let index = 0; index < points.length; index += 1) {
      const base = alignmentScore(samples[index]);
      if (base < 0) continue;
      let bestX = 0;
      let bestY = 0;
      let bestScore = base;
      for (const dy of ALIGN_OFFSETS) {
        for (const dx of ALIGN_OFFSETS) {
          if (dx === 0 && dy === 0) continue;
          const probe = sampleCellSync(context, points[index].row, points[index].column, { x: dx, y: dy }, ALIGN_PROBE_STRATA);
          const score = alignmentScore(probe);
          if (score > bestScore) {
            bestScore = score;
            bestX = dx;
            bestY = dy;
          }
        }
      }
      validPoints += 1;
      if (bestX === 0 && bestY === 0) continue;
      const key = `${bestX}:${bestY}`;
      const entry = votes.get(key) ?? { count: 0, gain: 0 };
      entry.count += 1;
      entry.gain += bestScore - base;
      votes.set(key, entry);
    }
    const winner = [...votes.entries()].sort((a, b) => b[1].count - a[1].count)[0];
    if (winner && validPoints > 0) {
      const [key, entry] = winner;
      const gain = entry.gain / entry.count;
      // 多数派 + 明显改善，两个条件都满足才动网格。
      if (entry.count / validPoints >= ALIGN_AGREEMENT && gain >= ALIGN_MIN_GAIN) {
        const [x, y] = key.split(':').map(Number);
        // 第二重门：多数派投票只看"每格自己变好了没有"，格子多的时候总有少数格
        // 因为噪声投出偏移。把整批抽样点整体换成候选偏移再算一遍，只有整体
        // 主色占比确实上升、平均色差没有变差，才允许移动整张网格。
        const shifted = points.map(point => sampleCellSync(context, point.row, point.column, { x, y }, ALIGN_PROBE_STRATA));
        const baseDistance = meanProbeDistance(samples);
        const shiftedDistance = meanProbeDistance(shifted);
        const distanceOk = !Number.isFinite(baseDistance) || !Number.isFinite(shiftedDistance)
          || shiftedDistance <= baseDistance * 1.02;
        if (distanceOk && meanConfidenceOf(shifted) >= meanConfidenceOf(samples) + ALIGN_MIN_CONFIDENCE_GAIN) {
          offset = { x, y };
          offsetGain = gain;
        }
      }
    }
  }
  return { gains, offset, offsetGain, sampled: points.length };
}

function runCells(context: RecognitionContext): ImportRecognitionCell[][] {
  const { rows, columns } = context.calibration;
  const cells: ImportRecognitionCell[][] = [];
  for (let row = 0; row < rows; row += 1) {
    cells.push(Array.from({ length: columns }, (_, column) => {
      const processing = processRecognitionCell(context, row, column);
      let step = processing.next();
      while (step.done === false) step = processing.next();
      return step.value;
    }));
  }
  return cells;
}

/**
 * 去杂色：把低置信格的色号替换为邻域多数色号。
 *
 * 只动"本来就没把握"的格子（主色占比 < 0.75），高置信格一个都不碰——
 * 这样网格正确时的清晰结构不会被抹平，只有糊成一片的区域被规整。
 * 替换后按同一个采样色重算 ΔE 与质量等级，保证 distance 仍然描述"这个采样离该色号多远"。
 */
/**
 * 双胞胎归一：把 ΔE < TWIN_RADIUS 的色号合并到"全图用得最多的那支"。
 *
 * 只改色号，不改测量：`sampleRgb` 保持原样，`distance` 按新色号重算。
 * 与去杂色的区别：去杂色看空间（周围是不是同一个色号），这里看色板
 * （两支颜色本来就分不出来），所以对"大片纯色里跳色号"这种花最有效。
 */
function unifyTwinColors(
  cells: ImportRecognitionCell[][],
  context: RecognitionContext,
): { cells: ImportRecognitionCell[][]; remapped: number } {
  const frequency = new Map<string, number>();
  for (const row of cells) {
    for (const cell of row) {
      if (cell.status !== 'mapped' || !cell.colorId) continue;
      frequency.set(cell.colorId, (frequency.get(cell.colorId) ?? 0) + 1);
    }
  }
  if (frequency.size < 2) return { cells, remapped: 0 };

  const byId = new Map(context.preparedPalette.map(entry => [entry.color.id, entry]));
  const ordered = [...frequency.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const alias = new Map<string, string>();
  for (const id of ordered) {
    if (alias.has(id)) continue;
    const entry = byId.get(id);
    if (!entry) continue;
    for (const other of ordered) {
      if (other === id || alias.has(other)) continue;
      const candidate = byId.get(other);
      if (!candidate) continue;
      if (deltaE2000(entry.lab, candidate.lab) < TWIN_RADIUS) alias.set(other, id);
    }
  }
  if (alias.size === 0) return { cells, remapped: 0 };

  let remapped = 0;
  const output = cells.map(row => row.map(cell => {
    if (cell.status !== 'mapped' || !cell.colorId) return cell;
    const targetId = alias.get(cell.colorId);
    if (!targetId) return cell;
    const target = byId.get(targetId);
    if (!target) return cell;
    remapped += 1;
    const distance = cell.sampleRgb ? deltaE2000(rgbToLab(...cell.sampleRgb), target.lab) : cell.distance;
    return { ...cell, color: target.color, colorId: targetId, distance, quality: qualityFor(cell.dominantRatio ?? 0, distance ?? 0) };
  }));
  return { cells: output, remapped };
}

function smoothCells(
  cells: ImportRecognitionCell[][],
  context: RecognitionContext,
): { cells: ImportRecognitionCell[][]; changed: number } {
  const ids = cells.map(row => row.map(cell => (cell.status === 'mapped' ? cell.colorId : null)));
  const byId = new Map(context.preparedPalette.map(entry => [entry.color.id, entry]));
  let changed = 0;
  const output = cells.map((row, rowIndex) => row.map((cell, columnIndex) => {
    if (cell.status !== 'mapped' || !cell.colorId || !cell.sampleRgb) return cell;
    // 两类格子交给邻域决定：
    // ① 主色占比低的（混色、模糊）；② 前两名打平且两支**肉眼可分**的（自己拿不准）。
    // 第二种是关键：它们正是复核队列的大头，用邻域证据定下来，队列自然变短，
    // 而且这是"做了决定"，不是"把标记藏起来"。
    const muddy = (cell.dominantRatio ?? 1) < SMOOTH_MIN_CONFIDENCE;
    const ambiguous = (cell.runnerUpSeparation ?? 0) >= SMOOTH_MIN_SEPARATION
      && (cell.dominantRatio ?? 1) - (cell.runnerUpRatio ?? 0) < SMOOTH_MAX_GAP;
    if (!muddy && !ambiguous) return cell;
    const votes = new Map<string, number>();
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const id = ids[rowIndex + dr]?.[columnIndex + dc];
        if (id) votes.set(id, (votes.get(id) ?? 0) + 1);
      }
    }
    let winnerId: string | null = null;
    let winnerVotes = 0;
    for (const [id, count] of votes) if (count > winnerVotes) { winnerVotes = count; winnerId = id; }
    if (!winnerId || winnerId === cell.colorId || winnerVotes < SMOOTH_MIN_VOTES) return cell;
    const target = byId.get(winnerId);
    if (!target) return cell;
    changed += 1;
    const distance = deltaE2000(rgbToLab(...cell.sampleRgb), target.lab);
    return {
      ...cell,
      color: target.color,
      colorId: winnerId,
      distance,
      quality: qualityFor(cell.dominantRatio ?? 0, distance),
    };
  }));
  return { cells: output, changed };
}

export function recognizeImportImage(
  source: ImportImagePixels,
  calibration: ImportGridCalibration,
  palette: BeadColor[],
  mode: ImportRecognitionMode,
  alphaCutoff = DEFAULT_ALPHA_CUTOFF,
  options: ImportRecognitionOptions = {},
): ImportRecognitionResult {
  const context = createRecognitionContext(source, calibration, palette, mode, alphaCutoff, options);
  if (context.invalidCells) return createRecognitionResult(mode, context.calibration, context.invalidCells, context.edgeInsetRatio);
  const probe = probeCalibration(
    context,
    options.autoColorBalance === true || options.beadPhoto === true,
    options.autoAlign === true,
  );
  const tuned: RecognitionContext = {
    ...context,
    gains: probe.gains ?? NEUTRAL_GAINS,
    offset: probe.offset,
  };
  const cells = runCells(tuned);
  const smoothed = options.smooth === true ? smoothCells(cells, tuned) : null;
  const unify = options.unifyTwins ?? (options.beadPhoto === true);
  const unified = unify ? unifyTwinColors(smoothed?.cells ?? cells, tuned) : null;
  const result = createRecognitionResult(mode, context.calibration, unified?.cells ?? smoothed?.cells ?? cells, context.edgeInsetRatio, {
    colorGains: probe.gains, gridOffset: probe.offset, offsetGain: probe.offsetGain, sampledCells: probe.sampled,
  });
  if (smoothed) result.smoothing = { changed: smoothed.changed, threshold: SMOOTH_MIN_CONFIDENCE };
  if (unified) result.twinUnification = { remapped: unified.remapped };
  return result;
}

export async function recognizeImportImageAsync(
  source: ImportImagePixels,
  calibration: ImportGridCalibration,
  palette: BeadColor[],
  mode: ImportRecognitionMode,
  alphaCutoff = DEFAULT_ALPHA_CUTOFF,
  options: ImportRecognitionAsyncOptions = {},
): Promise<ImportRecognitionResult> {
  throwIfAborted(options.signal);
  const context = createRecognitionContext(source, calibration, palette, mode, alphaCutoff, options);
  let reportedProgress = 0;
  const report = (value: number) => {
    reportedProgress = Math.max(reportedProgress, value);
    options.onProgress?.(reportedProgress);
  };
  throwIfAborted(options.signal);
  report(0);
  throwIfAborted(options.signal);
  if (context.invalidCells) {
    throwIfAborted(options.signal);
    report(100);
    return createRecognitionResult(mode, context.calibration, context.invalidCells, context.edgeInsetRatio);
  }

  const probe = probeCalibration(
    context,
    options.autoColorBalance === true || options.beadPhoto === true,
    options.autoAlign === true,
  );
  throwIfAborted(options.signal);
  const tuned: RecognitionContext = {
    ...context,
    gains: probe.gains ?? NEUTRAL_GAINS,
    offset: probe.offset,
  };

  const cells: ImportRecognitionCell[][] = [];
  const batchSize = Number.isFinite(options.batchSize) ? Math.max(1, Math.floor(options.batchSize!)) : 256;
  const total = tuned.calibration.rows * tuned.calibration.columns;
  let completed = 0;
  let sliceStarted = performance.now();
  let row: ImportRecognitionCell[] = [];
  for (let index = 0; index < total; index += 1) {
    throwIfAborted(options.signal);
    const rowIndex = Math.floor(index / tuned.calibration.columns);
    const column = index % tuned.calibration.columns;
    if (column === 0) row = [];
    const processing = processRecognitionCell(tuned, rowIndex, column);
    let step = processing.next();
    while (step.done === false) {
      report(Math.min(99, (completed + step.value) / total * 100));
      throwIfAborted(options.signal);
      await yieldToEventLoop();
      throwIfAborted(options.signal);
      sliceStarted = performance.now();
      step = processing.next();
    }
    row.push(step.value);
    completed += 1;
    if (column === tuned.calibration.columns - 1) cells.push(row);
    if (completed % batchSize === 0 || completed === total || performance.now() - sliceStarted >= MAX_SLICE_MS) {
      report(Math.min(99, Math.floor(completed / total * 100)));
      throwIfAborted(options.signal);
      await yieldToEventLoop();
      sliceStarted = performance.now();
    }
  }
  throwIfAborted(options.signal);
  const smoothed = options.smooth === true ? smoothCells(cells, tuned) : null;
  const unify = options.unifyTwins ?? (options.beadPhoto === true);
  const unified = unify ? unifyTwinColors(smoothed?.cells ?? cells, tuned) : null;
  const result = createRecognitionResult(mode, context.calibration, unified?.cells ?? smoothed?.cells ?? cells, context.edgeInsetRatio, {
    colorGains: probe.gains, gridOffset: probe.offset, offsetGain: probe.offsetGain, sampledCells: probe.sampled,
  });
  if (smoothed) result.smoothing = { changed: smoothed.changed, threshold: SMOOTH_MIN_CONFIDENCE };
  if (unified) result.twinUnification = { remapped: unified.remapped };
  report(100);
  return result;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function createRecognitionResult(
  mode: ImportRecognitionMode,
  calibration: ImportGridCalibration,
  cells: ImportRecognitionCell[][],
  edgeInsetRatio: number,
  autoCorrection?: ImportRecognitionResult['autoCorrection'],
): ImportRecognitionResult {
  return { mode, calibration, edgeInsetRatio, cells, summary: summarizeRecognition(cells), autoCorrection };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Recognition was cancelled.', 'AbortError');
}

export function summarizeRecognition(cells: ImportRecognitionCell[][]): ImportRecognitionSummary {
  const flat = cells.flat();
  const mapped = flat.filter(cell => cell.status === 'mapped');
  const distances = mapped.flatMap(cell => cell.distance === null ? [] : [cell.distance]);
  const confidences = mapped.flatMap(cell => cell.confidence === null ? [] : [cell.confidence]);
  const meanDistance = distances.length ? distances.reduce((sum, value) => sum + value, 0) / distances.length : null;
  const meanConfidence = confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null;
  const quality = !mapped.length || (meanConfidence ?? 0) + RATIO_EPSILON < LOW_CONFIDENCE || (meanDistance ?? 0) > 15
    ? 'poor'
    : (meanConfidence ?? 0) < 0.8 || (meanDistance ?? 0) > 8 ? 'fair' : 'good';
  return {
    total: flat.length,
    mapped: mapped.length,
    blank: flat.filter(cell => cell.status === 'blank').length,
    invalid: flat.filter(cell => cell.status === 'invalid').length,
    distinctColors: new Set(mapped.map(cell => cell.colorId)).size,
    meanDistance,
    meanConfidence,
    lowConfidence: mapped.filter(cell => (cell.confidence ?? 0) + RATIO_EPSILON < LOW_CONFIDENCE || cell.quality === 'poor').length,
    quality,
  };
}

export function recognitionResultToCodeMatrix(result: ImportRecognitionResult): string[][] {
  return result.cells.map(row => row.map(cell => cell.status === 'mapped' ? cell.color?.code ?? '' : ''));
}
