import type { BeadColor } from '../types';
import { deltaE2000, rgbToLab } from './colorUtils';
import type { ImportImagePixels } from './importRecognition';
import type { ImportGridCalibration } from './importGridCalibration';

/**
 * 图例自动解析（importLegend）。
 *
 * 很多交流用图纸（如 MARD 图）在网格下方印着一排排"色点 + 色号 + NNN粒"
 * 的图例条——色点是作者标注的标准答案：粒数是全图的真值统计，色号圈定了
 * 本图使用的色板范围。解析图例即可获得「色板锁定 + 数量锁定」的全部输入。
 *
 * 架构（机制与 importSymbolOCR 同源，布局与先验来源不同，故独立成文件）：
 * 1. **图例带定位**：calibration 网格底边以下的带状区域，按"横向文字行"
 *    聚类出图例行（水印是浅灰、对比不足 60，天然被对比阈值挡住）；
 * 2. **间隙分段条目**：条目之间的空白（≥32px）远大于条目内字符间隙
 *    （≤12px），按横向间隙把一行字形切成条目——不依赖色点也能切分；
 * 3. **色点提取**：条目首字形若为"宽而实心"的块即为色点；浅粉/浅橙/白圈
 *    等低对比色点用低阈值（12）掩码在条目首字形左侧的小窗口里补搜；
 * 4. **code|count 切分**：色点先验长度与"空格"级间隙联合仲裁——图例字距
 *    紧凑，先验长度是主证据，间隙一致时互证、冲突时优先间隙并标记可疑；
 * 5. **code 全局一致性求解**：MARD 色板 221 色高度密集（相似色 ΔE<3），
 *    单条目"点色→最近色"会系统性选错。改为跨条目约束求解：把全部条目的
 *    code 字形按形状聚类（同一字符 → 同组），每组允许字符 = 组内所有
 *    条目候选 code 对应位字符的交集，迭代传播收窄候选集，再按"色点 ΔE
 *    最近 + 全局 code 唯一"逐条定解（与 symbolAssist 的"底色先验 +
 *    域数==色号长度"同一机制，只是先验来自色点色且全局联合求解）；
 * 6. **数字自举识别**：求解出的 code 字形即天然标注样本 → 数字模板 →
 *    粒数逐字符匹配 + 宽块等分切片回收（粘连数字对 / 粘连"粒"尾块）；
 * 7. **校验**：code ∈ 色板 / 去重 / Σcount ≤ 格数 / 条目数 vs 头部
 *    "N色"·"W×H" 交叉校验，逐条置信度；错误条目 confidence < 0.6 且带
 *    warn，UI 标黄让人工兜底。
 *
 * 全程确定性（无随机源、无时间源参与判定），同一输入两次解析逐位一致。
 */

/** 位图比较的平移搜索半径（px）：消除小字号采样的相位差。 */
const GLYPH_SHIFT = 2;
/** 文字掩码与带内底色的最小对比（RGB 欧氏距离）：低于此视为纸底。 */
const CONTRAST = 60;
/** 色点搜索掩码的最小对比：浅粉/浅橙/白圈色点远低于文字墨色对比。 */
const DOT_CONTRAST = 12;
/** 色点先验的色板距离上限：印刷色差通常 < 6，放宽到 12。 */
const PRIOR_MAX_DELTA_E = 12;
/** 色卡宽窗候选数（颜色只提名不裁决）。 */
const COLOR_TOPK_WIDE = 6;
/** 决定性先验锁：色票底色是印刷原色时（自家导出回灌/高清截图），色点远比
 * 7px 小字的字形 OCR 可靠——先验 ΔE 足够小且对同长度次名有显著领先时，
 * 直接锁定先验，不让全局求解用错位的字形装配覆盖它。 */
const PRIOR_LOCK_MAX_DELTA_E = 6;
const PRIOR_LOCK_MARGIN = 3.5;
/** 原色级先验（ΔE 极小，如无损 PNG 回灌）：领先要求放宽。 */
const PRIOR_LOCK_EXACT_DELTA_E = 1.2;
const PRIOR_LOCK_EXACT_MARGIN = 1.5;
/** 色点先验在最终置信度里的权重上限口径（与 symbolAssist 同量级）。 */
const COLOR_PRIOR_WEIGHT = 0.3;
/** 一行文字行里至少这么多暗像素才算"文字行"（按带宽度的比例下限）。 */
const LINE_DARK_MIN_RATIO = 0.004;
/** 行内连通域的最小面积（JPEG 噪点）。 */
const COMPONENT_MIN_AREA = 5;
/** 行内横向跨度过大的连通域是整行分隔线/卡片边框，不是字形。 */
const COMPONENT_MAX_WIDTH_RATIO = 0.6;
/** 文字行的最小高度（卡片边框线只有 1~4px，图例字形 ≥ 5px）。 */
const MIN_LINE_HEIGHT = 5;
/** 单字符模板匹配的拒绝阈值（Jaccard 距离）。 */
const GLYPH_MAX_DISTANCE = 0.35;
/** 切片匹配的拒绝阈值（切片含邻居渗入，比整字稍严）。 */
const SPLIT_MAX_DISTANCE = 0.4;
/** 合成模板优先采信上限：模糊字形对干净合成模板的距离普遍 0.2-0.4。 */
const SYNTH_PRIMARY_MAX_DISTANCE = 0.45;
/** 浏览器内合成锚自洽度上限：同字体渲染下标注可信，直接优先于代码锚。 */
const SYNTH_TRUSTED_MAX_MEDDIST = 0.45;
/** 计数字体模板的匹配阈值（计数区自建字体，同字距离更紧）。 */
const COUNT_MAX_DISTANCE = 0.32;
/** 计数字形聚类的同字符阈值（同字体同字符距离 ~0.1）。 */
const COUNT_GROUP_JACCARD = 0.22;
/** 同字符碎簇合并阈值（簇模板两两距离）。 */
const COUNT_MERGE_JACCARD = 0.26;
/** 诊断：最近一次计数模板构建的指派表（簇大小 → 数字），dbg 脚本用。 */
export const countTemplateAssignment: Array<{ size: number; dims: string; digit: string }> = [];
/** 最近一次 buildCountTemplates 选中的合成锚（多高度候选胜者）。recognizeEntry
 * 的联合匹配（matchCount）复用它——候选渲染高度由仲裁选出，调用方无需重复推断。 */
export const lastSyntheticAnchors: { current: Map<string, Bitmap> | null } = { current: null };
/** code|count 形状打平时改信先验所需的领先度下限。 */
const SHAPE_AMBIGUOUS_MARGIN = 0.08;
/** 少于这个条目数就不认为是图例条（单"条目"更可能是噪点或水印）。 */
const MIN_ENTRIES = 2;
/** 错误条目必须低于此置信度并带 warn（验收口径）。 */
export const LEGEND_LOW_CONFIDENCE = 0.6;
/** 粒数上限（图纸单色粒数不可能超过总格数 312×312）。 */
const COUNT_MAX = 999;
/** 条目间隙阈值下限：条目间距（≥32px）必须显著大于字内间隙（≤12px）。 */
const ENTRY_GAP_MIN = 16;
/** 色点最小宽度下限（另与行内字形中位宽联动）。 */
const DOT_MIN_WIDTH = 8;
/** 色点最小填充率（实心圆/方块；字形笔画填充率远低于此）。 */
const DOT_MIN_SOLIDNESS = 0.55;
/** 色点补搜窗口宽度：色点紧贴条目首字形左侧。 */
const DOT_SEARCH_WINDOW = 22;
/** 窄碎片（边框残片/水印碎线）：宽 ≤3 且面积 ≤10 一律丢弃。 */
const SLIVER_MAX_WIDTH = 3;
const SLIVER_MAX_AREA = 10;
/** code|count 空格间隙阈值下限（px）：图例字内间隙 ≤4，空格 ≥4。 */
const SPACE_GAP_MIN = 4;
/** 字形聚类的"同字符"判定阈值（Jaccard 距离）：取保守值——欠合并只是
 * 约束变弱（argmin/唯一性兜底），错合并会跨字符污染全局求解。 */
const GROUP_MAX_JACCARD = 0.18;
/** 候选窗：色点 ΔE 超出 argmin 这么多的色板色视为不可信（密集色板的
 * 远房相似色会污染跨条目交集）。 */
const PLAUSIBLE_WINDOW = 4;
/** 一致性求解的迭代上限（约束传播收敛很快）。 */
const PROPAGATION_ROUNDS = 6;
/** argmin 定解所需的最小 ΔE 领先度；低于此延迟到唯一性轮次。 */
const RESOLVE_MARGIN = 1.2;
/** 自举标注自洽守卫：同字符桶内"异形"分离阈值（Jaccard 距离）。
 * 同字体同字距离 ~0.1、异字 p50 ~0.44——桶内字形分出 ≥2 个相距超过
 * 此阈值（平均连接聚不出来）的模式，说明有错解 code 毒化标注。 */
const LABEL_CONSIST_JACCARD = 0.32;
/** 码字种子一致性门：自举成员与真值种子模板的距离上限（比
 * LABEL_CONSIST_JACCARD 松——洗淡字形与干净种子的距离 ~0.35-0.45，
 * 太严会把正确的干净字形也滤掉；太松留下 solver 毒标成员）。 */
const CODE_SEED_CONSIST = 0.45;

export interface LegendEntry {
  code: string;
  count: number;
  /** 0..1，综合色点先验、全局一致性与粒数匹配的证据强度。 */
  confidence: number;
  /** 异常说明（低置信/切分可疑/粒数未读出/色号不在色板……），供 UI 标黄。 */
  warn?: string;
  /** 条目色点的印刷色（可能缺）。色号未读出时供 UI 按色板最近色给建议。 */
  dotRgb?: [number, number, number];
}

export interface LegendChecks {
  codesInPalette: boolean;
  codesUnique: boolean;
  sumWithinGrid: boolean;
  sumCount: number;
  /** 头部"N 色"解析结果（可选；解析不出则缺省）。 */
  headerColorCount?: number;
  headerGridCols?: number;
  headerGridRows?: number;
}

export type LegendFailureReason = 'noLegendBand' | 'tooFewEntries' | 'templateStarved';

export interface LegendParseResult {
  ok: boolean;
  failureReason?: LegendFailureReason;
  /** ok=false 时为 []，UI 降级手动输入。 */
  entries: LegendEntry[];
  checks: LegendChecks;
}

export interface LegendParseOptions {
  /** 来自校准快照的网格行列数，做 Σcount 校验；缺省用 calibration。 */
  gridRows?: number;
  gridCols?: number;
  /**
   * 用户在画布上框选的图例区域（图像像素坐标，含端点）。提供时只在
   * 该区域内找图例（不再依据网格底边/右边缘推断），三种版式通吃：
   * 底部横条 / 右侧竖列 / 右上面板块。
   */
  region?: LegendFrameRect;
  /**
   * 已验证计数字种子模板（2026-11-24）：校对确认条目的数字字形（真实
   * 字体）。成员级重标注 + 并入终池——治小字号数字模板毒标（card4
   * '2'簇毒标'7'、5/6/9 并进 0/8 簇）。生产链路 = 校对后重识别。
   */
  countSeedTemplates?: Map<string, Bitmap | Bitmap[]> | null;
  /** 已验证条目的码字种子（真值标注的字形，校对后重识别的生产语义）：
   * 打破 "solver 毒解 → 模板桶被炸 → 缺字永错" 的鸡生蛋循环。 */
  codeSeedGlyphs?: Map<string, Bitmap[]> | null;
  /**
   * 静态基准锚（分版式隔离，独立于 prune 聚类，2026-11-24 card4 H14）：
   * 同版式已验证条目的真值字形，绕过 labeled/prune 直接补最终模板池的
   * 缺字。与 codeSeedGlyphs 的区别：种子并入自举桶会改 prune 聚类路径
   * （实测模板微移 0.04 翻转 E16），锚只补实时池缺失的字符（'H' 被炸
   * 后 join 仲裁无模板可用），不触碰现存桶——校验兜底定位，零扰动。
   * 跨版式导入锚前必须做字体一致性校验（票式字体与点状图例小字字体
   * 不通借，跨字体锚会系统性误标——water-box 缺 5/6/9 的老坑）。
   */
  codeAnchorGlyphs?: Map<string, Bitmap[]> | null;
}

/** 用户框选的图例区域（图像像素坐标，含端点）。 */
export interface LegendFrameRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 保比例位图：宽 × 高的 0/1 图。 */
export interface Bitmap {
  data: Uint8Array;
  w: number;
  h: number;
}

interface GlyphComp {
  /** 绝对图像坐标 bbox。 */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  area: number;
  rgb: [number, number, number];
  /** 众数色：连通域内占多数的量化色（色票=票面底色，字形=笔画墨色）。 */
  modeRgb: [number, number, number];
  /** 该连通域的原生分辨率位图（1:1 采样，避免上采样相位噪声）。 */
  bitmap: Bitmap;
}

/** 间隙分段出的条目：色点颜色（可能缺）+ 点后字形（code + count + "粒"）。 */
interface RawEntry {
  dotRgb: [number, number, number] | null;
  glyphs: GlyphComp[];
}

const clampInt = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));

const rgbDist2 = (a: [number, number, number], b: [number, number, number]) => {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
};

/** 区域内底色：RGB 高 4 位量化取众数桶，再取桶内均值（同 symbolOCR 口径）。 */
export function dominantBaseColor(
  data: Uint8ClampedArray, width: number,
  x0: number, y0: number, x1: number, y1: number,
): [number, number, number] {
  const counts = new Map<number, number>();
  const sums = new Map<number, [number, number, number, number]>();
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const c = (counts.get(key) ?? 0) + 1;
      counts.set(key, c);
      const s = sums.get(key);
      if (s) { s[0] += r; s[1] += g; s[2] += b; s[3] += 1; }
      else sums.set(key, [r, g, b, 1]);
    }
  }
  let bestKey = -1, bestCount = -1;
  for (const [key, count] of counts) if (count > bestCount) { bestCount = count; bestKey = key; }
  const s = sums.get(bestKey);
  if (!s) return [255, 255, 255];
  return [Math.round(s[0] / s[3]), Math.round(s[1] / s[3]), Math.round(s[2] / s[3])];
}

/**
 * 众数色：RGB 高 4 位量化取众数桶再取桶内均值。
 * 右侧清单的色票中央印着色号文字（中心 3×3 采样会命中文字色），
 * 众数才是票面底色——文字像素是少数派。
 */
function modeColorOf(colors: Array<[number, number, number]>): [number, number, number] {
  const counts = new Map<number, number>();
  const sums = new Map<number, [number, number, number, number]>();
  for (const [r, g, b] of colors) {
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const c = (counts.get(key) ?? 0) + 1;
    counts.set(key, c);
    const s = sums.get(key);
    if (s) { s[0] += r; s[1] += g; s[2] += b; s[3] += 1; }
    else sums.set(key, [r, g, b, 1]);
  }
  let bestKey = -1, bestCount = -1;
  for (const [key, count] of counts) if (count > bestCount) { bestCount = count; bestKey = key; }
  const s = sums.get(bestKey);
  if (!s) return [255, 255, 255];
  return [Math.round(s[0] / s[3]), Math.round(s[1] / s[3]), Math.round(s[2] / s[3])];
}

interface RawComponent {
  pixels: Array<[number, number]>;
  minX: number; maxX: number; minY: number; maxY: number;
}

function connectedComponents(mask: Uint8Array, w: number, h: number): RawComponent[] {
  const seen = new Uint8Array(mask.length);
  const out: RawComponent[] = [];
  const queue: number[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    queue.length = 0;
    queue.push(start);
    const pixels: Array<[number, number]> = [];
    let minX = w, maxX = -1, minY = h, maxY = -1;
    while (queue.length) {
      const idx = queue.pop()!;
      const y = Math.floor(idx / w), x = idx % w;
      pixels.push([x, y]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[idx - 1] && !seen[idx - 1]) { seen[idx - 1] = 1; queue.push(idx - 1); }
      if (x < w - 1 && mask[idx + 1] && !seen[idx + 1]) { seen[idx + 1] = 1; queue.push(idx + 1); }
      if (y > 0 && mask[idx - w] && !seen[idx - w]) { seen[idx - w] = 1; queue.push(idx - w); }
      if (y < h - 1 && mask[idx + w] && !seen[idx + w]) { seen[idx + w] = 1; queue.push(idx + w); }
    }
    out.push({ pixels, minX, maxX, minY, maxY });
  }
  return out;
}

// connectedComponents 的颜色回读借助模块级临时表（仅在 analyzeLine 内有值）。
const maskColorAt = new Map<number, [number, number, number]>();

/** 原生分辨率位图：bbox 区域 1:1 采样（图例字形只有 5~9px，上采样会产生相位噪声）。 */
function normalizeBand(mask: Uint8Array, w: number, comp: RawComponent): Bitmap {
  const bw = comp.maxX - comp.minX + 1;
  const bh = comp.maxY - comp.minY + 1;
  const data = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      data[y * bw + x] = mask[(comp.minY + y) * w + (comp.minX + x)] ? 1 : 0;
    }
  }
  return { data, w: bw, h: bh };
}

/** 位图拉伸到目标宽高（最近邻采样）。 */
function stretchBitmap(b: Bitmap, w: number, h: number): Bitmap {
  if (b.w === w && b.h === h) return b;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(b.h - 1, Math.floor((y * b.h) / h));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(b.w - 1, Math.floor((x * b.w) / w));
      data[y * w + x] = b.data[sy * b.w + sx];
    }
  }
  return { data, w, h };
}

/**
 * 位图 Jaccard 距离：拉伸到公共宽高后做 ±GLYPH_SHIFT 平移搜索取最小值。
 * 图例字形只有 5~9px，同字符两次印刷的采样相位差会造成 1~2px 错位，
 * 平移搜索把"同字符"的距离压回 0.1~0.2、"异字符"保持在 0.3 以上。
 */
export const bitmapJaccard = (a: Bitmap, b: Bitmap): number => {
  const w = Math.max(a.w, b.w);
  const h = Math.max(a.h, b.h);
  const sa = stretchBitmap(a, w, h);
  const sb = stretchBitmap(b, w, h);
  let best = 1;
  for (let dy = -GLYPH_SHIFT; dy <= GLYPH_SHIFT; dy += 1) {
    for (let dx = -GLYPH_SHIFT; dx <= GLYPH_SHIFT; dx += 1) {
      let inter = 0, union = 0;
      for (let y = 0; y < h; y += 1) {
        const ay = y + dy;
        if (ay < 0 || ay >= h) continue;
        for (let x = 0; x < w; x += 1) {
          const ax = x + dx;
          const av = ax >= 0 && ax < w ? sa.data[ay * w + ax] : 0;
          const bv = sb.data[y * w + x];
          if (av && bv) inter += 1;
          if (av || bv) union += 1;
        }
      }
      const d = union === 0 ? 1 : 1 - inter / union;
      if (d < best) best = d;
    }
  }
  return best;
};

/** 居中填充到位图框（不拉伸）：跨尺寸比对时保形。 */
function padCenterBitmap(b: Bitmap, w: number, h: number): Bitmap {
  if (b.w === w && b.h === h) return b;
  const data = new Uint8Array(w * h);
  const ox = Math.floor((w - b.w) / 2);
  const oy = Math.floor((h - b.h) / 2);
  for (let y = 0; y < b.h; y += 1) {
    for (let x = 0; x < b.w; x += 1) {
      data[(y + oy) * w + (x + ox)] = b.data[y * b.w + x];
    }
  }
  return { data, w, h };
}

/**
 * 居中填充版位图 Jaccard：与 bitmapJaccard 同样的 ±shift 搜索，但用居中
 * 填充代替拉伸对齐。跨尺寸比对（合成锚 '4' 6px 宽 vs 真实字形 5px 宽）
 * 时拉伸会压掉 '4' 的斜线使其形似 '5'——浏览器实测簇误标的根因。
 */
const bitmapJaccardPad = (a: Bitmap, b: Bitmap): number => {
  const w = Math.max(a.w, b.w);
  const h = Math.max(a.h, b.h);
  const pa = padCenterBitmap(a, w, h);
  const pb = padCenterBitmap(b, w, h);
  let best = 1;
  for (let dy = -GLYPH_SHIFT; dy <= GLYPH_SHIFT; dy += 1) {
    for (let dx = -GLYPH_SHIFT; dx <= GLYPH_SHIFT; dx += 1) {
      let inter = 0, union = 0;
      for (let y = 0; y < h; y += 1) {
        const ay = y + dy;
        if (ay < 0 || ay >= h) continue;
        for (let x = 0; x < w; x += 1) {
          const ax = x + dx;
          const av = ax >= 0 && ax < w ? pa.data[ay * w + ax] : 0;
          const bv = pb.data[y * w + x];
          if (av && bv) inter += 1;
          if (av || bv) union += 1;
        }
      }
      const d = union === 0 ? 1 : 1 - inter / union;
      if (d < best) best = d;
    }
  }
  return best;
};

/** 位图等分切片：把粘连的 k 个字符按宽度等分（用于粘连数字回收）。 */
export function splitBitmap(b: Bitmap, k: number): Bitmap[] {
  const out: Bitmap[] = [];
  for (let i = 0; i < k; i += 1) {
    const gx0 = Math.floor((i * b.w) / k);
    const gx1 = Math.floor(((i + 1) * b.w) / k);
    const w = Math.max(1, gx1 - gx0);
    const data = new Uint8Array(w * b.h);
    for (let y = 0; y < b.h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        data[y * w + x] = gx0 + x < b.w ? b.data[y * b.w + gx0 + x] : 0;
      }
    }
    out.push({ data, w, h: b.h });
  }
  return out;
}

interface LineScan {
  y0: number;
  y1: number;
  /** 行内暗像素的 x 范围（用于裁剪 bbox，减少背景噪声）。 */
  minX: number;
  maxX: number;
}

type LegendRegion = 'bottom' | 'right' | 'chip-small';

interface LegendLocation {
  background: [number, number, number];
  lines: LineScan[];
  region: LegendRegion;
  /** 右侧带由色票锚定行分割产生：每行必有前导色票，走整行点锚路径。 */
  anchored: boolean;
  /** 用户框选区域：走多条目装配路径（一行可含多个条目）。 */
  framed: boolean;
  /** 芯片式图例（圆角色卡网格）：chipBoxes 直接给出每张色卡 bbox。 */
  chips?: boolean;
  chipBoxes?: Array<{ x0: number; y0: number; x1: number; y1: number }>;
}

/**
 * 在矩形区域内按"横向文字行"聚类：每行的暗像素计数达标即为文字行，
 * 行间空隙 >1px 断行。底部图例条与右侧竖排清单的每一行都是横向文字，
 * 同一扫描器通吃；区别只在候选区域与暗像素下限的分母（带宽）。
 */
function scanTextLines(
  source: ImportImagePixels,
  background: [number, number, number],
  x0: number, x1: number,
  y0: number, y1: number,
): LineScan[] {
  const { data, width } = source;
  const darkMin = Math.max(6, Math.round((x1 - x0 + 1) * LINE_DARK_MIN_RATIO));
  const rows = y1 - y0 + 1;
  const counts = new Int32Array(rows);
  const rowMinX = new Int32Array(rows).fill(width);
  const rowMaxX = new Int32Array(rows).fill(-1);
  const contrast2 = CONTRAST * CONTRAST;
  for (let y = y0; y <= y1; y += 1) {
    const row = y - y0;
    for (let x = x0; x <= x1; x += 1) {
      const i = (y * width + x) * 4;
      const dr = data[i] - background[0], dg = data[i + 1] - background[1], db = data[i + 2] - background[2];
      if (dr * dr + dg * dg + db * db > contrast2) {
        counts[row] += 1;
        if (x < rowMinX[row]) rowMinX[row] = x;
        if (x > rowMaxX[row]) rowMaxX[row] = x;
      }
    }
  }
  const lines: LineScan[] = [];
  const flush = (start: number, end: number) => {
    if (end - start + 1 < MIN_LINE_HEIGHT) return;
    let minX = width, maxX = -1;
    // start/end 是绝对 y，rowMinX/rowMaxX 按 y-y0 相对索引——用绝对 y
    // 直索引会在 bandTop≠0 的带里越界读 undefined，行被静默丢弃。
    for (let y = start; y <= end; y += 1) {
      const row = y - y0;
      if (rowMinX[row] < minX) minX = rowMinX[row];
      if (rowMaxX[row] > maxX) maxX = rowMaxX[row];
    }
    if (maxX >= minX) lines.push({ y0: start, y1: end, minX, maxX });
  };
  let start = -1;
  let gap = 0;
  // 注意：y0 是行的起点，start/gap 都以绝对 y 记录。
  for (let y = y0; y <= y1; y += 1) {
    const on = counts[y - y0] >= darkMin;
    if (on) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      if (gap > 1) {
        flush(start, y - gap);
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0) flush(start, y1);
  return lines;
}

/**
 * 右侧竖排清单的行分割：行距太密（相邻行文字几乎相接）时按暗像素行聚类
 * 会把多行并成一条——改用色票锚定。清单每行以色票开头且色票列 x 对齐：
 * 低对比掩码里找"实心块状"连通域（色票），按 x0 聚出最左达标簇，再按
 * 节距插值补齐粘连丢失行的虚拟锚点。找不到足量色票（≥5）时回落普通
 * 文字行聚类。
 */
function swatchAnchoredLines(
  source: ImportImagePixels,
  background: [number, number, number],
  bandLeft: number,
  bounds?: LegendFrameRect,
): LineScan[] | null {
  const { data, width, height } = source;
  // bounds（用户框选区域）把扫描限制在矩形内；缺省扫 bandLeft 右侧全高。
  const rx0 = bounds ? Math.max(0, Math.min(bandLeft, bounds.x0)) : bandLeft;
  const rx1 = bounds ? Math.min(width - 1, bounds.x1) : width - 1;
  const ry0 = bounds ? Math.max(0, bounds.y0) : 0;
  const ry1 = bounds ? Math.min(height - 1, bounds.y1) : height - 1;
  const w = rx1 - rx0 + 1;
  const h = ry1 - ry0 + 1;
  if (w < 8 || h < 8) return null;
  const contrast2 = DOT_CONTRAST * DOT_CONTRAST;
  const mask = new Uint8Array(w * h);
  const colors = new Map<number, [number, number, number]>();
  for (let y = ry0; y <= ry1; y += 1) {
    for (let x = rx0; x <= rx1; x += 1) {
      const i = (y * width + x) * 4;
      const dr = data[i] - background[0], dg = data[i + 1] - background[1], db = data[i + 2] - background[2];
      if (dr * dr + dg * dg + db * db > contrast2) {
        mask[((y - ry0) * w) + (x - rx0)] = 1;
        colors.set((y - ry0) * w + (x - rx0), [data[i], data[i + 1], data[i + 2]]);
      }
    }
  }
  let on = 0;
  for (let k = 0; k < mask.length; k += 1) if (mask[k]) on += 1;
  if (on === 0) return null;
  lastSwatchDebug.length = 0;
  const swatches: Array<{ x0: number; x1: number; y0: number; y1: number; area: number }> = [];
  for (const comp of connectedComponents(mask, w, h)) {
    const cw = comp.maxX - comp.minX + 1;
    const ch = comp.maxY - comp.minY + 1;
    const solidness = comp.pixels.length / (cw * ch);
    const compColors: Array<[number, number, number]> = [];
    for (const [px, py] of comp.pixels) {
      const color = colors.get(py * w + px);
      if (color) compColors.push(color);
    }
    const modeRgb = modeColorOf(compColors);
    const debug: SwatchDebug = {
      x0: comp.minX + rx0, x1: comp.maxX + rx0, y0: comp.minY + ry0, y1: comp.maxY + ry0,
      area: comp.pixels.length, solidness: Math.round(solidness * 100) / 100, modeRgb, kept: false,
    };
    let keep = true;
    // 色票是行内最大的块：比文字行高（码字/标题字形 h≤12），且接近方形
    // （计数文字带光晕是 2:1 以上的扁块）。这两个形状特征先筛掉 90% 噪块。
    const aspect = cw / ch;
    if (keep && (ch < 12 || cw < 8 || cw > 44 || ch > 44 || aspect < 0.3 || aspect > 1.9 || solidness < 0.35)) keep = false;
    debug.kept = keep;
    lastSwatchDebug.push(debug);
    if (!keep) continue;
    swatches.push({ x0: debug.x0, x1: debug.x1, y0: debug.y0, y1: debug.y1, area: debug.area });
  }
  if (swatches.length < 5) return null;
  // 色票列对齐：x0 聚类（相邻间隙 >8px 分簇），取"最左且成员达标"的簇——
  // 色票列必然在所有文本列的左边；浅色票与面板边框粘连被形状筛丢弃后，
  // 真色票列成员数仍远超其他列（≥4 成），取最左达标簇即可容忍缺失。
  swatches.sort((a, b) => a.x0 - b.x0);
  const clusters: Array<typeof swatches> = [];
  let current: typeof swatches = [swatches[0]];
  for (let i = 1; i < swatches.length; i += 1) {
    if (swatches[i].x0 - swatches[i - 1].x0 > 8) { clusters.push(current); current = [swatches[i]]; }
    else current.push(swatches[i]);
  }
  clusters.push(current);
  const minMembers = Math.max(5, Math.round(swatches.length * 0.4));
  const column = clusters.find(items => items.length >= minMembers);
  if (!column || column.length < 5) return null;
  // 节距插值：粘连丢失的行（E2/G16）在锚点序列里留下 2× 节距的大空洞。
  // 相邻锚点 y0 间距 >1.6× 中位节距时按间距均分插虚拟锚点，行条带用
  // 中位票高兜底。插值数超过实锚数说明节距误判（比如把真节距读成一半），
  // 直接放弃锚定回落文字行聚类。
  column.sort((a, b) => a.y0 - b.y0);
  const pitches: number[] = [];
  for (let i = 1; i < column.length; i += 1) {
    const gap = column[i].y0 - column[i - 1].y0;
    if (gap > 0) pitches.push(gap);
  }
  const pitch = median(pitches);
  const swatchH = median(column.map(s => s.y1 - s.y0 + 1));
  if (!(pitch >= MIN_LINE_HEIGHT)) return null;
  const anchors: Array<{ y0: number; y1: number; virtual: boolean }> = [];
  for (let i = 0; i < column.length; i += 1) {
    const s = column[i];
    anchors.push({ y0: s.y0, y1: s.y1, virtual: false });
    if (i + 1 >= column.length) continue;
    const gap = column[i + 1].y0 - s.y0;
    if (gap <= pitch * 1.6) continue;
    const steps = Math.round(gap / pitch);
    if (steps < 2 || steps > 6) continue;
    for (let k = 1; k < steps; k += 1) {
      const y = Math.round(s.y0 + (gap * k) / steps);
      anchors.push({ y0: y, y1: y + swatchH - 1, virtual: true });
    }
  }
  const virtualCount = anchors.filter(a => a.virtual).length;
  if (virtualCount > anchors.length - virtualCount) return null;
  // 每个锚点生成行条带：票顶上 2px 到票底下 2px，行内暗像素的 x 范围
  // 在限定区域内扫描（框选模式只看框内）。
  anchors.sort((a, b) => a.y0 - b.y0);
  const lines: LineScan[] = [];
  const contrast = CONTRAST * CONTRAST;
  for (const anchor of anchors) {
    const y0 = Math.max(ry0, anchor.y0 - 2), y1 = Math.min(ry1, anchor.y1 + 2);
    let minX = width, maxX = -1;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = rx0; x <= rx1; x += 1) {
        const i = (y * width + x) * 4;
        const dr = data[i] - background[0], dg = data[i + 1] - background[1], db = data[i + 2] - background[2];
        if (dr * dr + dg * dg + db * db > contrast) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    if (maxX >= minX) lines.push({ y0, y1, minX, maxX });
  }
  return lines;
}

/**
 * 图例带定位：底部（网格底边以下）与右侧（网格右边缘以右）两个候选区域
 * 都收集为候选（不分胜负）。提供用户框选区域时只返回框选区域的单一候选。
 * 生成型图纸三种版式都常见：WATER BOX 横条在底部；瑶/大耳狗清单在右侧
 * 或右上面板块（框选区域兜一切版式）。
 */
function locateLegendCandidates(
  source: ImportImagePixels,
  calibration: ImportGridCalibration,
  framed?: LegendFrameRect,
): LegendLocation[] {
  const { data, width, height } = source;
  if (framed) {
    // 芯片式优先：框选区域内检测到 ≥4 张色卡芯片时直通芯片路径。
    const chipCandidates = locateChipCandidates(source, calibration, framed);
    if (chipCandidates.length) return chipCandidates;
    const x0 = clampInt(framed.x0, 0, width - 1);
    const x1 = clampInt(framed.x1, x0, width - 1);
    const y0 = clampInt(framed.y0, 0, height - 1);
    const y1 = clampInt(framed.y1, y0, height - 1);
    if (x1 - x0 < 24 || y1 - y0 < 16) return [];
    const background = dominantBaseColor(data, width, x0, y0, x1, y1);
    const anchoredLines = swatchAnchoredLines(source, background, x0, { x0, y0, x1, y1 });
    const lines = anchoredLines ?? scanTextLines(source, background, x0, x1, y0, y1);
    if (!lines.length) return [];
    return [{
      background,
      lines,
      region: anchoredLines ? 'right' : 'bottom',
      anchored: anchoredLines !== null,
      framed: true,
    }];
  }
  const candidates: LegendLocation[] = [];
  // 底部带（原行为）。
  const gridBottom = calibration.originY + calibration.rows * calibration.cellHeight;
  const bandTop = Math.min(height - 1, Math.max(0, Math.floor(gridBottom) + 2));
  if (height - bandTop >= 8) {
    const background = dominantBaseColor(data, width, 0, bandTop, width, height);
    const lines = scanTextLines(source, background, 0, width - 1, bandTop, height - 1);
    lastLocationDebug.push({ region: 'bottom', anchored: false, lines: lines.length, rawEntries: -1 });
    if (lines.length) candidates.push({ background, lines, region: 'bottom', anchored: false, framed: false });
  } else {
    lastLocationDebug.push({ region: 'bottom', anchored: false, lines: -1, rawEntries: -1 });
  }
  // 右侧带（竖排清单）：优先色票锚定行分割，色票不足时回落文字行聚类。
  const gridRight = calibration.originX + calibration.columns * calibration.cellWidth;
  const bandLeft = Math.min(width - 1, Math.max(0, Math.floor(gridRight) + 2));
  if (bandLeft > 0 && width - bandLeft >= 8) {
    const background = dominantBaseColor(data, width, bandLeft, 0, width, height);
    const anchoredLines = swatchAnchoredLines(source, background, bandLeft);
    const lines = anchoredLines ?? scanTextLines(source, background, bandLeft, width - 1, 0, height - 1);
    lastLocationDebug.push({ region: 'right', anchored: anchoredLines !== null, lines: lines.length, rawEntries: -1 });
    if (lines.length) candidates.push({ background, lines, region: 'right', anchored: anchoredLines !== null, framed: false });
  }
  // 芯片式候选：与线式候选一起进仲裁（芯片条目全带色票先验，点锚分占优）。
  candidates.push(...locateChipCandidates(source, calibration));
  return candidates;
}

/**
 * 芯片式图例（圆角色卡网格，如「只只拼豆图」导出图）：色卡是大块实色
 * 圆角矩形（宽约 50~150px），码与数量印在卡内（深卡白字/浅卡黑字），
 * 三侧还可能压着水印。检测原理：色卡在行内形成 ≥40px 的实色游程——
 * 水印细线（1~5px）与文字（<20px）天然不过游程门槛，圆角只影响
 * 首末几行（游程仍过门槛）。每张卡产出一个条目：
 * { dotRgb: 卡色（整卡众数，先验极准）, glyphs: 卡内文字连通域 }，
 * 之后走既有切分/求解/自举/计数机器。
 */
const CHIP_MIN_RUN = 40;
/** 小码块回退游程：猴子图式图例的彩色码块仅 ~18px 宽（字印在块上，
 * 中部行被文字打断，只有上下垫边是实色），40px 门槛永远检不到。
 * 回退值 12 仍高于粗体数字笔画游程（~3px），垫边游程 ~14px 可过。 */
const CHIP_MIN_RUN_SMALL = 12;
const CHIP_MAX_W = 200;
const CHIP_MIN_H = 12;
const CHIP_MAX_H = 80;

export function detectLegendChips(
  source: ImportImagePixels,
  background: [number, number, number],
  x0: number, y0: number, x1: number, y1: number,
  minRun: number = CHIP_MIN_RUN,
): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  const { data, width } = source;
  const contrast2 = CONTRAST * CONTRAST;
  // 1) 逐行找长实色游程（只记录 ≥CHIP_MIN_RUN 的，天然滤掉文字/细水印线）。
  //    超过 CHIP_MAX_W 的游程直接丢弃——那是行间分隔条/表线（狗狗图橙色
  //    分隔条 1108px 宽），不是芯片；且它会以 100% 重叠吞并同带所有小
  //    芯片游程，整带聚类报废。
  const rows: Array<{ y: number; runs: Array<[number, number]> }> = [];
  for (let y = y0; y <= y1; y += 1) {
    const runs: Array<[number, number]> = [];
    let start = -1;
    for (let x = x0; x <= x1 + 1; x += 1) {
      let on = false;
      if (x <= x1) {
        const i = (y * width + x) * 4;
        const dr = data[i] - background[0], dg = data[i + 1] - background[1], db = data[i + 2] - background[2];
        on = dr * dr + dg * dg + db * db > contrast2;
      }
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start >= minRun && x - start <= CHIP_MAX_W) runs.push([start, x - 1]);
        start = -1;
      }
    }
    if (runs.length) rows.push({ y, runs });
  }
  if (!rows.length) return [];
  // 2) 游程行按 y 连续性聚成带（行间不留空行 → 同一张卡）。
  const boxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  let band: Array<{ y: number; runs: Array<[number, number]> }> = [];
  const flushBand = () => {
    if (!band.length) return;
    const bandY0 = band[0].y, bandY1 = band[band.length - 1].y;
    const bandH = bandY1 - bandY0 + 1;
    const bandRows = band;
    band = [];
    if (bandH < CHIP_MIN_H || bandH > CHIP_MAX_H) return;
    // 3) 带内游程按 x 重叠聚簇（≥50% 交叠比归同卡；卡间 gap>8px 不重叠）。
    const clusters: Array<{ x0: number; x1: number }> = [];
    for (const { runs } of bandRows) {
      for (const [rx0, rx1] of runs) {
        const target = clusters.find(c => {
          const inter = Math.min(c.x1, rx1) - Math.max(c.x0, rx0) + 1;
          return inter > 0 && inter / Math.min(c.x1 - c.x0 + 1, rx1 - rx0 + 1) >= 0.5;
        });
        if (!target) clusters.push({ x0: rx0, x1: rx1 });
        else { target.x0 = Math.min(target.x0, rx0); target.x1 = Math.max(target.x1, rx1); }
      }
    }
    for (const c of clusters) {
      if (c.x1 - c.x0 + 1 > CHIP_MAX_W) continue;
      boxes.push({ x0: c.x0, y0: bandY0, x1: c.x1, y1: bandY1 });
    }
  };
  for (const row of rows) {
    if (band.length && row.y === band[band.length - 1].y + 1) band.push(row);
    else { flushBand(); band = [row]; }
  }
  flushBand();
  return boxes;
}

