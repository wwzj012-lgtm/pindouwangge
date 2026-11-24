// card3 计数 token 内字形间隙分布：找「数字↔粒」分离阈值
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const PORT = 46214;
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
  const source = { data: img.data, width: img.width, height: img.height };
  const scan = S.collectCardEntries(source);
  return scan ? scan.splits.map(sp => sp ? sp.countGlyphs.map(g => ({ x0: Math.round(g.x0), x1: Math.round(g.x1), w: g.x1 - g.x0 + 1, h: g.y1 - g.y0 + 1 })) : []) : null;
}, { card });
if (!out) console.log('null');
else {
  out.forEach((gs, i) => {
    const t = truth[i]; const td = t ? String(t[1]) : '?';
    const gaps = gs.slice(1).map((g, k) => g.x0 - gs[k].x1 - 1);
    console.log(`#${String(i).padStart(2)} 真${td.padStart(5)}(位${td.length}) n=${gs.length} gaps=[${gaps.join(' ')}]`);
  });
}
await browser.close(); await vite.close();
