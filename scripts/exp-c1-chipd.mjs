// card1：CARD_DEBUG 的 [chipd] 日志（按 x 过滤），看票面/数量区装配细节
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const PORT = 46303;
const card = process.argv[2] || 'card1';
const lo = Number(process.argv[3] || 0), hi = Number(process.argv[4] || 9999);
const rowY = process.argv[5] ? process.argv[5].split(',').map(Number) : null;
const vite = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
const logs = [];
page.on('console', m => { const t = m.text(); if (t.includes('[chipd]')) logs.push(t); });
page.on('pageerror', e => console.log('[pageexception]', String(e).slice(0, 300)));
await page.addInitScript(() => { window.process = { env: { CARD_DEBUG: '1' } }; });
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 60000 });
await page.evaluate(async ({ card }) => {
  const S = await import('/src/utils/importLegend.ts');
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const resp = await fetch(`/benchmark/images/${card}.png`);
  const bmp = await createImageBitmap(await resp.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  S.parseColorCard({ data: img.data, width: img.width, height: img.height }, BRAND_PALETTES.MARD);
}, { card });
for (const l of logs) {
  const m = l.match(/x(\d+)-(\d+) y(\d+)-(\d+)/);
  if (!m) continue;
  const x0 = Number(m[1]);
  if (x0 < lo || x0 > hi) continue;
  if (rowY && !rowY.includes(Number(m[3]))) continue;
  console.log(l);
}
console.log('total logs', logs.length);
await browser.close(); await vite.close();