/** 芯片 → 条目：卡色当色票先验，卡内文字（对卡色对比）当码字+计数字形。 */
function collectChipEntries(
  source: ImportImagePixels,
  located: LegendLocation,
): { rawEntries: RawEntry[]; digitW: number } {
  const boxes = [...(located.chipBoxes ?? [])].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const rawEntries: RawEntry[] = [];
  const digitWidths: number[] = [];
  for (const box of boxes) {
    const boxW = box.x1 - box.x0 + 1;
    // 列级码块/数量格切分：小码块图例（猴子图式）的框常连着药丸边框行与
    // 白底数量格——码块贴框左缘，数量格≈条带底色。逐列取众数色，与底色
    // 明显不同（dist²>800）的连续列 = 码块；其后是计数区（含框外尾随）。
    const { data, width } = source;
    const bg = located.background;
    const colMode = (x: number) => {
      const counts = new Map<number, number>();
      for (let y = box.y0; y <= box.y1; y += 1) {
        const i = (y * width + x) * 4;
        const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let bestKey = -1, bestCount = -1;
      for (const [key, count] of counts) if (count > bestCount) { bestCount = count; bestKey = key; }
      return [((bestKey >> 8) & 15) * 16 + 8, ((bestKey >> 4) & 15) * 16 + 8, (bestKey & 15) * 16 + 8] as [number, number, number];
    };
    let chipEnd = box.x0 - 1;
    for (let x = box.x0; x <= box.x1; x += 1) {
      const [r, g, b] = colMode(x);
      const dr = r - bg[0], dg = g - bg[1], db = b - bg[2];
      if (dr * dr + dg * dg + db * db > 800) chipEnd = x;
      else break;
    }
    if (chipEnd < box.x0 + 3) continue; // 没有可辨的彩色码块
    const chipColor = dominantBaseColor(data, width, box.x0, box.y0, chipEnd + 1, box.y1 + 1);
    // 码块内文字（对卡色做对比掩码，深卡白字同样弹出）。左界 +3 避开
    // 卡缘边框列——边框混进首字形会毒化码字匹配（僵尸图实测 A17→A8）。
    const line: LineScan = { y0: box.y0 + 3, y1: box.y1 - 3, minX: box.x0 + 3, maxX: chipEnd - 1 };
    const comps = analyzeLine(source, chipColor, line)
      .filter(c => widthOf(c) < (chipEnd - box.x0) * 0.7 && c.x0 >= box.x0 + 3 && c.x1 <= chipEnd)
      .sort((a, b) => a.x0 - b.x0);
    // 计数区：码块右侧到同行下一卡左缘（含白底数量格与框外尾随两种形态）。
    const next = boxes.find(b => b !== box && b.y0 < box.y1 && b.y1 > box.y0 && b.x0 > box.x1);
    const trailLimit = Math.min(next ? next.x0 - 2 : box.x1 + boxW * 2 + 6, box.x1 + boxW * 2 + 6);
    if (trailLimit - (chipEnd + 3) >= 4) {
      const trailLine: LineScan = { y0: box.y0 + 2, y1: box.y1 - 2, minX: chipEnd + 3, maxX: trailLimit };
      const trail = analyzeLine(source, bg, trailLine)
        .filter(c => c.x0 >= chipEnd + 3 && c.x1 <= trailLimit && widthOf(c) <= boxW)
        .sort((a, b) => a.x0 - b.x0)
        .slice(0, 5);
      comps.push(...trail);
      comps.sort((a, b) => a.x0 - b.x0);
    }
    // 码块内 1-2 字形（"H2"）也合法——不再要求 ≥3。
    if (comps.length < 2) continue;
    rawEntries.push({ dotRgb: chipColor, glyphs: comps });
    for (const g of comps) digitWidths.push(widthOf(g));
  }
  return { rawEntries, digitW: Math.max(3, median(digitWidths)) };
}

/** 芯片候选：带内（网格底边以下 / 框选区域内）检测 ≥4 张卡才成立。 */
function locateChipCandidates(
  source: ImportImagePixels,
  calibration: ImportGridCalibration,
  framed?: LegendFrameRect,
  allowSmallRun = false,
): LegendLocation[] {
  const { width, height } = source;
  const bands: Array<{ x0: number; y0: number; x1: number; y1: number; framed: boolean }> = [];
  if (framed) {
    bands.push({
      x0: clampInt(framed.x0, 0, width - 1),
      x1: clampInt(framed.x1, 0, width - 1),
      y0: clampInt(framed.y0, 0, height - 1),
      y1: clampInt(framed.y1, 0, height - 1),
      framed: true,
    });
  } else {
    const gridBottom = calibration.originY + calibration.rows * calibration.cellHeight;
    const bandTop = Math.min(height - 1, Math.max(0, Math.floor(gridBottom) + 2));
    bands.push({ x0: 0, x1: width - 1, y0: bandTop, y1: height - 1, framed: false });
    // 标定偏移时 gridBottom 可能盖住图例：底 25% 回退带。
    const edgeTop = Math.max(0, height - Math.round(height * 0.25));
    if (edgeTop < bandTop - 8) bands.push({ x0: 0, x1: width - 1, y0: edgeTop, y1: height - 1, framed: false });
  }
  const candidates: LegendLocation[] = [];
  for (const band of bands) {
    if (band.y1 - band.y0 < CHIP_MIN_H + 4 || band.x1 - band.x0 < CHIP_MIN_RUN * 2) continue;
    const background = dominantBaseColor(source.data, width, band.x0, band.y0, band.x1 + 1, band.y1 + 1);
    const chipBoxes = allowSmallRun
      ? detectLegendChips(source, background, band.x0, band.y0, band.x1, band.y1, CHIP_MIN_RUN_SMALL)
      : detectLegendChips(source, background, band.x0, band.y0, band.x1, band.y1);
    if (chipBoxes.length < 4) continue;
    candidates.push({ background, lines: [], region: 'bottom', anchored: false, framed: band.framed, chips: true, chipBoxes });
  }
  return candidates;
}

/**
 * 图像边缘回退带：用户把识别区域框得很大（图例条被框进识别区域内）或
 * 标定整体偏移时，gridBottom/gridRight 落在图例之下/之右，两个候选带都
 * 扫不到图例。图例几乎总贴近图像底边或右边缘——按图像尺寸取底 25% /
 * 右 25% 作为回退候选。只在常规候选切不出足量条目时才参与仲裁
 * （见 selectLegendLocation），避免豆格行误判成图例。
 */
function locateEdgeCandidates(source: ImportImagePixels): LegendLocation[] {
  const { data, width, height } = source;
  const candidates: LegendLocation[] = [];
  // framed: true —— 边缘带版式未知，走多条目装配（含水印碎行守卫与
  // 计数残组归并），与用户框选区域同一条路径。
  const bottomTop = Math.max(0, height - Math.round(height * 0.25));
  if (height - bottomTop >= 24) {
    const background = dominantBaseColor(data, width, 0, bottomTop, width, height);
    const lines = scanTextLines(source, background, 0, width - 1, bottomTop, height - 1);
    if (lines.length) candidates.push({ background, lines, region: 'bottom', anchored: false, framed: true });
  }
  const rightLeft = Math.max(0, width - Math.round(width * 0.25));
  if (width - rightLeft >= 24) {
    const background = dominantBaseColor(data, width, rightLeft, 0, width, height);
    const anchoredLines = swatchAnchoredLines(source, background, rightLeft);
    const lines = anchoredLines ?? scanTextLines(source, background, rightLeft, width - 1, 0, height - 1);
    if (lines.length) candidates.push({ background, lines, region: 'right', anchored: anchoredLines !== null, framed: true });
  }
  return candidates;
}

/**
 * 区域仲裁：两个候选带各自跑一遍条目切分，点锚条目数（dotRgb ≠ null）
 * 多者胜、总条目数辅——真图例的条目几乎都有色点/色票，水印/豆格凑出的
 * 垃圾条目没有。并列时保持候选顺序（底部优先，旧路径行为）。
 *
 * 框选区域（framed）直通：不做仲裁。常规候选的"最强带"点锚条目很少
 * （<EDGE_GATE_MIN，典型场景：识别区域把图例框了进去，右带靠头部数字
 * 与水印凑出几条垃圾）时，图像边缘回退带才参与仲裁——常规带健康时
 * （真标定下 27 条）边缘带不介入，豆格/页脚碎屑没有机会翻盘。
 */
const EDGE_GATE_MIN = 8;

/** 小码块救援门槛：常规路径条目数低于此值即视为「凑不出像样结果」，跑 12px
 * 小游程救援。垃圾装配（分隔条/水印/豆格碎屑）通常只出 1-3 条，真图例条
 * 最小实测 11 条——取 6 作分界（2026-11-24 狗狗图左缘裁 4px 实证：
 * 旧门槛 MIN_ENTRIES=2 被恰好 2 条垃圾挡住，整条图例报 templateStarved）。 */
const RESCUE_SPARSE_ENTRIES = 6;

function selectLegendLocation(
  source: ImportImagePixels,
  calibration: ImportGridCalibration,
  framed?: LegendFrameRect,
): { located: LegendLocation; rawEntries: RawEntry[]; digitW: number } | null {
  const score = (parsed: { rawEntries: RawEntry[] }) => {
    const dotful = parsed.rawEntries.reduce((sum, entry) => sum + (entry.dotRgb ? 1 : 0), 0);
    return dotful * 1000 + parsed.rawEntries.length;
  };
  let best: { located: LegendLocation; rawEntries: RawEntry[]; digitW: number } | null = null;
  lastLocationDebug.length = 0;
  for (const located of locateLegendCandidates(source, calibration, framed)) {
    const parsed = located.chips ? collectChipEntries(source, located) : collectRawEntries(source, located);
    lastLocationDebug.push({ region: located.region, anchored: located.anchored, lines: located.lines.length, rawEntries: parsed.rawEntries.length });
    if (!best || score(parsed) > score(best)) {
      best = { located, ...parsed };
    }
  }
  const bestDotful = best ? best.rawEntries.reduce((sum, entry) => sum + (entry.dotRgb ? 1 : 0), 0) : 0;
  if (!framed && bestDotful < EDGE_GATE_MIN) {
    for (const located of locateEdgeCandidates(source)) {
      const parsed = collectRawEntries(source, located);
      lastLocationDebug.push({ region: located.region === 'bottom' ? 'edge-bottom' : 'edge-right', anchored: located.anchored, lines: located.lines.length, rawEntries: parsed.rawEntries.length });
      if (!best || score(parsed) > score(best)) {
        best = { located, ...parsed };
      }
    }
  }
  // 小码块最后手段（2026-11-22 猴子图）：彩色码块 ~18px 宽、字印在块上，
  // 常规 40px 实色游程检不到。只在常规候选（含边缘回退）凑不出像样条目数
  // 时才用 12px 小游程重试——不能参与常规仲裁（僵尸图实测会劫持本来正确
  // 的行/卡路径，色号全面劣化）。判定用条目数而非色点数：分隔条（狗狗图
  // 橙色横条）会凑出带假色点的垃圾，条目数门槛不被它骗过。
  //
  // 门槛从 MIN_ENTRIES(2) 提到 RESCUE_SPARSE_ENTRIES(6)（2026-11-24 狗狗图
  // 实测）：这类色卡芯片仅 ~51px 宽、白字压在芯片中部，实色游程被字打断，
  // 40px 主路径检出 0 张，只有 12px 救援路径能出 68 张。框选时左缘内缩 4px
  // 会让文字行路径恰好凑出 2 条垃圾——旧门槛「<2」判定不成立，救援被挡住，
  // 整条图例报 templateStarved。真图例条最小实测 11 条（water-box），6 是
  // 垃圾（1-3 条）与真图例之间的安全分界。
  const finalDotful = best ? best.rawEntries.reduce((sum, entry) => sum + (entry.dotRgb ? 1 : 0), 0) : 0;
  if (finalDotful === 0 || !best || best.rawEntries.length < RESCUE_SPARSE_ENTRIES) {
    for (const located of locateChipCandidates(source, calibration, framed, true)) {
      const parsed = collectChipEntries(source, located);
      lastLocationDebug.push({ region: 'chip-small', anchored: false, lines: 0, rawEntries: parsed.rawEntries.length });
      if (!best || score(parsed) > score(best)) {
        best = { located, ...parsed };
      }
    }
  }
  return best;
}

/**
 * 行内连通域 → 字形对象（面积/跨度过滤 + 保比例位图 + 均值色）。
 * 输出坐标为绝对图像坐标；边框残片（宽或高 ≤2）与窄碎片被丢弃。
 * 洗淡行重试：水印/半透明覆盖会把文字对比度压到 CONTRAST 以下，只剩
 * 笔画核心碎块（water-box 图例条带第 3 行整行被水印洗淡）。首通行
 * 字形 <4 时用 0.55×CONTRAST 重提——正常行不受影响（重试仅在欠额时触发）。
 */
export function analyzeLine(
  source: ImportImagePixels,
  background: [number, number, number],
  line: LineScan,
  maxWidthRatio: number = COMPONENT_MAX_WIDTH_RATIO,
): GlyphComp[] {
  const glyphs = analyzeLineWithContrast(source, background, line, CONTRAST, maxWidthRatio);
  if (glyphs.length >= 4) return glyphs;
  const retried = analyzeLineWithContrast(source, background, line, Math.round(CONTRAST * 0.55), maxWidthRatio);
  return retried.length > glyphs.length ? retried : glyphs;
}

export function analyzeLineWithContrast(
  source: ImportImagePixels,
  background: [number, number, number],
  line: LineScan,
  contrast: number,
  maxWidthRatio: number = COMPONENT_MAX_WIDTH_RATIO,
): GlyphComp[] {
  const { data, width } = source;
  const y0 = Math.max(0, line.y0 - 1);
  const y1 = Math.min(source.height - 1, line.y1 + 1);
  const x0 = Math.max(0, line.minX - 2);
  const x1 = Math.min(width - 1, line.maxX + 2);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w < 3 || h < 3) return [];
  const contrast2 = contrast * contrast;
  const mask = new Uint8Array(w * h);
  maskColorAt.clear();
  let on = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const i = (y * width + x) * 4;
      const rgb: [number, number, number] = [data[i], data[i + 1], data[i + 2]];
      const dr = rgb[0] - background[0], dg = rgb[1] - background[1], db = rgb[2] - background[2];
      if (dr * dr + dg * dg + db * db > contrast2) {
        mask[(y - y0) * w + (x - x0)] = 1;
        maskColorAt.set((y - y0) * w + (x - x0), rgb);
        on += 1;
      }
    }
  }
  if (on === 0) return [];
  const comps = connectedComponents(mask, w, h);
  const glyphs: GlyphComp[] = [];
  for (const comp of comps) {
    const area = comp.pixels.length;
    const cw = comp.maxX - comp.minX + 1;
    const ch = comp.maxY - comp.minY + 1;
    if (area < COMPONENT_MIN_AREA) continue;
    if (cw > w * maxWidthRatio) continue;
    // 边框残片（竖边/横边 1~2px）与水印碎线：字形笔画不会这么窄。
    if (cw <= 2 || ch <= 2) continue;
    if (cw <= SLIVER_MAX_WIDTH && area <= SLIVER_MAX_AREA) continue;
    let rSum = 0, gSum = 0, bSum = 0;
    const compColors: Array<[number, number, number]> = [];
    for (const [px, py] of comp.pixels) {
      const color = maskColorAt.get(py * w + px);
      if (color) {
        rSum += color[0]; gSum += color[1]; bSum += color[2];
        compColors.push(color);
      }
    }
    glyphs.push({
      x0: x0 + comp.minX, x1: x0 + comp.maxX, y0: y0 + comp.minY, y1: y0 + comp.maxY,
      area, rgb: [Math.round(rSum / area), Math.round(gSum / area), Math.round(bSum / area)],
      modeRgb: modeColorOf(compColors),
      bitmap: normalizeBand(mask, w, comp),
    });
  }
  maskColorAt.clear();
  glyphs.sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1);
  return glyphs;
}

/**
 * 色点判定（仅用于条目首字形）：色点是实心圆/方块，宽和高与整行字形中位
 * 尺寸同量级但明显更宽（≥1.4×中位宽且 ≥8px）、填充率高（≥0.55）。
 * 字母笔画填充率 ≤0.5、"粒"等 CJK 只出现在条目尾部（结构性排除）。
 */
function isDotComponent(comp: GlyphComp, medianW: number, medianH: number): boolean {
  const w = comp.x1 - comp.x0 + 1;
  const h = comp.y1 - comp.y0 + 1;
  if (h < 0.5 * medianH) return false;
  if (w < Math.max(DOT_MIN_WIDTH, 1.4 * medianW)) return false;
  if (w / h > 2) return false;
  return comp.area / (w * h) >= DOT_MIN_SOLIDNESS;
}

/** 色点中心 3×3 补丁均值：实心点=点色；空心圈点=内芯色（白点先验更准）。 */
function centerColorAt(source: ImportImagePixels, cx: number, cy: number): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= source.width || y >= source.height) continue;
      const i = (y * source.width + x) * 4;
      r += source.data[i]; g += source.data[i + 1]; b += source.data[i + 2];
      n += 1;
    }
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [255, 255, 255];
}

/**
 * 色点芯色：bbox 内按饱和度取前 30% 像素的众数色。淡点与水印灰笔画
 * 焊连时（小红书水印对比度 ~20-47 超过 DOT_CONTRAST=12 低对比门），
 * 连通域 bbox 中心被拉偏，中心 3×3 补丁落到白底 → 点色洗白成 H2 先验
 * （card4 E16/G15/M13 实证）。水印灰是中性低饱和（sat<10），芯色采样
 * 天然排除；实心深点自身高饱和，行为不变；白点全像素低饱和，退化为
 * 整域众数 ≈ 白（原行为）。格式无关：任何版式的淡色点都受益。
 */
function dotCoreColor(
  source: ImportImagePixels,
  box: { x0: number; x1: number; y0: number; y1: number },
): [number, number, number] {
  const colors: Array<{ c: [number, number, number]; sat: number }> = [];
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      if (x < 0 || y < 0 || x >= source.width || y >= source.height) continue;
      const i = (y * source.width + x) * 4;
      const r = source.data[i], g = source.data[i + 1], b = source.data[i + 2];
      colors.push({ c: [r, g, b], sat: Math.max(r, g, b) - Math.min(r, g, b) });
    }
  }
  if (!colors.length) return [255, 255, 255];
  colors.sort((a, b) => b.sat - a.sat);
  // 全中性 bbox（深灰/黑白点，maxSat<12）：饱和度无区分度，top 选择退化
  // 成扫描序截断——内切圆四角的白底像素混进 top → mode 出白（mechanism 2
  // 的 B77 深灰点实证）。回退中心补丁众数：点组件中心必然是点芯。
  if (colors[0].sat < 12) {
    const cx = (box.x0 + box.x1) >> 1;
    const cy = (box.y0 + box.y1) >> 1;
    return patchModeColor(source, cx, cy, 3);
  }
  const top = colors.slice(0, Math.max(4, Math.round(colors.length * 0.3)));
  const out = modeColorOf(top.map(p => p.c));
  if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[dot-dbg] core box=${box.x0},${box.y0}-${box.x1},${box.y1} n=${colors.length} topSat=${top[0].sat} -> ${out.join(',')}`);
  return out;
}

/**
 * 中心补丁众数色：色票取色专用。色票中央印着色号文字（中心 3×3 会命中
 * 文字色），白底色票的边框环在低对比掩码里只有环+文字没有内芯——补丁
 * 众数才是票面底色：实心票=填充色（文字少数派），空心票=内芯白。
 */
function patchModeColor(source: ImportImagePixels, cx: number, cy: number, side: number): [number, number, number] {
  const half = Math.max(2, Math.round(side / 2));
  const colors: Array<[number, number, number]> = [];
  for (let dy = -half; dy <= half; dy += 1) {
    for (let dx = -half; dx <= half; dx += 1) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= source.width || y >= source.height) continue;
      const i = (y * source.width + x) * 4;
      colors.push([source.data[i], source.data[i + 1], source.data[i + 2]]);
    }
  }
  return modeColorOf(colors);
}

interface PaleDotHit {
  rgb: [number, number, number];
  /** 命中的色点就是条目首字形本身（深色点未过形状判定时的兜底）。 */
  swallowsFirst: boolean;
  /** 命中色票的 bbox（吞掉票内印字残片用）。 */
  box: { x0: number; x1: number; y0: number; y1: number };
}

/**
 * 浅色点补搜：在条目首字形左侧的小窗口里用低对比掩码（DOT_CONTRAST）
 * 找色点形状的连通域（浅粉/浅橙/白圈色点低于文字对比阈值 60）。
 * 窗口左界为上一条目末字形之后——不会误吃邻条目内容。
 * rightBound（右侧清单专用）：首字形可能只是色票内印字的一部分（票框
 * 在文字对比度下不可见），窗口右界必须延伸罩住整张色票；同时命中域
 * 中心必须贴近行首（≤首字形起点+18px），防止把码字列的粘连块当成色票。
 */
function findPaleDot(
  source: ImportImagePixels,
  background: [number, number, number],
  group: GlyphComp[],
  prevEndX: number,
  rightBound?: number,
): PaleDotHit | null {
  const first = group[0];
  const wx0 = Math.max(0, Math.max(prevEndX + 1, first.x0 - DOT_SEARCH_WINDOW));
  // 窗口右界覆盖首字形整体：右侧清单的白底色票（灰边框+票内印字）本身
  // 就是首字形，必须把整个票框罩进低对比掩码才能找到它。
  const wx1 = Math.min(source.width - 1, Math.max(first.x0 + 2, first.x1, rightBound ?? 0));
  // 延伸窗口（右侧清单）时纵向也放宽：首字形可能只是色票上/下边缘的
  // 残片（票框在文字对比度下不可见），±2px 的窗口罩不住整张色票。
  const wy0 = rightBound !== undefined ? Math.max(0, first.y0 - 12) : Math.max(0, first.y0 - 2);
  const wy1 = rightBound !== undefined
    ? Math.min(source.height - 1, first.y1 + 12)
    : Math.min(source.height - 1, first.y1 + 2);
  const w = wx1 - wx0 + 1;
  const h = wy1 - wy0 + 1;
  if (w < 4 || h < 4) return null;
  const contrast2 = DOT_CONTRAST * DOT_CONTRAST;
  const mask = new Uint8Array(w * h);
  let on = 0;
  for (let y = wy0; y <= wy1; y += 1) {
    for (let x = wx0; x <= wx1; x += 1) {
      const i = (y * source.width + x) * 4;
      const dr = source.data[i] - background[0], dg = source.data[i + 1] - background[1], db = source.data[i + 2] - background[2];
      if (dr * dr + dg * dg + db * db > contrast2) { mask[(y - wy0) * w + (x - wx0)] = 1; on += 1; }
    }
  }
  if (on === 0) return null;
  let best: RawComponent | null = null;
  let bestBoxArea = 0;
  for (const comp of connectedComponents(mask, w, h)) {
    const cw = comp.maxX - comp.minX + 1;
    const ch = comp.maxY - comp.minY + 1;
    // 色票可达 26px+（右侧清单的票框），上限放宽到 32。
    if (cw < 5 || ch < 5 || cw > 32 || ch > 32) continue;
    const aspect = cw / ch;
    if (aspect < 0.45 || aspect > 2.2) continue;
    // 行首约束（延伸窗口时）：色票中心必然贴近行首，码字列的粘连块
    // 在延伸窗口里形状也合规，靠中心距离排除。
    if (rightBound !== undefined && wx0 + (comp.minX + comp.maxX) / 2 > first.x0 + 18) continue;
    // 优先 bbox 更大者（色票框罩住票内文字，按像素数选会输给 3 个字）。
    const boxArea = cw * ch;
    if (!best || boxArea > bestBoxArea || (boxArea === bestBoxArea && comp.pixels.length > best.pixels.length)) {
      best = comp;
      bestBoxArea = boxArea;
    }
  }
  if (!best) return null;
  const cx = wx0 + Math.round((best.minX + best.maxX) / 2);
  const cy = wy0 + Math.round((best.minY + best.maxY) / 2);  const firstCx = Math.round((first.x0 + first.x1) / 2);
  const firstCy = Math.round((first.y0 + first.y1) / 2);
  // 命中域罩住首字形中心 → 首字形就是色点本身（深色点未过形状判定的兜底）。
  const swallowsFirst = firstCx >= wx0 + best.minX - 1 && firstCx <= wx0 + best.maxX + 1
    && firstCy >= wy0 + best.minY - 1 && firstCy <= wy0 + best.maxY + 1;
  const solidness = best.pixels.length / bestBoxArea;
  void solidness;
  const bestW = best.maxX - best.minX + 1;
  const bestH = best.maxY - best.minY + 1;
  const box = { x0: wx0 + best.minX, x1: wx0 + best.maxX, y0: wy0 + best.minY, y1: wy0 + best.maxY };
  // 补丁众数为主（票内印字/边框环稳健）；仅当结果被洗白（sat<8——水印
  // 焊连把 bbox 中心拉偏，补丁落到白底）且 bbox 内存在饱和芯时用芯色
  // 兜底（card4 E16/G15 实证）。条件式保证已正确的点色一个比特不动——
  // 点色微移会跨过先验 ΔE 悬崖引发全局求解级联（D23 实证）。
  let rgb = patchModeColor(source, cx, cy, Math.max(7, Math.round(Math.min(bestW, bestH) * 0.9)));
  const satOf = (c: [number, number, number]) => Math.max(...c) - Math.min(...c);
  if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[dot-dbg] pale box=${box.x0},${box.y0}-${box.x1},${box.y1} patch=${rgb.join(',')} sat=${satOf(rgb)}`);
  if (satOf(rgb) < 8) {
    const core = dotCoreColor(source, box);
    if (satOf(core) >= 12) rgb = core;
  }
  return {
    rgb,
    swallowsFirst,
    box,
  };
}

/** 间隙分段：条目之间的空白远大于条目内字符间隙。 */
function groupByGaps(comps: GlyphComp[]): GlyphComp[][] {
  const gaps: number[] = [];
  for (let i = 1; i < comps.length; i += 1) gaps.push(comps[i].x0 - comps[i - 1].x1 - 1);
  const positive = gaps.filter(g => g > 0);
  const medianGap = median(positive);
  const threshold = Math.max(ENTRY_GAP_MIN, medianGap * 4 + 6);
  const groups: GlyphComp[][] = [];
  let current: GlyphComp[] = [comps[0]];
  for (let i = 1; i < comps.length; i += 1) {
    if (gaps[i - 1] >= threshold) {
      groups.push(current);
      current = [comps[i]];
    } else {
      current.push(comps[i]);
    }
  }
  groups.push(current);
  return groups;
}

interface LineContext {
  medianW: number;
  medianH: number;
}

