import type { BeadColor } from '../types';
import { deltaE2000, rgbToLab } from './colorUtils';
import type { ImportImagePixels } from './importRecognition';
import type { ImportGridCalibration } from './importGridCalibration';
import { warpOffsetAt } from './importGridWarp';

/**
 * 图纸色号文字识别（symbol OCR，整串匹配架构）。
 *
 * 很多交流用的拼豆图纸（如 MARD 图）会在每个格子里直接印上色号文字
 * （"F24"、"H2"…），文字本身是作者标注的标准答案——比印刷颜色更可靠，
 * 尤其能区分印刷色几乎一样的相近色号（F24/F22、D6/D8）。
 *
 * 架构（v2，整串匹配）：
 * 1. 逐格提取文字掩码与字符域；
 * 2. **字符模板自举**：底色→最近色板色是极可靠的先验（印刷色差 ΔE<10），
 *    取"域数==色号长度"的干净格标注字符实例，按标签聚成保比例模板；
 * 3. **整串匹配**：每格的文字条带（不管内部怎么粘连/断裂）与
 *    "底色先验 top-K 候选色号"用模板+实测字距拼出的整串位图比对，
 *    取 Jaccard 最高者。粘连的 "D6" 与模板拼的 "D6" 整体形状一致，
 *    容忍切分误差，且串间区分度（D6 vs D8 差在右半）远高于单字符。
 * 4. 色板约束：胜出串必须是色板里的 code。
 */

/** 模板/条带的归一化高度（px）。 */
const GLYPH_H = 16;
/** 与底色的最小对比（RGB 欧氏距离）：低于此视为底色的一部分。 */
const TEXT_CONTRAST = 60;
/** 浅底低对比重试阈值（见 analyzeCells 注释）：白字浅灰底实测对比 ~25-40。 */
const TEXT_CONTRAST_RETRY = 34;
/** 文字像素占格子中央区的比例上下限。 */
const TEXT_RATIO_MIN = 0.02;
const TEXT_RATIO_MAX = 0.5;
/** 连通域过滤：面积太小是 JPEG 噪点/虚线段，太大是水印或底色碎片。 */
const COMPONENT_MIN_AREA = 6;
const COMPONENT_MAX_AREA_RATIO = 0.55;
/** 字符高度下限（相对格子中央区高度）：图纸色号字高约 1/3 格。 */
const GLYPH_MIN_HEIGHT_RATIO = 0.12;
/** 底色标注的色板距离上限：印刷色差通常 <6，放宽到 10。 */
const PRIOR_MAX_DELTA_E = 10;
/** 整串匹配的接受阈值（Jaccard 距离）。 */
const STRING_MAX_DISTANCE = 0.55;
/** 胜出候选需要领先次优的差距（同色系相近色号防抖）。 */
const STRING_WIN_MARGIN = 0.015;
/**
 * 全局一致性（2026-11-22 僵尸图）：同一色号在整张图里印刷几百次且像素
 * 几乎相同（数字图纸，非照片），而单格 4-5px 小字的整串匹配错误率可观。
 * 按底色分组后群体投票：①个体 margin 弱的误读被群体翻案；②因
 * lowScore/margin 落选的格子用群体共识补全（图例"识别不出来"的主诉）。
 * 底色 32 级量化实测簇内 100% 纯（印刷色差远小于量化步长）。
 */
const GROUP_CONSENSUS_RATIO = 0.6;
/** 个体读数被群体翻案的 margin 上限：强读数（证据充分）不翻。 */
const GROUP_FLIP_MARGIN = 0.06;
/**
 * 底色先验在最终评分里的权重（0..1 的归一化色分 × 该权重，加到形状分上）。
 * 小字号印刷文字的形状分对 9/8、6/5、2/1 这类近邻字形几乎无区分度
 * （实测妲己图：错读格里 D9/D8 形状分只差 0.005，而正确候选 90%+ 就在 top3）；
 * 底色是整块印刷色，ΔE 0.3~1.6 vs 错误候选 6.6~14，区分度高出两个数量级。
 * 权重 0.3 经妲己图网格搜索：可翻转全部数字混淆对，又不压过真字形证据。
 */
const COLOR_PRIOR_WEIGHT = 0.3;
/**
 * 组内形状选举（2026-11-22 僵尸图 H2→H9）：印刷色与色板参考色存在系统
 * 偏差时，底色先验会把整组带偏——白豆 H2 的印刷白实测更接近 H9 参考
 * （ΔE 0.6~1.2 vs 4.3~4.8），0.3 先验加成（~0.105）压过形状优势（~0.046），
 * 106 格集体读成 H9，而纯形状两两对决 H2 胜率 92:41。
 * 选举：同底色组内，挑战者码对现冠军码做纯形状两两对决（|shape 差|≥
 * PAIR_VOTE_SHAPE_MARGIN 记一票），票数 ≥ ELECTION_MIN_VOTES 且胜率
 * ≥ ELECTION_WIN_RATIO 才翻——只在「色距合理」（中位 ΔE ≤ PRIOR_MAX）
 * 的码之间进行，避免形状噪声翻转真异色。
 */
