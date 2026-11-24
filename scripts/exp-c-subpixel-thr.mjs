// card1 同一计数字形在多个亚像素阈值下的形态（找能张开字腔的阈值）
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const PORT = 46226;
const card = process.argv[2] || 'card1';
const thr = (process.argv[3] || '100,150,200,250').split(',').map(Number);
const entryIdx = Number(process.argv[4] || 6);
const gi = Number(process.argv[5] || 1);
const vite = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageexception]', String(e).slice(0, 300)));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 60000 });
const out = await page.evaluate(async ({ card, thr, entryIdx, gi }) => {
  const S = await import('/src/utils/importLegend.ts');
  const resp = await fetch(`/benchmark/images/${card}.png`);
  const bmp = await createImageBitmap(await resp.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const source = { data: img.data, width: img.width, height: img.height };
  const scan = S.collectCardEntries(source);
  const g = scan.splits[entryIdx].countGlyphs[gi];
  const bg = S.cardPageBg(source);
  const out = [];
  for (const t of thr) {
    const bin = S.buildCardBuffers(source, bg, 4, t, true).bin;
    const w = g.x1 - g.x0 + 1, h = g.y1 - g.y0 + 1;
    const rows = [];
    for (let y = 0; y < h; y += 1) { let s = ''; for (let x = 0; x < w; x += 1) { const o = ((g.y0 + y) * bin.width + (g.x0 + x)) * 4; s += bin.data[o] === 0 ? '#' : '.'; } rows.push(s); }
    out.push({ t, rows });
  }
  return { w: g.x1 - g.x0 + 1, h: g.y1 - g.y0 + 1, out };
}, { card, thr, entryIdx, gi });
console.log(`字形 ${out.w}x${out.h}`);
const n = out.out[0].rows.length;
for (let k = 0; k < n; k += 1) console.log(out.out.map(o => (o.rows[k] || '').padEnd(out.w + 2)).join('| ') + '   ' + (k === 0 ? out.out.map(o => `thr${o.t}`).join(' | ') : ''));
await browser.close(); await vite.close();