/** 由一行字形构建条目：首字形色点判定 + 浅色点补搜 + 防噪守卫。 */
function buildEntry(
  source: ImportImagePixels,
  background: [number, number, number],
  group: GlyphComp[],
  prevEndX: number,
  ctx: LineContext,
  dotSampling: 'center' | 'mode' = 'mode',
): RawEntry | null {
  if (group.length < 3) return null;
  let dotRgb: [number, number, number] | null = null;
  let glyphs = group;
  if (isDotComponent(group[0], ctx.medianW, ctx.medianH)) {
    const dot = group[0];
    // 底部条带的圆点无印字：芯色采样（饱和度加权，抗水印焊连洗白，
    // 见 dotCoreColor 注释）；右侧清单的色票中央印着色号文字，必须用
    // 整票众数——文字像素是少数派。
    dotRgb = dotSampling === 'center'
      ? dotCoreColor(source, dot)
      : dot.modeRgb;
    glyphs = group.slice(1);
  } else {
    const hit = findPaleDot(source, background, group, prevEndX);
    if (hit) {
      dotRgb = hit.rgb;
      if (hit.swallowsFirst) {
        // 吞掉首字形 + 色票 bbox 内的所有残片（白底色票的框与票内印字
        // 在对比掩码里是分离的连通域，只吞首字形会漏掉印字）。
        const box = hit.box;
        glyphs = group.filter(g => g.x1 < box.x0 - 1 || g.x0 > box.x1 + 1 || g.y1 < box.y0 - 1 || g.y0 > box.y1 + 1);
      }
    }
  }
  // 无点锚的防噪守卫：标尺/水印碎行没有色点也凑不出 4 个字形。
  if (!dotRgb && glyphs.length < 4) return null;
  if (glyphs.length < 2) return null;
  return { dotRgb, glyphs };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const widthOf = (glyph: GlyphComp) => glyph.x1 - glyph.x0 + 1;

/** 色点先验：点色 → 色板最近色（ΔE 上限内）。 */
export function priorFromDot(
  dotRgb: [number, number, number],
  prepared: Array<{ color: BeadColor; lab: [number, number, number] }>,
): { code: string; deltaE: number } | null {
  const dotLab = rgbToLab(...dotRgb);
  let best: { code: string; deltaE: number } | null = null;
  for (const entry of prepared) {
    const d = deltaE2000(dotLab, entry.lab);
    if (!best || d < best.deltaE) best = { code: entry.color.code, deltaE: d };
  }
  if (!best || best.deltaE > PRIOR_MAX_DELTA_E) return null;
  return best;
}

/**
 * 色点颜色 → 色板最近色建议（供面板处理"色号未读出"的条目）。
 *
 * 色点是整块印刷色，区分度比小字字形高两个数量级——色号读不出时
 * 色板最近色（ΔE ≤ PRIOR_MAX_DELTA_E）是可用的候选建议，UI 标黄
 * 请用户核对。超出 ΔE 上限返回 null（连建议都不可给，行直接省略）。
 */
export function suggestCodeFromRgb(
  rgb: [number, number, number],
  palette: ReadonlyArray<BeadColor>,
): { code: string; deltaE: number } | null {
  const lab = rgbToLab(...rgb);
  let best: { code: string; deltaE: number } | null = null;
  for (const color of palette) {
    if (color.enabled === false) continue;
    const d = deltaE2000(lab, rgbToLab(...color.rgb));
    if (!best || d < best.deltaE) best = { code: color.code, deltaE: d };
  }
  if (!best || best.deltaE > PRIOR_MAX_DELTA_E) return null;
  return best;
}

/**
 * 色板外错读码的严格纠正（2026-11-15 用户实测：D23→H1、M14→M10 这类
 * 色号 OCR 错读，但色点仍是整块真印刷色）。与 suggestCodeFromRgb 的
 * 区别：OCR 是有证据的读数，色点纠正只在"唯一近色"时推翻——ΔE 上限
 * 更紧（≤8），且要求对次近邻有明显领先（margin ≥ 3），近邻歧义一律
 * 放弃纠正（保留错读码 + codeNotInPalette warn 让用户手动改）。
 */
export function strictCodeFromRgb(
  rgb: [number, number, number],
  palette: ReadonlyArray<BeadColor>,
  maxDeltaE = 8,
  minMargin = 3,
): { code: string; deltaE: number } | null {
  const lab = rgbToLab(...rgb);
  const ranked = palette
    .filter(color => color.enabled !== false)
    .map(color => ({ code: color.code, d: deltaE2000(lab, rgbToLab(...color.rgb)) }))
    .sort((a, b) => a.d - b.d);
  if (!ranked.length || ranked[0].d > maxDeltaE) return null;
  if (ranked.length > 1 && ranked[1].d - ranked[0].d < minMargin) return null;
  return { code: ranked[0].code, deltaE: ranked[0].d };
}

/**
 * 自举标注的自洽守卫（毒化拦截，2026-11-14 用户图实测）：
 * 全局求解错误的 code（'5' 被解成 '8' 等）会把异形字形注入同字符桶，
 * 再经 buildTemplates → codeDigitTemplates 毒化计数簇标注——色号对但
 * 粒数全线崩坏的根源。同字体同字距离 ~0.1，异字 p50 ~0.44：桶内字形
 * 用平均连接聚类，聚出多个模式即标注矛盾。处置：
 * - 多数派明显更大 → 只保留多数派（真字形占多数，少数派是错标）；
 * - 接近打平 → 整字弃用（缺字由色板先验/跨字体兜底，毒模板比缺字
 *   危害大——缺字只降置信，毒字会持续产错解）。
 */
function pruneInconsistentLabels(labeled: Map<string, Bitmap[]>): Map<string, Bitmap[]> {
  const out = new Map<string, Bitmap[]>();
  for (const [char, bitmaps] of labeled) {
    if (bitmaps.length <= 2) { out.set(char, bitmaps); continue; }
    const groups = averageLinkage(bitmaps, (a, b) => bitmapJaccard(a, b), LABEL_CONSIST_JACCARD);
    if (groups.length <= 1) { out.set(char, bitmaps); continue; }
    const sorted = [...groups].sort((a, b) => b.length - a.length);
    if (sorted[1].length >= sorted[0].length) continue;
    out.set(char, sorted[0]);
  }
  return out;
}

/** 逐实例拉伸平均 → 字符模板（阈值 0.4，同 symbolOCR 口径）。 */
export function buildTemplates(labeled: Map<string, Bitmap[]>): Map<string, Bitmap> {
  const templates = new Map<string, Bitmap>();
  for (const [label, glyphs] of labeled) {
    if (!glyphs.length) continue;
    const widths = glyphs.map(g => g.w).sort((a, b) => a - b);
    const targetW = widths[Math.floor(widths.length / 2)];
    const heights = glyphs.map(g => g.h).sort((a, b) => a - b);
    const targetH = heights[Math.floor(heights.length / 2)];
    const acc = new Float32Array(targetW * targetH);
    for (const glyph of glyphs) {
      const sg = stretchBitmap(glyph, targetW, targetH);
      for (let i = 0; i < acc.length; i += 1) acc[i] += sg.data[i];
    }
    const data = new Uint8Array(targetW * targetH);
    for (let i = 0; i < data.length; i += 1) data[i] = acc[i] / glyphs.length > 0.4 ? 1 : 0;
    templates.set(label, { data, w: targetW, h: targetH });
  }
  return templates;
}

/**
 * 计数区自建数字模板：图例的粒数数字与色号字母是两套字号/字重
 * （计数数字更小更细），直接借代码字体的模板匹配距离会系统性偏大
 * （同字 p50≈0.3、异字 p50≈0.44，边际太薄）。
 *
 * 三步走，全部只依赖"无监督聚类 100% 纯净"这一实测事实：
 * 1. 收集全部"单字宽"计数字形 → 平移 Jaccard 无监督聚类（同字体
 *    同字符距离极紧，实测 34/34 簇纯净）；
 * 2. 簇模板两两合并（同字符的碎簇距离 <0.2），得到 ≤10 个"单字簇"；
 * 3. 标注：全部簇对代码字体模板 argmin（允许同数字多个簇——簇分裂是
 *    常态），再用第一轮同字体临时模板重新 argmin 自纠（同字体同字距离
 *    ~0.1 远紧于跨字体的 0.3+），一轮即可把跨字体误标纠正到多数派。
 */
/**
 * 计数簇标注：跨字体 argmin 起步 + 同字体临时模板 EM 自纠。
 *
 * 两段式：① 全部簇对代码字体模板做 argmin（允许同数字多个簇——簇分裂
 * 是常态，注入式会硬性抢占正确标签）；② 用第一轮的同字体临时模板重新
 * argmin（同字体同字距离 ~0.1，远紧于跨字体的 0.3+），迭代至多两轮即可
 * 把跨字体误标的簇纠正到多数派。导出为纯函数供对抗测试直测（机制③）。
 */
export function annotateCountClusters(
  clusters: Bitmap[][],
  codeDigitTemplates: Map<string, Bitmap>,
  padAnchors = false,
): string[] {
  if (!clusters.length) return [];
  const digits = [...codeDigitTemplates.keys()].sort();
  if (!digits.length) return clusters.map(() => '');
  const dist = padAnchors ? bitmapJaccardPad : bitmapJaccard;
  const meanDist = (members: Bitmap[], template: Bitmap) =>
    members.reduce((sum, bitmap) => sum + dist(bitmap, template), 0) / members.length;
  const relabel = (assign: string[]) => {
    const map = new Map<string, Bitmap[]>();
    clusters.forEach((members, index) => {
      const list = map.get(assign[index]) ?? [];
      list.push(...members);
      map.set(assign[index], list);
    });
    return buildTemplates(map);
  };
  let assignment = clusters.map(members => {
    let best = digits[0];
    let bestD = Number.POSITIVE_INFINITY;
    for (const digit of digits) {
      const d = meanDist(members, codeDigitTemplates.get(digit)!);
      if (d < bestD) { bestD = d; best = digit; }
    }
    return best;
  });
  for (let round = 0; round < 2; round += 1) {
    const provisional = relabel(assignment);
    if (!provisional.size) break;
    let changed = false;
    assignment = clusters.map((members, index) => {
      let best = assignment[index];
      let bestD = Number.POSITIVE_INFINITY;
      for (const [digit, template] of provisional) {
        const d = meanDist(members, template);
        if (d < bestD) { bestD = d; best = digit; }
      }
      if (best !== assignment[index]) changed = true;
      return best;
    });
    if (!changed) break;
  }
  // 备注：曾试验"超编消解"（同标多簇里最远簇让位给未用数字，解决色号
  // 缺 '5' 时计数 5 无锚的问题）——实测选错替罪羊，粒数命中 3/27→1/27，
  // 已撤销。真正的缺口在 COUNT_MERGE_JACCARD 合并阶段就把 '5' 簇并进了
  // '3' 簇（形近链），标注层无解；后续杠杆是合并阈值分档或头部 Σ 求解。
  return assignment;
}

/**
 * 平均连接层次聚类：簇间距离 = 跨簇全部元素对的距离均值，低于阈值才合并。
 * 单链接（union-find）会被"形近链"拖垮——大耳狗的计数小字里不同数字
 * 两两距离略超阈值，链式合并把 24 个单字聚成一个 21 成员巨簇；平均
 * 连接要求整簇平均达标，能挡住链式合并。
 */
function averageLinkage<T>(items: T[], dist: (a: T, b: T) => number, threshold: number): T[][] {
  const clusters: T[][] = items.map(item => [item]);
  const clusterDist = (a: T[], b: T[]) => {
    let sum = 0;
    for (const x of a) for (const y of b) sum += dist(x, y);
    return sum / (a.length * b.length);
  };
  for (;;) {
    let bestA = -1, bestB = -1, bestD = threshold;
    for (let a = 0; a < clusters.length; a += 1) {
      for (let b = a + 1; b < clusters.length; b += 1) {
        const d = clusterDist(clusters[a], clusters[b]);
        if (d < bestD) { bestD = d; bestA = a; bestB = b; }
      }
    }
    if (bestA < 0) break;
    clusters[bestA] = [...clusters[bestA], ...clusters[bestB]];
    clusters.splice(bestB, 1);
  }
  return clusters;
}

/**
 * 合成数字模板（计数标注锚，2026-11-15）：计数与码字是两套字体/字重，
 * 代码字形模板跨字体 Jaccard 系统性失效（同字距离贴着异字距离、且色号里
 * 没出现过的数字根本没有锚）。解析与渲染发生在同一浏览器（同字体引擎），
 * 直接用 Canvas 渲染 0-9 合成锚，字号按计数字实际高度换算。
 * 渲染质量：4× 超采样 + imageSmoothing 平滑缩放 + 0.5 阈值——小字号
 * （8-9px）直渲的位图形状失真，实测 '0' 簇被错标成 '4'。
 */
export function renderSyntheticDigitTemplates(digitHeightPx: number): Map<string, Bitmap> | null {
  try {
    const SS = 4;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx || !(digitHeightPx >= 5)) return null;
    const probeFont = 100;
    ctx.font = `bold ${probeFont}px sans-serif`;
    const probe = ctx.measureText('0');
    const probeH = (probe.actualBoundingBoxAscent ?? 0) + (probe.actualBoundingBoxDescent ?? 0);
    if (!probeH) return null;
    const fontPx = Math.max(9, Math.round((digitHeightPx * probeFont) / probeH));
    const bigFontPx = fontPx * SS;
    canvas.width = Math.ceil(bigFontPx * 1.8);
    canvas.height = Math.ceil(bigFontPx * 1.8);
    ctx.font = `bold ${bigFontPx}px sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    const small = document.createElement('canvas');
    const sctx = small.getContext('2d');
    if (!sctx) return null;
    const out = new Map<string, Bitmap>();
    for (const ch of '0123456789') {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillText(ch, Math.ceil(bigFontPx * 0.2), Math.ceil(bigFontPx * 1.25));
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let x0 = canvas.width, x1 = -1, y0 = canvas.height, y1 = -1;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          if (img[(y * canvas.width + x) * 4 + 3] > 127) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < x0) continue;
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      // 高分辨率字形裁片（drawImage 按画布坐标裁）→ 平滑缩到目标字号 → 阈值
      small.width = Math.max(1, Math.round(bw / SS));
      small.height = Math.max(1, Math.round(bh / SS));
      sctx.clearRect(0, 0, small.width, small.height);
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(canvas, x0, y0, bw, bh, 0, 0, small.width, small.height);
      const scaled = sctx.getImageData(0, 0, small.width, small.height).data;
      const w = small.width, h = small.height;
      const data = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i += 1) data[i] = scaled[i * 4 + 3] >= 128 ? 1 : 0;
      out.set(ch, { data, w, h });
    }
    return out.size >= 8 ? out : null;
  } catch {
    return null;
  }
}

/** 计数单字 dump（诊断/种子回流）：buildCountTemplates 胜出路径的单字
 * 位图及其被派标签，带条目索引与 x 坐标——外部脚本可用「已验证条目」
 * 对齐真值提取完美字体种子（2026-11-24 card4 数量攻坚）。 */
export const countGlyphDump: Array<{ entry: number; digit: string; bitmap: Bitmap; x0: number }> = [];

/** 色号数字模板 dump：resolve 成功条目的 code 数字字形（自洽守卫后），
 * 同字体真值锚——计数种子的补充源（覆盖计数从未读对的数字）。 */
export const codeDigitDump: Array<{ digit: string; bitmap: Bitmap }> = [];

/** 色号全部字形 dump（诊断/种子回流）：按条目与列位展开的 code 字形
 * 位图——外部脚本用「已验证条目真值」逐位标注提取码字种子
 * （2026-11-24 card4 E16/H13 攻坚：solver 毒解炸掉 'H' 桶的循环打破）。 */
export const codeGlyphDump: Array<{ entry: number; index: number; bitmap: Bitmap; x0: number }> = [];

export function buildCountTemplates(
  rawEntries: RawEntry[],
  splits: Array<SplitResult | null>,
  digitW: number,
  codeDigitTemplates: Map<string, Bitmap>,
  syntheticDigits?: Map<string, Bitmap> | Array<Map<string, Bitmap> | null> | null,
  synthTrusted = false,
  seedTemplates?: Map<string, Bitmap | Bitmap[]> | null,
): Map<string, Bitmap> {
  // 兼容单锚与多高度候选两种传参（诊断脚本传单锚）。
  const synthCandidates = (Array.isArray(syntheticDigits) ? syntheticDigits : [syntheticDigits])
    .filter((m): m is Map<string, Bitmap> => !!m && m.size >= 8);
  lastSyntheticAnchors.current = null;
  // countGlyphDump 的清空不在本函数：多个定位候选会各调一次
  // buildCountTemplates，在这里清空会留下「最后候选」的 dump 而非胜者的
  // （2026-11-24 card4 数量种子实验踩坑）。清空点在 recognizeLegendEntries。
  const singlesRaw: Array<{ entry: number; bitmap: Bitmap; x0: number }> = [];
  for (let i = 0; i < rawEntries.length; i += 1) {
    const split = splits[i];
    if (!split) continue;
    for (const glyph of split.countGlyphs) {
      // 宽度门（1.4×digitW）：更宽的是粘连块走切片路径；蓝墨场景粒块
      // 由 buildCountTemplates 调用方决定（见 synth 路径注释）。
      if (widthOf(glyph) <= digitW * 1.4) singlesRaw.push({ entry: i, bitmap: glyph.bitmap, x0: glyph.x0 });
    }
  }
  // 高度守卫：单字池曾混入"粒"块（h≈11，蓝墨同色）与水印碎片（h≤5），
  // 聚类直接退化成单字 EM、标注全乱。计数字高度中位附近才收。
  const singles = (() => {
    if (singlesRaw.length < 4) return singlesRaw;
    const hs = singlesRaw.map(s => s.bitmap.h);
    const medH = median(hs);
    const kept = singlesRaw.filter((_, i) => hs[i] >= medH * 0.7 && hs[i] <= medH * 1.35);
    return kept.length >= 4 ? kept : singlesRaw;
  })();
  const hasSynthetic = synthCandidates.length > 0;
  if (!singles.length || (!codeDigitTemplates.size && !hasSynthetic)) return new Map();
  countTemplateAssignment.length = 0;

  /**
   * 一条标注路径：分组 → argmin 标注 → 真实实例模板 → 质量分。
   * 质量分 = 全部单字对其被派字符模板的中位 Jaccard 距离（越低越自洽）。
   */
  type CountMember = { entry: number; bitmap: Bitmap; x0: number };
  const runPath = (mode: 'code' | 'synth' | 'hybrid'): { labeled: Map<string, CountMember[]>; medDist: number; degenerate: boolean; candidate?: Map<string, Bitmap> } | null => {
    if (mode === 'code' ? !codeDigitTemplates.size : !synthCandidates.length) return null;
    let groups: number[][];
    let degenerate = false;
    {
      // 三条路径共用同一聚类（code/synth/hybrid——hybrid 合并锚 2026-11-24）。
      // singles 元素带条目元数据（entry/x0），聚类以索引为单元。
      const clusters = averageLinkage(
        singles.map((_, i) => i),
        (a, b) => bitmapJaccard(singles[a].bitmap, singles[b].bitmap),
        COUNT_GROUP_JACCARD,
      );
      degenerate = Math.max(...clusters.map(members => members.length)) > singles.length * 0.4;
      if (degenerate) {
        groups = singles.map((_, i) => [i]);
      } else {
        const clusterPairs = clusters.map(members => ({
          members,
          template: buildTemplates(new Map([['x', members.map(i => singles[i].bitmap)]])).get('x')!,
        }));
        const merged = averageLinkage(clusterPairs, (a, b) => bitmapJaccard(a.template, b.template), COUNT_MERGE_JACCARD);
        groups = merged.map(cluster => cluster.flatMap(p => p.members));
      }
    }
    const buildAttempt = (anchors: Map<string, Bitmap>, review: boolean): { labeled: Map<string, CountMember[]>; medDist: number } | null => {
      const labeled = new Map<string, CountMember[]>();
      const assignment = annotateCountClusters(groups.map(members => members.map(i => singles[i].bitmap)), anchors, review);
      groups.forEach((members, index) => {
        const digit = assignment[index];
        if (!digit) return;
        const list = labeled.get(digit) ?? [];
        list.push(...members.map(i => singles[i]));
        labeled.set(digit, list);
      });
      // 成员复核（2026-11-15 浏览器实测）：模糊字形链会把 '1'/'4'/'2' 并进
      // 同一簇，簇共识标签污染整组（'1' 字形对污染 '4' 模板距离低至 0.14，
      // 联合匹配也救不回）。合成锚与真实渲染同字体，对簇内每个字形独立
      // 复核：意见不同的成员迁移到对应字符组——簇结构保平稳，标签去污染。
      if (review) {
        for (const [char, members] of [...labeled]) {
          for (const member of members) {
            const sm = matchGlyph(member.bitmap, anchors, true);
            if (sm && sm.char !== char) {
              const list = labeled.get(char)!;
              const idx = list.indexOf(member);
              if (idx >= 0) list.splice(idx, 1);
              const target = labeled.get(sm.char) ?? [];
              target.push(member);
              labeled.set(sm.char, target);
            }
          }
        }
        for (const [char, list] of [...labeled]) if (!list.length) labeled.delete(char);
      }
      const finalTemplates = buildTemplates(new Map([...labeled].map(([d, ms]) => [d, ms.map(s => s.bitmap)])));
      const dists: number[] = [];
      groups.forEach((members, index) => {
        const template = finalTemplates.get(assignment[index]);
        if (!template) return;
        for (const i of members) dists.push(bitmapJaccard(singles[i].bitmap, template));
      });
      if (!dists.length) return null;
      return { labeled, medDist: median(dists) };
    };
    if (mode === 'code') {
      const attempt = buildAttempt(codeDigitTemplates, false);
      return attempt ? { ...attempt, degenerate } : null;
    }
    // 多高度候选（2026-11-15 框选路径实测）：合成锚按单一中位高度渲染时，
    // 框选路径的高度分布与直通路径不同，±1px 偏差就让 medDist 超阈回落
    // code 模板（5→8/2→4/3→1 混淆重现）。逐候选标注取自洽度最高者。
    // hybrid（2026-11-24 card4 实证）：小字号印刷'2'对合成锚三不靠
    // （'1':0.407<'7':0.412<'2':0.429）→ '2' 簇被毒标成 '7'，全卡 '2' 命中
    // 假模板 d0.087。色号里的数字（D2/E2/G15…）是同字体同字号已知真值，
    // 合并锚（code 优先，collision 时盖过 synth）标注+复核，让真'2'锚
    // 直接杀掉毒标。
    let best: { labeled: Map<string, CountMember[]>; medDist: number; degenerate: boolean; candidate: Map<string, Bitmap> } | null = null;
    for (const candidate of synthCandidates) {
      const anchors = mode === 'hybrid' ? new Map([...candidate, ...codeDigitTemplates]) : candidate;
      const attempt = buildAttempt(anchors, true);
      if (attempt && (!best || attempt.medDist < best.medDist)) {
        best = { ...attempt, degenerate, candidate };
      }
    }
    return best;
  };

  const codePath = runPath('code');
  const synthPath = hasSynthetic ? runPath('synth') : null;
  // hybrid 路径（code+synth 合并锚）：仅在显式传入种子时参与仲裁——
  // 无种子的 medDist 竞争会以 0.001 级差翻转 card1/3 的既有胜者
  // （2026-11-24 实测 synth→hybrid 翻转导致 card1 浏览器端标签漂移），
  // 违反「不为新卡过拟合、旧卡零回归」红线。种子通道（校对后重识别）
  // 才启用三路竞争。
  const seedBoosted = !!seedTemplates?.size;
  const hybridPath = seedBoosted && hasSynthetic && codeDigitTemplates.size ? runPath('hybrid') : null;
  // 当种子在场且 hybrid 自洽度严格更优时，hybrid 顶替 synth 作为合成侧
  // 候选；否则完全维持 2026-11-15 调优的 code-vs-synth 仲裁（含
  // synthTrusted 门），历史卡零行为变化。
  const synthSide = hybridPath && synthPath && hybridPath.medDist < synthPath.medDist ? hybridPath : synthPath;
  // 仲裁（2026-11-15 浏览器实测修订）：合成锚与实际渲染同字体引擎时
  // （浏览器），跨字体代码锚会系统性缺字（water-box 7 簇只标出 0123478，
  // 缺 5/6/9 → 953 读成 83）——两者都存在时按中位自洽距离竞争，代码锚
  // 聚类退化时也兜底。Node/无 DOM 下合成锚为 null，维持代码锚优先
  // （Node 字体与真实渲染不一致，分数竞争不可信，实测 Σ 更差）。
  const winner = synthSide && (!codePath || codePath.degenerate
      || (synthTrusted && synthSide.medDist <= SYNTH_TRUSTED_MAX_MEDDIST)
      || synthSide.medDist <= codePath.medDist)
    ? (synthSide === hybridPath ? 'hybrid' : 'synth')
    : 'code';
  countTemplateAssignment.push({ size: 0, dims: `code=${codePath ? codePath.medDist.toFixed(3) : '-'}${codePath?.degenerate ? '(deg)' : ''} synth=${synthPath ? synthPath.medDist.toFixed(3) : '-'}${synthPath?.degenerate ? '(deg)' : ''} hybrid=${hybridPath ? hybridPath.medDist.toFixed(3) : '-'}${hybridPath?.degenerate ? '(deg)' : ''}`, digit: `WINNER/${winner}` });
  for (const [tag, path] of [['code', codePath], ['synth', synthPath], ['hybrid', hybridPath]] as const) {
    if (!path) continue;
    const dist = [...path.labeled.entries()].map(([d, ms]) => `${d}×${ms.length}`).sort().join(' ');
    countTemplateAssignment.push({ size: 0, dims: `medDist=${path.medDist.toFixed(3)}`, digit: `PATH/${tag} ${dist}` });
  }
  const chosen = winner === 'synth' ? synthPath! : winner === 'hybrid' ? hybridPath! : codePath!;
  if (winner !== 'code' && chosen?.candidate) lastSyntheticAnchors.current = chosen.candidate;
  if (!chosen) return new Map();
  // 种子回灌（2026-11-24 card4 实证，通用机制）：已验证条目（校对面板
  // 确认 / 真值种子）的数字字形是真实字体完美模板。成员级重标注——
  // 与某种子同形（<0.25）但标签不同者迁到种子字符（治 '2' 簇毒标 '7'、
  // 5/6/9 并进 0/8 簇）；种子并入终池兜底缺字。无种子时零行为变化。
  if (seedTemplates?.size) {
    const seedEntries = [...seedTemplates.entries()].flatMap(([ch, t]) => (Array.isArray(t) ? t : [t]).map(b => [ch, b] as const));
    for (const [char, members] of [...chosen.labeled]) {
      for (const s of [...members]) {
        let bestCh = char;
        let bestD = Number.POSITIVE_INFINITY;
        for (const [ch, t] of seedEntries) {
          const d = bitmapJaccard(s.bitmap, t);
          if (d < bestD) { bestD = d; bestCh = ch; }
        }
        if (bestCh !== char && bestD < 0.25) {
          const list = chosen.labeled.get(char)!;
          list.splice(list.indexOf(s), 1);
          const target = chosen.labeled.get(bestCh) ?? [];
          chosen.labeled.set(bestCh, target);
          target.push(s);
          if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[cnt-seed] entry${s.entry} x${s.x0} '${char}'->'${bestCh}' d${bestD.toFixed(3)}`);
        }
      }
    }
    for (const [char, list] of [...chosen.labeled]) if (!list.length) chosen.labeled.delete(char);
  }
  for (const [digit, members] of chosen.labeled) {
    for (const s of members) countGlyphDump.push({ entry: s.entry, digit, bitmap: s.bitmap, x0: s.x0 });
  }
  const finalPool = buildTemplates(new Map([...chosen.labeled].map(([d, ms]) => [d, ms.map(s => s.bitmap)])));
  if (seedTemplates?.size) {
    for (const [ch, t] of seedTemplates) {
      const arr = Array.isArray(t) ? t : [t];
      arr.forEach((b, i) => {
        // 多实例用复合键（同字符多变体各自参赛）；matchGlyph 消费侧剥后缀
        const key = arr.length > 1 ? `${ch}#${i}` : ch;
        if (!finalPool.has(ch) || arr.length > 1) finalPool.set(key, b);
      });
    }
  }
  return finalPool;
}

interface GlyphMatch {
  char: string;
  distance: number;
  secondDistance: number;
}

/** 单字形对模板集匹配：返回最优字符与次优距离。pad=true 用居中填充比对
 * （合成锚跨尺寸场景，防止拉伸变形），默认拉伸（同源真实字形场景）。 */
export function matchGlyph(glyph: Bitmap, templates: Map<string, Bitmap>, pad = false): GlyphMatch | null {
  const dist = pad ? bitmapJaccardPad : bitmapJaccard;
  let best: GlyphMatch | null = null;
  let second = Number.POSITIVE_INFINITY;
  for (const [char, template] of templates) {
    const d = dist(glyph, template);
    if (!best || d < best.distance) {
      second = best ? best.distance : second;
      best = { char, distance: d, secondDistance: 0 };
    } else if (d < second) {
      second = d;
    }
  }
  if (!best) return null;
  best.secondDistance = second === Number.POSITIVE_INFINITY ? best.distance : second;
  return best;
}

interface SplitResult {
  codeGlyphs: GlyphComp[];
  countGlyphs: GlyphComp[];
  splitSuspicious: boolean;
  /** 计数列是独立彩色墨（蓝墨）印出：可用合成数字模板当标注锚。 */
  blueInkCount?: boolean;
}

/**
 * 条目内切分：code 字形 | 粒数字形（含尾部"粒"）。
 *
 * 先剥"粒"后缀：末位明显比其余字形宽且是"纯粒"宽度（< 1.9×数字宽）；
 * 更宽的尾块是"数字+粒"粘连，保留给计数区的切片回收。
 *
 * code|count 切分仲裁：图例字距紧凑，先验长度是主证据，"空格"级间隙是
 * 副证据——两者一致时互证；冲突时优先间隙（先验 argmax 在密集色板上会
 * 系统性选错，连带长度也不可信）并标记可疑；都没有时退回最大间隙。
 */
function splitEntry(glyphs: GlyphComp[], prior: { code: string; deltaE: number } | null, digitW: number): SplitResult | null {
  if (glyphs.length < 2) return null;
  // 蓝墨计数分离（2026-11-15 自家导出实测）：导出图例的计数与"粒"用高饱
  // 和蓝墨印刷，码字黑墨、名字灰墨——按墨色直接分离比空格间隙判据可靠
  // （灰名字与码字同属冷灰系，间隙判据经常跨列错切）。门控：蓝墨字形 ≥2
  // 且深墨字形 ≥2 才走此路（yao/water-box 计数是黑墨，蓝墨 ~0 不触发）。
  const isBlueInk = (comp: GlyphComp) => {
    const [r, g, b] = comp.modeRgb;
    return b >= 140 && b - r >= 50 && b - g >= 30;
  };
  const blue = glyphs.filter(isBlueInk);
  const dark = glyphs.filter(glyph => !isBlueInk(glyph));
  // 浏览器门控：蓝墨粗体计数与代码字形是两套字重，模板链必须靠 Canvas
  // 合成数字锚（buildCountTemplates 的 syntheticDigits）——Node/无 DOM
  // 环境合成锚为 null，蓝墨分离只会让计数全灭，此时保留旧切分路径。
  if (typeof document !== 'undefined'
    && blue.length >= 2 && dark.length >= 2 && blue.length + dark.length === glyphs.length) {
    // 蓝墨尾部宽块 = 中文单位（粒/颗）：数字宽 ≈ digitW，单位字明显更宽。
    // 不剥会混进计数单字池毒化聚类。
    const blueWidths = blue.map(widthOf);
    const lastBlue = blueWidths[blueWidths.length - 1];
    const blueMedianRest = median(blueWidths.slice(0, -1));
    const blueBody = lastBlue > digitW * 1.35 && blueMedianRest > 0 && lastBlue > blueMedianRest * 1.2
      ? blue.slice(0, -1)
      : blue;
    if (blueBody.length >= 1) {
      return { codeGlyphs: dark, countGlyphs: blueBody, splitSuspicious: false, blueInkCount: true };
    }
  }
  const widths = glyphs.map(widthOf);
  const medianRest = median(widths.slice(0, -1));
  const lastW = widths[widths.length - 1];
  let usable = glyphs;
  if (medianRest > 0 && lastW > medianRest * 1.35 && lastW >= 7
    && (digitW <= 0 || lastW <= digitW * 1.9)) {
    usable = glyphs.slice(0, -1);
  }
  if (usable.length < 2) return null;
  const innerGaps: number[] = [];
  for (let i = 1; i < usable.length; i += 1) innerGaps.push(usable[i].x0 - usable[i - 1].x1 - 1);
  // "空格"级间隙：显著大于字内间隙。字内间隙的中位数用"去掉最大间隙后"
  // 的正值估计（空格间隙本身是最大值，不能计入分母）。
  const sortedGaps = [...innerGaps].filter(g => g > 0).sort((a, b) => a - b);
  if (sortedGaps.length) sortedGaps.pop();
  const medianIntra = median(sortedGaps);
  const gapThreshold = Math.max(SPACE_GAP_MIN, Math.round(medianIntra * 2.5));
  const spaceCandidates = innerGaps
    .map((gap, index) => ({ index: index + 1, gap }))
    .filter(candidate => candidate.gap >= gapThreshold)
    .sort((a, b) => b.gap - a.gap || a.index - b.index);
  const preferred = prior ? prior.code.length : -1;
  let splitIndex: number;
  let suspicious = false;
  if (spaceCandidates.length && spaceCandidates.some(c => c.index < usable.length)) {
    // 计数是行尾数字：多个"空格"级间隙取最靠后的一个——右侧清单常把
    // 同一色号印两列（色票里一次、文本列再一次），取第一个空格会把第二列
    // 色号错进计数区。单一间隙时与旧版行为一致。
    splitIndex = spaceCandidates.reduce((last, c) => (c.index > last ? c.index : last), 0);
    suspicious = preferred >= 0 && preferred !== splitIndex;
  } else if (preferred >= 1 && preferred < usable.length) {
    splitIndex = preferred;
    suspicious = true;
  } else {
    splitIndex = innerGaps.indexOf(Math.max(...innerGaps)) + 1;
    suspicious = true;
  }
  if (splitIndex <= 0 || splitIndex >= usable.length) return null;
  return {
    codeGlyphs: usable.slice(0, splitIndex),
    countGlyphs: usable.slice(splitIndex),
    splitSuspicious: suspicious,
  };
}

/**
 * codeGlyphs 结构收窄（2026-11-15 用户口径）：色号 = 字母 + 1-2 数字
 * 紧贴相连（共 2-3 字形），色号与数量之间有空格级间隔。自家导出图例把
 * 同一色号印两份（色票小字 + 文本列），切分/去重失败时 codeGlyphs 会
 * 同时含两份副本——按列间隙聚簇，取"有效长度 ∈ {2,3}"的最右簇（文本列
 * 副本通常最完整；粘连块按宽度折算字数）。无合格簇时保守不动。
 */
function reduceCodeToStructuralCluster(split: SplitResult, digitW: number): void {
  const glyphs = split.codeGlyphs;
  if (digitW <= 0 || glyphs.length < 2) return;
  // 现有 codeGlyphs 有效长度已落在色号长度域（2-3）时不干预——已经合理，
  // 贸然换簇会把正确切分改错（water-box D23 实测 131→831 的回归来源）。
  const effLenAll = glyphs
    .reduce((sum, glyph) => sum + Math.max(1, Math.round(widthOf(glyph) / digitW)), 0);
  if (effLenAll >= 2 && effLenAll <= 3) return;
  const columnGap = Math.max(10, Math.round(digitW * 1.6));
  const clusters: GlyphComp[][] = [];
  let current: GlyphComp[] = [glyphs[0]];
  for (let i = 1; i < glyphs.length; i += 1) {
    if (glyphs[i].x0 - glyphs[i - 1].x1 - 1 >= columnGap) {
      clusters.push(current);
      current = [glyphs[i]];
    } else {
      current.push(glyphs[i]);
    }
  }
  clusters.push(current);
  if (clusters.length < 2) return;
  const effLen = (cluster: GlyphComp[]) => cluster
    .reduce((sum, glyph) => sum + Math.max(1, Math.round(widthOf(glyph) / digitW)), 0);
  const candidates = clusters.filter(cluster => {
    const len = effLen(cluster);
    return len >= 2 && len <= 3;
  });
  if (!candidates.length) return;
  const chosen = candidates[candidates.length - 1];
  if (chosen.length === glyphs.length) return;
  split.codeGlyphs = chosen;
}

/** 全局一致性求解出的条目 code（null = 求解失败，走模板/先验兜底）。 */
interface ResolvedCode {
  code: string;
  /** 求解 code 的色点距离（无点锚条目为 null）。 */
  deltaE: number | null;
  /** 传播收窄后候选唯一（证据最强）。 */
  unique: boolean;
}

/**
 * code 全局一致性求解（约束传播 + 全局唯一性）。
 *
 * 背景：MARD 等密集色板里相似色 ΔE < 3，单条目"点色→最近色"会系统性
 * 选错（真值常排第 2~4 名）。但跨条目看：同一字符的字形形状一致、
 * 全部 code 互不相同、且都必须落色板内、色点距离 ≤ 上限——四个约束
 * 联合足以定解。步骤：
 * 1. 候选集：长度匹配 + 色点 ΔE 达标（无点锚条目不设 ΔE 约束）；
 * 2. 字形聚类：全部条目的 code 字形按位图 Jaccard 聚成"同字符"组；
 * 3. 传播：每组的允许字符 = 组内所有条目候选 code 对应位字符的交集，
 *    再用交集收窄各条目候选集，迭代至不动点；
 * 4. 定解：候选唯一的直接定解；否则按色点 ΔE 定解（需领先 RESOLVE_MARGIN），
 *    已定解的 code 从其它条目候选集中移除（全局唯一），迭代至无进展。
 */