const PAIR_VOTE_SHAPE_MARGIN = 0.02;
const ELECTION_MIN_VOTES = 8;
const ELECTION_WIN_RATIO = 0.62;
/** 族单一印刷门：最大底色簇覆盖率低于此值视为混色族，选举不参与。 */
const FAMILY_PRIOR_UNIFORMITY = 0.85;
/**
 * 印刷质量门：族冠军读数平均形状分（1-Jaccard）上限。超过说明印刷
 * 文字发糊/模板失配，族级形状对决不可信，consensus 不背书。
 * 实测数字印刷图 0.52~0.61、照片翻拍图 0.67+，阈值 0.65 分开两群。
 */
const CONSENSUS_MAX_MEAN_SHAPE = 0.65;

/** 保比例位图：宽 x 高的 0/1 图。 */
interface Bitmap {
  data: Uint8Array;
  w: number;
  h: number;
}

export interface SymbolCellResult {
  code: string;
  /** 整串匹配置信度 0..1（1-Jaccard）。 */
  score: number;
  /** 底色先验给的色号（诊断用）。 */
  prior: string;
  /** 联合分（形状+底先验）领先次优的差距；差距大说明该读数证据充分。 */
  margin: number;
  /** 纯形状领先度（胜者形状分 − 其余候选最大形状分），字形独信置信度。 */
  shapeMargin: number;
  /**
   * 族选举背书：该读数与同底色色族的形状选举冠军一致（或被其翻案），
   * 背后有全族纯形状两两对决的决定性证据。下游冲突仲裁时，
   * consensus 读数可推翻颜色判定，个体读数仍然信颜色。
   */
  consensus?: boolean;
}

export interface SymbolExtractResult {
  /** "row:column" -> 识别结果（仅色板可查到的格子）。 */
  codes: Map<string, SymbolCellResult>;
  /** 检出文字的格子数。 */
  textCellCount: number;
  /** 成功解析到色板的格子数。 */
  resolvedCount: number;
  /** 有文字但没能解析成色板色号的格子数。 */
  unresolvedCount: number;
  /** 自举模板的字符种类数（诊断用）。 */
  templateLabels: number;
  /** 模板覆盖的字符（诊断用）。 */
  labelChars?: string;
  /** 未解析原因分布（诊断用）：noGlyph=缺模板字符, lowScore=分数低, margin=领先不足。 */
  unresolvedReasons?: Record<string, number>;
  /** "row:column" -> 排除文字/水印后的底色中位数（供下游重估采样色）。 */
  refinedBases?: Map<string, [number, number, number]>;
  /** 判定为"纸底空格"的格子（"row:column"）——底色接近全图主底色且无文字。 */
  blankCells: Set<string>;
}

interface CellText {
  row: number;
  column: number;
  baseRgb: [number, number, number];
  /** 掩码外像素中位数（排除文字/水印后的底色）；掩码吃掉 >65% 时缺省。 */
  refinedBase?: [number, number, number];
  /** 本格文字是浅底低对比重试检出的（真文字或水印缎带，需解析成功才可信）。 */
  retryUsed?: boolean;
  /** 文字条带位图（所有保留域并集，高度归一 GLYPH_H，保比例）。 */
  band: Bitmap;
  /** 逐域位图（保比例），x 排序——供模板标注。 */
  glyphs: Bitmap[];
  /** 保留域的原始 bbox 列表（x 排序），用于统计字距。 */
  boxes: Array<{ x0: number; x1: number; y0: number; y1: number }>;
  /** 域数。 */
  partCount: number;
}

const rgbDist2 = (a: [number, number, number], b: [number, number, number]) => {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
};

/** 中央区内的底色：RGB 高 4 位量化取众数桶，再取桶内均值。 */
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

interface RawComponent {
  pixels: Array<[number, number]>; // 相对 region 的坐标
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

/** 保比例缩放：mask 的 bbox 区域缩放到高 GLYPH_H、宽按比例。 */
function normalizeBand(mask: Uint8Array, w: number, comp: RawComponent): Bitmap {
  const bw = comp.maxX - comp.minX + 1;
  const bh = comp.maxY - comp.minY + 1;
  const outW = Math.max(2, Math.min(48, Math.round((bw * GLYPH_H) / bh)));
  const data = new Uint8Array(outW * GLYPH_H);
  for (let gy = 0; gy < GLYPH_H; gy += 1) {
    const sy = comp.minY + Math.floor((gy * bh) / GLYPH_H);
    for (let gx = 0; gx < outW; gx += 1) {
      const sx = comp.minX + Math.floor((gx * bw) / outW);
      data[gy * outW + gx] = mask[sy * w + sx] ? 1 : 0;
    }
  }
  return { data, w: outW, h: GLYPH_H };
}

const bitmapJaccard = (a: Bitmap, b: Bitmap) => {
  const w = Math.max(a.w, b.w);
  let inter = 0, union = 0;
  for (let y = 0; y < GLYPH_H; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const av = x < a.w ? a.data[y * a.w + x] : 0;
      const bv = x < b.w ? b.data[y * b.w + x] : 0;
      if (av && bv) inter += 1;
      if (av || bv) union += 1;
    }
  }
  return union === 0 ? 1 : 1 - inter / union;
};

