// card1：抓全部调试日志，按前缀计数 + 可按 x 范围过滤打印
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const PORT = 46304;
const card = process.argv[2] || 'card1';
const lo = Number(process.argv[3] ?? -1), hi = Number(process.argv[4] ?? 1e9);
const vite = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
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
const kinds = new Map();
for (const l of logs) { const k = (l.match(/^\[([a-z-]+)\]/) || [, '?'])[1]; kinds.set(k, (kinds.get(k) || 0) + 1); }
console.log('日志前缀:', [...kinds].map(([k, v]) => `${k}×${v}`).join(' '));
const kindFilter = process.argv[5] ? process.argv[5].split(',') : null;
for (const l of logs) {
  if (kindFilter) {
    const k = (l.match(/^\[([a-z-]+)\]/) || [, '?'])[1];
    if (kindFilter.includes(k)) console.log(l);
    continue;
  }
  const m = l.match(/x(\d+)-?(\d+)?/);
  if (!m) continue;
  const x0 = Number(m[1]);
  if (x0 >= lo && x0 <= hi) console.log(l);
}
await browser.close(); await vite.close();