export function resolveCodes(
  rawEntries: RawEntry[],
  splits: Array<SplitResult | null>,
  priors: Array<{ code: string; deltaE: number } | null>,
  prepared: Array<{ color: BeadColor; lab: [number, number, number] }>,
  options?: { wideColorWindow?: boolean },
): Array<ResolvedCode | null> {
  const n = rawEntries.length;
  const deltaEOf = new Map<string, number>();
  for (const entry of prepared) deltaEOf.set(entry.color.code, Number.POSITIVE_INFINITY);
  const dotDeltaE = (index: number, code: string): number => {
    const dotRgb = rawEntries[index].dotRgb;
    if (!dotRgb) return Number.POSITIVE_INFINITY;
    const entry = prepared.find(p => p.color.code === code);
    return entry ? deltaE2000(rgbToLab(...dotRgb), entry.lab) : Number.POSITIVE_INFINITY;
  };

  // 1. 候选集：长度匹配 + ΔE 上限 + "可信窗"（argmin + PLAUSIBLE_WINDOW）。
  // 密集色板里远房相似色（ΔE 略小于上限）会污染跨条目字符交集，
  // 用 argmin 邻域把候选集压到真正可信的近邻。
  const candidates: string[][] = [];
  for (let i = 0; i < n; i += 1) {
    const split = splits[i];
    if (!split || !split.codeGlyphs.length) { candidates.push([]); continue; }
    const len = split.codeGlyphs.length;
    const dotLab = rawEntries[i].dotRgb ? rgbToLab(...rawEntries[i].dotRgb) : null;
    const rankedAll = prepared
      .filter(p => p.color.code.length === len)
      .map(p => ({ code: p.color.code, deltaE: dotLab ? deltaE2000(dotLab, p.lab) : Number.POSITIVE_INFINITY }))
      .sort((a, b) => a.deltaE - b.deltaE);
    // 宽窗（色卡）：印刷票色≠豆色是系统性偏色，ΔE 硬窗会把真码滤在窗外
    // （card1 实测真值 NN 命中仅 33%）——颜色只提名（topK，不看 ΔE 绝对
    // 值），裁决交给下游簇约束 + 全局唯一性。窄窗（常规图例）行为不变。
    const ranked = options?.wideColorWindow
      ? rankedAll.slice(0, COLOR_TOPK_WIDE)
      : rankedAll.filter(p => p.deltaE <= PRIOR_MAX_DELTA_E);
    const window = ranked.length && dotLab && !options?.wideColorWindow
      ? Math.min(PRIOR_MAX_DELTA_E, ranked[0].deltaE + PLAUSIBLE_WINDOW)
      : Number.POSITIVE_INFINITY;
    candidates.push(ranked.filter(p => p.deltaE <= window).map(p => p.code));
  }

  // 2. 决定性先验锁（在字形传播前）：锁定项占用全局唯一名额，其余条目
  // 求解时自动避开；其字形不参与传播约束（自家导出实测：dedupe 残影会让
  // codeGlyphs 数 ≠ 真码长，组→字符映射错位会污染其它条目）。
  const resolved: Array<ResolvedCode | null> = new Array(n).fill(null);
  const taken = new Set<string>();
  for (let i = 0; i < n; i += 1) {
    const prior = priors[i];
    if (!prior || !rawEntries[i].dotRgb) continue;
    const dotLab = rgbToLab(...rawEntries[i].dotRgb);
    const ranked = prepared
      .filter(p => p.color.code.length === prior.code.length)
      .map(p => ({ code: p.color.code, deltaE: deltaE2000(dotLab, p.lab) }))
      .sort((a, b) => a.deltaE - b.deltaE);
    if (!ranked.length || ranked[0].code !== prior.code) continue;
    const margin = ranked.length > 1 ? ranked[1].deltaE - ranked[0].deltaE : Number.POSITIVE_INFINITY;
    // 先验锁整体停用（2026-11-15 归因）：此前 `false && A || B` 因优先级
    // 导致 B（原色级先验锁）仍然生效——误导色点 ΔE=0 恰好满足 B，先验被
    // 锁死，全局一致性求解没有纠正机会（mechanism 1 单测回归的根源）。
    const decisive = false && ((prior.deltaE <= PRIOR_LOCK_MAX_DELTA_E && margin >= PRIOR_LOCK_MARGIN)
      || (prior.deltaE <= PRIOR_LOCK_EXACT_DELTA_E && margin >= PRIOR_LOCK_EXACT_MARGIN));
    if (!decisive) continue;
    resolved[i] = { code: prior.code, deltaE: prior.deltaE, unique: true };
    taken.add(prior.code);
  }

  // 3. 字形聚类：union-find，同字符字形 Jaccard 距离极小。
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const p = parent.get(key);
    if (p === undefined || p === key) return key;
    const root = find(p);
    parent.set(key, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (let i = 0; i < n; i += 1) {
    const split = splits[i];
    if (!split) continue;
    split.codeGlyphs.forEach((_, j) => parent.set(`${i}:${j}`, `${i}:${j}`));
  }
  const glyphKeys: Array<{ i: number; j: number; key: string; glyph: GlyphComp }> = [];
  for (let i = 0; i < n; i += 1) {
    const split = splits[i];
    if (!split) continue;
    split.codeGlyphs.forEach((glyph, j) => glyphKeys.push({ i, j, key: `${i}:${j}`, glyph }));
  }
  for (let a = 0; a < glyphKeys.length; a += 1) {
    for (let b = a + 1; b < glyphKeys.length; b += 1) {
      const ga = glyphKeys[a], gb = glyphKeys[b];
      if (Math.abs(widthOf(ga.glyph) - widthOf(gb.glyph)) > 2) continue;
      if (bitmapJaccard(ga.glyph.bitmap, gb.glyph.bitmap) < GROUP_MAX_JACCARD) union(ga.key, gb.key);
    }
  }
  const groupOf = (i: number, j: number) => find(`${i}:${j}`);

  // 3. 约束传播。
  for (let round = 0; round < PROPAGATION_ROUNDS; round += 1) {
    const allowed = new Map<string, Set<string>>();
    for (let i = 0; i < n; i += 1) {
      const split = splits[i];
      if (!split || !candidates[i].length) continue;
      split.codeGlyphs.forEach((_, j) => {
        const root = groupOf(i, j);
        const chars = new Set(candidates[i].map(code => code[j]));
        const prev = allowed.get(root);
        if (!prev) { allowed.set(root, chars); return; }
        for (const ch of [...prev]) if (!chars.has(ch)) prev.delete(ch);
      });
    }
    // 空集 = 组内约束矛盾（聚类误合并或个别条目候选全错）：该组退化为
    // 不施加约束（成员条目靠 ΔE 排序与唯一性兜底）。
    for (const [root, chars] of allowed) if (chars.size === 0) allowed.set(root, null);
    let changed = false;
    for (let i = 0; i < n; i += 1) {
      const split = splits[i];
      if (!split || !candidates[i].length) continue;
      const filtered = candidates[i].filter(code =>
        split.codeGlyphs.every((_, j) => {
          const rule = allowed.get(groupOf(i, j));
          return rule === null || rule === undefined || rule.has(code[j]);
        }));
      if (filtered.length !== candidates[i].length) changed = true;
      candidates[i] = filtered;
    }
    if (!changed) break;
  }

  // 4. 定解（全局唯一；先验锁定项已占用名额）。
  for (let round = 0; round < n + 1; round += 1) {
    let progress = false;
    const order = candidates
      .map((cand, i) => ({ i, size: resolved[i] ? Number.POSITIVE_INFINITY : cand.length }))
      .sort((a, b) => a.size - b.size);
    for (const { i } of order) {
      if (resolved[i] || !candidates[i].length) continue;
      const split = splits[i]!;
      const open = candidates[i].filter(code => !taken.has(code));
      if (!open.length) continue;
      const ranked = open
        .map(code => ({ code, deltaE: dotDeltaE(i, code) }))
        .sort((a, b) => a.deltaE - b.deltaE
          || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
      if (ranked.length === 1 || ranked[1].deltaE - ranked[0].deltaE >= RESOLVE_MARGIN) {
        resolved[i] = { code: ranked[0].code, deltaE: rawEntries[i].dotRgb ? ranked[0].deltaE : null, unique: open.length === 1 };
        taken.add(ranked[0].code);
        progress = true;
      }
      void split;
    }
    if (!progress) break;
  }
  // 最终兜底：仍无解的"有点锚"条目按色点 ΔE argmin 定解（标记非唯一，
  // 置信度降低）。求解证据（字形一致性约束）已经收窄过候选集，argmin 是
  // 剩余候选里最可信的。无点锚条目没有 ΔE 证据，交给模板/先验路径。
  for (let i = 0; i < n; i += 1) {
    if (resolved[i] || !candidates[i].length || !rawEntries[i].dotRgb) continue;
    const ranked = candidates[i]
      .filter(code => !taken.has(code))
      .map(code => ({ code, deltaE: dotDeltaE(i, code) }))
      .sort((a, b) => a.deltaE - b.deltaE
        || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    if (!ranked.length) continue;
    resolved[i] = { code: ranked[0].code, deltaE: rawEntries[i].dotRgb ? ranked[0].deltaE : null, unique: false };
    taken.add(ranked[0].code);
  }
  return resolved;
}

interface EntryParse {
  code: string;
  count: number;
  confidence: number;
  warns: string[];
}

/** 单条目识别：code（一致性求解 → 模板 → 先验兜底）+ count（数字模板 + 切片回收）。 */
function recognizeEntry(
  entry: RawEntry,
  split: SplitResult | null,
  prior: { code: string; deltaE: number } | null,
  resolved: ResolvedCode | null,
  templates: Map<string, Bitmap>,
  countTemplates: Map<string, Bitmap>,
  paletteCodes: Set<string>,
  digitW: number,
  countW: number,
  synthTemplates?: Map<string, Bitmap> | null,
  prepared?: Array<{ color: BeadColor; lab: [number, number, number] }>,
): EntryParse {
  const warns: string[] = [];
  // 计数匹配（2026-11-15 浏览器实测）：真实字形模板捕获 JPEG 模糊，但
  // 模糊也会让 '1'（旗形头）贴上 '4' 模板——干净合成模板并入候选池取
  // 最小距离，两者互补（真实模板近时不受影响）。
  const matchCount = (bitmap: Bitmap): GlyphMatch | null => {
    const m = countTemplates.size ? matchGlyph(bitmap, countTemplates) : null;
    if (synthTemplates && synthTemplates.size) {
      const m2 = matchGlyph(bitmap, synthTemplates, true);
      if (m2 && (!m || m2.distance < m.distance)) return m2;
    }
    return m;
  };
  if (!split) {
    const fallback = resolved?.code ?? (prior && paletteCodes.has(prior.code) ? prior.code : '');
    return { code: fallback, count: 0, confidence: fallback ? 0.3 : 0.1, warns: ['entryTooShort'] };
  }
  if (split.splitSuspicious && !resolved) warns.push('splitSuspicious');

  // ---- code：全局一致性求解结果优先；未求解条目走模板/先验兜底。 ----
  //  prior 长度冲突守卫（C18 假码实证）：#27 黑票白字 3 碎片进求解被指派
  //  C18（色证 ΔE 11.0），而票色对 H6 ΔE=4.2 且码长 2 ≠ 字形数 3——碎片
  //  行的字形数本身不可信（JPEG 断裂），可靠票色的码长证据优先。
  let code = '';
  let codeConfidence: number | null = null;
  if (resolved && prepared && prior && paletteCodes.has(prior.code)
    && prior.code.length !== split.codeGlyphs.length
    && resolved.code.length === split.codeGlyphs.length
    && entry.dotRgb) {
    const dotLab = rgbToLab(...entry.dotRgb);
    const resolvedEntry = prepared.find(p => p.color.code === resolved.code);
    const priorEntry = prepared.find(p => p.color.code === prior.code);
    const resolvedDe = resolvedEntry ? deltaE2000(dotLab, resolvedEntry.lab) : Number.POSITIVE_INFINITY;
    const priorDe = priorEntry ? deltaE2000(dotLab, priorEntry.lab) : Number.POSITIVE_INFINITY;
    if (priorDe <= PRIOR_MAX_DELTA_E && resolvedDe > priorDe + CARD_PRIOR_CONFLICT_SLACK) {
      code = prior.code;
      codeConfidence = 0.35;
      warns.push('priorLengthConflict');
    }
  }
  if (!code && resolved) {
    // 字形证据仲裁（2026-11-24 card4 E16 实证，格式无关）：solver 的
    // 约束传播会被洗淡字形的误并组带偏（E16 的 E 被并进 H 组 → E16
    // 候选被淘汰 → 按点色 argmin 定了 H17），而模板逐字形匹配全部第一
    // 正确（E0.19/1/6 0.12）。joined 在色板内且全部字形可读时，逐字形
    // 证据优先于 solver——唯一解（unique）保守跳过不覆盖。
    if (templates.size && !resolved.unique) {
      const matches = split.codeGlyphs.map(glyph => matchGlyph(glyph.bitmap, templates));
      if (matches.every(m => m && m.distance <= GLYPH_MAX_DISTANCE)) {
        const joined = matches.map(m => m!.char).join('');
        if (joined !== resolved.code && paletteCodes.has(joined)) {
          code = joined;
          codeConfidence = 0.6;
          warns.push('shapeOverResolved');
        }
      }
    }
  }
  if (!code && resolved) {
    code = resolved.code;
    // 证据强度：色点距离（越近越可信）+ 是否唯一解。
    let base = resolved.deltaE === null ? 0.8 : 0.5 + 0.45 * (1 - resolved.deltaE / PRIOR_MAX_DELTA_E);
    base = resolved.unique ? Math.min(0.97, base + 0.04) : base - 0.05;
    codeConfidence = Math.max(0.3, Math.min(0.97, base));
  } else {
    let codeShape: number | null = null;
    let codeMargin: number | null = null;
    if (templates.size) {
      const matches = split.codeGlyphs.map(glyph => matchGlyph(glyph.bitmap, templates));
      if (matches.every(match => match)) {
        const margins: number[] = [];
        let distanceSum = 0;
        let readable = true;
        const chars: string[] = [];
        for (const match of matches) {
          const m = match!;
          if (m.distance > GLYPH_MAX_DISTANCE) readable = false;
          chars.push(m.char);
          distanceSum += m.distance;
          margins.push(m.secondDistance - m.distance);
        }
        codeShape = 1 - distanceSum / matches.length;
        codeMargin = Math.max(0, Math.min(1, median(margins) * 2));
        const joined = chars.join('');
        if (readable && paletteCodes.has(joined)) {
          code = joined;
          if (prior && prior.code !== joined && prior.code.length === chars.length && (codeMargin ?? 0) < SHAPE_AMBIGUOUS_MARGIN) {
            // 形状证据打平：色点是整块印刷色，区分度比小字字形高两个数量级。
            code = prior.code;
            warns.push('shapeTiePrior');
          }
        } else if (prior && paletteCodes.has(prior.code) && prior.code.length === matches.length) {
          code = prior.code;
          warns.push('shapeMismatchPrior');
        } else if (paletteCodes.has(joined)) {
          code = joined;
          warns.push('lowShape');
        }
      } else {
        warns.push('noTemplates');
      }
    }
    if (!code && prior && paletteCodes.has(prior.code)) {
      code = prior.code;
      if (!warns.includes('shapeMismatchPrior') && !warns.includes('shapeTiePrior')) warns.push('priorOnly');
    }
    if (codeShape !== null) {
      const priorConf = prior ? Math.max(0, 1 - prior.deltaE / PRIOR_MAX_DELTA_E) : 0;
      codeConfidence = prior
        ? (1 - COLOR_PRIOR_WEIGHT) * codeShape + COLOR_PRIOR_WEIGHT * priorConf
        : codeShape * 0.85;
      if (codeMargin !== null) codeConfidence = Math.min(1, codeConfidence + 0.1 * codeMargin);
    } else if (code) {
      codeConfidence = 0.35;
    }
  }

  // ---- count：数字模板匹配 + 宽块多 k 切片回收（粘连数字 / 粘连"粒"尾块）。 ----
  let count = 0;
  const digits: string[] = [];
  const digitDistances: number[] = [];
  let countReadable = true;
  for (let i = 0; i < split.countGlyphs.length; i += 1) {
    const glyph = split.countGlyphs[i];
    const isLast = i === split.countGlyphs.length - 1;
    const w = widthOf(glyph);
    // 宽度守卫：单字宽的 1.4 倍以上必然是粘连块（数字对 / 数字+粒），
    // 直接匹配会退化成"取中间",必须走切片回收。
    const match = w <= digitW * 1.4 ? matchCount(glyph.bitmap) : null;
    if (match && match.distance <= GLYPH_MAX_DISTANCE) {
      if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[cnt-dbg] x${glyph.x0} w${w} '${match.char}' d${match.distance.toFixed(3)}`);
      digits.push(match.char.split('#')[0]);
      digitDistances.push(match.distance);
      continue;
    }
    // 宽块：多枚字符粘连。k 取 round(w/countW) 及其邻域，逐 k 试切：
    // 非尾块要求整块全匹配（取平均距离最小者）；尾块取最长匹配前缀
    // （余下部分按"粒"残留丢弃）。countW 是计数字实际中位宽（比全局
    // digitW 窄）：守卫按 digitW 会把两字粘连块（w≈2×countW）全部拒收。
    const centerK = countW > 0 ? Math.round(w / countW) : 0;
    const ks: number[] = [];
    for (const k of [centerK - 1, centerK, centerK + 1]) {
      if (k >= 2 && k <= 4 && countW > 0 && w >= countW * 0.82 * k) ks.push(k);
    }
    let bestK = -1;
    let bestAvg = Number.POSITIVE_INFINITY;
    let bestPrefix = 0;
    // 尾块位数预算（2026-11-15 浏览器实测）：末位数字常与"粒"粘连，k 切片
    // 会把粒也切成数字（粒形似'0'全匹配）→ 总位数超 3 判 countUnread
    // （H1 953、E14 241 等 7 条全灭的根因）。尾块可贡献位数 = 3 - 已读位数。
    const tailBudget = Math.max(0, 3 - digits.length);
    if (countTemplates.size) {
      for (const k of ks) {
        const slices = splitBitmap(glyph.bitmap, k);
        const matches = slices.map(slice => matchCount(slice));
        let prefix = 0;
        let distSum = 0;
        while (prefix < matches.length) {
          const m = matches[prefix];
          if (m && m.distance <= SPLIT_MAX_DISTANCE) { distSum += m.distance; prefix += 1; }
          else break;
        }
        if (isLast && prefix > tailBudget) {
          prefix = tailBudget;
          distSum = matches.slice(0, prefix).reduce((s, m) => s + (m ? m.distance : 0), 0);
        }
        const fullMatch = prefix === k;
        if (isLast) {
          if (prefix > bestPrefix || (prefix === bestPrefix && prefix > 0 && distSum / prefix < bestAvg)) {
            bestK = k; bestAvg = prefix ? distSum / prefix : Number.POSITIVE_INFINITY; bestPrefix = prefix;
          }
        } else if (fullMatch && distSum / k < bestAvg) {
          bestK = k; bestAvg = distSum / k; bestPrefix = k;
        }
      }
    }
    if (bestK > 0 && bestPrefix > 0) {
      const slices = splitBitmap(glyph.bitmap, bestK);
      const matches = slices.map(slice => matchCount(slice));
      if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[cnt-dbg] x${glyph.x0} w${w} WIDE k${bestK} prefix${bestPrefix} -> '${matches.slice(0, bestPrefix).map(m => m!.char).join('')}'`);
      for (let s = 0; s < bestPrefix; s += 1) {
        digits.push(matches[s]!.char.split('#')[0]);
        digitDistances.push(matches[s]!.distance);
      }
      if (isLast) break;
      if (bestPrefix === bestK) continue;
      countReadable = false;
      break;
    }
    if (isLast && digits.length >= 1) {
      warns.push('countTailDropped'); // 尾部未匹配块按"粒"残留丢弃
      // 尾块宽度装得下"数字+粒"粘连（≥2×计数字宽）时截断值不可信：
      // 215 粒被截成 21 是"自信的错值"（2026-11-14 用户图实测，粒数全线
      // 少一位），比读不出更危险——数量配额会按错值配平。置为未读出。
      if (countW > 0 && w > countW * 2) countReadable = false;
      break;
    }
    countReadable = false;
    break;
  }
  if (digits.length >= 1 && digits.length <= 3 && countReadable) {
    const value = Number.parseInt(digits.join(''), 10);
    if (Number.isFinite(value) && value >= 1 && value <= COUNT_MAX) count = value;
    else warns.push('countOutOfRange');
  } else if (!count) {
    warns.push('countUnread');
  }
  const countShape = digitDistances.length ? 1 - digitDistances.reduce((s, d) => s + d, 0) / digitDistances.length : 0;

  // ---- 置信度：code 证据 + 粒数证据的加权。 ----
  let confidence = codeConfidence ?? 0;
  confidence = 0.75 * confidence + 0.25 * countShape;
  if (split.codeGlyphs.length !== code.length && code) {
    confidence *= 0.7;
    warns.push('codeLenMismatch');
  }
  if (!count) confidence *= 0.5;
  if (code && !paletteCodes.has(code)) {
    confidence *= 0.4;
    warns.push('codeNotInPalette');
  }
  if (confidence < LEGEND_LOW_CONFIDENCE && !warns.includes('lowConfidence')) warns.push('lowConfidence');
  return { code, count, confidence: Math.max(0, Math.min(1, confidence)), warns };
}

/**
 * 头部交叉校验信息："N 色"与"W × H"（图纸右上角）。
 * 用图例自举的数字模板 OCR 头部数字；解析不出则字段缺省（可选校验）。
 */
function parseHeader(
  source: ImportImagePixels,
  calibration: ImportGridCalibration,
  digitTemplates: Map<string, Bitmap>,
): { colorCount?: number; gridCols?: number; gridRows?: number } {
  const result: { colorCount?: number; gridCols?: number; gridRows?: number } = {};
  if (digitTemplates.size === 0) return result;
  const headerBottom = Math.floor(calibration.originY) - 2;
  if (headerBottom < 12) return result;
  const x0 = Math.round(source.width * 0.72);
  const background = dominantBaseColor(source.data, source.width, x0, 0, source.width, headerBottom + 1);
  // 头部区域按整块找暗像素行，再取最下面一条文字行（紧贴网格上沿）。
  const contrast2 = CONTRAST * CONTRAST;
  const counts = new Int32Array(source.height);
  for (let y = 0; y <= headerBottom; y += 1) {
    let c = 0;
    for (let x = x0; x < source.width; x += 1) {
      const i = (y * source.width + x) * 4;
      const dr = source.data[i] - background[0], dg = source.data[i + 1] - background[1], db = source.data[i + 2] - background[2];
      if (dr * dr + dg * dg + db * db > contrast2) c += 1;
    }
    counts[y] = c;
  }
  const darkMin = Math.max(4, Math.round(source.width * 0.001));
  let lastStart = -1;
  let lastEnd = -1;
  let runStart = -1;
  let runGap = 0;
  for (let y = 0; y <= headerBottom; y += 1) {
    if (counts[y] >= darkMin) {
      if (runStart < 0) runStart = y;
      runGap = 0;
    } else if (runStart >= 0) {
      runGap += 1;
      if (runGap > 2) {
        lastStart = runStart;
        lastEnd = y - runGap;
        runStart = -1;
        runGap = 0;
      }
    }
  }
  if (runStart >= 0) { lastStart = runStart; lastEnd = headerBottom; }
  if (lastStart < 0 || lastEnd - lastStart + 1 < 6) return result;
  const glyphs = analyzeLine(source, background, { y0: lastStart, y1: lastEnd, minX: x0, maxX: source.width - 1 });
  if (glyphs.length < 2) return result;
  // 连续数字串聚类：digit 字形连续归入当前串；非 digit（"色"/"×"）只是
  // 语义分隔符，把串断开。
  const runs: string[] = [];
  let current: string[] = [];
  for (const glyph of glyphs) {
    const match = matchGlyph(glyph.bitmap, digitTemplates);
    if (match && match.distance <= GLYPH_MAX_DISTANCE) current.push(match.char);
    else if (current.length) { runs.push(current.join('')); current = []; }
  }
  if (current.length) runs.push(current.join(''));
  // 解释：run1（"27色"）= 色数；run2/run3（"101×132"）= 网格列/行。
  const parsedRuns = runs.filter(run => run.length >= 1 && run.length <= 3)
    .map(run => Number.parseInt(run, 10))
    .filter(value => Number.isFinite(value) && value >= 1 && value <= 312);
  if (parsedRuns.length === 3) {
    result.colorCount = parsedRuns[0];
    result.gridCols = parsedRuns[1];
    result.gridRows = parsedRuns[2];
  } else if (parsedRuns.length === 1) {
    result.colorCount = parsedRuns[0];
  }
  return result;
}

function emptyChecks(): LegendChecks {
  return { codesInPalette: false, codesUnique: false, sumWithinGrid: false, sumCount: 0 };
}

export interface LegendDebugLine {
  y0: number;
  y1: number;
  comps: Array<{ x0: number; x1: number; y0: number; y1: number; area: number; rgb: [number, number, number]; dot: boolean }>;
}

export interface LegendDebugInfo {
  bandTop: number;
  background: [number, number, number];
  lines: LegendDebugLine[];
  entries: Array<{ dotRgb: [number, number, number] | null; glyphX: number[]; prior: string | null; priorDE: number | null }>;
}

/** 诊断：色票锚定检测的中间产物（dbg 脚本用）。 */
export interface SwatchDebug {
  x0: number; x1: number; y0: number; y1: number; area: number;
  solidness: number; modeRgb: [number, number, number]; kept: boolean;
}
const lastSwatchDebug: SwatchDebug[] = [];
export function debugSwatchDetection(): SwatchDebug[] {
  return lastSwatchDebug;
}

/** 诊断：区域仲裁的候选带中间产物（调试脚本用）。 */
export interface LegendLocationDebug {
  region: LegendRegion | 'edge-bottom' | 'edge-right';
  anchored: boolean;
  lines: number;
  rawEntries: number;
}
const lastLocationDebug: LegendLocationDebug[] = [];
export function debugLegendLocation(): LegendLocationDebug[] {
  return lastLocationDebug;
}

/** 诊断：行聚类 / 连通域 / 色点判定 / 条目切分的中间产物（调试脚本用）。 */
export function debugLegendLines(
  source: ImportImagePixels,
  calibration: ImportGridCalibration,
  palette: BeadColor[],
): LegendDebugInfo | null {
  const selected = selectLegendLocation(source, calibration);
  if (!selected) return null;
  const located = selected.located;
  const prepared = palette.filter(color => color.enabled !== false).map(color => ({ color, lab: rgbToLab(...color.rgb) }));
  const lines: LegendDebugLine[] = [];
  const entries: LegendDebugInfo['entries'] = [];
  for (const line of located.lines) {
    const comps = analyzeLine(source, located.background, line);
    if (comps.length < 4) continue;
    const ctx: LineContext = {
      medianW: median(comps.map(c => widthOf(c))),
      medianH: median(comps.map(c => c.y1 - c.y0 + 1)),
    };
    lines.push({
      y0: line.y0, y1: line.y1,
      comps: comps.map(c => ({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, area: c.area, rgb: c.rgb, dot: isDotComponent(c, ctx.medianW, ctx.medianH) })),
    });
    let prevEndX = -1;
    for (const group of groupByGaps(comps)) {
      const entry = buildEntry(source, located.background, group, prevEndX, ctx);
      prevEndX = group[group.length - 1].x1;
      if (!entry) continue;
      const prior = entry.dotRgb ? priorFromDot(entry.dotRgb, prepared) : null;
      entries.push({
        dotRgb: entry.dotRgb,
        glyphX: entry.glyphs.map(g => g.x0),
        prior: prior?.code ?? null,
        priorDE: prior ? Math.round(prior.deltaE * 100) / 100 : null,
      });
    }
  }
  return { bandTop: located.lines[0]?.y0 ?? 0, background: located.background, lines, entries };
}

export interface LegendDebugParse {
  rawEntries: RawEntry[];
  /** 逐行连通域与锚点判定（anchorTrace），诊断误锚切行。 */
  anchorTrace?: Array<{ y0: number; y1: number; comps: Array<{ x0: number; x1: number; y0: number; y1: number; area: number; anchor: boolean }> }>;
  priors: Array<{ code: string; deltaE: number } | null>;
  splits: Array<SplitResult | null>;
  resolvedCodes: Array<ResolvedCode | null>;
  digitW: number;
  templateChars: string[];
  countTemplateChars: string[];
  countTemplateAscii?: string;
  parsed: EntryParse[];
}

/**
 * 色票锚点判定（比 isDotComponent 更严）：实心块 + 明显宽于行内中位字形。
 * 粘连的码字块（"F20" 连成一个连通域）宽度也可能过 1.4×medianW，但墨迹
 * 实心度低（笔画空洞多 ≤0.5）；色票/圆点实心度 ≥0.62（票内白字挖洞后
 * 仍在 0.65+）。锚定行按此切段，避免把码字块误当成色票锚点。
 */
function isSwatchAnchor(comp: GlyphComp, ctx: LineContext): boolean {
  if (!isDotComponent(comp, ctx.medianW, ctx.medianH)) return false;
  const w = widthOf(comp);
  const h = comp.y1 - comp.y0 + 1;
  if (comp.area / (w * h) < 0.62) return false;
  return w >= ctx.medianW * 1.15;
}

/**
 * 框选区域的多条目装配：三种版式通用（底部横条 / 右侧竖列 / 右上面板）。
 * 行内分组：锚定行按色票锚点切段（面板一行含多列条目），非锚定行按
 * 间隙分段（横条一行多组）。组序列从左到右走一遍——
 * · 组首是色点/色票 → 开新条目（点色取众数：票内印字是少数派）
 * · 组首不是点 → 浅色票补搜（窗口含上一组末尾；锚定行右界延伸罩整票）
 *   命中 → 新条目；未命中且当前有条目 → 附着（计数残组归并到主条目）
 * · 行首无主的文字组（标题行/标尺）丢弃
 */
function collectFramedEntries(
  source: ImportImagePixels,
  located: LegendLocation,
): { rawEntries: RawEntry[]; digitW: number } {
  const rawEntries: RawEntry[] = [];
  for (const line of located.lines) {
    const comps = analyzeLine(source, located.background, line);
    if (comps.length < 2) continue;
    const ctx: LineContext = {
      medianW: median(comps.map(c => widthOf(c))),
      medianH: median(comps.map(c => c.y1 - c.y0 + 1)),
    };
    // 水印/标尺碎行守卫：字形只有 3-4px 高的行是半透明水印或页面装饰
    // 文字（真图例字形 ≥8px 或是整张色票），它们的碎片会经浅色点补搜
    // 凑成近白"色点"的假条目（实测边缘回退带靠水印行多出 4 条假条目）。
    if (ctx.medianH < 5) continue;
    const groups: GlyphComp[][] = [];
    if (located.anchored) {
      // 锚定行：色票锚点即条目起点，按锚点切段；锚点前的杂字形自成一组。
      // 假锚守卫（2026-11-15 自家导出图实测）：加粗计数数字会粘连成实心块
      // （"27"→18×8 fill 0.70，与真色票 fill 0.7-0.9 同档、高度比也与
      // water-box 真锚点 1.0-1.44 重叠——几何特征无法区分），但它后面只剩
      // 1-2 个字形（余数+粒）；真色票锚点之后必然跟着整列内容（码字+计数
      // ≥3 字形）。剩余字形不足 3 时不切，把假锚点并回当前条目（它本来就是
      // 计数的一部分，缺了它计数少一位）。
      let current: GlyphComp[] = [];
      for (let i = 0; i < comps.length; i += 1) {
        const comp = comps[i];
        if (isSwatchAnchor(comp, ctx) && current.length && comps.length - i - 1 >= 3) {
          groups.push(current);
          current = [comp];
        } else current.push(comp);
      }
      if (current.length) groups.push(current);
    } else {
      groups.push(...groupByGaps(comps));
    }
    let prevEndX = -1;
    let current: RawEntry | null = null;
    for (const group of groups) {
      const lead = group[0];
      let entry: RawEntry | null = null;
      if (isDotComponent(lead, ctx.medianW, ctx.medianH)) {
        entry = { dotRgb: lead.modeRgb, glyphs: group.slice(1) };
      } else {
        const hit = findPaleDot(source, located.background, group, prevEndX, located.anchored ? lead.x0 + 36 : undefined);
        if (hit) {
          const box = hit.box;
          entry = {
            dotRgb: hit.rgb,
            glyphs: group.filter(g => g.x1 < box.x0 - 1 || g.x0 > box.x1 + 1 || g.y1 < box.y0 - 1 || g.y0 > box.y1 + 1),
          };
        }
      }
      if (entry) {
        if (current) rawEntries.push(current);
        current = entry;
      } else if (current) {
        current.glyphs.push(...group);
      }
      prevEndX = group[group.length - 1].x1;
    }
    if (current) rawEntries.push(current);
  }
  // 防噪守卫与 buildEntry 同口径：无点锚且字形少的组是标尺/水印碎行。
  const kept = rawEntries.filter(entry => entry.glyphs.length >= 2 && (entry.dotRgb !== null || entry.glyphs.length >= 4));
  const digitWidths: number[] = [];
  for (const entry of kept) for (const glyph of entry.glyphs) digitWidths.push(widthOf(glyph));
  return { rawEntries: kept, digitW: Math.max(3, median(digitWidths)) };
}

/**
 * 逐行 → 条目。右侧色票锚定路径与用户框选区域走多条目装配（锚定行内
 * 按色票锚点切段，一行可含多个条目；面板版式的行含左右两列条目）；
 * 其余路径（底部横条 + 右侧回落文字行聚类）保持旧行为：连通域 ≥4 →
 * 间隙分段 → buildEntry，右侧清单的标题行按"无点锚行整行丢弃"过滤。
 */
function collectRawEntries(
  source: ImportImagePixels,
  located: LegendLocation,
): { rawEntries: RawEntry[]; digitW: number } {
  if (located.framed || (located.region === 'right' && located.anchored)) {
    return collectFramedEntries(source, located);
  }
  const perLine: RawEntry[][] = [];
  for (const line of located.lines) {
    const comps = analyzeLine(source, located.background, line);
    if (comps.length < 4) continue;
    const ctx: LineContext = {
      medianW: median(comps.map(c => widthOf(c))),
      medianH: median(comps.map(c => c.y1 - c.y0 + 1)),
    };
    let prevEndX = -1;
    const lineEntries: RawEntry[] = [];
    const dotSampling = located.region === 'right' ? 'mode' : 'center';
    for (const group of groupByGaps(comps)) {
      const entry = buildEntry(source, located.background, group, prevEndX, ctx, dotSampling);
      prevEndX = group[group.length - 1].x1;
      if (!entry) continue;
      lineEntries.push(entry);
    }
    perLine.push(lineEntries);
  }
  let kept = perLine;
  if (located.region === 'right') {
    const dotful = perLine.filter(entries => entries.length > 0 && entries[0].dotRgb).length;
    if (dotful >= 3) kept = perLine.filter(entries => entries.length > 0 && entries[0].dotRgb);
  }
  const rawEntries: RawEntry[] = [];
  for (const lineEntries of kept) {
    if (!lineEntries.length) continue;
    if (located.region === 'right') {
      // 右侧清单：一行 = 色票 + 码字列 + 重复码字列 + 计数，间隙分段会把它
      // 切成多组——合并回一个条目再进切分流（切分按"最后的空格级间隙"取计数区）。
      const dotOwner = lineEntries.find(entry => entry.dotRgb) ?? lineEntries[0];
      const glyphs = lineEntries.flatMap(entry => entry.glyphs).sort((a, b) => a.x0 - b.x0);
      rawEntries.push({ dotRgb: dotOwner.dotRgb, glyphs });
      continue;
    }
    // 底部条带一行可含多个并排条目（water-box 是 3 行 × 9 列），全部保留。
    rawEntries.push(...lineEntries);
  }
  const digitWidths: number[] = [];
  for (const entry of rawEntries) for (const glyph of entry.glyphs) digitWidths.push(widthOf(glyph));
  return { rawEntries, digitW: Math.max(3, median(digitWidths)) };
}

/**
 * 右侧清单把同一色号印两列（色票里一次、文本列再一次）：codeGlyphs 恰为
 * 色号长度的 2~3 倍且各份字形逐一相似时保留第一份——否则全局求解会因
 * "长度无候选色"而整体退到色点先验，置信度被砍半。
 */
function dedupeDuplicateCodeColumns(
  priors: Array<{ code: string; deltaE: number } | null>,
  splits: Array<SplitResult | null>,
): void {
  for (let i = 0; i < priors.length; i += 1) {
    const split = splits[i], prior = priors[i];
    if (!split || !prior) continue;
    const len = prior.code.length;
    for (const copies of [3, 2]) {
      if (split.codeGlyphs.length !== len * copies) continue;
      let same = true;
      for (let copy = 1; copy < copies && same; copy += 1) {
        for (let j = 0; j < len; j += 1) {
          if (bitmapJaccard(split.codeGlyphs[j].bitmap, split.codeGlyphs[copy * len + j].bitmap) > 0.25) { same = false; break; }
        }
      }
      if (same) split.codeGlyphs = split.codeGlyphs.slice(0, len);
      break;
    }
  }
}

/**
 * 按列修复 code 字形（先验锚定行）：自家导出图例的行结构是
 * [色票][码字列][码字名列][计数字列][粒]，码字印两份。dedupe 后的
 * codeGlyphs 可能跨两列（JPEG 让某一份缺字/粘连，列簇合并失败），
 * 长度碰巧凑成 L 时垃圾字形会以"对齐"假象进入自举标注，毒化数字
 * 模板。已知 L 时逐列重选：有恰好 L 个单字形的列直接用；否则找总宽
 * ≈ L×digitW 的列按宽度占比切片凑 L（粘连 "C2"+"1" → C,2,1）。
 */
function repairCodeFromColumns(
  split: SplitResult,
  prior: { code: string; deltaE: number },
  digitW: number,
): void {
  const len = prior.code.length;
  const glyphs = split.codeGlyphs;
  if (glyphs.length === 0 || glyphs.length === len) return;
  const columnGap = Math.max(10, Math.round(digitW * 1.6));
  const columns: GlyphComp[][] = [];
  let current: GlyphComp[] = [glyphs[0]];
  for (let k = 1; k < glyphs.length; k += 1) {
    if (glyphs[k].x0 - glyphs[k - 1].x1 - 1 >= columnGap) { columns.push(current); current = [glyphs[k]]; }
    else current.push(glyphs[k]);
  }
  columns.push(current);
  // 优先级 1：恰好 L 个单字形的列（干净拷贝）。
  const exact = columns.find(col => col.length === len);
  if (exact) { split.codeGlyphs = exact; return; }
  // 优先级 2：总宽 ≈ L×digitW 的列，按宽度占比切片凑 L。
  for (const col of columns) {
    if (col.length >= len) continue;
    const totalW = col.reduce((sum, glyph) => sum + widthOf(glyph), 0);
    if (totalW < digitW * len * 0.55 || totalW > digitW * len * 1.9) continue;
    const ks = col.map(glyph => Math.max(1, Math.round((widthOf(glyph) / totalW) * len)));
    if (ks.reduce((sum, k) => sum + k, 0) !== len) continue;
    const pieces: GlyphComp[] = [];
    col.forEach((glyph, k) => {
      if (ks[k] === 1) { pieces.push(glyph); return; }
      for (const piece of sliceGlyphBitmap(glyph, ks[k])) pieces.push(piece);
    });
    if (pieces.length === len) { split.codeGlyphs = pieces; return; }
  }
}

/**
 * 荒谬切分剪枝（resolveCodes 前置）：装配噪声行（水印笔画并进条目、网格
 * 文字混入）会产出字形数远超任何色码长度的 codeGlyphs（实测 18 个），它们
 * 参与 union-find 聚类与全局唯一性后会抢走真码名额（幽灵行抢码）。剪掉后
 * 条目降级为先验/色点建议路径。阈值宽松：4 字符码的 3 倍余量。
 */
function pruneImplausibleSplits(
  priors: Array<{ code: string; deltaE: number } | null>,
  splits: Array<SplitResult | null>,
): void {
  for (let i = 0; i < splits.length; i += 1) {
    const split = splits[i];
    if (!split) continue;
    const cap = (priors[i]?.code.length ?? 4) * 3 + 2;
    if (split.codeGlyphs.length > cap) splits[i] = null;
  }
}

/**
 * 右侧清单重复码字列的第二道合并（仅右侧区域调用）：同色号印两列时
 * codeGlyphs 常含两份拷贝，粘连/残缺使份数不再恰为色号长度的 2~3 倍，
 * 逐份 Jaccard 比对失效。按列间隙（≥max(10, 1.6×digitW)）把 codeGlyphs
 * 聚成列簇：第一簇总宽与 L×digitW 相当（0.55~1.7 倍）时只保留第一簇
 * （码字列必然是行内最左的文本列）；否则跨簇按宽度占比重切（最大余数
 * 法）成恰好 L 片。总宽与 L×digitW 相差过大时不动，交给先验兜底。
 */
function dedupeCodeColumnCopies(
  priors: Array<{ code: string; deltaE: number } | null>,
  splits: Array<SplitResult | null>,
  digitW: number,
): void {
  const columnGap = Math.max(10, Math.round(digitW * 1.6));
  for (let i = 0; i < priors.length; i += 1) {
    const split = splits[i], prior = priors[i];
    if (!split || !prior) continue;
    const len = prior.code.length;
    const glyphs = split.codeGlyphs;
    if (glyphs.length < 2) continue;
    const clusters: GlyphComp[][] = [];
    let current: GlyphComp[] = [glyphs[0]];
    for (let k = 1; k < glyphs.length; k += 1) {
      if (glyphs[k].x0 - glyphs[k - 1].x1 - 1 >= columnGap) { clusters.push(current); current = [glyphs[k]]; }
      else current.push(glyphs[k]);
    }
    clusters.push(current);
    // 第一簇 ≈ L×digitW → 只保留第一簇（码字列必然是行内最左文本列）。
    // 不要求 glyphs.length > len：两份粘连拷贝（如 [16px "F20", 16px "F20"]）
    // 总数可能 ≤ len，但每份粘连块随后由 sliceMergedCodeGlyphs 切开。
    if (clusters.length >= 2) {
      const w0 = clusters[0].reduce((sum, glyph) => sum + widthOf(glyph), 0);
      if (w0 >= len * digitW * 0.55 && w0 <= len * digitW * 1.7) {
        split.codeGlyphs = clusters[0];
        continue;
      }
    }
    if (glyphs.length <= len) continue;
    const totalW = glyphs.reduce((sum, glyph) => sum + widthOf(glyph), 0);
    if (totalW < len * digitW * 0.55 || totalW > len * digitW * 2.1) continue;
    const raw = glyphs.map(glyph => (widthOf(glyph) / totalW) * len);
    const ks = raw.map(Math.floor);
    let rem = len - ks.reduce((sum, k) => sum + k, 0);
    const order = raw.map((value, k) => ({ frac: value - Math.floor(value), k })).sort((a, b) => b.frac - a.frac);
    for (const { k } of order) {
      if (rem <= 0) break;
      ks[k] += 1;
      rem -= 1;
    }
    const pieces: GlyphComp[] = [];
    glyphs.forEach((glyph, k) => {
      if (ks[k] <= 0) return;
      if (ks[k] === 1) { pieces.push(glyph); return; }
      for (const piece of sliceGlyphBitmap(glyph, ks[k])) pieces.push(piece);
    });
    if (pieces.length === len) split.codeGlyphs = pieces;
  }
}

/**
 * 连体块等分切片，切片带独立 bbox（x0/x1 按占比收窄）：沿用整块 bbox
 * 会让下游的"单字宽"守卫（widthOf > digitW*1.9 不进模板）把整块切片
 * 全部跳过，模板链断粮。
 */
function sliceGlyphBitmap(glyph: GlyphComp, k: number): GlyphComp[] {
  const w = widthOf(glyph);
  return splitBitmap(glyph.bitmap, k).map((piece, index) => {
    let on = 0;
    for (let t = 0; t < piece.data.length; t += 1) on += piece.data[t];
    return {
      x0: glyph.x0 + Math.round((w * index) / k),
      x1: glyph.x0 + Math.round((w * (index + 1)) / k) - 1,
      y0: glyph.y0, y1: glyph.y1,
      area: on, rgb: glyph.rgb, modeRgb: glyph.modeRgb, bitmap: piece,
    };
  });
}

/**
 * 字符粘连回收：码字印刷成连体块（"E16" 一个连通域）时 codeGlyphs 数会
 * 少于色号长度、全局求解因"长度无候选"而整体失效。按宽度占比把连体块
 * 等分切片凑齐 L 个字形，切片位图参与模板匹配与约束传播。
 * （仅点锚条目走此路径：L 来自色票先验。）
 */
export function sliceMergedCodeGlyphs(
  split: SplitResult,
  prior: { code: string; deltaE: number },
  digitW: number,
): void {
  const length = prior.code.length;
  const glyphs = split.codeGlyphs;
  if (glyphs.length === 0 || glyphs.length >= length) return;
  const totalW = glyphs.reduce((sum, glyph) => sum + widthOf(glyph), 0);
  if (totalW < digitW * length * 0.6) return;
  const sliced: GlyphComp[] = [];
  for (const glyph of glyphs) {
    const k = Math.max(1, Math.round((widthOf(glyph) / totalW) * length));
    if (k === 1) { sliced.push(glyph); continue; }
    for (const piece of sliceGlyphBitmap(glyph, k)) sliced.push(piece);
  }
  if (sliced.length === length) split.codeGlyphs = sliced;
}

/**
 * 右侧清单行内切分：计数区从行尾向左走，遇到"列间隙"（≥10px）停——
 * 计数字符间间隙 ≤4px，码字列/重复码字列与计数列之间 ≥14px。
 * 码字区（可能含重复列与粘连块）整体留给 codeGlyphs，交由去重、切片
 * 与色票先验兜底。返回 null 时回落通用切分。
 */
function splitRightRow(glyphs: GlyphComp[], digitW: number): SplitResult | null {
  if (glyphs.length < 2) return null;
  const columnGap = Math.max(10, Math.round(digitW * 1.6));
  let start = glyphs.length - 1;
  while (start > 0 && glyphs[start].x0 - glyphs[start - 1].x1 - 1 < columnGap) start -= 1;
  const countGlyphs = glyphs.slice(start);
  const codeGlyphs = glyphs.slice(0, start);
  if (!countGlyphs.length || !codeGlyphs.length) return null;
  // 计数区必须含窄字形（数字或"粒"），全是宽块说明走错了列。
  if (Math.min(...countGlyphs.map(widthOf)) > digitW * 2.2) return null;
  return { codeGlyphs, countGlyphs, splitSuspicious: false };
}

/** 诊断：完整中间产物（切分/求解/模板/识别），供 dbg-* 脚本逐层定位问题。 */
export function debugLegendParse(
  source: ImportImagePixels,
  calibration: ImportGridCalibration,
  palette: BeadColor[],
  options: LegendParseOptions = {},
): LegendDebugParse | null {
  const selected = selectLegendLocation(source, calibration, options.region);
  if (!selected) return null;
  const located = selected.located;
  const prepared = palette
    .filter(color => color.enabled !== false)
    .map(color => ({ color, lab: rgbToLab(...color.rgb) }));
  if (!prepared.length) return null;
  const { rawEntries, digitW } = selected;
  if (rawEntries.length < MIN_ENTRIES) return null;
  // 锚点追踪：逐行重放 analyzeLine + isSwatchAnchor，诊断误锚切行。
  const anchorTrace = located.lines.map(line => {
    const comps = analyzeLine(source, located.background, line);
    const ctx: LineContext = {
      medianW: median(comps.map(c => widthOf(c))),
      medianH: median(comps.map(c => c.y1 - c.y0 + 1)),
    };
    return {
      y0: line.y0, y1: line.y1,
      comps: comps.map(c => ({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, area: c.area, anchor: isSwatchAnchor(c, ctx) })),
    };
  });
  void anchorTrace;
  const priors = rawEntries.map(entry => entry.dotRgb ? priorFromDot(entry.dotRgb, prepared) : null);
  const splits = rawEntries.map((entry, index) => {
    const generic = () => splitEntry(entry.glyphs, priors[index], digitW);
    return located.region === 'right' ? (splitRightRow(entry.glyphs, digitW) ?? generic()) : generic();
  });
  dedupeDuplicateCodeColumns(priors, splits);
  if (located.region === 'right') dedupeCodeColumnCopies(priors, splits, digitW);
  for (const split of splits) if (split) reduceCodeToStructuralCluster(split, digitW);
  for (let i = 0; i < splits.length; i += 1) {
    if (splits[i] && priors[i]) sliceMergedCodeGlyphs(splits[i]!, priors[i]!, digitW);
  }
  for (let i = 0; i < splits.length; i += 1) {
    if (false && splits[i] && priors[i]) repairCodeFromColumns(splits[i]!, priors[i]!, digitW);
  }
  // pruneImplausibleSplits(priors, splits);
  const resolvedCodes = resolveCodes(rawEntries, splits, priors, prepared);
  const labeled = new Map<string, Bitmap[]>();
  let bootstrapCount = 0;
  for (let i = 0; i < rawEntries.length; i += 1) {
    const resolved = resolvedCodes[i];
    const split = splits[i];
    if (!resolved || !split || split.codeGlyphs.length !== resolved.code.length) continue;
    // 列跨度守卫：code 字形必须落在单个文本列内（跨度 ≲ L×digitW*1.6）。
    // 跨两列的垃圾装配（码字列+名字列拼接）长度碰巧 = L 时会以"对齐"假象
    // 进入自举，把错字形标成正确字符、毒化数字模板链。
    const cgSpan = split.codeGlyphs[split.codeGlyphs.length - 1].x1 - split.codeGlyphs[0].x0 + 1;
    if (cgSpan > resolved.code.length * digitW * 1.6) continue;
    let labeledAny = false;
    for (let j = 0; j < resolved.code.length; j += 1) {
      // 粘连块不进模板（防污染）——逐字形跳过而非整行放弃：右侧清单
      // 粘连常见，整行放弃会饿死模板链。
      if (widthOf(split.codeGlyphs[j]) > digitW * 1.9) continue;
      const list = labeled.get(resolved.code[j]) ?? [];
      list.push(split.codeGlyphs[j].bitmap);
      labeled.set(resolved.code[j], list);
      labeledAny = true;
    }
    if (labeledAny) bootstrapCount += 1;
  }
  const templates = buildTemplates(pruneInconsistentLabels(labeled));
  if (bootstrapCount === 0) return null;
  const codeDigitTemplates = new Map([...templates].filter(([char]) => char >= '0' && char <= '9'));
  // 计数字实际中位宽：全局 digitW 含代码字母会偏宽，粘连块 k 值估算
  // 必须用计数字自己的宽度（water-box 计数字 4-5px，digitW=6）。
  const countSingleWidths = splits.flatMap(s => s
    ? s.countGlyphs.filter(g => widthOf(g) <= digitW * 1.4).map(widthOf)
    : []);
  const countW = countSingleWidths.length ? median(countSingleWidths) : Math.max(3, Math.round(digitW * 0.75));
  const countGlyphHeights = splits.flatMap(s => s ? s.countGlyphs.filter(g => widthOf(g) <= digitW * 1.2).map(g => g.y1 - g.y0 + 1) : []);
  // 计数标注锚（2026-11-15 浏览器实测）：计数与色号是两套字体，借色号
  // 字形当锚会系统性误标（water-box 浏览器实测 7 簇只标出 0123478，缺
  // 5/6/9 → 953 读成 83、490 读成 8）。Canvas 合成 0-9 锚与实际渲染同
  // 字体引擎，浏览器端一律可用；Node/无 DOM 自动为 null 回落代码字形锚。
  // 多高度候选（2026-11-15 框选路径实测）：中位高度估计 ±1px 偏差就让
  // 合成锚 medDist 超阈回落污染的 code 模板。逐候选仲裁取自洽度最高者，
  // 胜者经 lastSyntheticAnchors 供 recognizeEntry 联合匹配复用。
  const medCountH = countGlyphHeights.length ? Math.round(median(countGlyphHeights)) : 0;
  const syntheticDigits = countGlyphHeights.length
    ? [medCountH - 1, medCountH, medCountH + 1]
        .map(h => renderSyntheticDigitTemplates(h))
        .filter((m): m is Map<string, Bitmap> => !!m)
    : [];
  const countTemplates = buildCountTemplates(rawEntries, splits, digitW, codeDigitTemplates, syntheticDigits, typeof document !== 'undefined');
  const synthWinner = lastSyntheticAnchors.current;
  const paletteCodes = new Set(prepared.map(entry => entry.color.code));
  const parsed = rawEntries.map((entry, index) =>
    recognizeEntry(entry, splits[index], priors[index], resolvedCodes[index], templates, countTemplates, paletteCodes, digitW, countW, synthWinner, prepared));
  return {
    rawEntries, priors, splits, resolvedCodes, digitW,
    templateChars: [...templates.keys()].sort(),
    countTemplateChars: [...countTemplates.keys()].sort(),
    countTemplateAscii: [...countTemplates].sort((a, b) => a[0].localeCompare(b[0])).map(([c, b]) => {
      const rows: string[] = [];
      for (let y = 0; y < b.h; y += 1) {
        let line = '';
        for (let x = 0; x < b.w; x += 1) line += b.data[y * b.w + x] ? '#' : '.';
        rows.push(line);
      }
      return `${c}(${b.w}x${b.h}):\n  ${rows.join('\n  ')}`;
    }).join('\n'),
    parsed,
    anchorTrace,
  };
}

/**
 * 入口：解析图纸底部的图例条。
 *
 * @param source 全图像素（图例在网格下方，需要完整图幅）
 * @param calibration 网格校准（用于圈定"网格底边以下"的带状区域）
 * @param palette 当前色板（色点先验 + code 色板约束）
 * @param options gridRows/gridCols 来自校准快照，做 Σcount 校验
 */

// ======================================================================
// 独立色卡路径（2026-11-22 用户三张色卡攻坚）
//
// 三种实测版式（均为机器生成的整齐清单，与图纸图例的关键差异：
// 没有豆网格、条目间距小（2~6px），常规 noLegendBand/贫瘠仲裁覆盖不了）：
//   A 横向药丸（card1）：[彩色色块(色号印在块上)][数量印在白底]；
//     白/浅色色块无对比 → 无色块锚，条目退化为 [色号文本][数量] 交替。
//   B 竖排清单（card3）：[色块(码印上)][色号文本][数量][粒]，行距 ~17px，
//     斜向水印叠加。
//   C 大色票（card2）：整块大色票（~85×20），"A1 (23)" 全印在票面上，
//     括号包数量；票面色票先验极强。
//
// 管线：裁剪 → 双线性 ×4 放大（人工"放大看"的等价物，字形从 5px 升到
// 20px+）→ 内容行带 → 间隙 token → 色块锚定/交替切条目 → code|count
// 预切分 → 复用 parseLegend 下游（先验→全局求解→自举→计数模板→逐条识别）。
// 只在常规路径无候选或结果贫瘠时参与（见 parseLegend 两处调用点），
// 不进常规图例仲裁。
// ======================================================================

/** 放大倍数：色卡文字普遍 5~8px，×4 后 20~32px 进模板匹配舒适区。 */
const CARD_UPSCALE = 4;
/** token 间隙阈值（放大后 px）：字内间隙 ≤8，码|数量/条目间隙 ≥12。 */
const CARD_TOKEN_GAP = 9;
/** 色块连通域最小宽（放大后 px，原生 ~6px）。 */
const CARD_SWATCH_MIN_W = 24;
/** 色块连通域最小高度（相对行带）。 */
const CARD_SWATCH_MIN_H_RATIO = 0.5;
/** 色块连通域最小填充率（实心块 vs 字形笔画）。 */
const CARD_SWATCH_MIN_FILL = 0.7;
/** 行带高度范围（放大后 px）。 */
const CARD_BAND_MIN_H = 16;
const CARD_BAND_MAX_H = 150;
/** 行带间至少空 2 行才算分行。 */
const CARD_BAND_GAP = 2;
/** 每行至少这么多内容像素才算内容行。 */
/** 内容行判定：≥ max(3, 宽度×0.015)。放大后空行噪声：卡缘碎屑/水印
 * 可达 32px（card2，宽 3044 时 0.008=24 被超）——占比太低把整图连成
 * 一条带；真内容行有数千像素，×0.015 仍有 10 倍以上余量。 */
const CARD_ROW_MIN_CONTENT_RATIO = 0.015;
/** family C 大色票判定（放大后 px，原生 ≥30px 的整块色票）。 */
const CARD_CHIP_MIN_W = 110;
/** 计数字形宽度上界（×digitW），超过视为粘连块走切片。 */
const CARD_COUNT_W_RATIO = 1.45;
/** 文本对比阈值（dist² = 100²）。实测色卡数字：间隙亮度 183-225（dist 30-70）、
 * 笔画核心 67-150（dist 103-190）——100 干净分离；CONTRAST(60) 会把间隙桥接成粘连块。 */
const CARD_TEXT_CONTRAST = 100;
/** 票面内提码对比阈值：CONTRAST(60) 下 JPEG 噪声把字腔填死（'6' 变实心团，
 * 孔洞拓扑/字形差异全部丢失），150 只留强墨像素、字腔张开。 */
const CARD_SWATCH_TEXT_CONTRAST = 150;
/** 淡印码重试对比阈值：E20 等浅行码笔画太淡（dist 85-145），100 只剩
 * 碎片；55 下完整成块（水印 dist 60-80 会进来，靠等分宽度校验挡）。 */
const CARD_GRAY_CONTRAST = 55;

/** 双线性放大（纯 JS，浏览器/Node 同口径；模板链在同源缓冲区内自举，尺度自洽）。 */
export function upscalePixelsBilinear(source: ImportImagePixels, k: number): ImportImagePixels {
  const { data, width, height } = source;
  const w = width * k, h = height * k;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const sy = (y + 0.5) / k - 0.5;
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(sy)));
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sy - y0));
    for (let x = 0; x < w; x += 1) {
      const sx = (x + 0.5) / k - 0.5;
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(sx)));
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const i00 = (y0 * width + x0) * 4, i01 = (y0 * width + x1) * 4;
      const i10 = (y1 * width + x0) * 4, i11 = (y1 * width + x1) * 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        out[o + c] = (data[i00 + c] * (1 - fx) + data[i01 + c] * fx) * (1 - fy)
          + (data[i10 + c] * (1 - fx) + data[i11 + c] * fx) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * 色卡双缓冲：bin = 原生分辨率对比掩码（≥CONTRAST）后 ×4 最近邻放大，
 * 字间空隙是纯白（双线性会把空隙糊成中灰内容，字形全粘连）；color =
 * 双线性放大原图，供色票/色块取色（平滑保真）。analyzeLine(bin, 白底)
 * 的掩码与原生二值掩码逐位一致。
 */
