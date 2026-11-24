// card3 token 布局：debugColorCardParse 的 bands.tokenXs + [vdbg] 日志
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const PORT = 46213;
const card = process.argv[2] || 'card3';
const vite = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
const logs = [];
page.on('console', m => { const t = m.text(); if (t.includes('[vdbg]')) logs.push(t); });
page.on('pageerror', e => console.log('[pageexception]', String(e).slice(0, 300)));
await page.addInitScript(() => { window.process = { env: { CARD_DEBUG: '1' } }; });
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 60000 });
const out = await page.evaluate(async ({ card }) => {
  const S = await import('/src/utils/importLegend.ts');
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const resp = await fetch(`/benchmark/images/${card}.png`);
  const bmp = await createImageBitmap(await resp.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const source = { data: img.data, width: img.width, height: img.height };
  const dbg = S.debugColorCardParse(source, BRAND_PALETTES.MARD);
  return { bands: dbg ? dbg.bands : null, gates: dbg ? dbg.gates : null };
}, { card });
console.log('gates', JSON.stringify(out.gates));
console.log('bands', out.bands ? out.bands.length : 'null');
(out.bands || []).slice(0, 8).forEach(b => console.log(`y${b.y0}-${b.y1} tokens=${b.tokens} sw=${b.swatches} ${JSON.stringify(b.tokenXs)}`));
console.log('--- vdbg ---');
console.log(logs.slice(0, 12).join('\n'));
await browser.close();
await vite.close();
