// 指定条目：collectCardEntries 的全部 countGlyphs ASCII（含宽块）
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const PORT = 46219;
const card = process.argv[2] || 'card1';
const want = (process.argv[3] || '6,8').split(',').map(Number);
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'))[card].entries;
const vite = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageexception]', String(e).slice(0, 300)));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 60000 });
const out = await page.evaluate(async ({ card, want }) => {
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
  const art = (bm) => {
    const rows = [];
    for (let y = 0; y < bm.h; y += 1) { let s = ''; for (let x = 0; x < bm.w; x += 1) s += bm.data[y * bm.w + x] ? '#' : '.'; rows.push(s); }
    return rows;
  };
  return { digitW: scan.digitW, items: want.map(i => ({ i, glyphs: scan.splits[i].countGlyphs.map(g => ({ x0: Math.round(g.x0), w: g.x1 - g.x0 + 1, h: g.y1 - g.y0 + 1, rows: art(g.bitmap) })) })) };
}, { card, want });
console.log('digitW=' + out.digitW);
for (const it of out.items) {
  const t = truth[it.i];
  console.log(`\n#${it.i} ${t ? t.join(':') : '?'} n=${it.glyphs.length}`);
  for (const g of it.glyphs) {
    console.log(` -- x${g.x0} ${g.w}x${g.h}`);
    console.log(g.rows.map(r => '    ' + r).join('\n'));
  }
}
await browser.close(); await vite.close();
