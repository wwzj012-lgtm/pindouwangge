// card1 逐位对照：code 与 count 任一不符即打印
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const PORT = 46310;
const card = process.argv[2] || 'card1';
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'))[card].entries;
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
  const r = S.parseColorCard({ data: img.data, width: img.width, height: img.height }, BRAND_PALETTES.MARD);
  return r.entries.map(e => ({ code: e.code, count: e.count, warn: e.warn || '' }));
}, { card });
let codeHit = 0, countHit = 0;
out.forEach((e, i) => {
  const t = truth[i]; if (!t) return;
  const codeOk = e.code === t[0];
  const countOk = e.count === t[1];
  if (codeOk) codeHit += 1;
  if (countOk) countHit += 1;
  if (!codeOk || !countOk) console.log(`#${String(i).padStart(2)} ${codeOk ? '  ' : 'C '}${countOk ? '  ' : 'N '} got ${(e.code || '??').padEnd(4)}:${String(e.count).padEnd(5)} want ${t[0]}:${t[1]} ${e.warn ? '!' + e.warn : ''}`);
});
console.log(`code ${codeHit}/${out.length} count ${countHit}/${out.length}`);
await browser.close(); await vite.close();