/** 候选串位图：字符模板按实测字距水平拼接。 */
function composeString(
  code: string,
  templates: Map<string, Bitmap>,
  gap: number,
): Bitmap | null {
  const glyphs: Bitmap[] = [];
  for (const ch of code) {
    const t = templates.get(ch);
    if (!t) return null;
    glyphs.push(t);
  }
  const totalW = glyphs.reduce((s, g) => s + g.w, 0) + gap * (glyphs.length - 1);
  const data = new Uint8Array(totalW * GLYPH_H);
  let x = 0;
  for (const g of glyphs) {
    for (let gy = 0; gy < GLYPH_H; gy += 1) {
      for (let gx = 0; gx < g.w; gx += 1) data[gy * totalW + x + gx] = g.data[gy * g.w + gx];
    }
    x += g.w + gap;
  }
  return { data, w: totalW, h: GLYPH_H };
}

/** 阶段 1：逐格提取文字条带。（导出供实验/调试脚本复用） */
export function analyzeCells(
  source: ImportImagePixels, calibration: ImportGridCalibration,
): { cells: CellText[]; totalCells: number; plainBases: Map<string, [number, number, number]> } {
  const { data, width } = source;
  const cells: CellText[] = [];
  const plainBases = new Map<string, [number, number, number]>();
  let totalCells = 0;
  for (let row = 0; row < calibration.rows; row += 1) {
    for (let column = 0; column < calibration.columns; column += 1) {
      // 分区相位场：本格中心的透视偏移（无 warp 时为 0）
      const warpOff = calibration.warp
        ? warpOffsetAt(calibration.warp,
          calibration.originX + (column + 0.5) * calibration.cellWidth,
          calibration.originY + (row + 0.5) * calibration.cellHeight)
        : { dx: 0, dy: 0 };
      const x0 = Math.round(column * calibration.cellWidth + calibration.originX + warpOff.dx);
      const y0 = Math.round(row * calibration.cellHeight + calibration.originY + warpOff.dy);
      const rx0 = Math.max(0, x0 + Math.round(calibration.cellWidth * 0.14));
      const ry0 = Math.max(0, y0 + Math.round(calibration.cellHeight * 0.14));
      const rx1 = Math.min(source.width, x0 + Math.round(calibration.cellWidth * 0.86));
      const ry1 = Math.min(source.height, y0 + Math.round(calibration.cellHeight * 0.86));
      const rw = rx1 - rx0, rh = ry1 - ry0;
      if (rw < 8 || rh < 8) continue;
      totalCells += 1;
      const baseRgb = dominantBaseColor(data, width, rx0, ry0, rx1, ry1);
      const buildMask = (contrast: number) => {
        const m = new Uint8Array(rw * rh);
        let count = 0;
        const c2 = contrast * contrast;
        for (let y = ry0; y < ry1; y += 1) {
          for (let x = rx0; x < rx1; x += 1) {
            const i = (y * width + x) * 4;
            if (rgbDist2([data[i], data[i + 1], data[i + 2]], baseRgb) > c2) {
              m[(y - ry0) * rw + (x - rx0)] = 1;
              count += 1;
            }
          }
        }
        return { m, count };
      };
      let { m: mask, count: on } = buildMask(TEXT_CONTRAST);
      let ratio = on / (rw * rh);
      let retryUsed = false;
      // 浅底低对比重试：白字印在浅灰底上（H3 式）时墨水-底色对比只有
      // ~25-40（12.8px 格 + JPEG 扩散），TEXT_CONTRAST=60 全部漏检 →
      // 整族 OCR 盲 → 颜色分类被水印/文字带偏无人纠正。底色偏亮且主
      // 掩码没找到文字时，用低对比阈值重试一次。
      if ((ratio < TEXT_RATIO_MIN || ratio > TEXT_RATIO_MAX)
        && baseRgb[0] + baseRgb[1] + baseRgb[2] > 3 * 170) {
        const retry = buildMask(TEXT_CONTRAST_RETRY);
        const retryRatio = retry.count / (rw * rh);
        if (retryRatio >= TEXT_RATIO_MIN && retryRatio <= TEXT_RATIO_MAX) {
          mask = retry.m;
          on = retry.count;
          ratio = retryRatio;
          retryUsed = true;
        }
      }
      if (ratio < TEXT_RATIO_MIN || ratio > TEXT_RATIO_MAX) {
        plainBases.set(`${row}:${column}`, baseRgb);
        continue;
      }
      const comps = connectedComponents(mask, rw, rh);
      const kept = comps.filter((c) => {
        const area = c.pixels.length;
        const cw = c.maxX - c.minX + 1, ch = c.maxY - c.minY + 1;
        if (area < COMPONENT_MIN_AREA) return false;
        if (area > rw * rh * COMPONENT_MAX_AREA_RATIO) return false;
        if (ch < rh * GLYPH_MIN_HEIGHT_RATIO) return false;
        if (cw > rw * 0.8) return false;
        return true;
      });
      if (!kept.length || kept.length > 4) continue;
      // refinedBase：掩码外像素的主色 bin 均值——排除文字（和斜穿格子的
      // 白色水印缎带）后的真实底色。整格面积平均会被文字像素拖偏
      // （白豆 H2 深字把采样从 250 拖到 234 → 贴到 H9）；中位数仍会被
      // 文字抗锯齿边缘拖偏（边缘像素占未掩码的 20-40% 且单向偏离），
      // 众数对两者都免疫：背景像素集中在单一 bin，边缘像素散在多个 bin。
      // 掩码吃掉过多时不可信，放弃。
      let refinedBase: [number, number, number] | undefined;
      {
        const unmasked = rw * rh - on;
        if (unmasked >= rw * rh * 0.35) {
          const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
          for (let y = ry0; y < ry1; y += 1) {
            for (let x = rx0; x < rx1; x += 1) {
              if (mask[(y - ry0) * rw + (x - rx0)]) continue;
              const i = (y * width + x) * 4;
              const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
              const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
              bin.n += 1; bin.r += data[i]; bin.g += data[i + 1]; bin.b += data[i + 2];
              bins.set(key, bin);
            }
          }
          let best: { n: number; r: number; g: number; b: number } | null = null;
          for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin;
          if (best && best.n >= unmasked * 0.5) {
            refinedBase = [best.r / best.n, best.g / best.n, best.b / best.n];
          }
        }
      }
      kept.sort((a, b) => a.minX - b.minX);
      // 条带 = 全部保留域的外接框（不管内部粘连/断裂）
      const bandBox: RawComponent = {
        pixels: kept.flatMap((c) => c.pixels),
        minX: Math.min(...kept.map((c) => c.minX)),
        maxX: Math.max(...kept.map((c) => c.maxX)),
        minY: Math.min(...kept.map((c) => c.minY)),
        maxY: Math.max(...kept.map((c) => c.maxY)),
      };
      cells.push({
        row, column, baseRgb, refinedBase, retryUsed,
        band: normalizeBand(mask, rw, bandBox),
        glyphs: kept.map((c) => normalizeBand(mask, rw, c)),
        boxes: kept.map((c) => ({ x0: c.minX, x1: c.maxX, y0: c.minY, y1: c.maxY })),
        partCount: kept.length,
      });
    }
  }
  return { cells, totalCells, plainBases };
}

