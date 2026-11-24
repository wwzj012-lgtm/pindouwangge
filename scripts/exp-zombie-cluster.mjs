// 实验：格内文字条带聚类 —— 验证"同码格子位图几乎一致"假设
// 输出：聚类大小分布、簇内底色纯度、每簇代表条带放大拼接图（供目读真值）
import { createServer } from 'vite';
import sharp from 'sharp';

const IMG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-22T09-39-58-552Z-fe2f92b2.jpg';

const vite = await createServer({
  root: process.cwd(), appType: 'custom',
  server: { middlewareMode: true }, logLevel: 'error',
  optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts',
});
const { analyzeCells } = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
const { estimateBeadPitch, refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');

const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

const est = estimateBeadPitch(source);
let cal = {
  originX: est.originTrustedX ? est.originX : 0,
  originY: est.originTrustedY ? est.originY : 0,
  cellWidth: est.cell, cellHeight: est.cell,
  columns: Math.min(est.columns, Math.floor((source.width - est.originX) / est.cell)),
  rows: Math.min(est.rows, Math.floor((source.height - est.originY) / est.cell)),
};
const ref = refineGridAlignment(source, cal);
if (ref.applied) cal = { ...cal, cellWidth: ref.cell, cellHeight: ref.cell, originX: ref.originX, originY: ref.originY };

const { cells } = analyzeCells(source, cal);
const inGrid = cells.filter(c => c.row < 66);
console.log('textCells total:', cells.length, 'in grid(0..65):', inGrid.length);

// 贪心聚类：Jaccard 距离 < TH 且底色量化一致
const bitmapJaccard = (a, b) => {
  const w = Math.max(a.w, b.w);
  let inter = 0, union = 0;
  for (let y = 0; y < a.h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const av = x < a.w ? a.data[y * a.w + x] : 0;
      const bv = x < b.w ? b.data[y * b.w + x] : 0;
      if (av && bv) inter += 1;
      if (av || bv) union += 1;
    }
  }
  return union === 0 ? 1 : 1 - inter / union;
};
const colorKey = (rgb) => `${rgb[0] >> 5},${rgb[1] >> 5},${rgb[2] >> 5}`;

const TH = Number(process.env.TH || 0.22);
const USE_COLOR = process.env.USE_COLOR !== '0';
const clusters = []; // {members: [cell], rep: cell}
for (const cell of inGrid) {
  let best = -1, bestD = 1;
  for (let i = 0; i < clusters.length; i += 1) {
    const c = clusters[i];
    if (USE_COLOR && colorKey(c.rep.baseRgb) !== colorKey(cell.baseRgb)) continue;
    const d = bitmapJaccard(c.rep.band, cell.band);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0 && bestD < TH) clusters[best].members.push(cell);
  else clusters.push({ members: [cell], rep: cell });
}
console.log(`clusters(${TH}, color=${USE_COLOR}):`, clusters.length);
const sizes = clusters.map(c => c.members.length).sort((a, b) => b - a);
console.log('sizes:', sizes.join(','));

// 簇内底色一致性（精确 RGB 方差）
let pureColor = 0;
for (const c of clusters) {
  const keys = new Set(c.members.map(m => colorKey(m.baseRgb)));
  if (keys.size === 1) pureColor += 1;
}
console.log('color-pure clusters:', pureColor, '/', clusters.length);

// 拼接代表条带图（原始像素直出 PNG）：每行 = 底色块 | 成员数条 | 放大band
const shown = [...clusters].sort((a, b) => b.members.length - a.members.length).slice(0, 80);
const GLYPH_H = 16, SCALE = 6, LABEL_W = 56;
const maxW = Math.max(...shown.map(c => c.rep.band.w));
const rowH = GLYPH_H * SCALE + 4;
const W = LABEL_W + maxW * SCALE + 8, H = shown.length * rowH + 4;
const px = Buffer.alloc(W * H * 3, 235);
const put = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b;
};
shown.forEach((c, i) => {
  const y0 = 4 + i * rowH;
  const [br, bg, bb] = c.rep.baseRgb;
  for (let y = y0; y < y0 + rowH - 4; y += 1) for (let x = 0; x < 40; x += 1) put(x, y, br, bg, bb);
  const n = Math.min(12, c.members.length);
  for (let y = y0; y < y0 + rowH - 4; y += 1) for (let x = 0; x < n; x += 1) put(44 + x * 1, y, 60, 60, 60);
  const b = c.rep.band;
  for (let gy = 0; gy < b.h; gy += 1) {
    for (let gx = 0; gx < b.w; gx += 1) {
      if (!b.data[gy * b.w + gx]) continue;
      for (let dy = 0; dy < SCALE; dy += 1) for (let dx = 0; dx < SCALE; dx += 1) {
        put(LABEL_W + gx * SCALE + dx, y0 + gy * SCALE + dy, 17, 17, 17);
      }
    }
  }
});
await sharp(px, { raw: { width: W, height: H, channels: 3 } }).resize({ width: 768, kernel: 'lanczos3' }).png().toFile('C:/Users/Plout/Desktop/pindouwangge/zombie-cluster-sheet.png');
console.log('sheet', W, 'x', H);
await vite.close();
