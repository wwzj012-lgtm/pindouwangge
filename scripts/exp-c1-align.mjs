// card1：最终条目 vs 装配 item 对齐（countUnread 条目看数量区字形数）
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const PORT = 46301;
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
  const source = { data: img.data, width: img.width, height: img.height };
  const r = S.parseColorCard(source, BRAND_PALETTES.MARD);
  const dbg = S.debugColorCardParse(source, BRAND_PALETTES.MARD);
  return {
    entries: r.entries.map(e => ({ code: e.code, count: e.count, warn: e.warn || '' })),
    items: dbg ? dbg.items : [],
    gates: dbg ? dbg.gates : null,
  };
}, { card });
console.log('gates', JSON.stringify(out.gates), 'items', out.items.length, 'entries', out.entries.length);
out.entries.forEach((e, i) => {
  const t = truth[i];
  const ok = t && e.count === t[1] && e.code === t[0];
  if (ok) return;
  const it = out.items[i];
  console.log(`#${String(i).padStart(2)} got ${(e.code || '??').padEnd(4)}:${String(e.count).padEnd(5)} want ${t ? t[0] + ':' + t[1] : '?'}`);
  console.log(`     item=${it ? `sw=${it.swatch} cg=${it.codeGlyphs} ng=${it.countGlyphs} codeSpan=${it.codeSpan} countSpan=${it.countSpan} cw=[${it.codeWs.join(',')}] nw=[${it.countWs.join(',')}] prior=${it.prior} resolved=${it.resolved}` : 'null'}`);
  console.log(`     warn=${e.warn}`);
});
await browser.close(); await vite.close();
