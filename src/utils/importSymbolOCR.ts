import type { BeadColor } from '../types';
import { deltaE2000, rgbToLab } from './colorUtils';
import type { ImportImagePixels } from './importRecognition';
import type { ImportGridCalibration } from './importGridCalibration';

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
 * 底色先验在最终评分里的权重（0..1 的归一化色分 × 该权重，加到形状分上）。
 * 小字号印刷文字的形状分对 9/8、6/5、2/1 这类近邻字形几乎无区分度
 * （实测妲己图：错读格里 D9/D8 形状分只差 0.005，而正确候选 90%+ 就在 top3）；
 * 底色是整块印刷色，ΔE 0.3~1.6 vs 错误候选 6.6~14，区分度高出两个数量级。
 * 权重 0.3 经妲己图网格搜索：可翻转全部数字混淆对，又不压过真字形证据。
 */
const COLOR_PRIOR_WEIGHT = 0.3;

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
  /** 联合分（形状+底色先验）领先次优的差距；差距大说明该读数证据充分。 */
  margin: number;
  /** 纯形状领先度（胜者形状分 − 其余候选最大形状分），字形独信置信度。 */
  shapeMargin: number;
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
  /** 判定为"纸底空格"的格子（"row:column"）——底色接近全图主底色且无文字。 */
  blankCells: Set<string>;
}

interface CellText {
  row: number;
  column: number;
  baseRgb: [number, number, number];
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

/** 阶段 1：逐格提取文字条带。 */
function analyzeCells(
  source: ImportImagePixels, calibration: ImportGridCalibration,
): { cells: CellText[]; totalCells: number; plainBases: Map<string, [number, number, number]> } {
  const { data, width } = source;
  const cells: CellText[] = [];
  const plainBases = new Map<string, [number, number, number]>();
  let totalCells = 0;
  for (let row = 0; row < calibration.rows; row += 1) {
    for (let column = 0; column < calibration.columns; column += 1) {
      const x0 = Math.round(column * calibration.cellWidth + calibration.originX);
      const y0 = Math.round(row * calibration.cellHeight + calibration.originY);
      const rx0 = Math.max(0, x0 + Math.round(calibration.cellWidth * 0.14));
      const ry0 = Math.max(0, y0 + Math.round(calibration.cellHeight * 0.14));
      const rx1 = Math.min(source.width, x0 + Math.round(calibration.cellWidth * 0.86));
      const ry1 = Math.min(source.height, y0 + Math.round(calibration.cellHeight * 0.86));
      const rw = rx1 - rx0, rh = ry1 - ry0;
      if (rw < 8 || rh < 8) continue;
      totalCells += 1;
      const baseRgb = dominantBaseColor(data, width, rx0, ry0, rx1, ry1);
      const mask = new Uint8Array(rw * rh);
      let on = 0;
      for (let y = ry0; y < ry1; y += 1) {
        for (let x = rx0; x < rx1; x += 1) {
          const i = (y * width + x) * 4;
          if (rgbDist2([data[i], data[i + 1], data[i + 2]], baseRgb) > TEXT_CONTRAST * TEXT_CONTRAST) {
            mask[(y - ry0) * rw + (x - rx0)] = 1;
            on += 1;
          }
        }
      }
      const ratio = on / (rw * rh);
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
        row, column, baseRgb,
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
  for (const cell of cells) {
    const baseLab = rgbToLab(...cell.baseRgb);
    // 候选：底色 ΔE 排序的 top-K 色号
    const cands = prepared
      .map((p) => ({ code: p.color.code, d: deltaE2000(baseLab, p.lab) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
    // 联合评分：形状（整串 Jaccard）+ 底色先验（归一化）。底色是整块印刷色，
    // 比小字字形的区分度高两个数量级，只靠形状会系统性读错近邻数字（9/8、6/5）。
    const scored: Array<{ code: string; shape: number; combined: number }> = [];
    let composable = 0;
    for (const c of cands) {
      if (!codeSet.has(c.code)) continue;
      const tpl = compose(c.code);
      if (!tpl) continue;
      composable += 1;
      const shape = 1 - bitmapJaccard(cell.band, tpl);
      scored.push({ code: c.code, shape, combined: shape + COLOR_PRIOR_WEIGHT * Math.max(0, 1 - c.d / PRIOR_MAX_DELTA_E) });
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
      continue;
    }
    codes.set(`${cell.row}:${cell.column}`, { code: bestCode, score: bestShape, prior: cands[0]?.code ?? '', margin: bestCombined - secondCombined, shapeMargin });
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
    const paperLab = rgbToLab(...paper);
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
  return result;
}
