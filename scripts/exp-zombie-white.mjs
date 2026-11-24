// 白豆组 H2/H9 集体误读诊断：形状分、条带自然聚类、字形级证据
import { createServer } from 'vite';
import sharp from 'sharp';

const IMG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-22T09-39-58-552Z-fe2f92b2.jpg';
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
const byCode = new Map(palette.map(c => [c.code, c]));

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

// rgbToLab / deltaE 从模块内拿不到就自己算（Lab 近似够用：这里只做白灰分族筛选）
const lab = (r, g, b) => {
  const f = (v) => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  const X = R * 0.4124 + G * 0.3576 + B * 0.1805, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  const h = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * h(Y) - 16, 500 * (h(X) - h(Y)), 200 * (h(Y) - h(Z))];
};
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// 白灰系筛选：底色接近 H2/H9/H11/H5/H3/H17 任一（ΔE76 粗筛）
const FAMILY = ['H2', 'H9', 'H11', 'H5', 'H3', 'H17', 'H6', 'H7'];
const fam = [];
for (const cell of cells) {
  const L = lab(...cell.baseRgb);
  let best = null;
  for (const code of FAMILY) {
    const c = byCode.get(code);
    if (!c) continue;
    const d = dE(L, lab(...c.rgb));
    if (!best || d < best.d) best = { code, d };
  }
  if (best && best.d <= 18) fam.push({ cell, best });
}
console.log('white/gray family cells:', fam.length);
const dist = new Map();
for (const f of fam) dist.set(f.best.code, (dist.get(f.best.code) ?? 0) + 1);
console.log('nearest-palette dist:', [...dist.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join(' '));

// ---- 条带自然聚类（贪心锚定，Jaccard 距离阈值扫描）----
const jac = (A, B) => {
  const w = Math.max(A.w, B.w), h = Math.max(A.h, B.h);
  let inter = 0, uni = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = y < A.h && x < A.w && A.data[y * A.w + x];
    const b = y < B.h && x < B.w && B.data[y * B.w + x];
    if (a || b) uni++; if (a && b) inter++;
  }
  return uni ? inter / uni : 1;
};
for (const TH of [0.55, 0.6, 0.65]) {
  const anchors = []; // {band, n}
  for (const { cell } of fam) {
    let matched = false;
    for (const a of anchors) {
      if (a.n >= 400) { if (jac(a.band, cell.band) >= TH) { a.n++; matched = true; break; } }
      else if (jac(a.band, cell.band) >= TH) { a.n++; matched = true; break; }
    }
    if (!matched) anchors.push({ band: cell.band, n: 1 });
  }
  anchors.sort((a, b) => b.n - a.n);
  console.log(`TH=${TH}: clusters=${anchors.length} sizes=${anchors.slice(0, 8).map(a => a.n).join(',')}...`);
  if (TH === 0.6) {
    // 保存各大簇代表带 + 合成模板对比
    const { templates, gap } = SO.diagnoseSymbols(source, cal, palette);
    console.log('--- rep vs composite shape (1-Jaccard):');
    for (const [i, a] of anchors.slice(0, 5).entries()) {
      const scores = FAMILY.map(code => {
        const t = templates.get(code);
        return t ? `${code}=${(1 - jac(a.band, t)).toFixed(3)}` : `${code}=null`;
      }).join(' ');
      console.log(`  cluster#${i} n=${a.n} w=${a.band.w} h=${a.band.h}: ${scores}`);
    }
    // 字形级：B25/M2 第二字形（'2'）与白簇代表第二字形比对
    const splitGlyphs = (band) => {
      // 按列投影切字形
      const cols = [];
      for (let x = 0; x < band.w; x++) { let n = 0; for (let y = 0; y < band.h; y++) if (band.data[y * band.w + x]) n++; cols.push(n); }
      const glyphs = []; let s = -1;
      for (let x = 0; x < band.w; x++) {
        if (cols[x] > 0 && s < 0) s = x;
        if (cols[x] === 0 && s >= 0) { glyphs.push([s, x - 1]); s = -1; }
      }
      if (s >= 0) glyphs.push([s, band.w - 1]);
      return glyphs.map(([x0, x1]) => {
        let gy0 = band.h, gy1 = -1;
        for (let y = 0; y < band.h; y++) for (let x = x0; x <= x1; x++) if (band.data[y * band.w + x]) { gy0 = Math.min(gy0, y); gy1 = Math.max(gy1, y); }
        if (gy1 < 0) return null;
        const w = x1 - x0 + 1, h = gy1 - gy0 + 1;
        const d = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = band.data[(gy0 + y) * band.w + x0 + x];
        return { w, h, data: d };
      }).filter(Boolean);
    };
    // B25 anchor band（从 fam 里找 baseRgb 最近 B25 的）
    const whiteRep = anchors[0].band;
    const collectDigits = (code) => {
      const c = byCode.get(code); if (!c) return [];
      const cl = lab(...c.rgb);
      const picks = fam.map(f => ({ f, d: dE(lab(...f.cell.baseRgb), cl) })).sort((a, b) => a.d - b.d).slice(0, 30);
      return picks.map(p => { const g = splitGlyphs(p.f.cell.band); return g.length >= 2 ? g[1] : null; }).filter(Boolean);
    };
    const twos = collectDigits('B25').concat(collectDigits('B26'), collectDigits('M2'));
    const whiteGlyphs = splitGlyphs(whiteRep);
    console.log('white rep glyph count:', whiteGlyphs.length);
    if (whiteGlyphs.length >= 2) {
      const last = whiteGlyphs[whiteGlyphs.length - 1];
      let best2 = 0, best2n = 0;
      for (const g of twos) { const j = jac(last, g); if (j > best2) { best2 = j; } if (j >= 0.6) best2n++; }
      console.log(`'2' evidence: best Jaccard=${best2.toFixed(3)} match>=0.6: ${best2n}/${twos.length}`);
      // 对比：'2' 模板与 white 首字形（'H'）不应相似（阴性对照）
      const head = whiteGlyphs[0];
      let negBest = 0;
      for (const g of twos) negBest = Math.max(negBest, jac(head, g));
      console.log(`negative ctrl (H vs '2'): ${negBest.toFixed(3)}`);
      // '9' 的阴性证据：white 尾字形与 H9 模板的尾字形
      await sharp(Buffer.from(
        [...Array(last.h)].map((_, y) => [...Array(last.w)].map((_, x) => last.data[y * last.w + x] ? [0, 0, 0] : [255, 255, 255])).flat().flat()
      ), { raw: { width: last.w, height: last.h, channels: 3 } }).resize({ width: last.w * 10, kernel: 'nearest' }).png().toFile('C:/Users/Plout/Desktop/pindouwangge/white-tail-glyph.png');
      console.log('saved white-tail-glyph.png', last.w + 'x' + last.h);
    }
    // 保存 5 个大簇代表带拼图
    const rows = [];
    for (const a of anchors.slice(0, 5)) rows.push(a.band);
    const maxW = Math.max(...rows.map(b => b.w)), S = 8;
    const W = maxW * S + 10, H = rows.reduce((s, b) => s + b.h * S + 6, 6);
    const px = Buffer.alloc(W * H * 3, 240);
    let y0 = 6;
    for (const b of rows) {
      for (let gy = 0; gy < b.h; gy++) for (let gx = 0; gx < b.w; gx++) if (b.data[gy * b.w + gx]) {
        for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
          const i = ((y0 + gy * S + dy) * W + gx * S + dx) * 3; px[i] = 17; px[i + 1] = 17; px[i + 2] = 17;
        }
      }
      y0 += b.h * S + 6;
    }
    await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toFile('C:/Users/Plout/Desktop/pindouwangge/white-cluster-reps.png');
    console.log('saved white-cluster-reps.png');
  }
}
await vite.close(); process.exit(0);