/** 阶段 2：底色先验 + 干净格标注 → 字符模板（保比例）与实测字距。 */
function buildTemplates(
  cells: CellText[],
  palette: BeadColor[],
): { templates: Map<string, Bitmap>; gap: number } {
  const prepared = palette.map((color) => ({ color, lab: rgbToLab(...color.rgb) }));
  // 候选字距：2+ 域格子的相邻域间隙
  const gaps: number[] = [];
  for (const cell of cells) {
    for (let i = 1; i < cell.boxes.length; i += 1) {
      gaps.push(cell.boxes[i].x0 - cell.boxes[i - 1].x1 - 1);
    }
  }
  gaps.sort((a, b) => a - b);
  const gap = gaps.length ? Math.max(1, Math.min(4, gaps[Math.floor(gaps.length / 2)])) : 1;
  // 字符模板：从"域数==色号长度"的干净格标注（底色先验 + 长度一致双约束）
  const labeled = collectLabeledGlyphs(cells, palette);
  const templates = new Map<string, Bitmap>();
  for (const [label, glyphs] of labeled) {
    if (glyphs.length < 2) continue; // 单样本标签不建模板（可能是污染）
    const widths = glyphs.map((g) => g.w).sort((a, b) => a - b);
    const targetW = widths[Math.floor(widths.length / 2)];
    const acc = new Float32Array(targetW * GLYPH_H);
    for (const g of glyphs) {
      // 逐实例拉伸到 (targetW, GLYPH_H)
      for (let gy = 0; gy < GLYPH_H; gy += 1) {
        const sy = Math.floor((gy * g.h) / GLYPH_H);
        for (let gx = 0; gx < targetW; gx += 1) {
          const sx = Math.floor((gx * g.w) / targetW);
          acc[gy * targetW + gx] += g.data[sy * g.w + sx];
        }
      }
    }
    const data = new Uint8Array(targetW * GLYPH_H);
    for (let i = 0; i < data.length; i += 1) data[i] = acc[i] / glyphs.length > 0.4 ? 1 : 0;
    templates.set(label, { data, w: targetW, h: GLYPH_H });
  }
  return { templates, gap };
}

/** 从干净标注格收集 (label → 保比例字形位图)。 */
function collectLabeledGlyphs(
  cells: CellText[],
  palette: BeadColor[],
): Map<string, Bitmap[]> {
  const prepared = palette.map((color) => ({ color, lab: rgbToLab(...color.rgb) }));
  const out = new Map<string, Bitmap[]>();
  for (const cell of cells) {
    const baseLab = rgbToLab(...cell.baseRgb);
    let best: { color: BeadColor; distance: number } | null = null;
    for (const p of prepared) {
      const d = deltaE2000(baseLab, p.lab);
      if (!best || d < best.distance) best = { color: p.color, distance: d };
    }
    if (!best || best.distance > PRIOR_MAX_DELTA_E) continue;
    const code = best.color.code;
    if (code.length !== cell.partCount) continue;
    for (let i = 0; i < code.length; i += 1) {
      const list = out.get(code[i]) ?? [];
      list.push(cell.glyphs[i]);
      out.set(code[i], list);
    }
  }
  return out;
}