export function buildCardBuffers(
  cropped: ImportImagePixels,
  bg: [number, number, number],
  k: number,
  contrast: number = CONTRAST,
): { bin: ImportImagePixels; color: ImportImagePixels } {
  const { data, width, height } = cropped;
  const w = width * k, h = height * k;
  const contrast2 = contrast * contrast;
  const binData = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(height - 1, Math.floor(y / k));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(width - 1, Math.floor(x / k));
      const i = (sy * width + sx) * 4;
      const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
      const on = dr * dr + dg * dg + db * db > contrast2;
      const o = (y * w + x) * 4;
      binData[o] = binData[o + 1] = binData[o + 2] = on ? 0 : 255;
      binData[o + 3] = 255;
    }
  }
  return { bin: { data: binData, width: w, height: h }, color: upscalePixelsBilinear(cropped, k) };
}

export function cropPixels(source: ImportImagePixels, x0: number, y0: number, x1: number, y1: number): ImportImagePixels {
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const srcRow = ((y0 + y) * source.width + x0) * 4;
    out.set(source.data.subarray(srcRow, srcRow + w * 4), y * w * 4);
  }
  return { data: out, width: w, height: h };
}

interface CardToken {
  x0: number;
  x1: number;
  comps: GlyphComp[];
  swatchComp: GlyphComp | null;
}

interface CardItem {
  codeGlyphs: GlyphComp[];
  countGlyphs: GlyphComp[];
  dotRgb: [number, number, number] | null;
}

/** 色块判定：宽 ≥ 阈值、高 ≥ 0.5 行带、填充率 ≥ 0.7 的连通域。 */
export function cardSwatchComp(token: CardToken, bandH: number): GlyphComp | null {
  for (const comp of token.comps) {
    const w = widthOf(comp);
    const h = comp.y1 - comp.y0 + 1;
    if (w < CARD_SWATCH_MIN_W) continue;
    if (h < bandH * CARD_SWATCH_MIN_H_RATIO) continue;
    if (comp.area / (w * h) < CARD_SWATCH_MIN_FILL) continue;
    return comp;
  }
  return null;
}

/** 大票 fallback：family C 票面几乎占满 token 扫描区，analyzeLine 的
 * COMPONENT_MAX_WIDTH_RATIO 把整块票面当超宽连通域剔除 → swatchComp 永远
 * NULL。从 color 缓冲直接判：token 宽 ≥ CARD_CHIP_MIN_W、票色（距页底色
 * > 60 的众数色）覆盖率 ≥ 0.6 → 构造合成色块 bbox。 */
