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
/** 计数字体模板的匹配阈值（计数区自建字体，同字距离更紧）。 */
const COUNT_MAX_DISTANCE = 0.32;
/** 计数字形聚类的同字符阈值（同字体同字符距离 ~0.1）。 */
const COUNT_GROUP_JACCARD = 0.22;
/** 同字符碎簇合并阈值（簇模板两两距离）。 */
const COUNT_MERGE_JACCARD = 0.26;
/** 诊断：最近一次计数模板构建的指派表（簇大小 → 数字），dbg 脚本用。 */
export const countTemplateAssignment: Array<{ size: number; dims: string; digit: string }> = [];
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
}

/** 用户框选的图例区域（图像像素坐标，含端点）。 */
export interface LegendFrameRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 保比例位图：宽 × 高的 0/1 图。 */
interface Bitmap {
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
function dominantBaseColor(
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
const bitmapJaccard = (a: Bitmap, b: Bitmap): number => {
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

/** 位图等分切片：把粘连的 k 个字符按宽度等分（用于粘连数字回收）。 */
function splitBitmap(b: Bitmap, k: number): Bitmap[] {
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

type LegendRegion = 'bottom' | 'right';

interface LegendLocation {
  background: [number, number, number];
  lines: LineScan[];
  region: LegendRegion;
  /** 右侧带由色票锚定行分割产生：每行必有前导色票，走整行点锚路径。 */
  anchored: boolean;
  /** 用户框选区域：走多条目装配路径（一行可含多个条目）。 */
  framed: boolean;
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
    const parsed = collectRawEntries(source, located);
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
  return best;
}

/**
 * 行内连通域 → 字形对象（面积/跨度过滤 + 保比例位图 + 均值色）。
 * 输出坐标为绝对图像坐标；边框残片（宽或高 ≤2）与窄碎片被丢弃。
 * 洗淡行重试：水印/半透明覆盖会把文字对比度压到 CONTRAST 以下，只剩
 * 笔画核心碎块（water-box 图例条带第 3 行整行被水印洗淡）。首通行
 * 字形 <4 时用 0.55×CONTRAST 重提——正常行不受影响（重试仅在欠额时触发）。
 */
function analyzeLine(
  source: ImportImagePixels,
  background: [number, number, number],
  line: LineScan,
): GlyphComp[] {
  const glyphs = analyzeLineWithContrast(source, background, line, CONTRAST);
  if (glyphs.length >= 4) return glyphs;
  const retried = analyzeLineWithContrast(source, background, line, Math.round(CONTRAST * 0.55));
  return retried.length > glyphs.length ? retried : glyphs;
}

function analyzeLineWithContrast(
  source: ImportImagePixels,
  background: [number, number, number],
  line: LineScan,
  contrast: number,
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
    if (cw > w * COMPONENT_MAX_WIDTH_RATIO) continue;
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
  return {
    // 补丁众数色：实心票=填充色（票内印字是少数派）；空心票框=内芯底色。
    // 相比中心 3×3 均值，补丁众数对"票内印字"与"边框环混入"都稳健。
    rgb: patchModeColor(source, cx, cy, Math.max(7, Math.round(Math.min(bestW, bestH) * 0.9))),
    swallowsFirst,
    box: { x0: wx0 + best.minX, x1: wx0 + best.maxX, y0: wy0 + best.minY, y1: wy0 + best.maxY },
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
    const cx = Math.round((dot.x0 + dot.x1) / 2);
    const cy = Math.round((dot.y0 + dot.y1) / 2);
    // 底部条带的圆点无印字，中心补丁众数=填充色（均值桶在 JPEG 噪声下
    // 反而漂移，实测众数多对 1 个）；右侧清单的色票中央印着色号文字，
    // 必须用整票众数——文字像素是少数派。
    dotRgb = dotSampling === 'center'
      ? patchModeColor(source, cx, cy, 3)
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
function priorFromDot(
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
function buildTemplates(labeled: Map<string, Bitmap[]>): Map<string, Bitmap> {
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
): string[] {
  if (!clusters.length) return [];
  const digits = [...codeDigitTemplates.keys()].sort();
  if (!digits.length) return clusters.map(() => '');
  const meanDist = (members: Bitmap[], template: Bitmap) =>
    members.reduce((sum, bitmap) => sum + bitmapJaccard(bitmap, template), 0) / members.length;
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

function buildCountTemplates(
  rawEntries: RawEntry[],
  splits: Array<SplitResult | null>,
  digitW: number,
  codeDigitTemplates: Map<string, Bitmap>,
): Map<string, Bitmap> {
  const singles: Bitmap[] = [];
  for (let i = 0; i < rawEntries.length; i += 1) {
    const split = splits[i];
    if (!split) continue;
    for (const glyph of split.countGlyphs) {
      if (widthOf(glyph) <= digitW * 1.4) singles.push(glyph.bitmap);
    }
  }
  if (!singles.length || !codeDigitTemplates.size) return new Map();
  // 聚类（平均连接，挡单链接的形近链）→ 簇模板合并 → 标注。若聚类退化
  // （最大簇吞掉 >40% 单字——小字号+JPEG 模糊时不同数字两两距离全部贴着
  // 阈值，任何链接策略都会链成巨簇），退回逐单字标注：去噪交给 EM 轮次
  // 里按标注聚合的同字体临时模板。
  countTemplateAssignment.length = 0;
  const rawClusters = averageLinkage(singles, (a, b) => bitmapJaccard(a, b), COUNT_GROUP_JACCARD);
  const degenerate = Math.max(...rawClusters.map(members => members.length)) > singles.length * 0.4;
  let groupsAll: Bitmap[][];
  if (degenerate) {
    countTemplateAssignment.push({ size: singles.length, dims: '', digit: 'SINGLETON/EM' });
    groupsAll = singles.map(bitmap => [bitmap]);
  } else {
    countTemplateAssignment.push({ size: rawClusters.length, dims: '', digit: `CLUSTER/${rawClusters.length}` });
    const clusterPairs = rawClusters.map(members => ({
      members,
      template: buildTemplates(new Map([['x', members]])).get('x')!,
    }));
    const merged = averageLinkage(
      clusterPairs,
      (a, b) => bitmapJaccard(a.template, b.template),
      COUNT_MERGE_JACCARD,
    );
    countTemplateAssignment[0].digit = `CLUSTER/${rawClusters.length}->${merged.length}`;
    groupsAll = merged.map(cluster => cluster.flatMap(p => p.members));
  }
  // 标注（argmin + 同字体 EM 自纠），两段式实现见导出的 annotateCountClusters。
  const labeled = new Map<string, Bitmap[]>();
  const assignment = annotateCountClusters(groupsAll, codeDigitTemplates);
  groupsAll.forEach((members, index) => {
    const list = labeled.get(assignment[index]) ?? [];
    list.push(...members);
    labeled.set(assignment[index], list);
    countTemplateAssignment.push({ size: members.length, dims: members.map(m => `${m.w}x${m.h}`).join(','), digit: assignment[index] });
  });
  return buildTemplates(labeled);
}

interface GlyphMatch {
  char: string;
  distance: number;
  secondDistance: number;
}

/** 单字形对模板集匹配：返回最优字符与次优距离。 */
function matchGlyph(glyph: Bitmap, templates: Map<string, Bitmap>): GlyphMatch | null {
  let best: GlyphMatch | null = null;
  let second = Number.POSITIVE_INFINITY;
  for (const [char, template] of templates) {
    const d = bitmapJaccard(glyph, template);
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
function resolveCodes(
  rawEntries: RawEntry[],
  splits: Array<SplitResult | null>,
  priors: Array<{ code: string; deltaE: number } | null>,
  prepared: Array<{ color: BeadColor; lab: [number, number, number] }>,
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
    const ranked = prepared
      .filter(p => p.color.code.length === len)
      .filter(p => {
        if (!dotLab) return true;
        return deltaE2000(dotLab, p.lab) <= PRIOR_MAX_DELTA_E;
      })
      .map(p => ({ code: p.color.code, deltaE: dotLab ? deltaE2000(dotLab, p.lab) : Number.POSITIVE_INFINITY }))
      .sort((a, b) => a.deltaE - b.deltaE);
    const window = ranked.length && dotLab
      ? Math.min(PRIOR_MAX_DELTA_E, ranked[0].deltaE + PLAUSIBLE_WINDOW)
      : PRIOR_MAX_DELTA_E;
    candidates.push(ranked.filter(p => p.deltaE <= window).map(p => p.code));
  }

  // 2. 字形聚类：union-find，同字符字形 Jaccard 距离极小。
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

  // 4. 定解（全局唯一）。
  const resolved: Array<ResolvedCode | null> = new Array(n).fill(null);
  const taken = new Set<string>();
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
): EntryParse {
  const warns: string[] = [];
  if (!split) {
    const fallback = resolved?.code ?? (prior && paletteCodes.has(prior.code) ? prior.code : '');
    return { code: fallback, count: 0, confidence: fallback ? 0.3 : 0.1, warns: ['entryTooShort'] };
  }
  if (split.splitSuspicious && !resolved) warns.push('splitSuspicious');

  // ---- code：全局一致性求解结果优先；未求解条目走模板/先验兜底。 ----
  let code = '';
  let codeConfidence: number | null = null;
  if (resolved) {
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
    const match = countTemplates.size && w <= digitW * 1.4 ? matchGlyph(glyph.bitmap, countTemplates) : null;
    if (match && match.distance <= GLYPH_MAX_DISTANCE) {
      digits.push(match.char);
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
      if (k >= 2 && k <= 4 && countW > 0 && w >= countW * 0.92 * k) ks.push(k);
    }
    let bestK = -1;
    let bestAvg = Number.POSITIVE_INFINITY;
    let bestPrefix = 0;
    if (countTemplates.size) {
      for (const k of ks) {
        const slices = splitBitmap(glyph.bitmap, k);
        const matches = slices.map(slice => matchGlyph(slice, countTemplates));
        let prefix = 0;
        let distSum = 0;
        while (prefix < matches.length) {
          const m = matches[prefix];
          if (m && m.distance <= SPLIT_MAX_DISTANCE) { distSum += m.distance; prefix += 1; }
          else break;
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
      const matches = slices.map(slice => matchGlyph(slice, countTemplates));
      for (let s = 0; s < bestPrefix; s += 1) {
        digits.push(matches[s]!.char);
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
  priors: Array<{ code: string; deltaE: number } | null>;
  splits: Array<SplitResult | null>;
  resolvedCodes: Array<ResolvedCode | null>;
  digitW: number;
  templateChars: string[];
  countTemplateChars: string[];
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
      let current: GlyphComp[] = [];
      for (const comp of comps) {
        if (isSwatchAnchor(comp, ctx) && current.length) {
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
function sliceMergedCodeGlyphs(
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
  const priors = rawEntries.map(entry => entry.dotRgb ? priorFromDot(entry.dotRgb, prepared) : null);
  const splits = rawEntries.map((entry, index) => {
    const generic = () => splitEntry(entry.glyphs, priors[index], digitW);
    return located.region === 'right' ? (splitRightRow(entry.glyphs, digitW) ?? generic()) : generic();
  });
  dedupeDuplicateCodeColumns(priors, splits);
  if (located.region === 'right') dedupeCodeColumnCopies(priors, splits, digitW);
  for (let i = 0; i < splits.length; i += 1) {
    if (splits[i] && priors[i]) sliceMergedCodeGlyphs(splits[i]!, priors[i]!, digitW);
  }
  const resolvedCodes = resolveCodes(rawEntries, splits, priors, prepared);
  const labeled = new Map<string, Bitmap[]>();
  let bootstrapCount = 0;
  for (let i = 0; i < rawEntries.length; i += 1) {
    const resolved = resolvedCodes[i];
    const split = splits[i];
    if (!resolved || !split || split.codeGlyphs.length !== resolved.code.length) continue;
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
  const countTemplates = buildCountTemplates(rawEntries, splits, digitW, codeDigitTemplates);
  const paletteCodes = new Set(prepared.map(entry => entry.color.code));
  const parsed = rawEntries.map((entry, index) =>
    recognizeEntry(entry, splits[index], priors[index], resolvedCodes[index], templates, countTemplates, paletteCodes, digitW, countW));
  return {
    rawEntries, priors, splits, resolvedCodes, digitW,
    templateChars: [...templates.keys()].sort(),
    countTemplateChars: [...countTemplates.keys()].sort(),
    parsed,
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

  const selected = selectLegendLocation(source, calibration, options.region);
  if (!selected || !selected.located.lines.length) return failure('noLegendBand');
  const located = selected.located;
  const prepared = palette
    .filter(color => color.enabled !== false)
    .map(color => ({ color, lab: rgbToLab(...color.rgb) }));
  const paletteCodes = new Set(prepared.map(entry => entry.color.code));
  if (!prepared.length) return failure('noLegendBand');

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
  for (let i = 0; i < splits.length; i += 1) {
    if (splits[i] && priors[i]) sliceMergedCodeGlyphs(splits[i]!, priors[i]!, digitW);
  }
  const resolvedCodes = resolveCodes(rawEntries, splits, priors, prepared);

  // 自举标注：求解出的 code 字形是天然标注样本（覆盖全部出现过的字符）。
  // 字形宽度守卫：code 区超宽字形（粘连）不标注防污染模板。
  const labeled = new Map<string, Bitmap[]>();
  let bootstrapCount = 0;
  for (let i = 0; i < rawEntries.length; i += 1) {
    const resolved = resolvedCodes[i];
    const split = splits[i];
    if (!resolved || !split || split.codeGlyphs.length !== resolved.code.length) continue;
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
  // 自洽守卫：错解 code 的异形字形不进模板（毒化计数簇标注的根源）。
  const templates = buildTemplates(pruneInconsistentLabels(labeled));
  if (bootstrapCount === 0) return failure('templateStarved');

  // 计数区自建数字模板（计数数字与色号字体不同，直接借模板距离会偏大）。
  const codeDigitTemplates = new Map([...templates].filter(([char]) => char >= '0' && char <= '9'));
  // 计数字实际中位宽：全局 digitW 含代码字母会偏宽，粘连块 k 值估算
  // 必须用计数字自己的宽度（water-box 计数字 4-5px，digitW=6）。
  const countSingleWidths = splits.flatMap(s => s
    ? s.countGlyphs.filter(g => widthOf(g) <= digitW * 1.4).map(widthOf)
    : []);
  const countW = countSingleWidths.length ? median(countSingleWidths) : Math.max(3, Math.round(digitW * 0.75));
  const countTemplates = buildCountTemplates(rawEntries, splits, digitW, codeDigitTemplates);

  // 逐条目识别。
  const parsed = rawEntries.map((entry, index) =>
    recognizeEntry(entry, splits[index], priors[index], resolvedCodes[index], templates, countTemplates, paletteCodes, digitW, countW));

  // 头部交叉校验（用自举的数字模板；解析不出则字段缺省）。
  const digitTemplates = new Map([...templates].filter(([char]) => char >= '0' && char <= '9'));
  const header = parseHeader(source, calibration, digitTemplates);
  if (header.colorCount !== undefined) checks.headerColorCount = header.colorCount;
  if (header.gridCols !== undefined) checks.headerGridCols = header.gridCols;
  if (header.gridRows !== undefined) checks.headerGridRows = header.gridRows;

  // 结果组装：去重标记 + 汇总校验。
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
  checks.codesInPalette = entries.length > 0 && entries.every(entry => entry.code.length > 0 && paletteCodes.has(entry.code));
  checks.codesUnique = new Set(entries.map(entry => entry.code)).size === entries.length;
  checks.sumCount = entries.reduce((sum, entry) => sum + (entry.count > 0 ? entry.count : 0), 0);
  const gridRows = Number.isFinite(options.gridRows) ? Math.max(1, Math.round(options.gridRows!)) : calibration.rows;
  const gridCols = Number.isFinite(options.gridCols) ? Math.max(1, Math.round(options.gridCols!)) : calibration.columns;
  checks.sumWithinGrid = checks.sumCount <= gridRows * gridCols;

  const resolved = entries.some(entry => entry.code.length > 0 && paletteCodes.has(entry.code));
  if (entries.length < MIN_ENTRIES) return failure('tooFewEntries');
  if (!resolved) return failure('templateStarved');
  return { ok: true, entries, checks };
}
