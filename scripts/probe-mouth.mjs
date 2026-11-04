// 嘴部/指定格探查：源色精确直方图 + 两版选豆对比。
// 用法: node scripts/probe-mouth.mjs
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const vite = await createServer({
  root: process.cwd(), appType: 'custom', server: { middlewareMode: true },
  logLevel: 'error', optimizeDeps: { noDiscovery: true },
});
const { MARD_PALETTE } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { rgbToLab, deltaE2000 } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const colorById = new Map(MARD_PALETTE.map((c) => [c.id, c]));
const v2 = JSON.parse(await readFile('benchmark/results/decomp-v2.json', 'utf8'));
const d6 = JSON.parse(await readFile('benchmark/results/decomp-dom6.json', 'utf8'));
const { data, info } = await sharp('benchmark/images/street-boy.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const srcW = info.width, srcH = info.height;
const px = (x, y) => { const i = (y * srcW + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };

const cellHist = (gx, gy, cols, rows) => {
  const x0 = Math.floor(gx * srcW / cols), x1 = Math.min(srcW, Math.ceil((gx + 1) * srcW / cols));
  const y0 = Math.floor(gy * srcH / rows), y1 = Math.min(srcH, Math.ceil((gy + 1) * srcH / rows));
  const groups = [];
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const [r, g, b, a] = px(x, y);
    if (a < 128) continue;
    let g0 = groups.find((gr) => Math.max(Math.abs(gr.r / gr.n - r), Math.abs(gr.g / gr.n - g), Math.abs(gr.b / gr.n - b)) <= 14);
    if (!g0) { g0 = { r: 0, g: 0, b: 0, n: 0 }; groups.push(g0); }
    g0.r += r; g0.g += g; g0.b += b; g0.n++;
  }
  return groups.map((gr) => ({ rgb: [Math.round(gr.r / gr.n), Math.round(gr.g / gr.n), Math.round(gr.b / gr.n)], share: gr.n }))
    .sort((a, b) => b.share - a.share).slice(0, 3);
};
const total = (h) => h.reduce((s, x) => s + x.share, 0);
const err = (id, h) => {
  if (!id) return '空';
  const c = colorById.get(id).rgb;
  const lab = rgbToLab(...c);
  return `${id} rgb(${c}) 块差[${h.map((x) => deltaE2000(rgbToLab(...x.rgb), lab).toFixed(0)).join(',')}]`;
};

const CELLS = process.env.CELLS ? JSON.parse(process.env.CELLS)
  : [[46, 46], [47, 47], [48, 48], [49, 49], [50, 50], [51, 51], [52, 50], [53, 51], [50, 51], [52, 52], [53, 52], [54, 51], [48, 50], [49, 50], [51, 50], [47, 48], [55, 50], [56, 51]];

for (const [gx, gy] of CELLS) {
  const h = cellHist(gx, gy, 100, 100);
  const t = total(h);
  const src = h.map((x) => `rgb(${x.rgb}) ${Math.round((x.share / t) * 100)}%`).join(' | ');
  console.log(`(${gx},${gy}) ${src}`);
  console.log(`   v2: ${err(v2.grid[gy][gx], h)} | dom6: ${err(d6.grid[gy][gx], h)}`);
}
await vite.close();