export function cardChipFallback(
  token: CardToken,
  color: ImportImagePixels,
  band: { y0: number; y1: number },
  pageBg: [number, number, number],
): GlyphComp | null {
  const w = token.x1 - token.x0 + 1;
  const h = band.y1 - band.y0 + 1;
  if (w < CARD_CHIP_MIN_W || h < 10) return null;
  const { data, width } = color;
  const counts = new Map<number, number>();
  for (let y = band.y0; y <= band.y1; y += 1) {
    for (let x = token.x0; x <= token.x1; x += 1) {
      const i = (y * width + x) * 4;
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let bestKey = -1, bestCount = 0;
  for (const [key, count] of counts) if (count > bestCount) { bestCount = count; bestKey = key; }
  // 票面印字可占 ~45%（"A1 (23)" 大字）→ 覆盖率门槛 0.5；但众数色必须
  // 不是页底色（dist>25）——否则 card3 白底数量 token 会被误判成色块。
  const rgb: [number, number, number] = [
    ((bestKey >> 8) & 15) * 16 + 8,
    ((bestKey >> 4) & 15) * 16 + 8,
    (bestKey & 15) * 16 + 8,
  ];
  const dd = (rgb[0] - pageBg[0]) ** 2 + (rgb[1] - pageBg[1]) ** 2 + (rgb[2] - pageBg[2]) ** 2;
  if (bestCount / (w * h) < 0.5 || dd <= 25 * 25) return null;
  return {
    x0: token.x0, x1: token.x1, y0: band.y0, y1: band.y1,
    area: bestCount, rgb, modeRgb: rgb,
    bitmap: { data: new Uint8Array(w * h).fill(1), w, h },
  };
}

/**
 * 色卡条目收集：行带 → token → 条目（codeGlyphs/countGlyphs/dotRgb）。
 * 返回 null 表示版式不符合色卡特征（条目太少/计数缺失太多）。
 */
/** 页底色：色卡票面覆盖大半图幅时全图众数会取到票色（card2 黑票赢 →
 * bin 全白、行带消失）。取上/下边 2px 边框各自的众数、再选亮度高者——
 * 页面边距总是页底色，且截图可能带入深色 UI 条（card2 底边 39,39,39）。 */
export function cardPageBg(cropped: ImportImagePixels): [number, number, number] {
  const { data, width, height } = cropped;
  const stripMode = (ys: number[]): [number, number, number] | null => {
    const counts = new Map<number, number>();
    const sums = new Map<number, [number, number, number, number]>();
    for (const y of ys) {
      if (y < 0 || y >= height) continue;
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        const s = sums.get(key);
        if (s) { s[0] += data[i]; s[1] += data[i + 1]; s[2] += data[i + 2]; s[3] += 1; }
        else sums.set(key, [data[i], data[i + 1], data[i + 2], 1]);
      }
    }
    let bestKey = -1, bestCount = -1;
    for (const [key, count] of counts) if (count > bestCount) { bestCount = count; bestKey = key; }
    const s = sums.get(bestKey);
    if (!s) return null;
    return [Math.round(s[0] / s[3]), Math.round(s[1] / s[3]), Math.round(s[2] / s[3])];
  };
  const top = stripMode([0, 1]);
  const bottom = stripMode([height - 2, height - 1]);
  const lum = (c: [number, number, number]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  if (top && bottom) return lum(top) >= lum(bottom) ? top : bottom;
  return top ?? bottom ?? [255, 255, 255];
}

export function collectCardItems(cropped: ImportImagePixels): { items: CardItem[]; digitW: number; pitch: number; vertical: boolean } | null {
  const bgNative = cardPageBg(cropped);
  const { bin, color } = buildCardBuffers(cropped, bgNative, CARD_UPSCALE);
  const { data, width, height } = bin;
  const bg: [number, number, number] = [255, 255, 255];
  const contrast2 = CONTRAST * CONTRAST;

  // ---- 内容行剖面 → 行带 ----
  const rowContent = new Uint32Array(height);
  for (let y = 0; y < height; y += 1) {
    let c = 0;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
      if (dr * dr + dg * dg + db * db > contrast2) c += 1;
    }
    rowContent[y] = c;
  }
  const rowThreshold = Math.max(3, Math.round(width * CARD_ROW_MIN_CONTENT_RATIO));
  const bands: Array<{ y0: number; y1: number }> = [];
  let bandStart = -1;
  let gap = 0;
  const flushBand = (y1: number) => {
    if (bandStart < 0) return;
    const bh = y1 - bandStart + 1;
    if (bh >= CARD_BAND_MIN_H && bh <= CARD_BAND_MAX_H) bands.push({ y0: bandStart, y1 });
    bandStart = -1;
  };
  for (let y = 0; y < height; y += 1) {
    if (rowContent[y] >= rowThreshold) {
      if (bandStart < 0) bandStart = y;
      gap = 0;
    } else if (bandStart >= 0) {
      gap += 1;
      if (gap >= CARD_BAND_GAP) flushBand(y - gap);
    }
  }
  flushBand(height - 1);
  if (!bands.length) { if (cardDebugSink) cardDebugSink(`cci: no bands (h=${height} thr=${rowThreshold})`); return null; }

  // 第一遍：行带 → token/锚
  const bandData: Array<{ band: { y0: number; y1: number }; tokens: CardToken[]; anchors: number[] }> = [];
  for (const band of bands) {
    const bandH = band.y1 - band.y0 + 1;
    // ---- 列内容 → token ----
    const colFill = new Float32Array(width);
    for (let x = 0; x < width; x += 1) {
      let c = 0;
      for (let y = band.y0; y <= band.y1; y += 1) {
        const i = (y * width + x) * 4;
        const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
        if (dr * dr + dg * dg + db * db > contrast2) c += 1;
      }
      colFill[x] = c / bandH;
    }
    const tokens: CardToken[] = [];
    let tStart = -1;
    let tGap = 0;
    for (let x = 0; x < width; x += 1) {
      if (colFill[x] > 0.02) {
        if (tStart < 0) tStart = x;
        tGap = 0;
      } else if (tStart >= 0) {
        tGap += 1;
        if (tGap >= CARD_TOKEN_GAP) {
          tokens.push({ x0: tStart, x1: x - tGap, comps: [], swatchComp: null });
          tStart = -1;
          tGap = 0;
        }
      }
    }
    if (tStart >= 0) tokens.push({ x0: tStart, x1: width - 1, comps: [], swatchComp: null });
    // mega-token 二次切分：family C 大票行的票间隙有水印内容（填充率 ~0.15，
    // > 0.02 判定下整行连成一个 token）。宽 > 4×CARD_CHIP_MIN_W 的 token 内部
    // 按「低填充列段（fill<0.4 连续 ≥4 列）」找票边界，子段 ≥80px 保留为票。
    // （阈值 4×：单票宽 ~3×CHIP_MIN_W，票面印字区低填充段不应触发误切。）
    // 按「低填充列段（fill<0.4 连续 ≥4 列）」找票边界，子段 ≥80px 保留为票。
    const mega: CardToken[] = [];
    for (const token of tokens) {
      if (token.x1 - token.x0 + 1 < CARD_CHIP_MIN_W * 4) { mega.push(token); continue; }
      let segStart = token.x0;
      let lowRun = 0;
      for (let x = token.x0; x <= token.x1 + 1; x += 1) {
        const low = x <= token.x1 && colFill[x] < 0.4;
        if (low) {
          lowRun += 1;
          if (lowRun >= 4 && segStart < x - lowRun + 1) {
            if (x - lowRun + 1 - segStart >= 80) mega.push({ x0: segStart, x1: x - lowRun, comps: [], swatchComp: null });
            segStart = -1;
          }
        } else {
          lowRun = 0;
          if (segStart < 0) segStart = x;
        }
      }
      if (segStart >= 0 && token.x1 - segStart + 1 >= 80) mega.push({ x0: segStart, x1: token.x1, comps: [], swatchComp: null });
    }
    tokens.length = 0;
    tokens.push(...mega);
    if (tokens.length < 2) continue;
    for (const token of tokens) {
      token.comps = analyzeLine(bin, bg, { y0: band.y0 - 1, y1: band.y1 + 1, minX: token.x0 - 1, maxX: token.x1 + 1 })
        .filter(c => c.x0 >= token.x0 - 1 && c.x1 <= token.x1 + 1);
      token.swatchComp = cardSwatchComp(token, bandH) ?? cardChipFallback(token, color, band, bgNative);
    }

    // ---- 第一遍先存 token/锚，节距网格第二遍装配 ----
    const anchors: number[] = [];
    for (const token of tokens) {
      if (token.swatchComp) anchors.push(token.swatchComp.x0);
    }
    bandData.push({ band, tokens, anchors });
  }

  // ---- 全局节距：色卡是机器生成的等距清单，色块锚 x0 差的最小稳定值。
  // 白/浅色票无锚导致锚距跳 slot（整数倍），取最小簇的中位数。 ----
  const allDiffs: number[] = [];
  for (const bd of bandData) {
    for (let i = 1; i < bd.anchors.length; i += 1) {
      const d = bd.anchors[i] - bd.anchors[i - 1];
      if (d >= CARD_SWATCH_MIN_W) allDiffs.push(d);
    }
  }
  allDiffs.sort((a, b) => a - b);
  let pitch = 0;
  if (allDiffs.length) {
    // 覆盖率裁决（与 importGridPitch v2.2 同源方法论）：初估 = 最小锚距簇
    // 中位（相邻有色块条目），再用「多数锚距能被 k×pitch 解释」校验。
    // 约数陷阱（亚周期 86）由覆盖率回退升档处理。
    const base = allDiffs[0];
    pitch = median(allDiffs.filter(d => d <= base * 1.3)) || base;
    const explainedOf = (p: number) => allDiffs.filter(d => {
      const k = Math.max(1, Math.round(d / p));
      return Math.abs(d - k * p) <= p * 0.12 + k * p * 0.04;
    }).length / allDiffs.length;
    if (explainedOf(pitch) < 0.7) {
      let bestCov = explainedOf(pitch);
      for (let mult = 2; mult <= 4; mult += 1) {
        const p2 = pitch * mult;
        const cov = explainedOf(p2);
        if (cov > bestCov) { bestCov = cov; pitch = p2; }
      }
    }
  }

  const items: CardItem[] = [];
  const countWidths: number[] = [];
  // ---- 竖排清单版式（card3 类）：每行带恰一个条目（2~5 token）、无水平
  // 节距。token 布局 [码文本][数量(粒)][色块]：码文本印在白页底上最干净，
  // 直接当码字形；色块只贡献先验色（dotRgb），不参与装配（避免单 token
  // 垃圾 slot 稀释 withCount 门槛）。 ----
  const vertical = bandData.length >= 8
    && bandData.every(bd => bd.tokens.length >= 2 && bd.tokens.length <= 5)
    && median(bandData.map(bd => bd.tokens.length)) <= 4;
  if (vertical) {
    // 水印跨 token 连接字形 → comps 越界被 token 过滤滤空（card3 丢 20 条）。
    // 高对比重 bin（CARD_TEXT_CONTRAST）：水印淡紫 dist≈60-80 被甩掉，印字
    // 深藏青 dist≈300 保留。
    const binHi = buildCardBuffers(cropped, bgNative, CARD_UPSCALE, CARD_TEXT_CONTRAST).bin;
    let binLoGray: ImportImagePixels | null = null;
    // 矮 band 延伸：淡色行（H2 等）行内容稀疏，行带检测在字形中途截断
    // （band 高 28 vs 中位 48，字形下半在带外 → comps=0 整行丢弃）。竖排
    // 版式行距 ≫ 行高，延伸到中位高不会碰到下一行。
    const bandHs = bandData.map(bd => bd.band.y1 - bd.band.y0 + 1);
    const medianH = median(bandHs);
    const byY = [...bandData].sort((a, b) => a.band.y0 - b.band.y0);
    for (let i = 0; i < byY.length; i += 1) {
      const bd = byY[i];
      const bh = bd.band.y1 - bd.band.y0 + 1;
      if (bh >= medianH * 0.7) continue;
      const nextY0 = i + 1 < byY.length ? byY[i + 1].band.y0 : bd.band.y0 + medianH * 2;
      bd.band = { ...bd.band, y1: Math.min(bd.band.y0 + medianH - 1, nextY0 - 2) };
    }
    for (const bd of bandData) {
      const { band, tokens } = bd;
      // 淡色块在 bin 里不可见（fill 低 → swatchComp 误判到文本 token）——
      // 竖排模式按「token 众数色距页底色」识别色块：色块底色 ≠ 页底色，
      // 文本 token 的底色就是页底色。
      // 2026-11-23 修正：H 系淡色票（白/米票+深印码）的票区 token 众数色
      // 距页底 ≤25 判不出票，而窄码 token 区域被水印（淡紫 dist 60-80>25）
      // 污染众数 → 码 token 被误判成票 → texts[0] 变票内碎片 comps=0 整行
      // 丢弃（card3 丢 9 行）。竖排版式票恒在最左：直接取最左 token 为票，
      // 码恒从 texts[0]（票外码文本）读。
      const sortedTokens = [...tokens].sort((a, b) => a.x0 - b.x0);
      const swatchToken = sortedTokens.length >= 2 ? sortedTokens[0] : null;
      let swatchColor: [number, number, number] | null = null;
      if (swatchToken) {
        const mode = dominantBaseColor(color.data, color.width, swatchToken.x0, band.y0, swatchToken.x1 + 1, band.y1 + 1);
        swatchColor = mode;
      }
      const texts = tokens.filter(t => t !== swatchToken).sort((a, b) => a.x0 - b.x0);
      if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[vdbg] y=${band.y0}-${band.y1} tokens=${tokens.map(t => `${t.x0}-${t.x1}${t === swatchToken ? 'S' : ''}`).join('|')}`);
      if (!texts.length) continue;
      for (const token of texts) {
        // maxWidthRatio 放宽到 0.95：2 字符码（D8/H9/M8/H3）两字形 JPEG 糊连成
        // 28px 单 comp，窄窗口（38px）×默认 0.6=22.8px 会被超宽剔除扔掉，
        // 活不到 cardSplitWideGlyph 的粘连切分。窗口已被 CARD_TEXT_CONTRAST
        // 甩掉水印，全宽 comp 就是粘连字形本体。
        token.comps = analyzeLineWithContrast(binHi, bg, { y0: band.y0 - 1, y1: band.y1 + 1, minX: token.x0 - 1, maxX: token.x1 + 1 }, CARD_TEXT_CONTRAST, 0.95)
          .filter(c => c.x0 >= token.x0 - 1 && c.x1 <= token.x1 + 1);
      }
      const bandWidthsV: number[] = [];
      for (const token of texts) {
        for (const c of token.comps) {
          const w = widthOf(c);
          if (w >= 6 && w <= 34) bandWidthsV.push(w);
        }
      }
      const digitWv = bandWidthsV.length ? median(bandWidthsV) : 20;
      let codeGlyphs = cardDropSlivers(texts[0].comps.flatMap(g => cardSplitWideGlyph(g, digitWv)), digitWv);
      // 淡印码重试：保留字形跨度 < 0.7×token 宽 = 笔画太淡被硬阈值打成
      // 碎片（E20 的 '0' 只剩 4px 环残片被 sliver 过滤吞掉）。降对比度
      // 55 重提：淡笔画完整成块，粘连块 k=round(w/digitW) 等分（同数量
      // 路径逻辑）。健康行跨度 ≈ token 全宽，永不进此分支。
      const tokenSpan = texts[0].x1 - texts[0].x0 + 1;
      if (codeGlyphs.length >= 1) {
        const span = codeGlyphs[codeGlyphs.length - 1].x1 - codeGlyphs[0].x0 + 1;
        if (span < tokenSpan * 0.7) {
          if (!binLoGray) binLoGray = buildCardBuffers(cropped, bgNative, CARD_UPSCALE, CARD_GRAY_CONTRAST).bin;
          const retryComps = analyzeLineWithContrast(binLoGray, bg, { y0: band.y0 - 1, y1: band.y1 + 1, minX: texts[0].x0 - 1, maxX: texts[0].x1 + 1 }, CARD_GRAY_CONTRAST, 0.95)
            .filter(c => c.x0 >= texts[0].x0 - 1 && c.x1 <= texts[0].x1 + 1);
          const retryGlyphs: GlyphComp[] = [];
          for (const c of retryComps) {
            for (const p of cardSplitWideGlyph(c, digitWv)) {
              const pw = widthOf(p);
              if (pw < digitWv * 1.55) { retryGlyphs.push(p); continue; }
              const k = Math.max(2, Math.min(6, Math.round(pw / Math.max(4, digitWv))));
              const pieces = sliceGlyphBitmap(p, k);
              if (pieces.length === k && pieces.every(pc => widthOf(pc) >= digitWv * 0.45 && widthOf(pc) <= digitWv * 1.5)) retryGlyphs.push(...pieces);
              else retryGlyphs.push(p);
            }
          }
          const sane = retryGlyphs.length >= 2
            && retryGlyphs.every(g => widthOf(g) >= digitWv * 0.45 && widthOf(g) <= digitWv * 1.6);
          if (sane) codeGlyphs = retryGlyphs;
          if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[vdbg-retry] y=${band.y0}-${band.y1} span=${span}/${tokenSpan} retry=${retryGlyphs.length} sane=${sane}`);
        }
      }
      if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[vdbg] y=${band.y0}-${band.y1} texts=${texts.length} comps0=${texts[0].comps.length} digitW=${digitWv} code=${codeGlyphs.length}`);
      if (!codeGlyphs.length) continue;
      // 数量：粗体数字互触成宽块。先谷底切（cardSplitWideGlyph），仍宽的块
      // 按 countW（单字宽中位）估 k 等分切——"2725"整块 → 4 数字。
      const rawCounts = texts.slice(1).flatMap(t => t.comps);
      const singleW = rawCounts
        .map(widthOf)
        .filter(w => w >= digitWv * 0.5 && w < digitWv * 1.4);
      const countWv = singleW.length ? median(singleW) : digitWv;
      const countGlyphs = rawCounts.flatMap(g => {
        const parts = cardSplitWideGlyph(g, digitWv);
        const out: GlyphComp[] = [];
        for (const p of parts) {
          const w = widthOf(p);
          if (w < digitWv * 1.4) { out.push(p); continue; }
          const k = Math.max(2, Math.min(6, Math.round(w / Math.max(4, countWv))));
          const pieces = sliceGlyphBitmap(p, k);
          if (pieces.length === k && pieces.every(pc => widthOf(pc) >= countWv * 0.5 && widthOf(pc) <= countWv * 1.5)) out.push(...pieces);
          // 切不出合理片：整块丢弃（无法解释的宽块不进数量）。
        }
        return out;
      });
      items.push({ codeGlyphs, countGlyphs, dotRgb: swatchColor });
      for (const g of countGlyphs) if (widthOf(g) <= 40) countWidths.push(widthOf(g));
    }
  } else {
  for (const bd of bandData) {
    const { band, tokens, anchors } = bd;
    if (!tokens.length) continue;
    // ---- 节距网格 slot：slot 左缘 = 锚位置；白票 slot 按节距外推。 ----
    const slots: Array<{ x: number; swatch: CardToken | null; ext: CardToken[] }> = [];
    if (anchors.length && pitch > 0) {
      const firstAnchor = anchors[0];
      const bandLeft = tokens[0].x0;
      const bandRight = tokens[tokens.length - 1].x1;
      const kMin = Math.ceil((bandLeft - pitch * 0.35 - firstAnchor) / pitch);
      const kMax = Math.floor((bandRight + pitch * 0.35 - firstAnchor) / pitch);
      for (let k = kMin; k <= kMax; k += 1) slots.push({ x: firstAnchor + k * pitch, swatch: null, ext: [] });
      for (const token of tokens) {
        const center = (token.x0 + token.x1) / 2;
        // 区间归属：数量 token 靠 slot 右侧（偏移可达 ~0.7×pitch），最近邻
        // 会把它错分给下一个 slot；floor(offset/pitch + 0.3) 让边界落在
        // 0.7×pitch 处。锚（色块）单独按左缘对齐。
        const offset = center - firstAnchor;
        const k = Math.floor(offset / pitch + 0.3);
        const slot = slots[k - kMin];
        if (!slot) continue;
        if (token.swatchComp && Math.abs(token.swatchComp.x0 - slot.x) <= pitch * 0.3) slot.swatch = token;
        else slot.ext.push(token);
      }
    } else {
      // 无锚/无节距退化：色块 token 自成 slot（旧行为）。
      for (const token of tokens) {
        if (token.swatchComp) slots.push({ x: token.swatchComp.x0, swatch: token, ext: [] });
        else if (slots.length) slots[slots.length - 1].ext.push(token);
        else slots.push({ x: token.x0, swatch: null, ext: [token] });
      }
    }

    // ---- family 判定：familyA（横向药丸）= 非空 slot 的 token 数中位 == 1
    // （码+数量同 token；familyB 竖排清单每条目 2~4 token）。行带 digitW：
    // 全部非色块 comps 宽度中位（数字占多数）。 ----
    const nonEmptySlots = slots.filter(s => s.swatch || s.ext.length);
    const tokenCounts = nonEmptySlots.map(s => (s.swatch ? 1 : 0) + s.ext.length);
    const familyA = tokenCounts.length > 0 && median(tokenCounts) === 1;
    const bandWidths: number[] = [];
    for (const token of tokens) {
      for (const c of token.comps) {
        const w = widthOf(c);
        if (token.swatchComp && c.x0 <= token.swatchComp.x1 && c.x1 >= token.swatchComp.x0) continue;
        if (w >= 6 && w <= 34) bandWidths.push(w);
      }
    }
    const bandDigitW = bandWidths.length ? median(bandWidths) : 20;

    for (const slot of slots) {
      const slotTokens = [...(slot.swatch ? [slot.swatch] : []), ...slot.ext];
      const item = cardAssembleItem(slotTokens, familyA, band, color, bg, pitch, bandDigitW);
      if (item) {
        // 码/数量字形规范化：mega 码块 k 等分（票面白印码三字互触）→ 粘连
        // 宽字形切分（"16"/"23"互触）→ 碎片剔除。
        item.codeGlyphs = cardDropSlivers(item.codeGlyphs
          .flatMap(g => cardSplitMegaCode(g, bandDigitW))
          .flatMap(g => cardSplitWideGlyph(g, bandDigitW)), bandDigitW);
        item.countGlyphs = item.countGlyphs.flatMap(g => cardSplitWideGlyph(g, bandDigitW));
        items.push(item);
        for (const g of item.countGlyphs) if (widthOf(g) <= 40) countWidths.push(widthOf(g));
      }
    }
  }
  }
  if (items.length < MIN_ENTRIES) { if (cardDebugSink) cardDebugSink(`cci: items=${items.length} < MIN (bands=${bands.length} bandData=${bandData.length})`); return null; }
  const withCount = items.filter(i => i.countGlyphs.length > 0).length;
  if (withCount < items.length * 0.5) { if (cardDebugSink) cardDebugSink(`cci: withCount=${withCount}/${items.length}`); return null; }
  const digitW = countWidths.length ? Math.max(6, median(countWidths)) : 0;
  if (!digitW) { if (cardDebugSink) cardDebugSink('cci: digitW=0'); return null; }
  return { items, digitW, pitch, vertical };
}

/** 碎片剔除：过窄且过小的连通域（w < 0.55×digitW 且面积 < 0.3×digitW²）。
 * 真字符（含窄 '1'）宽 ≥0.6×digitW；碎片是票缘/水印残渣。 */
export function cardDropSlivers(glyphs: GlyphComp[], digitW: number): GlyphComp[] {
  const kept = glyphs.filter(g => !(widthOf(g) < digitW * 0.55 && g.area < digitW * digitW * 0.3));
  return kept.length ? kept : glyphs;
}

/** mega 码块 k 等分（横排专用，card1 H22/D17/D19 实证）：票面白印码三字符
 * 互触成 61~66px 单 comp（>2.5×digitW 超出 cardSplitWideGlyph 的中段单切
 * 上限，原样带进求解层 = glyphN(1) < 码长(3)）。k = round(w/digitW) 等分，
 * 片宽守卫 [0.45, 1.6]×digitW 全过才收，否则回落 cardSplitWideGlyph。
 * （等分而非谷底吸附：谷底切点±1px 会扰动字形位图 → 模板自举连锁打翻
 * 无关行 G6/E16，实测 39→37；等分切点虽不理想但与切分前其他行零耦合。）
 * 仅横排槽位路径调用——竖排 card3 路径不经过此处（版式隔离红线）。 */
export function cardSplitMegaCode(glyph: GlyphComp, digitW: number): GlyphComp[] {
  const w = widthOf(glyph);
  if (w < digitW * 2.5) return [glyph];
  const k = Math.max(2, Math.min(6, Math.round(w / Math.max(4, digitW))));
  if (k < 3) return [glyph];
  const pieces = sliceGlyphBitmap(glyph, k);
  if (pieces.length === k && pieces.every(pc => {
    const pw = widthOf(pc);
    return pw >= digitW * 0.45 && pw <= digitW * 1.6;
  })) return pieces;
  return cardSplitWideGlyph(glyph, digitW);
}

/** 宽码字切分：w ≥1.55×digitW 的粘连字形（"16"/"44" 等数字互触）按位图列
 * 剖面切开——空列直接切；无空列且 ≤2.5×digitW 时在中间区找最小密度列切。
 * 切出碎片须 ≥0.45×digitW，否则放弃（保留原字形走切片链）。 */
export function cardSplitWideGlyph(glyph: GlyphComp, digitW: number): GlyphComp[] {
  const w = widthOf(glyph);
  if (w < digitW * 1.55) return [glyph];
  const bm = glyph.bitmap;
  const cols: number[] = [];
  for (let x = 0; x < bm.w; x += 1) {
    let c = 0;
    for (let y = 0; y < bm.h; y += 1) if (bm.data[y * bm.w + x]) c += 1;
    cols.push(c);
  }
  const piece = (x0: number, x1: number): GlyphComp | null => {
    const pw = x1 - x0 + 1;
    if (pw < digitW * 0.45) return null;
    const data = new Uint8Array(pw * bm.h);
    let area = 0;
    for (let y = 0; y < bm.h; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const v = bm.data[y * bm.w + x];
        data[y * pw + (x - x0)] = v;
        if (v) area += 1;
      }
    }
    if (!area) return null;
    return { x0: glyph.x0 + x0, x1: glyph.x0 + x1, y0: glyph.y0, y1: glyph.y1, area, rgb: glyph.rgb, modeRgb: glyph.modeRgb, bitmap: { data, w: pw, h: bm.h } };
  };
  // 空列多段切分
  const cuts: number[] = [];
  for (let x = 1; x < bm.w; x += 1) if (cols[x] === 0 && cols[x - 1] > 0) cuts.push(x);
  if (cuts.length) {
    const bounds = [0, ...cuts, bm.w];
    const pieces: GlyphComp[] = [];
    for (let i = 0; i < bounds.length - 1; i += 1) {
      const p = piece(bounds[i], bounds[i + 1] - 1);
      if (p) pieces.push(p);
    }
    if (pieces.length >= 2) return pieces;
  }
  // 无空列（互触）：中段最小密度列单切。
  // （宽门 h*0.55 + 孔洞验证证伪 2026-11-23 晚：H10 的 '1''0' 厚桥（密度
  // 0.5h）确实能切，但全局阈值伤及无辜——#34 G16→H19、#48 C28→M13 连锁
  // 打翻（被误切行本身含孔，孔洞验证拦不住），#58 自己也错成 H19。共享
  // 规范化路径上的全局阈值 = 连锁，与种子准入同一教训。）
  if (w <= digitW * 2.5) {
    let bestX = -1;
    let bestC = Number.POSITIVE_INFINITY;
    for (let x = Math.round(bm.w * 0.3); x <= Math.round(bm.w * 0.7); x += 1) {
      if (cols[x] < bestC) { bestC = cols[x]; bestX = x; }
    }
    if (bestX > 0 && bestC <= bm.h * 0.3) {
      const a = piece(0, bestX - 1);
      const b = piece(bestX, bm.w - 1);
      if (a && b) return [a, b];
    }
  }
  return [glyph];
}

/** 码|数量间隙切分：码与数量之间的大间隙（数量内部数字间距小得多）。
 * 取最左一个「间隙 ≥ max(5, 0.4×digitW) 且右侧全为数字宽」的切点。 */
function cardSplitCodeCount(
  glyphs: GlyphComp[],
  digitW: number,
): { code: GlyphComp[]; count: GlyphComp[] } | null {
  if (glyphs.length < 2) return null;
  const runDigit = (w: number) => w >= digitW * 0.3 && w <= digitW * 1.28;
  const gapThreshold = Math.max(5, digitW * 0.4);
  for (let i = 1; i < glyphs.length; i += 1) {
    const gap = glyphs[i].x0 - glyphs[i - 1].x1;
    if (gap < gapThreshold) continue;
    const right = glyphs.slice(i);
    if (!right.every(g => runDigit(widthOf(g)))) continue;
    return { code: glyphs.slice(0, i), count: right };
  }
  return null;
}

/** 调试出口：cardRefineCodes 的簇/投票/重组明细（脚本诊断用）。 */
let cardDebugSink: ((msg: string) => void) | null = null;
export function setCardDebugSink(fn: ((msg: string) => void) | null): void { cardDebugSink = fn; }

/** 位图孔洞数：背景(0)从边缘 flood-fill，未到达的 0 连通域（≥4px）= 孔洞。
 * 胖圆体 6/8/9/0/D/A 有孔、5/2/3/1/7/E/H 无孔——Jaccard 分不开的混淆对
 * （实测 6!5 min=0.110、H!0 min=0.056，同字符中位 0.129）先按拓扑分开。 */
function bitmapHoles(bitmap: Bitmap): number {
  const { data, w, h } = bitmap;
  const visited = new Uint8Array(w * h);
  const flood = (start: number): number => {
    const stack = [start];
    let size = 0;
    visited[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      size += 1;
      const x = p % w, y = Math.floor(p / w);
      if (x > 0 && !data[p - 1] && !visited[p - 1]) { visited[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && !data[p + 1] && !visited[p + 1]) { visited[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && !data[p - w] && !visited[p - w]) { visited[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && !data[p + w] && !visited[p + w]) { visited[p + w] = 1; stack.push(p + w); }
    }
    return size;
  };
  for (let x = 0; x < w; x += 1) {
    if (!data[x] && !visited[x]) flood(x);
    if (!data[(h - 1) * w + x] && !visited[(h - 1) * w + x]) flood((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    if (!data[y * w] && !visited[y * w]) flood(y * w);
    if (!data[y * w + w - 1] && !visited[y * w + w - 1]) flood(y * w + w - 1);
  }
  let holes = 0;
  for (let p = 0; p < w * h; p += 1) {
    if (!data[p] && !visited[p]) {
      const size = flood(p);
      if (size >= 4) holes += 1;
    }
  }
  return holes;
}

/** 色块颜色 → topK 宽候选（无 ΔE 硬窗）。印刷票色≠豆色是系统性偏色
 * （card1 实测 NN 命中仅 33%，真值常排 2~6 名），ΔE 硬窗会把真码滤在
 * 窗外——颜色只负责「提名」，裁决交给文本模板分。 */
function colorTopK(
  dotRgb: [number, number, number],
  prepared: Array<{ color: BeadColor; lab: [number, number, number] }>,
  k: number,
): Array<{ code: string; deltaE: number }> {
  const dotLab = rgbToLab(...dotRgb);
  return prepared
    .map(p => ({ code: p.color.code, deltaE: deltaE2000(dotLab, p.lab) }))
    .sort((a, b) => a.deltaE - b.deltaE)
    .slice(0, k);
}

/** 最近邻等比缩放位图到目标高度（保持纵横比）。 */
function resizeBitmapNearest(bmp: Bitmap, targetH: number): Bitmap {
  if (bmp.h === targetH || bmp.h <= 0) return bmp;
  const scale = targetH / bmp.h;
  const w = Math.max(1, Math.round(bmp.w * scale));
  const out = new Uint8Array(w * targetH);
  for (let y = 0; y < targetH; y += 1) {
    const sy = Math.min(bmp.h - 1, Math.floor((y + 0.5) / scale));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(bmp.w - 1, Math.floor((x + 0.5) / scale));
      out[y * w + x] = bmp.data[sy * bmp.w + sx];
    }
  }
  return { data: out, w, h: targetH };
}

/** 联合打分内核：每条目的候选池打分（颜色 rank + 文本模板 Jaccard）。
 * debugJointSolve / cardJointSolve 共用。 */
function jointCandidates(
  rawEntries: RawEntry[],
  splits: Array<SplitResult | null>,
  prepared: Array<{ color: BeadColor; lab: [number, number, number] }>,
  charTemplates: Map<string, Bitmap> | null,
): Array<Array<{ code: string; deltaE: number | null; joint: number; text: number; color: number }>> {
  const COLOR_TOP_K = 6;
  const COLOR_WEIGHT = 0.35;
  const TEXT_WEIGHT = 0.65;
  const textScoreOf = (glyphs: GlyphComp[], code: string): number | null => {
    if (!charTemplates || glyphs.length !== code.length) return null;
    let sum = 0;
    for (let j = 0; j < glyphs.length; j += 1) {
      const tpl = charTemplates.get(code[j]);
      if (!tpl) return null;
      sum += 1 - bitmapJaccard(glyphs[j].bitmap, resizeBitmapNearest(tpl, glyphs[j].bitmap.h));
    }
    return sum / glyphs.length;
  };
  const perEntry: Array<Array<{ code: string; deltaE: number | null; joint: number; text: number; color: number }>> = [];
  for (let i = 0; i < rawEntries.length; i += 1) {
    const split = splits[i];
    if (!split || !split.codeGlyphs.length) { perEntry.push([]); continue; }
    const L = split.codeGlyphs.length;
    const dotRgb = rawEntries[i].dotRgb;
    const ranked = dotRgb
      ? colorTopK(dotRgb, prepared, COLOR_TOP_K).filter(c => c.code.length === L)
      : prepared.filter(p => p.color.code.length === L).map(p => ({ code: p.color.code, deltaE: Number.POSITIVE_INFINITY }));
    const joints: Array<{ code: string; deltaE: number | null; joint: number; text: number; color: number }> = [];
    for (let rank = 0; rank < ranked.length; rank += 1) {
      const cand = ranked[rank];
      const text = textScoreOf(split.codeGlyphs, cand.code);
      if (text === null) continue;
      const colorScore = dotRgb ? 1 - rank / COLOR_TOP_K : 0;
      joints.push({
        code: cand.code,
        deltaE: dotRgb ? cand.deltaE : null,
        joint: TEXT_WEIGHT * text + COLOR_WEIGHT * colorScore,
        text,
        color: colorScore,
      });
    }
    joints.sort((a, b) => b.joint - a.joint);
    perEntry.push(joints);
  }
  return perEntry;
}

/** 诊断：联合打分候选明细（真值对照/阈值校准用）。 */
export function debugJointSolve(
  rawEntries: RawEntry[],
  splits: Array<SplitResult | null>,
  prepared: Array<{ color: BeadColor; lab: [number, number, number] }>,
  charTemplates: Map<string, Bitmap> | null,
) {
  return jointCandidates(rawEntries, splits, prepared, charTemplates);
}

/** 双线索联合打分器（色卡求解主路径，阶段1）。
 *
 * 旧链（resolveCodes+cardRefineCodes）的病灶：色点 ΔE 硬窗把印刷偏色的
 * 真码滤在窗外，簇传播的锚点先天残缺 → 33% 命中的先验毒化全局。
 * 新架构（对齐评审共识）：
 * - 分支A 颜色：top6 宽候选池，只提名不裁决（colorScore = 1-rank/K）；
 * - 分支B 文本：patch 对字符模板（合成字体渲染）逐位 Jaccard 距离打分；
 * - 联合分 joint = 0.65×text + 0.35×colorRank（无色块线索的条目纯文本分）；
 * - 裁决：top1 ≥ JOINT_MIN 且领先 top2 ≥ JOINT_MARGIN 才采信，否则 null
 *   （下游走「色号读不出→颜色建议 warn」的人工复核通道——错码 > 漏检）；
 * - 全局唯一性后处理：采信集撞码 → 撞码条目全部降 null（真值唯一，
 *   双方高置信撞码说明必有一错，都不猜）。
 * 旧簇传播保留为兜底（本函数全 null 时才启用），兜底结果强制 uncertain。 */
export function cardJointSolve(
  rawEntries: RawEntry[],
  splits: Array<SplitResult | null>,
  prepared: Array<{ color: BeadColor; lab: [number, number, number] }>,
  charTemplates: Map<string, Bitmap> | null,
): Array<ResolvedCode | null> {
  const n = rawEntries.length;
  const JOINT_MIN = 0.5;
  const JOINT_MARGIN = 0.08;
  const perEntry = jointCandidates(rawEntries, splits, prepared, charTemplates);
  // 采信 + 全局唯一性（高分先占坑；撞码双方都降 null——必有一错不猜）。
  const resolved: Array<ResolvedCode | null> = new Array(n).fill(null);
  const taken = new Map<string, number[]>();
  for (let i = 0; i < n; i += 1) {
    const joints = perEntry[i];
    if (!joints.length) continue;
    const top1 = joints[0];
    const top2 = joints[1];
    const clear = !top2 || top1.joint - top2.joint >= JOINT_MARGIN;
    if (top1.joint >= JOINT_MIN && clear) {
      resolved[i] = { code: top1.code, deltaE: top1.deltaE, unique: clear && top1.joint - (top2?.joint ?? 0) >= 0.2 };
      const list = taken.get(top1.code) ?? [];
      list.push(i);
      taken.set(top1.code, list);
    }
  }
  for (const list of taken.values()) {
    if (list.length > 1) for (const i of list) resolved[i] = null;
  }
  return resolved;
}

/** 卡片求解：字形簇 CSP + 标签传播。印刷票色≠豆色，ΔE 对色卡系统性失效，
 * 但 resolveCodes 色点窗锚点（anchors）提供初始票源——锚点写簇标签，
 * 簇字符约束 + 全局唯一性 CSP 消解，迭代到不动点后按簇标签重组剩余
 * 条目的码串（多数派 ≥60% 且 ≥2 票，重组码须在色板内）。 */
export function cardRefineCodes(
  rawEntries: RawEntry[],
  splits: Array<SplitResult | null>,
  anchors: Array<ResolvedCode | null>,
  prepared: Array<{ color: BeadColor; lab: [number, number, number] }>,
  digitW = 0,
  demoteSeeds?: Set<number>,
): Array<ResolvedCode | null> {
  const n = rawEntries.length;
  const paletteCodes = new Set(prepared.map(p => p.color.code));
  // 1. 全量 code 字形聚类：平均连接（预计算距离矩阵 + Lance-Williams 更新）。
  // union-find 的传递性会串相似链——胖圆体 9~6~4 两两 Jaccard≈0.15-0.17，
  // 链式合并把 2/3/4/5/6/8/9 吞成一簇（实测 39 成员 10 种字符投票）；
  // 平均连接要求簇间平均距离达标，链在中段断开。宽差 ≤4 只是省 CPU 的
  // 预筛（同字符 4× 上采样相位漂 1-3px，G w23 vs w26）。
  const glyphKeys: Array<{ i: number; j: number; key: string; glyph: GlyphComp }> = [];
  for (let i = 0; i < n; i += 1) {
    const split = splits[i];
    if (!split) continue;
    split.codeGlyphs.forEach((glyph, j) => glyphKeys.push({ i, j, key: `${i}:${j}`, glyph }));
  }
  const g = glyphKeys.length;
  const widths = glyphKeys.map(gk => widthOf(gk.glyph));
  const holes = glyphKeys.map(gk => bitmapHoles(gk.glyph.bitmap));
  const D: Float32Array[] = [];
  for (let a = 0; a < g; a += 1) {
    const row = new Float32Array(g);
    for (let b = 0; b < g; b += 1) {
      if (a === b) { row[b] = 0; continue; }
      if (Math.abs(widths[a] - widths[b]) > 4) { row[b] = 1; continue; }
      if (holes[a] !== holes[b]) { row[b] = 1; continue; }
      row[b] = bitmapJaccard(glyphKeys[a].glyph.bitmap, glyphKeys[b].glyph.bitmap);
    }
    D.push(row);
  }
  // 簇级距离矩阵（初始 = 字形级），Lance-Williams 加权平均合并。
  const members: number[][] = glyphKeys.map((_, k) => [k]);
  const clusterD: Float32Array[] = D.map(row => Float32Array.from(row));
  const active = glyphKeys.map(() => true);
  for (;;) {
    let bestA = -1, bestB = -1, bestVal = GROUP_MAX_JACCARD;
    for (let a = 0; a < g; a += 1) {
      if (!active[a]) continue;
      for (let b = a + 1; b < g; b += 1) {
        if (!active[b]) continue;
        if (clusterD[a][b] < bestVal) { bestVal = clusterD[a][b]; bestA = a; bestB = b; }
      }
    }
    if (bestA < 0) break;
    const na = members[bestA].length, nb = members[bestB].length;
    for (let x = 0; x < g; x += 1) {
      if (!active[x] || x === bestA || x === bestB) continue;
      clusterD[bestA][x] = (na * clusterD[bestA][x] + nb * clusterD[bestB][x]) / (na + nb);
      clusterD[x][bestA] = clusterD[bestA][x];
    }
    members[bestA] = [...members[bestA], ...members[bestB]];
    active[bestB] = false;
  }
  const rootOf = new Map<string, number>();
  for (let k = 0; k < g; k += 1) {
    if (!active[k]) continue;
    for (const m of members[k]) rootOf.set(glyphKeys[m].key, k);
  }
  if (cardDebugSink) {
    for (let k = 0; k < g; k += 1) {
      if (!active[k] || members[k].length < 2) continue;
      const desc = members[k].map(idx => `${glyphKeys[idx].key}(w${widths[idx]},h${holes[idx]})`);
      cardDebugSink(`cluster c${k} n=${members[k].length} [${desc.join(' ')}]`);
    }
  }
  // 2. CSP：候选=全部等长码（不依赖印刷色），簇字符约束传播 + 全局唯一性
  //  消解，迭代到不动点。约束矛盾（空集）的簇退化为不施加约束。
  //  锚种子准入（G2 名字偷窃链修复，两遍 refine 方案）：色证锚是候选种子
  //  而非天然可信种子——#56 的 E15 锚色证强（ΔE 3.8）但字形证据反对（翻案
  //  层实证 F22 胜出），作为 CSP 种子单候选后尾字 '5' 经簇 c33 交集把 #13
  //  滤成 G5、偷走 G5 名额。准入裁决不在此处做（宽度门已证伪：真 '1' 宽度
  //  0.16~0.79×digitW 无判别力），由输出层翻案轮报告毒锚（reportFlips）→
  //  parseCardLegend 第二遍 refine 时传 demoteSeeds。降级 = 不 pin 单候选、
  //  保留在等长码候选池（降级≠丢弃），仅失去强制锁簇特权。
  //  （宽度门证伪记录 2026-11-23 晚：'1' 宽度门 + 非'1'窄字门 → card1
  //  42→35、card2 14→0——F18/F16/F17/F1 的真 '1' 宽 w12-15 全被杀。）
  const paletteList = [...paletteCodes];
  const cand: string[][] = [];
  for (let i = 0; i < n; i += 1) {
    const split = splits[i];
    const len = split ? split.codeGlyphs.length : 0;
    // 锚点种子：色点窗解作初值（码长须与字形数一致，错长的锚弃用）。
    const anchor = anchors[i];
    if (len > 0 && anchor && anchor.code.length === len && paletteCodes.has(anchor.code)
      && !demoteSeeds?.has(i)) {
      cand.push([anchor.code]);
    } else {
      if (demoteSeeds?.has(i) && cardDebugSink) cardDebugSink(`seed-demote #${i} ${anchor?.code ?? '?'}`);
      cand.push(len > 0 ? paletteList.filter(c => c.length === len) : []);
    }
  }
  const taken = new Set<string>();
  for (;;) {
    let changed = false;
    const allowed = new Map<number, Set<string>>();
    for (let i = 0; i < n; i += 1) {
      const split = splits[i];
      if (!split || !cand[i].length) continue;
      split.codeGlyphs.forEach((_, j) => {
        const root = rootOf.get(`${i}:${j}`);
        if (root === undefined) return;
        const chars = new Set(cand[i].map(code => code[j]));
        const prev = allowed.get(root);
        if (!prev) { allowed.set(root, chars); return; }
        for (const ch of [...prev]) if (!chars.has(ch)) prev.delete(ch);
      });
    }
    for (let i = 0; i < n; i += 1) {
      if (!cand[i].length) continue;
      const filtered = cand[i].filter(code =>
        splits[i]!.codeGlyphs.every((_, j) => {
          const root = rootOf.get(`${i}:${j}`);
          const rule = root === undefined ? undefined : allowed.get(root);
          return rule === null || rule === undefined || rule.size === 0 || rule.has(code[j]);
        }));
      if (filtered.length !== cand[i].length) changed = true;
      cand[i] = filtered;
    }
    for (let i = 0; i < n; i += 1) {
      if (cand[i].length === 1 && !taken.has(cand[i][0])) {
        taken.add(cand[i][0]);
        changed = true;
      }
    }
    for (let i = 0; i < n; i += 1) {
      if (cand[i].length > 1) {
        const open = cand[i].filter(code => !taken.has(code));
        if (open.length !== cand[i].length) changed = true;
        cand[i] = open;
      }
    }
    if (!changed) break;
  }
  const resolved: Array<ResolvedCode | null> = cand.map(c =>
    c.length === 1 ? { code: c[0], deltaE: null, unique: true } : null);
  if (cardDebugSink) {
    const forced = resolved.filter(Boolean).length;
    cardDebugSink(`csp: forced ${forced}/${n}, ambiguous ${cand.filter(c => c.length > 1).length}, empty ${cand.filter(c => c.length === 0).length}`);
  }

  // 3. 两轮投票+重组：结构唯一解写簇标签 → 覆盖扩大 → 再消解。
  for (let round = 0; round < 2; round += 1) {
    const votes = new Map<number, Map<string, number>>();
    for (let i = 0; i < n; i += 1) {
      const split = splits[i];
      const resolvedCode = resolved[i];
      if (!split || !resolvedCode || split.codeGlyphs.length !== resolvedCode.code.length) continue;
      split.codeGlyphs.forEach((glyph, j) => {
        const root = rootOf.get(`${i}:${j}`);
        if (root === undefined) return;
        const m = votes.get(root) ?? new Map<string, number>();
        m.set(resolvedCode.code[j], (m.get(resolvedCode.code[j]) ?? 0) + 1);
        votes.set(root, m);
      });
    }
    const labelOf = new Map<number, string>();
    for (const [root, m] of votes) {
      let bestChar = '';
      let bestCount = 0;
      let total = 0;
      for (const [ch, c] of m) { total += c; if (c > bestCount) { bestCount = c; bestChar = ch; } }
      if (total >= 2 && bestCount / total >= 0.6) labelOf.set(root, bestChar);
    }
    if (cardDebugSink) {
      for (const [root, m] of votes) {
        const labeled = labelOf.get(root);
        const desc = (members[root] ?? []).map(k => `${glyphKeys[k].key}(w${widths[k]},h${glyphKeys[k].glyph.y1 - glyphKeys[k].glyph.y0 + 1},a${glyphKeys[k].glyph.area})`);
        cardDebugSink(`vote r${round} c${root} ${JSON.stringify([...m])} -> ${labeled ?? 'none'} [${desc.join(' ')}]`);
      }
    }
    let changed = false;
    for (let i = 0; i < n; i += 1) {
      const split = splits[i];
      if (!split || !split.codeGlyphs.length) continue;
      const chars: string[] = [];
      let full = true;
      for (let j = 0; j < split.codeGlyphs.length; j += 1) {
        const root = rootOf.get(`${i}:${j}`);
        const label = root === undefined ? undefined : labelOf.get(root);
        if (label === undefined) { full = false; break; }
        chars.push(label);
      }
      if (!full) continue;
      const code = chars.join('');
      if (!paletteCodes.has(code)) continue;
      const prev = resolved[i];
      if (prev?.code === code) continue;
      resolved[i] = { code, deltaE: prev?.deltaE ?? null, unique: false };
      changed = true;
      if (cardDebugSink) cardDebugSink(`rebuild r${round} #${i} ${prev?.code ?? '-'} -> ${code} glyphs=${split.codeGlyphs.map(widthOf).join(',')}`);
    }
    if (!changed) break;
  }
  return resolved;
}

