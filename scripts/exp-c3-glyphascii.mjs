// 指定条目的计数单字 ASCII（带真值数字），看 6/8/9 在 4x 是否可分
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const PORT = 46218;
const card = process.argv[2] || 'card3';
const want = (process.argv[3] || '8,13,17,20,29').split(',').map(Number);
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'))[card].entries;
const vite = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageexception]', String(e).slice(0, 300)));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 60000 });
const out = await page.evaluate(async ({ card, want }) => {
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
  S.parseColorCard(source, BRAND_PALETTES.MARD);
  const art = (bm) => {
    const rows = [];
    for (let y = 0; y < bm.h; y += 1) {
      let s = '';
      for (let x = 0; x < bm.w; x += 1) s += bm.data[y * bm.w + x] ? '#' : '.';
      rows.push(s);
    }
    return rows;
  };
  return S.countGlyphDump.filter(d => want.includes(d.entry)).map(d => ({ entry: d.entry, digit: d.digit, x0: Math.round(d.x0), w: d.bitmap.w, h: d.bitmap.h, rows: art(d.bitmap) }));
}, { card, want });
for (const g of out) {
  const t = truth[g.entry];
  console.log(`\n#${g.entry} ${t ? t.join(':') : '?'} x${g.x0} ${g.w}x${g.h} 派='${g.digit}'`);
  console.log(g.rows.map(r => '   ' + r).join('\n'));
}
await browser.close(); await vite.close();