/** 阶段 3：整串匹配——条带 vs 先验候选串。 */
function recognizeAll(
  cells: CellText[],
  templates: Map<string, Bitmap>,
  gap: number,
  palette: BeadColor[],
): { codes: Map<string, SymbolCellResult>; unresolved: number; reasons: Record<string, number> } {
  const prepared = palette.map((color) => ({ color, lab: rgbToLab(...color.rgb) }));
  const codeSet = new Map(palette.map((c) => [c.code, c]));
  const cache = new Map<string, Bitmap | null>();
  const compose = (code: string) => {
    if (!cache.has(code)) cache.set(code, composeString(code, templates, gap));
    return cache.get(code)!;
  };
  const codes = new Map<string, SymbolCellResult>();
  let unresolved = 0;
  const reasons: Record<string, number> = {};
  const bump = (k: string) => { reasons[k] = (reasons[k] ?? 0) + 1; };
  // 逐格读数记录（供全局一致性投票；key=底色 32 级量化）。
  const records: Array<{
    cell: CellText; key: string; code: string | null;
    score: number; margin: number; composable: boolean;
    /** 底色最近色板码（先验）：族先验一致性检测用。 */
    priorCode: string;
    scored: Array<{ code: string; shape: number; de: number }>;
  }> = [];
  const quantKey = (c: [number, number, number]) => `${c[0] >> 5},${c[1] >> 5},${c[2] >> 5}`;
  for (const cell of cells) {
    const baseLab = rgbToLab(...cell.baseRgb);
    // 候选：底色 ΔE 排序的 top-K 色号
    const cands = prepared
      .map((p) => ({ code: p.color.code, d: deltaE2000(baseLab, p.lab) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
    // 联合评分：形状（整串 Jaccard）+ 底色先验（归一化）。底色是整块印刷色，
    // 比小字字形的区分度高两个数量级，只靠形状会系统性读错近邻数字（9/8、6/5）。
    const scored: Array<{ code: string; shape: number; combined: number; de: number }> = [];
    let composable = 0;
    for (const c of cands) {
      if (!codeSet.has(c.code)) continue;
      const tpl = compose(c.code);
      if (!tpl) continue;
      composable += 1;
      const shape = 1 - bitmapJaccard(cell.band, tpl);
      scored.push({ code: c.code, shape, combined: shape + COLOR_PRIOR_WEIGHT * Math.max(0, 1 - c.d / PRIOR_MAX_DELTA_E), de: c.d });
    }
    scored.sort((a, b) => b.combined - a.combined);
    const top = scored[0] ?? null;
    const bestCode = top?.code ?? null;
    const bestShape = top?.shape ?? 0;
    const bestCombined = top?.combined ?? 0;
    const secondCombined = scored[1]?.combined ?? 0;
    // 其余候选的最大纯形状分：形状证据是否"一枝独秀"要用它来量——
    // 联合 margin 混着底色证据（与颜色判定共享同一来源），不能当字形置信度。
    const otherBestShape = scored.slice(1).reduce((m, s) => Math.max(m, s.shape), 0);
    const shapeMargin = bestShape - otherBestShape;
    // 形状太差仍然拒绝（底色加成不能把"完全不像"救回来），
    // 防抖 margin 看联合分——先验差距本身就是置信度的一部分。
    if (!bestCode || bestShape < 1 - STRING_MAX_DISTANCE || bestCombined - secondCombined < STRING_WIN_MARGIN) {
      unresolved += 1;
      if (!composable) bump('noGlyph');
      else if (bestCode && bestShape < 1 - STRING_MAX_DISTANCE) bump('lowScore');
      else bump('margin');
      records.push({ cell, key: quantKey(cell.baseRgb), code: null, score: 0, margin: 0, composable: composable > 0, priorCode: cands[0]?.code ?? '', scored });
      continue;
    }
    records.push({ cell, key: quantKey(cell.baseRgb), code: bestCode, score: bestShape, margin: bestCombined - secondCombined, composable: true, priorCode: cands[0]?.code ?? '', scored });
    codes.set(`${cell.row}:${cell.column}`, { code: bestCode, score: bestShape, prior: cands[0]?.code ?? '', margin: bestCombined - secondCombined, shapeMargin });
  }
  // ---- 全局一致性投票：同底色分组，群体共识翻案弱个体 + 补全落选格 ----
  const groups = new Map<string, typeof records>();
  for (const rec of records) {
    const list = groups.get(rec.key) ?? [];
    list.push(rec);
    groups.set(rec.key, list);
  }
  // ---- 色族形状选举：底色先验可能被印刷偏差带偏（僵尸图白豆 H2 的印刷白
  // 更近 H9 参考 ΔE 0.6~1.2 vs 4.3~4.8，整组集体读错；纯形状对决 H2 92:41）。
  // 32 级量化会把一族拆成小桶、票数凑不够门槛——选举在 ΔE 相邻桶合并的
  // "色族"级做纯形状两两对决；桶级共识翻案保持独立（真异色共存图里
  // 两族各 50% 时选举不过门槛、桶级也各翻各的，互不伤害）。
  const FAMILY_MERGE_DELTA_E = 4;
  const families: Array<typeof records> = [];
  const famMean: Array<[number, number, number]> = [];
  const bucketKeys = [...groups.keys()].sort((a, b) => groups.get(b)!.length - groups.get(a)!.length);
  for (const key of bucketKeys) {
    const members = groups.get(key)!;
    const n = members.length;
    const mean: [number, number, number] = [
      members.reduce((s, m) => s + m.cell.baseRgb[0], 0) / n,
      members.reduce((s, m) => s + m.cell.baseRgb[1], 0) / n,
      members.reduce((s, m) => s + m.cell.baseRgb[2], 0) / n,
    ];
    const meanLab = rgbToLab(...mean);
    let famIdx = families.findIndex((_, i) => deltaE2000(meanLab, rgbToLab(...famMean[i])) <= FAMILY_MERGE_DELTA_E);
    if (famIdx < 0) {
      families.push([]);
      famMean.push(mean);
      famIdx = families.length - 1;
    }
    families[famIdx].push(...members);
  }
  const flipToWinner = (members: typeof records, winner: string, elected: boolean) => {
    const resolvedLocal = members.filter((m) => m.code);
    const meanScore = resolvedLocal.length
      ? resolvedLocal.reduce((s, m) => s + m.score, 0) / resolvedLocal.length
      : 0;
    for (const m of members) {
      const key = `${m.cell.row}:${m.cell.column}`;
      if (m.code === winner) continue;
      // 选举翻案后豁免强 dissent 保护：个体的"强 margin"恰恰来自被印刷
      // 偏差带偏的底色先验（确定性偏置），不是独立证据。
      if (m.code && m.margin >= GROUP_FLIP_MARGIN && !elected) continue;
      if (!m.code && !m.composable) continue; // 无候选的格子（非文字噪声）不补
      if (!m.code) unresolved -= 1;
      m.code = winner;
      m.score = m.code && codes.get(key) ? codes.get(key)!.score : meanScore;
      codes.set(key, {
        code: winner,
        score: m.score,
        prior: '',
        margin: m.code && codes.get(key) ? codes.get(key)!.margin : 0.02,
        shapeMargin: 0,
      });
    }
  };
  const runElection = (members: typeof records) => {
    if (members.length < 5) return null;
    const resolved = members.filter((m) => m.code);
    if (resolved.length < 2) return null;
    const weights = new Map<string, number>();
    for (const m of resolved) weights.set(m.code!, (weights.get(m.code!) ?? 0) + m.score + m.margin + 0.5);
    const sorted = [...weights.entries()].sort((a, b) => b[1] - a[1]);
    const winner = sorted[0][0];
    const median = (arr: number[]) => {
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)] ?? NaN;
    };
    const desByCode = new Map<string, number[]>();
    for (const m of members) {
      for (const s of m.scored) {
        const list = desByCode.get(s.code) ?? [];
        list.push(s.de);
        desByCode.set(s.code, list);
      }
    }
    const decide = (a: string, b: string) => {
      let va = 0, vb = 0;
      if (a.length !== b.length) return [0, 0] as const; // 长度不同=分段伪证据，不对决
      for (const m of members) {
        const sa = m.scored.find((s) => s.code === a);
        const sb = m.scored.find((s) => s.code === b);
        if (!sa || !sb) continue;
        if (sa.shape - sb.shape >= PAIR_VOTE_SHAPE_MARGIN) va += 1;
        else if (sb.shape - sa.shape >= PAIR_VOTE_SHAPE_MARGIN) vb += 1;
      }
      return [va, vb] as const;
    };
    let challenger: string | null = null;
    let bestRatio = 0;
    for (const [cand, des] of desByCode) {
      if (cand === winner) continue;
      if (!(median(des) <= PRIOR_MAX_DELTA_E)) continue;
      const [vc, vw] = decide(cand, winner);
      if (vc < Math.max(ELECTION_MIN_VOTES, Math.floor(members.length * 0.25))) continue;
      const ratio = vc / (vc + vw);
      if (ratio >= ELECTION_WIN_RATIO && ratio > bestRatio) {
        bestRatio = ratio;
        challenger = cand;
      }
    }
    return { winner, decide, totalWeight: sorted[0][1] / sorted.reduce((s, [, w]) => s + w, 0) };
  };
  for (const members of families) {
    if (members.length < 5) continue;
    const election = runElection(members);
    if (!election) continue;
    const { winner, decide } = election;
    // 印刷质量门：consensus 授权下游推翻颜色判定，前提是本族的印刷
    // 文字质量足以让形状证据可信。族内冠军码读数的平均形状分（=1-
    // Jaccard，越低越像）超过门槛说明整族文字发糊/模板失配——此时
    // 族级"决定性对决"可能是模板伪证据（妲己照片图 meanShape 0.67+，
    // 决定性但错误；数字印刷图 0.52~0.61，决定性且正确）。
    const wreads = members.filter((m) => m.code === winner);
    const meanShape = wreads.length ? wreads.reduce((s2, m) => s2 + m.score, 0) / wreads.length : 1;
    if (meanShape > CONSENSUS_MAX_MEAN_SHAPE) continue;
    if (process.env.SYM_DEBUG) {
      const wPrior = members.filter((m) => m.priorCode === winner).length;
      console.error(`[family] n=${members.length} winner=${winner} wReads=${wreads.length} meanShape=${meanShape.toFixed(3)} priorAgree=${wPrior}/${members.length}`);
    }
    if (process.env.SYM_DEBUG) {
      // 族紧度：桶均值两两 ΔE2000 最大值（单峰印刷族 < 3，混色族更大）
      const means: Array<[number, number, number]> = [];
      const seen = new Set<string>();
      for (const m of members) {
        const k = m.key;
        if (seen.has(k)) continue;
        seen.add(k);
        const ms = groups.get(k)!;
        const n = ms.length;
        means.push([
          ms.reduce((s, x) => s + x.cell.baseRgb[0], 0) / n,
          ms.reduce((s, x) => s + x.cell.baseRgb[1], 0) / n,
          ms.reduce((s, x) => s + x.cell.baseRgb[2], 0) / n,
        ]);
      }
      let spread = 0;
      for (let i = 0; i < means.length; i++) for (let j = i + 1; j < means.length; j++) {
        spread = Math.max(spread, deltaE2000(rgbToLab(...means[i]), rgbToLab(...means[j])));
      }
      console.error(`[family] n=${members.length} winner=${winner} buckets=${means.length} spread=${spread.toFixed(1)}`);
    }
    // 族冠军确立后逐成员对质：仅当冠军对该成员码的形状对决是决定性
    // （票数/胜率达标）才翻——真异色共存图（两码印刷色差 < 合并阈值）
    // 对决五五开，自动不动手。
    const meanScore = (() => {
      const rs = members.filter((m) => m.code);
      return rs.length ? rs.reduce((s, m) => s + m.score, 0) / rs.length : 0;
    })();
    const minVotes = Math.max(6, Math.floor(members.length * 0.1));
    for (const m of members) {
      const key = `${m.cell.row}:${m.cell.column}`;
      if (m.code === winner) {
        // 冠军码 = 族选举背书：个体读数与全族决定性证据一致。但 consensus
        // 会授权下游推翻颜色判定，所以要求冠军对该格的最近色先验码
        // （颜色判定的代理）也赢下决定性对决——混色族里多数派码对
        // 异码先验成员的伪证据在这里被拦下（妲己 M4→G1）。
        const prev = codes.get(key);
        if (prev && !prev.consensus) {
          if (m.priorCode === winner) {
            codes.set(key, { ...prev, consensus: true });
          } else if (m.priorCode) {
            const [vw, vc] = decide(winner, m.priorCode);
            const decided = vw + vc;
            if (decided > 0 && vw >= minVotes && vw / decided >= ELECTION_WIN_RATIO) {
              codes.set(key, { ...prev, consensus: true });
            }
          }
        }
        continue;
      }
      if (!m.code && !m.composable) continue; // 无候选的格子（非文字噪声）不补
      if (m.code) {
        const [vw, vc] = decide(winner, m.code);
        const decided = vw + vc;
        if (decided === 0 || vw < minVotes || vw / decided < ELECTION_WIN_RATIO) continue;
      } else {
        unresolved -= 1;
      }
      m.code = winner;
      m.score = m.code && codes.get(key) ? codes.get(key)!.score : meanScore;
      codes.set(key, {
        code: winner,
        score: m.score,
        prior: '',
        margin: m.code && codes.get(key) ? codes.get(key)!.margin : 0.02,
        shapeMargin: 0,
        consensus: true,
      });
    }
  }
  // ---- 桶级共识：补全落选格 + 翻案弱个体（强 dissent 保留）----
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const resolved = members.filter((m) => m.code);
    if (resolved.length < 2) continue;
    const weights = new Map<string, number>();
    for (const m of resolved) weights.set(m.code!, (weights.get(m.code!) ?? 0) + m.score + m.margin + 0.5);
    const sorted = [...weights.entries()].sort((a, b) => b[1] - a[1]);
    const totalWeight = sorted.reduce((s, [, w]) => s + w, 0);
    const [winner] = sorted[0];
    if (totalWeight > 0 && sorted[0][1] / totalWeight < GROUP_CONSENSUS_RATIO) continue;
    flipToWinner(members, winner, false);
  }
  return { codes, unresolved, reasons };
}