/** 条目装配（token≈条目模型）：slot 内全部 token（首 token 可能含色块）。
 * family A（横向药丸，slot token 数中位 == 1）：数量用 CARD_TEXT_CONTRAST
 * 在彩色缓冲重扫（原生二值化下计数与色块连通/含碎屑）；
 * family B（竖排清单）：多 token = [色块][码][数量][粒]，按 token 分类归配；
 * family C（大色票）：整票含字，票面色当先验，票面内括号切分码|数量；
 * 白票（无色块）：码在前，码|数量按大间隙切分。 */
export function cardAssembleItem(
  slotTokens: CardToken[],
  familyA: boolean,
  band: { y0: number; y1: number },
  color: ImportImagePixels,
  bg: [number, number, number],
  pitch: number,
  digitW: number,
): CardItem | null {
  if (!slotTokens.length) return null;
  const swatchToken = slotTokens.find(t => t.swatchComp);
  const isDigitW = (w: number) => w >= digitW * 0.35 && w <= digitW * 1.4;
  if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) {
    const x0 = slotTokens[0].x0, x1 = slotTokens[slotTokens.length - 1].x1;
    if (x1 > 1700 && x1 < 2050 && band.y0 > 140) console.error(`[slot-dbg] x${x0}-${x1} y${band.y0}-${band.y1} famA=${familyA} tokens=${slotTokens.map(t => `x${t.x0}-${t.x1}${t.swatchComp ? 'S' : ''}(c${t.comps.length})`).join('|')}`);
  }
  // 票内提码背景自校正（C28 实证）：swatchColor/dotRgb 可能是票缘晕染的
  // 混合众数（#939ba7 vs 票面真实填充 #e2e9f6），用它当提取背景会把票面
  // 印码一起滤掉（只剩 11px 碎片）。内芯（缩边 15%）众数才是文字真正
  // 落在上面的底色——深票=票色本身（不变），浅票=真实填充色。
  const innerBgOf = (box: GlyphComp): [number, number, number] => {
    const bw = widthOf(box);
    const bh = box.y1 - box.y0 + 1;
    const ix = Math.max(2, Math.round(bw * 0.15));
    const iy = Math.max(2, Math.round(bh * 0.15));
    return dominantBaseColor(color.data, color.width, box.x0 + ix, box.y0 + iy, box.x1 - ix, box.y1 - iy);
  };

  // ---- 无色块（白/浅色票）----
  if (!swatchToken) {
    if (familyA) {
      // 横向药丸整条重扫：CARD_TEXT_CONTRAST 分离间隙与笔画。
      // 浅色票在本对比下呈「实心大块」（fill≥0.85 且明显高于文本行）：
      // 块色 = 先验，块内以票色为背景重提码（码印在票上时），
      // 块外剩余字形再按大间隙切码|数量。
      const x0 = slotTokens[0].x0;
      const x1 = slotTokens[slotTokens.length - 1].x1;
      const glyphs = analyzeLineWithContrast(color, bg, { y0: band.y0, y1: band.y1, minX: x0, maxX: x1 + 1 }, CARD_TEXT_CONTRAST);
      if (!glyphs.length) return null;
      const texts = glyphs.filter(g => widthOf(g) >= digitW * 0.55);
      if (!texts.length) return null;
      const medH = median(texts.map(g => g.y1 - g.y0 + 1));
      if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[fa-dbg] x${x0}-${x1} y${band.y0}-${band.y1} glyphs=[${glyphs.map(g => `x${g.x0}-${g.x1}w${widthOf(g)}h${g.y1 - g.y0 + 1}f${(g.area / (widthOf(g) * (g.y1 - g.y0 + 1))).toFixed(2)}`).join('|')}] medH=${medH}`);
      // 色票块：实心（fill≥0.7）且明显高于文本行（≥1.3×）或横跨 ≥2.2×digitW
      // 且块高 ≥0.75×行带（真票块 h≈0.9×行带；C28 实证：深色印字粘连块
      // 'C28' fill=0.72 卡过 fill 门 + w 门，被误当票块 → 用文字晕染色当
      // 票色在文字上提文字 → 全灭只剩 11px 碎片。文字块 h≈0.5×行带）。码字/
      // 计数粘连块 fill≈0.4-0.5 不会误中。
      const bandH = band.y1 - band.y0 + 1;
      const block = texts.find(g => {
        const w = widthOf(g);
        const h = g.y1 - g.y0 + 1;
        const fill = g.area / (w * h);
        return fill >= 0.7 && (h >= medH * 1.3 || (w >= digitW * 2.2 && h >= bandH * 0.75));
      });
      if (!block) {
        // 淡色票框：充填色 vs 白底 dist < CONTRAST → bin 只见边框环+印码
        //（fill 低，实心判据接不住）。按几何尺寸认框（宽 ≥2.2×digitW、
        // 高 ≥1.3×medH、扁形 h<0.85w——排除粘连数字块 h/w≈1），内部以框内
        // 充填色重提印码，充填色当先验色点。
        const frame = texts.find(g => {
          const w = widthOf(g);
          const h = g.y1 - g.y0 + 1;
          return w >= digitW * 2.2 && h >= medH * 1.3 && h < w * 0.85;
        });
        if (frame) {
          const inset = Math.max(4, Math.round(frame.y1 - frame.y0 + 1) >> 3);
          const fillColor = dominantBaseColor(
            color.data, color.width,
            frame.x0 + (inset * 3), frame.y0 + inset, frame.x1 - (inset * 3), frame.y1 - inset,
          );
          if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[frame-dbg] x${frame.x0}-${frame.x1} y${frame.y0}-${frame.y1} fill=${fillColor.join(',')}`);
          const inner = analyzeLineWithContrast(
            color, fillColor,
            { y0: frame.y0 + (inset >> 1), y1: frame.y1 - (inset >> 1), minX: frame.x0 + (inset >> 1), maxX: frame.x1 - (inset >> 1) },
            CARD_TEXT_CONTRAST, 0.95,
          ).filter(c => c.x0 >= frame.x0 && c.x1 <= frame.x1 && widthOf(c) < widthOf(frame) * 0.92);
          if (inner.length) {
            const remaining = texts.filter(g => g !== frame);
            const runDigit = (w: number) => w >= digitW * 0.3 && w <= digitW * 1.28;
            return { codeGlyphs: inner, countGlyphs: remaining.filter(g => runDigit(widthOf(g))), dotRgb: fillColor };
          }
        }
        const split = cardSplitCodeCount(texts, digitW);
        if (split) return { codeGlyphs: split.code, countGlyphs: split.count, dotRgb: null };
        return { codeGlyphs: texts.slice(0, 2), countGlyphs: [], dotRgb: null };
      }
      const swatchColor = dominantBaseColor(color.data, color.width, block.x0, block.y0, block.x1, block.y1);
      let inner = analyzeLine(color, swatchColor, { y0: block.y0, y1: block.y1, minX: block.x0, maxX: block.x1 }, 0.95)
        .filter(c => c.x0 >= block.x0 && c.x1 <= block.x1 && widthOf(c) < widthOf(block) * 0.92);
      // 淡印补收（G20 实证）：票内印墨深浅不一——'G' 淡于 '2''0'，主对比度
      // 只出 2 字形（codeSpan 36px < 3 字符跨度）。高对比度重试中 x 范围
      // 不与已收字形重叠的 comp = 漏收的淡印字符，按 x 升序并入。跨度守卫：
      // 票宽/digitW 推算期望字数，主提取数已达下限（期望-0.5）则不补——
      // 防止给完整票乱加字形。C28 教训：不整体替换（内芯众数色可能偏），
      // 只做增量补收。
      {
        const spanUnits = widthOf(block) / Math.max(1, digitW);
        if (inner.length >= 2 && inner.length < spanUnits - 0.5) {
          const retried = analyzeLineWithContrast(
            color, swatchColor,
            { y0: block.y0, y1: block.y1, minX: block.x0, maxX: block.x1 },
            CARD_TEXT_CONTRAST, 0.95,
          ).filter(c => c.x0 >= block.x0 && c.x1 <= block.x1 && widthOf(c) < widthOf(block) * 0.92);
          const extra = retried.filter(r =>
            widthOf(r) >= digitW * 0.35 && widthOf(r) <= digitW * 1.4
            && !inner.some(g => r.x0 < g.x1 && r.x1 > g.x0));
          if (extra.length && inner.length + extra.length <= Math.ceil(spanUnits)) {
            if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[adb-extra] block x${block.x0}-${block.x1} +[${extra.map(g => `x${g.x0}-${g.x1}w${widthOf(g)}`).join('|')}]`);
            inner = [...inner, ...extra].sort((a, b) => a.x0 - b.x0);
          }
        }
      }
      const remaining = texts.filter(g => g !== block);
      const split = cardSplitCodeCount(remaining, digitW);
      if (split) return { codeGlyphs: [...inner, ...split.code], countGlyphs: split.count, dotRgb: swatchColor };
      const runDigit = (w: number) => w >= digitW * 0.3 && w <= digitW * 1.28;
      return { codeGlyphs: inner, countGlyphs: remaining.filter(g => runDigit(widthOf(g))), dotRgb: swatchColor };
    }
    if (slotTokens.length >= 2) {
      // family B 竖排：token 边界即码|数量分界；尾部「粒」宽块丢弃。
      const codeGlyphs = slotTokens[0].comps;
      const countGlyphs = slotTokens.slice(1).flatMap(t => t.comps)
        .filter(c => widthOf(c) < digitW * 1.4);
      if (!codeGlyphs.length) return null;
      return { codeGlyphs, countGlyphs, dotRgb: null };
    }
    // 退化：单 token —— 同一间隙切分（bin comps）。
    const glyphs = slotTokens[0].comps;
    if (!glyphs.length) return null;
    const split = cardSplitCodeCount(glyphs, digitW);
    if (split) return { codeGlyphs: split.code, countGlyphs: split.count, dotRgb: null };
    return { codeGlyphs: glyphs.slice(0, 2), countGlyphs: [], dotRgb: null };
  }

  const box = swatchToken.swatchComp!;
  const boxW = widthOf(box);
  const swatchColor = dominantBaseColor(color.data, color.width, box.x0 + 1, box.y0 + 1, box.x1, box.y1 - 1);

  // ---- family C：大色票 —— 码+数量都印在票面，票面内做括号切分 ----
  if (boxW >= CARD_CHIP_MIN_W && (pitch <= 0 || boxW >= pitch * 0.5)) {
    let inner = analyzeLine(color, swatchColor, { y0: box.y0 + 2, y1: box.y1 - 2, minX: box.x0 + 2, maxX: box.x1 - 1 }, 0.95)
      .filter(c => c.x0 >= box.x0 && c.x1 <= box.x1);
    if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[fc-dbg] box x${box.x0}-${box.x1} y${box.y0}-${box.y1} sw=${swatchColor.join(',')} g=[${inner.map(g => `x${g.x0}-${g.x1}w${widthOf(g)}h${g.y1 - g.y0 + 1}f${(g.area / (widthOf(g) * (g.y1 - g.y0 + 1))).toFixed(2)}`).join('|')}]`);
    // 近空重试（同 familyB：C28 实证 dotRgb 取到晕染混合色致提取近全灭）。
    // 合成票框（cardChipFallback）可能罩住票+数量+白页——内芯众数色在此
    // 仍可能偏，但高对比度（CARD_TEXT_CONTRAST）下深色印字至少能冒头。
    if (inner.length < 2) {
      const retried = analyzeLineWithContrast(
        color, innerBgOf(box),
        { y0: box.y0 + 2, y1: box.y1 - 2, minX: box.x0 + 2, maxX: box.x1 - 1 },
        CARD_TEXT_CONTRAST, 0.95,
      ).filter(c => c.x0 >= box.x0 && c.x1 <= box.x1);
      if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[fc-dbg] retry got=${retried.length} [${retried.map(g => `x${g.x0}-${g.x1}w${widthOf(g)}`).join('|')}]`);
      if (retried.length > inner.length) inner = retried;
    }
    if (inner.length < 2) return null;
    const widths = inner.map(widthOf).sort((a, b) => a - b);
    const mw = median(widths);
    // 括号签名（2026-11-24 card2「色号（数量）」格式攻坚）：票面印字「A17 (11)」
    // 中括号比数字窄且**高**（超出数字带上下）。旧判据 fill<0.5 被模糊图
    // 团灭（card2 括号 fill 0.70-0.86），且 mw 被括号自身拉低（0.62×mw 门
    // 差 0.15px 漏检）。新签名两支——①宽≤digitW 且高≥数字带中位高×1.04
    // （数字带=宽>0.62×digitW 的字形，排除括号拉低基准）；②极窄
    // ≤0.62×digitW（B26 实证：括号 w9 与数字同高 h26，只能靠宽度）。
    // card2 24 槽逐票验算全命中、全部数字（含窄'1'）安全。
    const heightOf = (c: GlyphComp) => c.y1 - c.y0 + 1;
    const digitLikeH = inner.filter(c => widthOf(c) > digitW * 0.62).map(heightOf);
    const digitMedH = median(digitLikeH.length ? digitLikeH : inner.map(heightOf));
    const isParenShape = (c: GlyphComp) => {
      const w = widthOf(c);
      return (w <= digitW && heightOf(c) >= digitMedH * 1.04) || w <= digitW * 0.62;
    };
    const parenIdx = inner.findIndex(isParenShape);
    let codeGlyphs: GlyphComp[];
    let countGlyphs: GlyphComp[];
    if (parenIdx >= 1) {
      codeGlyphs = inner.slice(0, parenIdx);
      let end = inner.length;
      while (end > parenIdx + 1 && isParenShape(inner[end - 1])) end -= 1;
      countGlyphs = inner.slice(parenIdx + 1, end);
    } else {
      // 无括号（模糊图联不出）：码取前 2 字形，其余归数量（窄碎片剔除）。
      codeGlyphs = inner.slice(0, 2);
      countGlyphs = inner.slice(2).filter(c => widthOf(c) > mw * 0.62);
    }
    if (!codeGlyphs.length) return null;
    // 数量缺失（水印遮挡）也要保住码与先验。
    return { codeGlyphs, countGlyphs, dotRgb: swatchColor };
  }

  // ---- 色块 family A：码印在块上（票面内 vs 票色）；数量 = 块右侧
  // CARD_TEXT_CONTRAST 彩色缓冲重扫（bin comps 与色块连通/含碎屑）。 ----
  if (familyA) {
    const codeGlyphs = analyzeLine(color, swatchColor, { y0: box.y0 + 2, y1: box.y1 - 2, minX: box.x0 + 2, maxX: box.x1 - 1 }, 0.95)
      .filter(c => c.x0 >= box.x0 && c.x1 <= box.x1 && widthOf(c) < boxW * 0.92);
    if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) {
      const raw = analyzeLine(color, swatchColor, { y0: box.y0 + 2, y1: box.y1 - 2, minX: box.x0 + 2, maxX: box.x1 - 1 });
      console.error(`[adb] box x${box.x0}-${box.x1} y${box.y0}-${box.y1} sw=${swatchColor.join(',')} raw=${raw.map(c => `x${c.x0}-${c.x1}w${widthOf(c)}a${c.area}`).join('|')} kept=${codeGlyphs.length}`);
    }
    const countGlyphs = analyzeLineWithContrast(
      color,
      bg,
      { y0: band.y0, y1: band.y1, minX: box.x1 + 2, maxX: slotTokens[slotTokens.length - 1].x1 + 1 },
      CARD_TEXT_CONTRAST,
    ).filter(c => c.x0 > box.x1 && widthOf(c) < digitW * CARD_COUNT_W_RATIO);
    if (!codeGlyphs.length && !countGlyphs.length) return null;
    return { codeGlyphs, countGlyphs, dotRgb: swatchColor };
  }

  // ---- 色块 family B：码印在块上；数量/外部码 = 块右侧 token 分类归配。 ----
  let codeGlyphs = analyzeLine(color, swatchColor, { y0: box.y0 + 2, y1: box.y1 - 2, minX: box.x0 + 2, maxX: box.x1 - 1 }, 0.95)
    .filter(c => c.x0 >= box.x0 && c.x1 <= box.x1 && widthOf(c) < boxW * 0.92);
  // 票内提码背景自校正重试（C28 实证）：dotRgb 是晕染混合众数（#939ba7 vs
  // 真实填充 #e2e9f6）时提取近乎全灭（1 个 11px 碎片）。仅近空结果才用
  // 内芯众数色 + 高对比度重试——健康行（≥2 字形）不动，避免涟漪。
  {
    const maxW = codeGlyphs.reduce((m, g) => Math.max(m, widthOf(g)), 0);
    if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[fb-dbg] box x${box.x0}-${box.x1} y${box.y0}-${box.y1} sw=${swatchColor.join(',')} innerBg=${innerBgOf(box).join(',')} g=${codeGlyphs.map(g => `x${g.x0}-${g.x1}w${widthOf(g)}`).join('|')}`);
    if (codeGlyphs.length < 2 || maxW < digitW * 0.9) {
      const retried = analyzeLineWithContrast(
        color, innerBgOf(box),
        { y0: box.y0 + 2, y1: box.y1 - 2, minX: box.x0 + 2, maxX: box.x1 - 1 },
        CARD_TEXT_CONTRAST, 0.95,
      ).filter(c => c.x0 >= box.x0 && c.x1 <= box.x1 && widthOf(c) < boxW * 0.92);
      if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[fb-dbg] retry got=${retried.length} [${retried.map(g => `x${g.x0}-${g.x1}w${widthOf(g)}`).join('|')}]`);
      if (retried.length > codeGlyphs.length) codeGlyphs = retried;
    }
  }
  const countGlyphs: GlyphComp[] = [];
  const extCodeGlyphs: GlyphComp[] = [];
  for (const token of slotTokens) {
    const outs = token.comps.filter(c => c.x0 > box.x1 - 2);
    if (!outs.length) continue;
    const digitComps = outs.filter(c => isDigitW(widthOf(c)));
    if (digitComps.length === outs.length) countGlyphs.push(...outs);
    else {
      // 码文本 token（family B 外部码）；"粒"宽块（单字形 ≥1.4×digitW）丢弃。
      const kept = outs.filter(c => widthOf(c) < digitW * 1.4);
      if (kept.length) extCodeGlyphs.push(...kept);
    }
  }
  // 外部码文本（family B）比票面印码干净——优先用外部码。
  const finalCode = extCodeGlyphs.length >= 2 ? extCodeGlyphs : codeGlyphs;
  if (!finalCode.length && !countGlyphs.length) return null;
  return { codeGlyphs: finalCode, countGlyphs, dotRgb: swatchColor };
}

/** 色卡条目质量门槛不满足时返回 null（常规路径结果继续使用）。 */
export function collectCardEntries(
  source: ImportImagePixels,
  region?: LegendFrameRect,
): { rawEntries: RawEntry[]; splits: Array<SplitResult | null>; digitW: number; vertical: boolean } | null {
  const x0 = region ? clampInt(region.x0, 0, source.width - 1) : 0;
  const y0 = region ? clampInt(region.y0, 0, source.height - 1) : 0;
  const x1 = region ? clampInt(region.x1, 0, source.width - 1) : source.width - 1;
  const y1 = region ? clampInt(region.y1, 0, source.height - 1) : source.height - 1;
  if (x1 - x0 < 40 || y1 - y0 < 10) return null;
  const cropped = cropPixels(source, x0, y0, x1, y1);
  const collected = collectCardItems(cropped);
  if (!collected) return null;
  const rawEntries: RawEntry[] = [];
  const splits: Array<SplitResult | null> = [];
  for (const item of collected.items) {
    rawEntries.push({ dotRgb: item.dotRgb, glyphs: [...item.codeGlyphs, ...item.countGlyphs] });
    splits.push({ codeGlyphs: item.codeGlyphs, countGlyphs: item.countGlyphs, splitSuspicious: false });
  }
  return { rawEntries, splits, digitW: collected.digitW, vertical: collected.vertical };
}

/** 色卡条目质量分：色板内码 +1、可读数量再 +1（compare 用）。 */
const cardResultScore = (entries: LegendEntry[]): number => entries.reduce(
  (sum, e) => sum + (e.code ? 1 : 0) + (e.count > 0 && !(e.warn ?? '').includes('countUnread') ? 1 : 0),
  0,
);

/** 翻案 margin（竖排严格值）：第一名字形分须领先第二名 ≥ 此值。 */
const CARD_OVERTURN_MARGIN = 0.03;
/** 翻案 margin（横排宽松值）：F22 翻案实测领先仅 0.006——绝对门+当前码
 * 保护线（cur>0.25 才翻）兜底假翻。仅横排色卡路径使用。 */
const CARD_OVERTURN_MARGIN_LOOSE = 0.005;
/** 翻案绝对门：字形分高于此值不翻（碎片行全体高分，天然挡住）。 */
const CARD_OVERTURN_MAX = 0.35;
/** 当前码保护线：当前码自身字形分低于此值 = 字形证据兼容当前码，不翻。 */
const CARD_OVERTURN_CUR_MAX = 0.25;
/** 无票色条目的当前码保护线：dotRgb=null 的当前码无色证支撑（refine 猜测），
 * 门放低（G2 槽被偷成 G5 实证，'2' vs '5' 模板距离 ~0.2 卡死旧门）。 */
const CARD_OVERTURN_CUR_MAX_NODOT = 0.12;
/** prior 长度冲突守卫 slack：resolved 码的票色距离比可靠 prior 差超过此值
 * 时信 prior（C18 假码实证：C18 ΔE 11.0 vs H6 4.2）。 */
const CARD_PRIOR_CONFLICT_SLACK = 5;
/** 无码死区翻案 margin（竖排严格值）。 */
const CARD_NOLOAD_MARGIN = 0.06;
/** 无码死区翻案 margin（横排宽松值）：0.010 = E15@#32 实测领先 M15 的
 * 幅度（顶带缺口罚压掉 H15 后的第二名）；全死区行复验：#41 D13 margin
 * 0.003、#45 A12 0.006 自然挡住，#24 M13 错槽但 M13 已命中（集合中性）。 */
const CARD_NOLOAD_MARGIN_LOOSE = 0.010;
/** 孔洞拓扑罚项：D/A/0/6/8/9 有孔、H/B/E/F/G/M/1/2/3/5/7 无孔——Jaccard
 * 分不开的混淆对（D19 vs H19 实测差 0.002）由孔洞数硬分开。 */
const CARD_HOLE_PENALTY = 0.08;

/** 顶带缺口罚（E/H 判别，#32 E15 实证）：H 的顶部是两根分离竖笔（顶带
 * 中段 20%-80% 宽的列覆盖 0.40-0.56），E/F/G/D/M 的顶臂/顶曲线是实心横杠
 * （1.00）——分布实测 card1 25 字形零重叠。糊化免疫（糊只加墨：缺口只会
 * 变小不会消失，实心不会变缺口）。方向：ch='H' 而字形顶带实心 → 罚；
 * ch=E/F/G/D 而顶带有缺口 → 罚。真 H 行（#60/#33/#37/#44/#46 全 0.40-0.56）
 * 天然免罚。
 * （右缘连续性版证伪记录：2 列窄窗/右 1/4 区密度都分不开糊 E(0.67) 与 H，
 * 且真 G 右缘高达 0.8-1.0 与教科书拓扑相反——顶带中段才是本字体的 E/H
 * 分离轴。） */
const CARD_TOPGAP_PENALTY = 0.18;
/** 顶带缺口判定阈值：H 的缺口区 <0.56，实心区 =1.00，取中。 */
const CARD_TOPGAP_TH = 0.75;
/** 顶带（上 25% 行）中段（20%-80% 宽）列覆盖度：有 ink 的列占比。 */
const topMidCoverage = (bm: Bitmap): number => {
  const y1 = Math.max(1, Math.floor(bm.h * 0.25));
  const x0 = Math.floor(bm.w * 0.2);
  const x1 = Math.max(x0 + 1, Math.floor(bm.w * 0.8));
  let hit = 0;
  for (let x = x0; x < x1; x += 1) {
    let ink = false;
    for (let y = 0; y < y1; y += 1) if (bm.data[y * bm.w + x]) { ink = true; break; }
    if (ink) hit += 1;
  }
  return hit / (x1 - x0);
};

/**
 * 字形翻案轮·输出层（card1 实证）：refined 解码靠色点 ΔE + 簇约束，字形
 * 证据只有聚类合并/字符交集，没有逐码打分——同码长近邻色（E15 vs F22）
 * 经常排输。用 unique 强解行的字形做自体模板池（leave-one-out 防自举毒锁）
 * + 合成数字兜底池中缺席字符，对输出层翻案。
 * **必须在 recognizeLegendEntries 之后直接改 entries.code**：改 refined 会
 * 通过模板自举连锁放大（#56 翻正 → 'E15' 毒标移除 → 依赖它的 4 行塌掉，
 * 实测 37→34）——输出层翻案零连锁。
 * 裁决三守卫（browser-overturn-test.mjs 三卡实证 card1 +1 零误伤）：
 * margin ≥ CARD_OVERTURN_MARGIN + 绝对门 + 当前码保护线。
 */
function cardOverturnEntries(
  rawEntries: RawEntry[],
  splits: Array<SplitResult | null>,
  anchors: Array<ResolvedCode | null>,
  entries: LegendEntry[],
  prepared: Array<{ color: BeadColor; lab: [number, number, number] }>,
  layout?: { vertical?: boolean; reportFlips?: Set<number> },
): void {
  const n = Math.min(rawEntries.length, entries.length);
  const pool = new Map<string, Array<{ bitmap: Bitmap; from: number }>>();
  const taken = new Set<string>();
  for (let i = 0; i < n; i += 1) {
    const anchor = anchors[i];
    const split = splits[i];
    if (!split || !anchor?.unique || anchor.code.length !== split.codeGlyphs.length) continue;
    taken.add(anchor.code);
    [...anchor.code].forEach((ch, j) => {
      if (!pool.has(ch)) pool.set(ch, []);
      pool.get(ch)!.push({ bitmap: split.codeGlyphs[j].bitmap, from: i });
    });
  }
  // 合成数字兜底（无 DOM 时为空，纯自体池降级运行）。
  const heights: number[] = [];
  for (const split of splits) {
    if (!split) continue;
    for (const glyph of split.codeGlyphs) heights.push(glyph.y1 - glyph.y0 + 1);
  }
  heights.sort((a, b) => a - b);
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const synthMaps = medH ? [medH - 1, medH, medH + 1]
    .map(h => renderSyntheticDigitTemplates(h))
    .filter((m): m is Map<string, Bitmap> => m !== null) : [];
  const glyphDist = (glyph: GlyphComp, ch: string, excludeI: number): number | null => {
    const own = (pool.get(ch) ?? []).filter(p => p.from !== excludeI);
    if (own.length) {
      const cov = topMidCoverage(glyph.bitmap);
      const topPen = (ch === 'H' && cov > CARD_TOPGAP_TH)
        || (ch !== 'H' && 'EFGD'.includes(ch) && cov < CARD_TOPGAP_TH)
        ? CARD_TOPGAP_PENALTY : 0;
      return Math.min(...own.map(p =>
        bitmapJaccard(glyph.bitmap, p.bitmap)
        + (bitmapHoles(glyph.bitmap) === bitmapHoles(p.bitmap) ? 0 : CARD_HOLE_PENALTY)))
        + topPen;
    }
    const syns = synthMaps.map(t => t.get(ch)).filter((t): t is Bitmap => t !== undefined);
    if (syns.length) {
      let best = Number.POSITIVE_INFINITY;
      for (const t of syns) {
        const m = matchGlyph(glyph.bitmap, new Map([[ch, t]]), true);
        if (m) best = Math.min(best, m.distance);
      }
      return best;
    }
    return null;
  };
  const codeScore = (split: SplitResult, code: string, excludeI: number): number | null => {
    let sum = 0;
    for (let j = 0; j < code.length; j += 1) {
      const d = glyphDist(split.codeGlyphs[j], code[j], excludeI);
      if (d === null) return null;
      sum += d;
    }
    return sum / code.length;
  };
  // margin 版式隔离（card3 红线守卫）：margin 收窄到 0.005 后 card3 竖排
  // H22 行被假翻成 E10（47/48 实证）。竖排清单用严格 margin（旧值），
  // 横排色卡用窄 margin——横排的 F22 翻案领先幅度实测仅 0.006。
  // 色点 ΔE 否决证伪：印刷票色≠豆色，色证在横排系统性偏（E15 vs F22 的
  // dotRgb 距离 E15 更近），会误杀正确翻案。
  const margin = layout?.vertical ? CARD_OVERTURN_MARGIN : CARD_OVERTURN_MARGIN_LOOSE;
  const noLoadMargin = layout?.vertical ? CARD_NOLOAD_MARGIN : CARD_NOLOAD_MARGIN_LOOSE;
  for (let i = 0; i < n; i += 1) {
    const split = splits[i];
    if (!split || split.codeGlyphs.length < 2) continue;
    // unique 锚行跳过（证伪记录 2026-11-23 晚：放开后 card3 D8 假翻 M1
    // 破防 47/48 + card1 三个假翻 E16→H16/M3→H1/H4→E3——色证 unique 锚
    // 的字形分普遍偏高（锚即簇投票主力，池被自家字形主导），门放不开）。
    if (anchors[i]?.unique) continue;
    const entry = entries[i];
    if (!entry || entry.code.length !== split.codeGlyphs.length || entry.code.length < 2) continue;
    const curScore = codeScore(split, entry.code, i);
    // 当前码打不了分（池缺字符）= 证据不完整，保守跳过。
    if (curScore === null) continue;
    // 当前码保护线分级（G2 名字偷窃实证）：无票色条目的当前码只是 refine
    // 的猜测（候选集退化为色板序，无色证支撑），保护门放低让它有机会被
    // 字形证据翻掉；有票色条目维持严门（色证独立于字形证据）。
    const curMax = rawEntries[i].dotRgb ? CARD_OVERTURN_CUR_MAX : CARD_OVERTURN_CUR_MAX_NODOT;
    if (curScore < curMax) continue;
    const scored: Array<{ code: string; gs: number }> = [];
    for (const p of prepared) {
      if (p.color.code.length !== split.codeGlyphs.length || taken.has(p.color.code)) continue;
      const gs = codeScore(split, p.color.code, i);
      if (gs !== null) scored.push({ code: p.color.code, gs });
    }
    if (scored.length < 2) continue;
    scored.sort((a, b) => a.gs - b.gs);
    if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[otrn-dbg] #${i} cur=${entry.code}(${curScore.toFixed(3)}) top=[${scored.slice(0, 3).map(s => `${s.code}:${s.gs.toFixed(3)}`).join(' ')}]`);
    if (scored[0].gs > CARD_OVERTURN_MAX) continue;
    if (scored[1].gs - scored[0].gs < margin) continue;
    if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[otrn] #${i} ${entry.code}→${scored[0].code} gs=${scored[0].gs.toFixed(3)} vs ${scored[1].gs.toFixed(3)} cur=${curScore.toFixed(3)}`);
    // 毒锚报告（种子准入前移）：翻案层翻掉的条目 = 其色证锚与字形证据
    // 冲突（E15@#56 实证）——该锚不得再作为下一遍 refine 的 CSP 种子。
    // 注意 scored[0]===当前码时不是翻案（margin 判据对「当前码即第一」
    // 无判别力，#46 H22 实证），不记。
    if (scored[0].code !== entry.code) layout?.reportFlips?.add(i);
    entry.code = scored[0].code;
  }
  // 无码死区翻案（card1 G2/H22/D17 实证）：dotRgb=null 的条目在
  // resolveCodes 里所有候选 ΔE=∞，候选集退化为「色板顺序前 K」，真码
  // 不在集内 → 永不求解（entry.code 为空）。字形齐全时用字形池逐码打分
  // 直接翻案：无当前码保护 → margin 加严 + 绝对门 + 全局唯一（taken）。
  const paletteSet = new Set(prepared.map(p => p.color.code));
  for (let i = 0; i < n; i += 1) {
    const split = splits[i];
    const entry = entries[i];
    if (!split || !entry) continue;
    const L = split.codeGlyphs.length;
    if (L < 2) continue;
    if (anchors[i]?.unique) continue;
    if (paletteSet.has(entry.code)) continue;
    const scored: Array<{ code: string; gs: number }> = [];
    for (const p of prepared) {
      if (p.color.code.length !== L || taken.has(p.color.code)) continue;
      const gs = codeScore(split, p.color.code, i);
      if (gs !== null) scored.push({ code: p.color.code, gs });
    }
    if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) {
      const dbgScored: string[] = [];
      for (const p of prepared) {
        if (p.color.code.length !== L || taken.has(p.color.code)) continue;
        const gs = codeScore(split, p.color.code, i);
        if (gs !== null) dbgScored.push(`${gs.toFixed(3)}:${p.color.code}`);
      }
      dbgScored.sort();
      console.error(`[otrn-nl-dbg] #${i} code='${entry.code}' L=${L} scored=${dbgScored.length} top=[${dbgScored.slice(0, 5).join(' ')}]`);
    }
    if (scored.length < 2) continue;
    scored.sort((a, b) => a.gs - b.gs);
    if (scored[0].gs > CARD_OVERTURN_MAX) continue;
    if (scored[1].gs - scored[0].gs < noLoadMargin) continue;
    if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) console.error(`[otrn-nl] #${i} ''→${scored[0].code} gs=${scored[0].gs.toFixed(3)} vs ${scored[1].gs.toFixed(3)}`);
    entry.code = scored[0].code;
    taken.add(scored[0].code);
  }
}


