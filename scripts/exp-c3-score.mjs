// card3 数量逐条判分（全量错值）：浏览器 parseColorCard vs 真值
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const PORT = 46215;
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
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const resp = await fetch(`/benchmark/images/${card}.png`);
  const bmp = await createImageBitmap(await resp.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const r = S.parseColorCard({ data: img.data, width: img.width, height: img.height }, BRAND_PALETTES.MARD);
  return { entries: r.entries.map(e => ({ code: e.code, count: e.count, warn: e.warn || '' })), tmplChars: (S.countGlyphDump || []).length };
}, { card });
let hit = 0;
out.entries.forEach((e, i) => {
  const t = truth[i]; if (!t) return;
  const ok = e.count === t[1];
  if (ok) hit += 1;
  const got = String(e.count).padStart(5), want = String(t[1]).padStart(5);
  // 逐位比较，标出错的位
  const gp = got.trim().padStart(want.trim().length, ' ').split('');
  console.log(`${ok ? '  ' : '✗ '}#${String(i).padStart(2)} ${(e.code || '??').padEnd(4)} got${got} want${want}  ${ok ? '' : gp.map((ch, k) => ch === want.trim()[k] ? '·' : '^').join('')} ${e.warn ? '!' + e.warn : ''}`);
});
console.log(`数量 ${hit}/${out.entries.length}`);
await browser.close(); await vite.close();
