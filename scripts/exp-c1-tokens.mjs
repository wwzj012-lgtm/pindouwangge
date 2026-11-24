// card1：band 内 token 与色块标注（原图坐标）+ 每个 token 的 comps 宽度
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const PORT = 46305;
const card = process.argv[2] || 'card1';
const bandIdx = Number(process.argv[3] || 0);
const vite = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageexception]', String(e).slice(0, 300)));
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
  const dbg = S.debugColorCardParse({ data: img.data, width: img.width, height: img.height }, BRAND_PALETTES.MARD);
  return dbg ? { bands: dbg.bands, items: dbg.items, gates: dbg.gates } : null;
}, { card });
if (!out) { console.log('null'); process.exit(0); }
console.log('gates', JSON.stringify(out.gates));
out.bands.forEach((b, i) => {
  console.log(`band${i} y${b.y0}-${b.y1} tokens=${b.tokens} sw=${b.swatches}`);
  console.log('  ' + b.tokenXs.map(([a, bb, s]) => `${a}-${bb}${s ? 'S' : ''}`).join(' '));
});
await browser.close(); await vite.close();
