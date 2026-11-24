// 计数单字的填充率 vs 真值数字：找「实心团块」判据（粒碎片常是实心）
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const PORT = 46222;
const card = process.argv[2] || 'card3';
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'))[card].entries;
const vite = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageexception]', String(e).slice(0, 300)));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 60000 });
const out = await page.evaluate(async ({ card }) => {
  const S = await import('/src/utils/importLegend.ts');
  const resp = await fetch(`/benchmark/images/${card}.png`);
  const bmp = await createImageBitmap(await resp.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const scan = S.collectCardEntries({ data: img.data, width: img.width, height: img.height });
  return scan.splits.map(sp => sp ? sp.countGlyphs.map(g => {
    const w = g.x1 - g.x0 + 1, h = g.y1 - g.y0 + 1;
    return { w, h, fill: Number((g.area / (w * h)).toFixed(2)) };
  }) : []);
}, { card });
const rows = [];
out.forEach((gs, i) => {
  const t = truth[i]; if (!t) return;
  const want = String(t[1]);
  if (gs.length !== want.length) { rows.push(`#${i} 段位不符 n=${gs.length} 真${want} fills=${gs.map(g => g.fill).join(',')}`); return; }
  rows.push(`#${i} 真${want} fills=${gs.map((g, k) => `${want[k]}:${g.fill}(${g.w}x${g.h})`).join(' ')}`);
});
console.log(rows.slice(0, 60).join('\n'));
await browser.close(); await vite.close();