/**
 * 诊断：逐格候选打分明细（模板质量分析用，不参与业务识别）。
 * 返回每个文字格的 top6 候选（色板底色 ΔE + 形状分）、胜者与次优，
 * 用于回答"D9 为什么读成 D1"这类字形混淆问题。
 */
export interface SymbolDiagnosis {
  row: number;
  column: number;
  baseRgb: [number, number, number];
  bandWidth: number;
  partCount: number;
  /** 底色先验色号与 ΔE。 */
  prior: string;
  priorDE: number;
  /** top6 候选：code / 底色ΔE / 形状分（1-Jaccard，越高越像）。 */
  candidates: Array<{ code: string; colorDE: number; shape: number }>;
  best: string | null;
  bestShape: number;
  second: string | null;
  secondShape: number;
  /** 联合分（形状 + 底色先验加权），与 recognizeAll 的选择一致。 */
  bestCombined: number;
  /** 联合分领先次优的差距（>0 才会被 recognizeAll 接受）。 */
  margin: number;
}

export function diagnoseSymbols(
  source: ImportImagePixels,
  calibration: ImportGridCalibration,
  palette: BeadColor[],
): { items: SymbolDiagnosis[]; templates: Map<string, Bitmap>; gap: number; textCells: number } {
  const { cells } = analyzeCells(source, calibration);
  if (!cells.length) return { items: [], templates: new Map(), gap: 1, textCells: 0 };
  const { templates, gap } = buildTemplates(cells, palette);
  const prepared = palette.map((color) => ({ color, lab: rgbToLab(...color.rgb) }));
  const codeSet = new Map(palette.map((c) => [c.code, c]));
  const cache = new Map<string, Bitmap | null>();
  const compose = (code: string) => {
    if (!cache.has(code)) cache.set(code, composeString(code, templates, gap));
    return cache.get(code)!;
  };
  const items: SymbolDiagnosis[] = [];
  for (const cell of cells) {
    const baseLab = rgbToLab(...cell.baseRgb);
    const ranked = prepared
      .map((p) => ({ code: p.color.code, d: deltaE2000(baseLab, p.lab) }))
      .sort((a, b) => a.d - b.d);
    const cands = ranked.slice(0, 6);
    const list: SymbolDiagnosis['candidates'] = [];
    let best: string | null = null, bestShape = 0, bestCombined = 0, second: string | null = null, secondShape = 0, secondCombined = 0;
    for (const c of cands) {
      if (!codeSet.has(c.code)) continue;
      const tpl = compose(c.code);
      if (!tpl) continue;
      const shape = 1 - bitmapJaccard(cell.band, tpl);
      const combined = shape + COLOR_PRIOR_WEIGHT * Math.max(0, 1 - c.d / PRIOR_MAX_DELTA_E);
      list.push({ code: c.code, colorDE: c.d, shape });
      if (combined > bestCombined) {
        second = best; secondShape = bestShape; secondCombined = bestCombined;
        best = c.code; bestShape = shape; bestCombined = combined;
      } else if (combined > secondCombined) { second = c.code; secondShape = shape; secondCombined = combined; }
    }
    items.push({
      row: cell.row, column: cell.column,
      baseRgb: cell.baseRgb, bandWidth: cell.band.w, partCount: cell.partCount,
      prior: ranked[0]?.code ?? '', priorDE: ranked[0]?.d ?? NaN,
      candidates: list, best, bestShape, second, secondShape,
      bestCombined, margin: bestCombined - secondCombined,
    });
  }
  return { items, templates, gap, textCells: cells.length };
}