/**
 * 色卡路径完整管线：collectCardEntries → 先验 → 全局求解 → 复用下游识别。
 * 条目太少 / 自举饥饿 / 全部解不出时返回 null（调用方保留常规结果或失败）。
 */
function parseCardLegend(
  source: ImportImagePixels,
  prepared: Array<{ color: BeadColor; lab: [number, number, number] }>,
  paletteCodes: Set<string>,
  region?: LegendFrameRect,
  countSeedTemplates?: Map<string, Bitmap | Bitmap[]> | null,
  codeSeedGlyphs?: Map<string, Bitmap[]> | null,
  codeAnchors?: Map<string, Bitmap[]> | null,
): LegendParseResult | null {
  const collected = collectCardEntries(source, region);
  if (!collected) return null;
  const { rawEntries, splits, digitW, vertical } = collected;
  const priors = rawEntries.map(entry => entry.dotRgb ? priorFromDot(entry.dotRgb, prepared) : null);
  // 先验码长辅助切片（粘连码字）：色卡印刷票色≠豆色，先验不可靠——只在
  // ΔE≤6（色票基本原色）时才允许它改写字形结构，否则 M13→G6 毒化重演。
  // 切分验证回滚（card1 #6 实证）：切分是"相信先验码长"的赌注——宽字母 G
  // (1.37×digitW) 被等分成 [13,13] 假字形 → 假码 G21。赌赢的判据是切分后
  // 该行真的解出先验码；解出别的码 = 字形证据反对先验 → 回滚原字形重解。
  // card2 实证：5 个被切行全部解出先验（A17/B11/C17/C24）不受影响。
  const sliceBackup: Array<GlyphComp[] | null> = [];
  const sliceApplied: boolean[] = [];
  for (let i = 0; i < splits.length; i += 1) {
    const split = splits[i];
    if (!split || !priors[i] || priors[i]!.deltaE > 6) { sliceBackup.push(null); sliceApplied.push(false); continue; }
    const before = split.codeGlyphs;
    sliceMergedCodeGlyphs(split, priors[i]!, digitW);
    sliceBackup.push(split.codeGlyphs !== before ? before : null);
    sliceApplied.push(split.codeGlyphs !== before);
  }
  const anchors0 = resolveCodes(rawEntries, splits, priors, prepared);
  // 回滚毒切行并置 null（不全局重解——全量重跑会打乱唯一性名额分配，
  // 连锁打翻 #1/#29/#57 等无关正确行）。假码比无解危害大：宁可空码。
  const anchors = [...anchors0];
  for (let i = 0; i < splits.length; i += 1) {
    if (sliceApplied[i] && anchors0[i]?.code !== priors[i]!.code && sliceBackup[i]) {
      splits[i]!.codeGlyphs = sliceBackup[i]!;
      anchors[i] = null;
    }
  }
  // 卡片求解：resolveCodes（色点窗）出初始锚点——印刷票色≠豆色，ΔE 排序
  // 不可靠但 28/62 量级的锚足以驱动簇约束与标签传播；cardRefineCodes 用
  // 簇 CSP + 投票补全/纠错，最终裁决靠字形簇而非 ΔE。
  // （宽窗实验 2026-11-23：候选池扩到 top6 反而回退 36→34/38→35——错误
  // 候选参与簇字符交集，交集变松传播变弱。窄窗+簇传播仍是主路径，
  // 宽窗参数 wideColorWindow 保留备用。）
  // 种子准入实验（2026-11-23 晚，整体证伪回退，基建保留 dormant）：
  // 目标=拆 #56 E15 毒锚的 G5 偷窃链。四变体全败：①宽度门（'1'≤0.6×
  // digitW）→ 35/62——真 '1' 宽度 0.16~0.79×digitW 无判别力；②两遍 refine
  // 纯降级（翻案 reportFlips → 种子置空）→ 38/62；③种子改判（毒锚换翻案
  // 裁决码）→ 38；④+高 ΔE(>9) 锚降级 → 38。根因=CSP 约束全局耦合：毒锚
  // 的字母同时参与其他行的正确强制（forced 38→35），局部降级实际是全局
  // 重解，符合「连锁打翻」历史模式；且 G2 链的真正堵点是 c0 簇 F/G 形近
  // 首字母交集为空（约束丢弃）→ pos0 无约束 → {G2,H2..} 不唯一——种子
  // 准入对此无能为力。demoteSeeds/reportFlips 参数保留（默认不激活）。
  const refinedCodes = cardRefineCodes(rawEntries, splits, anchors, prepared, digitW);
  const checks = emptyChecks();
  const { entries } = recognizeLegendEntries(rawEntries, splits, priors, refinedCodes, prepared, paletteCodes, digitW, countSeedTemplates ?? null, codeSeedGlyphs ?? null, codeAnchors ?? null);
  // 字形翻案轮（输出层）：必须放在 recognizeLegendEntries 之后直接改
  // entries.code——放 refined 层会被模板自举连锁放大（实测 37→34）。
  cardOverturnEntries(rawEntries, splits, anchors, entries, prepared, { vertical });
  const resolved = entries.some(entry => entry.code.length > 0 && paletteCodes.has(entry.code));
  if (entries.length < MIN_ENTRIES || !resolved) return null;
  checks.codesInPalette = entries.every(entry => entry.code.length > 0 && paletteCodes.has(entry.code));
  checks.codesUnique = new Set(entries.map(entry => entry.code)).size === entries.length;
  checks.sumCount = entries.reduce((sum, entry) => sum + (entry.count > 0 ? entry.count : 0), 0);
  return { ok: true, entries, checks };
}

/** 独立入口：纯色卡清单识别（UI「色卡识别」/脚本直接调用）。 */
export function parseColorCard(
  source: ImportImagePixels,
  palette: BeadColor[],
  region?: LegendFrameRect,
): LegendParseResult {
  const failure: LegendParseResult = { ok: false, failureReason: 'noLegendBand', entries: [], checks: emptyChecks() };
  const prepared = palette
    .filter(color => color.enabled !== false)
    .map(color => ({ color, lab: rgbToLab(...color.rgb) }));
  if (!prepared.length) return failure;
  const paletteCodes = new Set(prepared.map(entry => entry.color.code));
  return parseCardLegend(source, prepared, paletteCodes, region) ?? failure;
}

/** 诊断：色卡路径中间产物（行带/token/色块/条目/求解），dbg 脚本用。 */
export function debugColorCardParse(
  source: ImportImagePixels,
  palette?: BeadColor[],
  region?: LegendFrameRect,
): {
  bands: Array<{ y0: number; y1: number; tokens: number; swatches: number; tokenXs: Array<[number, number, boolean]> }>;
  items: Array<{
    swatch: boolean; codeGlyphs: number; countGlyphs: number; codeSpan: string; countSpan: string;
    codeWs: number[]; countWs: number[]; dotHex: string | null; prior: string | null; resolved: string | null;
  }>;
  glyphDump: Array<{ i: number; kind: 'code' | 'count'; w: number; h: number; rows: string[]; rgb: string }>;
  gates: { items: number; withCount: number; digitW: number; pitch: number };
  bg: [number, number, number];
  maxRowContent: number;
} | null {
  const x0 = region ? clampInt(region.x0, 0, source.width - 1) : 0;
  const y0 = region ? clampInt(region.y0, 0, source.height - 1) : 0;
  const x1 = region ? clampInt(region.x1, 0, source.width - 1) : source.width - 1;
  const y1 = region ? clampInt(region.y1, 0, source.height - 1) : source.height - 1;
  if (x1 - x0 < 40 || y1 - y0 < 10) return null;
  const cropped = cropPixels(source, x0, y0, x1, y1);
  const bgNative = cardPageBg(cropped);
  const buffers = buildCardBuffers(cropped, bgNative, CARD_UPSCALE);
  const S = buffers.bin;
  const bin = S;
  const color = buffers.color;
  const { data, width, height } = S;
  const bg = dominantBaseColor(data, width, 0, 0, width, height);
  const contrast2 = CONTRAST * CONTRAST;
  const rowContent = new Uint32Array(height);
  for (let y = 0; y < height; y += 1) {
    let c = 0;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
      if (dr * dr + dg * dg + db * db > contrast2) c += 1;
    }
    rowContent[y] = c;
  }
  const rowThreshold = Math.max(3, Math.round(width * CARD_ROW_MIN_CONTENT_RATIO));
  const bands: Array<{ y0: number; y1: number; tokens: number; swatches: number; tokenXs: Array<[number, number, boolean]> }> = [];
  let bandStart = -1;
  let gap = 0;
  const flushBand = (y1b: number) => {
    if (bandStart < 0) return;
    const bh = y1b - bandStart + 1;
    if (bh >= CARD_BAND_MIN_H && bh <= CARD_BAND_MAX_H) bands.push({ y0: bandStart, y1: y1b, tokens: -1, swatches: -1, tokenXs: [] });
    bandStart = -1;
  };
  for (let y = 0; y < height; y += 1) {
    if (rowContent[y] >= rowThreshold) {
      if (bandStart < 0) bandStart = y;
      gap = 0;
    } else if (bandStart >= 0) {
      gap += 1;
      if (gap >= CARD_BAND_GAP) flushBand(y - gap);
    }
  }
  flushBand(height - 1);

  const items: Array<{
    swatch: boolean; codeGlyphs: number; countGlyphs: number; codeSpan: string; countSpan: string;
    codeWs: number[]; countWs: number[]; dotHex: string | null; prior: string | null; resolved: string | null;
  }> = [];
  const glyphDump: Array<{ i: number; kind: 'code' | 'count'; w: number; h: number; rows: string[]; rgb: string }> = [];
  let gates = { items: 0, withCount: 0, digitW: 0, pitch: 0 };
  const collected = collectCardItems(cropped);
  const toHex = (rgb: [number, number, number]) => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const resolvedList: Array<string | null> = [];
  if (collected) {
    gates = { items: collected.items.length, withCount: collected.items.filter(i => i.countGlyphs.length > 0).length, digitW: collected.digitW, pitch: collected.pitch };
    // 下游求解（与 parseCardLegend 同链），palette 传入时输出先验/结果。
    const rawEntries: RawEntry[] = [];
    const splits: Array<SplitResult | null> = [];
    for (const item of collected.items) {
      rawEntries.push({ dotRgb: item.dotRgb, glyphs: [...item.codeGlyphs, ...item.countGlyphs] });
      splits.push({ codeGlyphs: item.codeGlyphs, countGlyphs: item.countGlyphs, splitSuspicious: false });
    }
    const prepared = (palette ?? [])
      .filter(color => color.enabled !== false)
      .map(color => ({ color, lab: rgbToLab(...color.rgb) }));
    const priors = rawEntries.map(entry => entry.dotRgb ? priorFromDot(entry.dotRgb, prepared) : null);
    for (let i = 0; i < splits.length; i += 1) {
      if (splits[i] && priors[i]) sliceMergedCodeGlyphs(splits[i]!, priors[i]!, collected.digitW);
    }
    const resolvedCodes = prepared.length ? resolveCodes(rawEntries, splits, priors, prepared) : rawEntries.map(() => null);
    for (let i = 0; i < collected.items.length; i += 1) {
      const item = collected.items[i];
      const resolved = resolvedCodes[i];
      resolvedList.push(resolved ? resolved.code : null);
      items.push({
        swatch: item.dotRgb !== null,
        codeGlyphs: item.codeGlyphs.length,
        countGlyphs: item.countGlyphs.length,
        codeSpan: item.codeGlyphs.length ? `${item.codeGlyphs[0].x0}-${item.codeGlyphs[item.codeGlyphs.length - 1].x1}` : '-',
        countSpan: item.countGlyphs.length ? `${item.countGlyphs[0].x0}-${item.countGlyphs[item.countGlyphs.length - 1].x1}` : '-',
        codeWs: item.codeGlyphs.map(widthOf),
        countWs: item.countGlyphs.map(widthOf),
        dotHex: item.dotRgb ? toHex(item.dotRgb) : null,
        prior: priors[i] ? priors[i]!.code : null,
        resolved: resolved ? resolved.code : null,
      });
      for (const kind of ['code', 'count'] as const) {
        for (const g of kind === 'code' ? item.codeGlyphs : item.countGlyphs) {
          glyphDump.push({
            i,
            kind,
            w: g.bitmap.w,
            h: g.bitmap.h,
            rows: Array.from({ length: g.bitmap.h }, (_, y) =>
              Array.from({ length: g.bitmap.w }, (_, x) => (g.bitmap.data[y * g.bitmap.w + x] ? '1' : '0')).join('')),
            rgb: toHex(g.rgb),
          });
        }
      }
    }
  }
  // 逐行带补 token 统计（重放列剖面）
  for (const band of bands) {
    const bandH = band.y1 - band.y0 + 1;
    const colFill = new Float32Array(width);
    for (let x = 0; x < width; x += 1) {
      let c = 0;
      for (let y = band.y0; y <= band.y1; y += 1) {
        const i = (y * width + x) * 4;
        const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
        if (dr * dr + dg * dg + db * db > contrast2) c += 1;
      }
      colFill[x] = c / bandH;
    }
    let tokenCount = 0;
    let swatchCount = 0;
    let tStart = -1;
    let tGap = 0;
    const flushTok = (endX: number) => {
      if (tStart < 0) return;
      tokenCount += 1;
      const comps = analyzeLine(bin, bg, { y0: band.y0 - 1, y1: band.y1 + 1, minX: tStart - 1, maxX: endX + 1 })
        .filter(c => c.x0 >= tStart - 1 && c.x1 <= endX + 1);
      const bandHb = bandH;
      for (const comp of comps) {
        const w = widthOf(comp);
        const h = comp.y1 - comp.y0 + 1;
        if (w >= CARD_SWATCH_MIN_W && h >= bandHb * CARD_SWATCH_MIN_H_RATIO && comp.area / (w * h) >= CARD_SWATCH_MIN_FILL) { swatchCount += 1; break; }
      }
      tStart = -1;
    };
    for (let x = 0; x < width; x += 1) {
      if (colFill[x] > 0.02) {
        if (tStart < 0) tStart = x;
        tGap = 0;
      } else if (tStart >= 0) {
        tGap += 1;
        if (tGap >= CARD_TOKEN_GAP) { flushTok(x - tGap); tGap = 0; }
      }
    }
    flushTok(width - 1);
    band.tokens = tokenCount;
    band.swatches = swatchCount;
    // token 明细（x 范围 + 是否色块），重放一次 comps
    band.tokenXs = [];
    let ts = -1;
    let tg = 0;
    const flushDetail = (endX: number) => {
      if (ts < 0) return;
      const comps = analyzeLine(bin, bg, { y0: band.y0 - 1, y1: band.y1 + 1, minX: ts - 1, maxX: endX + 1 })
        .filter(c => c.x0 >= ts - 1 && c.x1 <= endX + 1);
      let isSwatch = false;
      for (const comp of comps) {
        const w = widthOf(comp);
        const h = comp.y1 - comp.y0 + 1;
        if (w >= CARD_SWATCH_MIN_W && h >= bandH * CARD_SWATCH_MIN_H_RATIO && comp.area / (w * h) >= CARD_SWATCH_MIN_FILL) { isSwatch = true; break; }
      }
      band.tokenXs.push([ts, endX, isSwatch]);
      ts = -1;
    };
    for (let x = 0; x < width; x += 1) {
      if (colFill[x] > 0.02) {
        if (ts < 0) ts = x;
        tg = 0;
      } else if (ts >= 0) {
        tg += 1;
        if (tg >= CARD_TOKEN_GAP) { flushDetail(x - tg); tg = 0; }
      }
    }
    flushDetail(width - 1);
  }
  return { bands, items, glyphDump, gates, bg, maxRowContent: Math.max(...rowContent) };
}

/**
 * 下游共享（常规路径与色卡路径同一条链）：自举标注 → 字形模板 → 计数
 * 模板（合成锚 + 码字锚）→ 逐条目识别 → 去重组装。bootstrapCount===0
 * 时返回 bootstrapped:false（调用方报 templateStarved）。
 */
export function recognizeLegendEntries(
  rawEntries: RawEntry[],
  splits: Array<SplitResult | null>,
  priors: Array<{ code: string; deltaE: number } | null>,
  resolvedCodes: Array<ResolvedCode | null>,
  prepared: Array<{ color: BeadColor; lab: [number, number, number] }>,
  paletteCodes: Set<string>,
  digitW: number,
  countSeedTemplates?: Map<string, Bitmap | Bitmap[]> | null,
  codeSeeds?: Map<string, Bitmap[]> | null,
  codeAnchors?: Map<string, Bitmap[]> | null,
): { entries: LegendEntry[]; templates: Map<string, Bitmap>; bootstrapped: boolean } {
  countGlyphDump.length = 0;
  // 自举标注：求解出的 code 字形是天然标注样本（覆盖全部出现过的字符）。
  // 字形宽度守卫：code 区超宽字形（粘连）不标注防污染模板。
  const labeled = new Map<string, Bitmap[]>();
  let bootstrapCount = 0;
  for (let i = 0; i < rawEntries.length; i += 1) {
    const resolved = resolvedCodes[i];
    const split = splits[i];
    if (!resolved || !split || split.codeGlyphs.length !== resolved.code.length) continue;
    // 列跨度守卫：code 字形必须落在单个文本列内（跨度 ≲ L×digitW*1.6）。
    // 跨两列的垃圾装配（码字列+名字列拼接）长度碰巧 = L 时会以"对齐"假象
    // 进入自举，把错字形标成正确字符、毒化数字模板链。
    const cgSpan = split.codeGlyphs[split.codeGlyphs.length - 1].x1 - split.codeGlyphs[0].x0 + 1;
    if (cgSpan > resolved.code.length * digitW * 1.6) continue;
    let labeledAny = false;
    for (let j = 0; j < resolved.code.length; j += 1) {
      // 粘连块不进模板（防污染）——逐字形跳过而非整行放弃。
      if (widthOf(split.codeGlyphs[j]) > digitW * 1.9) continue;
      const list = labeled.get(resolved.code[j]) ?? [];
      list.push(split.codeGlyphs[j].bitmap);
      labeled.set(resolved.code[j], list);
      labeledAny = true;
    }
    if (labeledAny) bootstrapCount += 1;
  }
  codeGlyphDump.length = 0;
  for (let i = 0; i < rawEntries.length; i += 1) {
    const split = splits[i];
    if (!split) continue;
    split.codeGlyphs.forEach((g, j) => codeGlyphDump.push({ entry: i, index: j, bitmap: g.bitmap, x0: g.x0 }));
  }
  // 码字种子回灌（2026-11-24 card4 实证，与计数种子同构的生产语义：
  // 校对确认一条 = 种子 +1）：solver 毒解会触发连锁——E16 错解成 H17
  // 把洗淡 E 标成 'H'、G15 错解成 H18 把洗淡 G 标成 'H'，'H' 桶三个
  // 互异单例被 pruneInconsistentLabels 打平弃字 → 'H' 从池里消失 →
  // H1/H13/H14 永远读不对（鸡生蛋循环）。真值种子按松一致性
  // （CODE_SEED_CONSIST）过滤毒标成员并重建被炸掉的桶。
  if (codeSeeds?.size) {
    for (const [ch, seeds] of codeSeeds) {
      if (!seeds.length) continue;
      const seedTemplate = buildTemplates(new Map([['x', seeds]])).get('x')!;
      const existing = labeled.get(ch) ?? [];
      const kept = existing.filter(b => bitmapJaccard(b, seedTemplate) <= CODE_SEED_CONSIST);
      // 去重：已验证条目的种子字形与自举成员往往是同一位图——重复入桶
      // 会把 ≤2 成员桶（快速保留路径）变成 4 成员桶（聚类路径），
      // prune 行为漂移连带模板微移（E16 实证 0.04 翻转）。
      const seen = new Set(kept.map(b => `${b.w}x${b.h}:${Array.from(b.data).join('')}`));
      const fresh = seeds.filter(s => !seen.has(`${s.w}x${s.h}:${Array.from(s.data).join('')}`));
      labeled.set(ch, [...kept, ...fresh]);
    }
  }
  // 自洽守卫：错解 code 的异形字形不进模板（毒化计数簇标注的根源）。
  const templates = buildTemplates(pruneInconsistentLabels(labeled));
  // 静态基准锚缺字补池（绕过 prune，零扰动）：只补实时池缺失的字符。
  // 'H' 桶被 solver 毒解炸掉后，join 仲裁/模板路径无 H 可用 → H 系条目
  // 永错；锚直接补位打破循环。现存桶一个字节不动（种子教训：prune 路径
  // 敏感度高于模板均值）。
  if (codeAnchors?.size) {
    for (const [ch, glyphs] of codeAnchors) {
      if (templates.has(ch) || !glyphs.length) continue;
      const t = buildTemplates(new Map([['x', glyphs]])).get('x');
      if (t) templates.set(ch, t);
    }
  }
  if (bootstrapCount === 0) return { entries: [], templates, bootstrapped: false };

  // 计数区自建数字模板（计数数字与色号字体不同，直接借模板距离会偏大）。
  const codeDigitTemplates = new Map([...templates].filter(([char]) => char >= '0' && char <= '9'));
  codeDigitDump.length = 0;
  for (const [digit, bitmap] of codeDigitTemplates) codeDigitDump.push({ digit, bitmap });
  // 计数字实际中位宽：全局 digitW 含代码字母会偏宽，粘连块 k 值估算
  // 必须用计数字自己的宽度（water-box 计数字 4-5px，digitW=6）。
  const countSingleWidths = splits.flatMap(s => s
    ? s.countGlyphs.filter(g => widthOf(g) <= digitW * 1.4).map(widthOf)
    : []);
  const countW = countSingleWidths.length ? median(countSingleWidths) : Math.max(3, Math.round(digitW * 0.75));
  const countGlyphHeights = splits.flatMap(s => s ? s.countGlyphs.filter(g => widthOf(g) <= digitW * 1.2).map(g => g.y1 - g.y0 + 1) : []);
  // 计数标注锚：浏览器端一律用 Canvas 合成 0-9（同字体引擎）；Node/无 DOM
  // 自动为 null 回落代码字形锚。跨字体借锚会系统性误标（见 debug 路径注释）。
  const medCountH = countGlyphHeights.length ? Math.round(median(countGlyphHeights)) : 0;
  const syntheticDigits = countGlyphHeights.length
    ? [medCountH - 1, medCountH, medCountH + 1]
        .map(h => renderSyntheticDigitTemplates(h))
        .filter((m): m is Map<string, Bitmap> => !!m)
    : [];
  const countTemplates = buildCountTemplates(rawEntries, splits, digitW, codeDigitTemplates, syntheticDigits, typeof document !== 'undefined', countSeedTemplates ?? null);
  const synthWinner = lastSyntheticAnchors.current;

  // 逐条目识别。
  const parsed = rawEntries.map((entry, index) =>
    recognizeEntry(entry, splits[index], priors[index], resolvedCodes[index], templates, countTemplates, paletteCodes, digitW, countW, synthWinner, prepared));
  if (typeof process !== 'undefined' && process.env?.CARD_DEBUG) {
    rawEntries.forEach((entry, i) => {
      const split = splits[i];
      const dbg = `x${entry.glyphs[0]?.x0 ?? -1} dot=${entry.dotRgb ? entry.dotRgb.join(',') : 'NULL'}`
        + ` glyphs=[${entry.glyphs.map(g => `w${widthOf(g)}`).join(' ')}]`
        + ` prior=${priors[i]?.code ?? '-'}@${priors[i] ? priors[i].deltaE.toFixed(1) : '-'}`
        + ` split=${split ? `code${split.codeGlyphs.length}/cnt${split.countGlyphs.length}${split.splitSuspicious ? '(sus)' : ''}` : 'null'}`
        + ` -> ${parsed[i].code || '?'}/${parsed[i].count}${parsed[i].warns.length ? '!' + parsed[i].warns.join(',') : ''}`;
      console.error(`[ent-dbg] #${i} ${dbg}`);
      if (i === 0) {
        const pool = [...templates.entries()].map(([ch, b]) => `${ch}:${b.w}x${b.h}`).sort().join(' ');
        console.error(`[pool-dbg] ${templates.size} chars: ${pool}`);
      }
      if (split) {
        const glyphDbg = split.codeGlyphs.map(g => {
          const m = matchGlyph(g.bitmap, templates);
          if (!m) return 'null';
          // top3：临时剔除最佳后两次匹配
          const t2 = new Map(templates); t2.delete(m.char);
          const m2 = matchGlyph(g.bitmap, t2);
          const t3 = new Map(t2); if (m2) t3.delete(m2.char);
          const m3 = matchGlyph(g.bitmap, t3);
          return `${m.char}${m.distance.toFixed(2)}>${m2 ? m2.char + m2.distance.toFixed(2) : '-'}>${m3 ? m3.char + m3.distance.toFixed(2) : '-'}`;
        });
        console.error(`[code-dbg] #${i} ${parsed[i].code || '?'} glyphs: ${glyphDbg.join(' | ')}`);
      }
    });
  }

  // 结果组装：去重标记。
  const seen = new Set<string>();
  const entries: LegendEntry[] = parsed.map((item, index) => {
    const warn = [...item.warns];
    if (item.code && seen.has(item.code)) warn.push('duplicateCode');
    if (item.code) seen.add(item.code);
    const entry: LegendEntry = { code: item.code, count: item.count, confidence: Number(item.confidence.toFixed(4)) };
    const dotRgb = rawEntries[index]?.dotRgb;
    if (dotRgb) entry.dotRgb = dotRgb;
    if (warn.length) entry.warn = warn.join(';');
    return entry;
  });
  return { entries, templates, bootstrapped: true };
}

/**
 * 入口：解析图纸底部的图例条。
 *
 * 2026-11-22 增补独立色卡路径：常规候选一无所获，或常规结果贫瘠
 * （色板内码 < 60% 或可读数量 < 40%）时，尝试药丸/色票清单版式
 * （collectCardEntries），按条目质量分仲裁，只在更优时采纳。
 *
 * @param source 全图像素（图例在网格下方，需要完整图幅）
 * @param calibration 网格校准（用于圈定"网格底边以下"的带状区域）
 * @param palette 当前色板（色点先验 + code 色板约束）
 * @param options gridRows/gridCols 来自校准快照，做 Σcount 校验
 */
export function parseLegend(
  source: ImportImagePixels,
  calibration: ImportGridCalibration,
  palette: BeadColor[],
  options: LegendParseOptions = {},
): LegendParseResult {
  const checks = emptyChecks();
  const failure = (reason: LegendFailureReason): LegendParseResult => ({ ok: false, failureReason: reason, entries: [], checks });
  const valid = Number.isInteger(source.width) && Number.isInteger(source.height)
    && source.width > 0 && source.height > 0
    && source.data.length >= source.width * source.height * 4
    && [calibration.originX, calibration.originY, calibration.cellWidth, calibration.cellHeight].every(Number.isFinite)
    && calibration.cellWidth > 0 && calibration.cellHeight > 0
    && calibration.columns > 0 && calibration.rows > 0;
  if (!valid || palette.length === 0) return failure('noLegendBand');

  const prepared = palette
    .filter(color => color.enabled !== false)
    .map(color => ({ color, lab: rgbToLab(...color.rgb) }));
  const paletteCodes = new Set(prepared.map(entry => entry.color.code));
  if (!prepared.length) return failure('noLegendBand');

  const selected = selectLegendLocation(source, calibration, options.region);
  if (!selected || (!selected.located.lines.length && !selected.located.chips)) {
    // 常规候选一无所获：独立色卡（无豆网格的清单图）兜底。
    const cardResult = parseCardLegend(source, prepared, paletteCodes, options.region, options.countSeedTemplates ?? null, options.codeSeedGlyphs ?? null, options.codeAnchorGlyphs ?? null);
    if (cardResult) {
      const gridRowsC = Number.isFinite(options.gridRows) ? Math.max(1, Math.round(options.gridRows!)) : calibration.rows;
      const gridColsC = Number.isFinite(options.gridCols) ? Math.max(1, Math.round(options.gridCols!)) : calibration.columns;
      cardResult.checks.sumWithinGrid = cardResult.checks.sumCount <= gridRowsC * gridColsC;
      return cardResult;
    }
    return failure('noLegendBand');
  }
  const located = selected.located;

  // 逐行：连通域 → 间隙分段条目 → 色点提取（右侧清单模式先滤标题/副标题行）。
  const { rawEntries, digitW } = selected;
  if (rawEntries.length < MIN_ENTRIES) return failure('tooFewEntries');

  // 色点先验 + code|count 切分（含重复色号列合并）+ 全局一致性求解。
  const priors = rawEntries.map(entry => entry.dotRgb ? priorFromDot(entry.dotRgb, prepared) : null);
  const splits = rawEntries.map((entry, index) => {
    const generic = () => splitEntry(entry.glyphs, priors[index], digitW);
    return located.region === 'right' ? (splitRightRow(entry.glyphs, digitW) ?? generic()) : generic();
  });
  dedupeDuplicateCodeColumns(priors, splits);
  if (located.region === 'right') dedupeCodeColumnCopies(priors, splits, digitW);
  for (const split of splits) if (split) reduceCodeToStructuralCluster(split, digitW);
  for (let i = 0; i < splits.length; i += 1) {
    if (splits[i] && priors[i]) sliceMergedCodeGlyphs(splits[i]!, priors[i]!, digitW);
  }
  for (let i = 0; i < splits.length; i += 1) {
    if (false && splits[i] && priors[i]) repairCodeFromColumns(splits[i]!, priors[i]!, digitW);
  }
  // pruneImplausibleSplits(priors, splits);
  const resolvedCodes = resolveCodes(rawEntries, splits, priors, prepared);

  // 自举模板 + 计数模板 + 逐条目识别（与色卡路径共享，见 recognizeLegendEntries）。
  const { entries: parsedEntries, templates, bootstrapped } =
    recognizeLegendEntries(rawEntries, splits, priors, resolvedCodes, prepared, paletteCodes, digitW, options.countSeedTemplates ?? null, options.codeSeedGlyphs ?? null, options.codeAnchorGlyphs ?? null);
  if (!bootstrapped) return failure('templateStarved');

  // 头部交叉校验（用自举的数字模板；解析不出则字段缺省）。
  const digitTemplates = new Map([...templates].filter(([char]) => char >= '0' && char <= '9'));
  const header = parseHeader(source, calibration, digitTemplates);
  if (header.colorCount !== undefined) checks.headerColorCount = header.colorCount;
  if (header.gridCols !== undefined) checks.headerGridCols = header.gridCols;
  if (header.gridRows !== undefined) checks.headerGridRows = header.gridRows;

  const entries: LegendEntry[] = parsedEntries;
  checks.codesInPalette = entries.length > 0 && entries.every(entry => entry.code.length > 0 && paletteCodes.has(entry.code));
  checks.codesUnique = new Set(entries.map(entry => entry.code)).size === entries.length;
  checks.sumCount = entries.reduce((sum, entry) => sum + (entry.count > 0 ? entry.count : 0), 0);
  const gridRows = Number.isFinite(options.gridRows) ? Math.max(1, Math.round(options.gridRows!)) : calibration.rows;
  const gridCols = Number.isFinite(options.gridCols) ? Math.max(1, Math.round(options.gridCols!)) : calibration.columns;
  checks.sumWithinGrid = checks.sumCount <= gridRows * gridCols;

  const resolved = entries.some(entry => entry.code.length > 0 && paletteCodes.has(entry.code));
  if (entries.length < MIN_ENTRIES) return failure('tooFewEntries');
  if (!resolved) return failure('templateStarved');

  // ---- 独立色卡仲裁（2026-11-22）：常规结果贫瘠（色板内码 <60% 或可读
  // 数量 <40%）且色卡路径可用时，按条目质量分取舍——只赢不输。 ----
  const resolvedRatio = entries.filter(entry => entry.code.length > 0 && paletteCodes.has(entry.code)).length / entries.length;
  const readableRatio = entries.filter(entry => entry.count > 0 && !(entry.warn ?? '').includes('countUnread')).length / entries.length;
  if (resolvedRatio < 0.6 || readableRatio < 0.4) {
    const cardResult = parseCardLegend(source, prepared, paletteCodes, options.region, options.countSeedTemplates ?? null, options.codeSeedGlyphs ?? null, options.codeAnchorGlyphs ?? null);
    if (cardResult && cardResult.ok && cardResultScore(cardResult.entries) > cardResultScore(entries)) {
      return cardResult;
    }
  }
  return { ok: true, entries, checks };
}
