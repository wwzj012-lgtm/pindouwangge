// 字元级解码原型：CC 切字形 → 全图聚类 → 可信读数贴标签 → 逐格解码
// 验证对 H2/H9 集体误读的修复效果，达标后移植进 importSymbolOCR.ts
import { createServer } from 'vite';
import sharp from 'sharp';

const IMG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-22T09-39-58-552Z-fe2f92b2.jpg';
const TRUTH = { A1:23,A17:11,B11:9,B14:32,B25:59,B26:12,C10:70,C16:56,C17:7,C19:26,C20:2,C22:1,C24:9,C26:1,F6:8,H2:106,H5:86,H6:136,H7:433,M1:16,M2:60,M3:2,M14:23 };
const vite = await createServer({
  root: process.cwd(), appType: 'custom',
  server: { middlewareMode: true }, logLevel: 'error',
  optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts',
});
const SO = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
const { estimateBeadPitch, refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const palette = BRAND_PALETTES.MARD;
const codeSet = new Set(palette.map(c => c.code));

const est = estimateBeadPitch(source);
let cal = {
  originX: est.originTrustedX ? est.originX : 0, originY: est.originTrustedY ? est.originY : 0,
  cellWidth: est.cell, cellHeight: est.cell,
  columns: Math.min(est.columns, Math.floor((source.width - est.originX) / est.cell)),
  rows: Math.min(est.rows, Math.floor((source.height - est.originY) / est.cell)),
};
const ref = refineGridAlignment(source, cal);
if (ref.applied) cal = { ...cal, cellWidth: ref.cell, cellHeight: ref.cell, originX: ref.originX, originY: ref.originY };

const { cells } = SO.analyzeCells(source, cal);
console.log('cells:', cells.length);

// ---- 连通域切字形（8 邻接，面积 ≥ 4）----
function splitGlyphsCC(band) {
  const { w, h, data: d } = band;
  const seen = new Uint8Array(w * h);
  const glyphs = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!d[y * w + x] || seen[y * w + x]) continue;
    // BFS
    const stack = [[x, y]]; seen[y * w + x] = 1;
    let x0 = x, x1 = x, y0 = y, y1 = y, n = 0;
    const pts = [];
    while (stack.length) {
      const [cx, cy] = stack.pop(); pts.push([cx, cy]); n++;
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || !d[ny * w + nx]) continue;
        seen[ny * w + nx] = 1; stack.push([nx, ny]);
      }
    }
    if (n < 4 || (y1 - y0 + 1) < 5) continue; // 噪点
    glyphs.push({ x0, x1, y0, y1, n, pts });
  }
  // x 重叠的部件（同一字形断裂）合并
  glyphs.sort((a, b) => a.x0 - b.x0);
  const merged = [];
  for (const g of glyphs) {
    const last = merged[merged.length - 1];
    if (last && g.x0 <= last.x1 - 1) { // 重叠 ≥1px 视为同字形
      last.x0 = Math.min(last.x0, g.x0); last.x1 = Math.max(last.x1, g.x1);
      last.y0 = Math.min(last.y0, g.y0); last.y1 = Math.max(last.y1, g.y1);
      last.pts.push(...g.pts);
    } else merged.push({ ...g });
  }
  return merged.map(g => {
    const gw = g.x1 - g.x0 + 1, gh = g.y1 - g.y0 + 1;
    const dd = new Uint8Array(gw * gh);
    for (const [px, py] of g.pts) dd[(py - g.y0) * gw + (px - g.x0)] = 1;
    return { w: gw, h: gh, data: dd };
  });
}
const cellGlyphs = new Map(); // key -> glyphs
for (const c of cells) cellGlyphs.set(c, splitGlyphsCC(c.band));
const gcounts = new Map();
for (const g of cellGlyphs.values()) gcounts.set(g.length, (gcounts.get(g.length) ?? 0) + 1);
console.log('glyph-count dist:', [...gcounts.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}字:${v}`).join(' '));

const jac = (A, B) => {
  if (Math.abs(A.w - B.w) > 3 || Math.abs(A.h - B.h) > 3) return 0;
  const w = Math.max(A.w, B.w), h = Math.max(A.h, B.h);
  let inter = 0, uni = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = y < A.h && x < A.w && A.data[y * A.w + x];
    const b = y < B.h && x < B.w && B.data[y * B.w + x];
    if (a || b) uni++; if (a && b) inter++;
  }
  return uni ? inter / uni : 1;
};

// ---- 基线读数：extractBeadSymbols 的逐格 code + score ----
const base = SO.extractBeadSymbols(source, cal, palette);
console.log('base resolved:', base.resolvedCount, '/', base.textCellCount);

// ---- 字形聚类（贪心锚定）----
const GLYPH_TH = 0.62;
const anchors = []; // {glyph, n, labels: Map<char,n>}
const allGlyphs = [];
for (const [cell, gs] of cellGlyphs) {
  const read = base.codes.get(`${cell.row}:${cell.column}`);
  for (const g of gs) allGlyphs.push({ g, cell, read: read ?? null });
}
console.log('total glyphs:', allGlyphs.length);
for (const item of allGlyphs) {
  let best = null, bestJ = 0;
  for (const a of anchors) {
    const j = jac(a.g, item.g);
    if (j > bestJ) { bestJ = j; best = a; }
  }
  if (bestJ >= GLYPH_TH && best.n < 600) {
    best.n++; best.members.push(item);
  } else anchors.push({ g: item.g, n: 1, members: [item] });
}
console.log('glyph clusters:', anchors.length, 'top sizes:', anchors.map(a => a.n).sort((a, b) => b - a).slice(0, 12).join(','));

// ---- 簇贴标签：可信读数（score≥0.72 且 margin≥0.03）按位投票 ----
for (const a of anchors) a.labels = new Map();
for (const item of allGlyphs) {
  if (!item.read || item.read.score < 0.72 || (item.read.margin ?? 0) < 0.03) continue;
  const gs = cellGlyphs.get(item.cell);
  const code = item.read.code;
  if (gs.length !== code.length) continue;
  const idx = gs.indexOf(item.g);
  const ch = code[idx];
  const a = anchors.find(x => x.members.includes(item));
  if (a) a.labels.set(ch, (a.labels.get(ch) ?? 0) + 1);
}
let labeled = 0, ambiguous = 0;
const clusterLabel = new Map();
for (const a of anchors) {
  const sorted = [...(a.labels ?? new Map()).entries()].sort((x, y) => y[1] - x[1]);
  if (!sorted.length) continue;
  const total = sorted.reduce((s, [, n]) => s + n, 0);
  if (sorted[0][1] / total >= 0.7) { clusterLabel.set(a, sorted[0][0]); labeled++; }
  else ambiguous++;
}
console.log('labeled clusters:', labeled, 'ambiguous:', ambiguous, 'of', anchors.length);

// ---- 逐格解码：字形 → 簇标签 → 串 ----
const decoded = new Map(); // "r:c" -> string
let decodeFails = 0;
for (const [cell, gs] of cellGlyphs) {
  let s = '', ok = true;
  for (const g of gs) {
    let bestA = null, bestJ = 0;
    for (const a of anchors) {
      if (!clusterLabel.has(a)) continue;
      const j = jac(a.g, g);
      if (j > bestJ) { bestJ = j; bestA = a; }
    }
    if (!bestA || bestJ < GLYPH_TH) { ok = false; break; }
    s += clusterLabel.get(bestA);
  }
  if (ok && s) decoded.set(`${cell.row}:${cell.column}`, s); else decodeFails++;
}
console.log('decoded cells:', decoded.size, 'fail:', decodeFails);

// 只统计网格区（行 < 66，排除图例）
const count = new Map();
let inGrid = 0;
for (const [key, s] of decoded) {
  const [r] = key.split(':').map(Number);
  if (r >= 66) continue;
  inGrid++;
  count.set(s, (count.get(s) ?? 0) + 1);
}
console.log(`\ndecoded in-grid: ${inGrid}`);
let okN = 0;
const lines = [];
for (const [code, t] of Object.entries(TRUTH)) {
  const f = count.get(code) ?? 0;
  const ok = Math.abs(f - t) <= Math.max(2, t * 0.08);
  if (ok) okN++;
  lines.push(`${code}:${f}/${t}${ok ? '✓' : '✗'}`);
}
console.log(`count-match ${okN}/${Object.keys(TRUTH).length}`);
console.log('  ' + lines.join(' '));
const extra = [...count.entries()].filter(([c]) => !(c in TRUTH)).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log('ghost:', extra.map(([c, n]) => `${c}:${n}`).join(' ') || '(无)');

// 对比基线（extractBeadSymbols 的读数分布）
const baseCount = new Map();
for (const [key, r] of base.codes) {
  const [r2] = key.split(':').map(Number);
  if (r2 >= 66) continue;
  baseCount.set(r.code, (baseCount.get(r.code) ?? 0) + 1);
}
let okB = 0;
for (const [code, t] of Object.entries(TRUTH)) {
  const f = baseCount.get(code) ?? 0;
  if (Math.abs(f - t) <= Math.max(2, t * 0.08)) okB++;
}
console.log(`\nbaseline count-match: ${okB}/${Object.keys(TRUTH).length}`);
await vite.close(); process.exit(0);