/**
 * 入口：从图纸里提取每格色号。
 * 色号必须能在 palette 中查到（code 精确匹配）才算解析成功。
 */
export function extractBeadSymbols(
  source: ImportImagePixels,
  calibration: ImportGridCalibration,
  palette: BeadColor[],
): SymbolExtractResult {
  const { cells, plainBases } = analyzeCells(source, calibration);
  const result: SymbolExtractResult = {
    codes: new Map(),
    textCellCount: cells.length,
    resolvedCount: 0,
    unresolvedCount: 0,
    templateLabels: 0,
    blankCells: new Set(),
  };
  // 纸底空格：无文字格的底色众数里，出现最多的那一色就是"纸底"
  // （图纸留白）。底色与纸底几乎一致的格子判为空格（不放豆）。
  let paperLab: ReturnType<typeof rgbToLab> | null = null;
  if (plainBases.size) {
    const baseKey = (c: [number, number, number]) => `${c[0] >> 4},${c[1] >> 4},${c[2] >> 4}`;
    const freq = new Map<string, number>();
    for (const base of plainBases.values()) {
      const k = baseKey(base);
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
    let paperKey = '', paperCount = 0;
    for (const [k, n] of freq) if (n > paperCount) { paperCount = n; paperKey = k; }
    const paper = [...plainBases.values()].find((c) => baseKey(c) === paperKey)!;
    paperLab = rgbToLab(...paper);
    for (const [key, base] of plainBases) {
      if (deltaE2000(rgbToLab(...base), paperLab) < 8) result.blankCells.add(key);
    }
  }
  if (!cells.length) return result;
  const { templates, gap } = buildTemplates(cells, palette);
  result.templateLabels = templates.size;
  result.labelChars = [...templates.keys()].sort().join("");
  if (templates.size < 2) return result;
  const { codes, unresolved, reasons } = recognizeAll(cells, templates, gap, palette);
  result.unresolvedReasons = reasons;
  result.codes = codes;
  result.resolvedCount = codes.size;
  result.unresolvedCount = unresolved;
  // 浅底低对比重试检出的"文字"可能是斜穿空白格的水印缎带——解析失败
  // 且底色贴纸底的格子回落为 blank（否则逃过纸底判定，被颜色分类成
  // 浅色豆虚增映射数）。
  if (paperLab) {
    for (const cell of cells) {
      if (!cell.retryUsed || result.codes.has(`${cell.row}:${cell.column}`)) continue;
      if (deltaE2000(rgbToLab(...cell.baseRgb), paperLab) < 8) {
        result.blankCells.add(`${cell.row}:${cell.column}`);
      }
    }
  }
  const refinedBases = new Map<string, [number, number, number]>();
  for (const cell of cells) {
    if (cell.refinedBase) refinedBases.set(`${cell.row}:${cell.column}`, cell.refinedBase);
  }
  result.refinedBases = refinedBases;
  return result;
}
