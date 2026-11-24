// card1 计数区的 NN vs 亚像素二值化对比 ASCII（同 bbox）
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const PORT = 46225;
const card = process.argv[2] || 'card1';
const want = (process.argv[3] || '6').split(',').map(Number);
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
  const bg = S.cardPageBg(source);
  const sub = S.buildCardBuffers(source, bg, 4, 60, true).bin;
  const art = (bm) => { const rows = []; for (let y = 0; y < bm.h; y += 1) { let s = ''; for (let x = 0; x < bm.w; x += 1) s += bm.data[y * bm.w + x] ? '#' : '.'; rows.push(s); } return rows; };
  const sub_art = (g) => {
    const w = g.x1 - g.x0 + 1, h = g.y1 - g.y0 + 1;
    const rows = [];
    for (let y = 0; y < h; y += 1) { let s = ''; for (let x = 0; x < w; x += 1) { const o = ((g.y0 + y) * sub.width + (g.x0 + x)) * 4; s += sub.data[o] === 0 ? '#' : '.'; } rows.push(s); }
    return rows;
  };
  return want.map(i => ({ i, cnt: scan.splits[i].countGlyphs.map(g => ({ w: g.x1 - g.x0 + 1, h: g.y1 - g.y0 + 1, nn: art(g.bitmap), sub: sub_art(g) })) }));
}, { card, want });
for (const it of out) {
  const t = truth[it.i];
  console.log(`\n===== #${it.i} ${t ? t.join(':') : '?'} =====`);
  for (const g of it.cnt) {
    console.log(`-- ${g.w}x${g.h}  NN | SUB`);
    const n = Math.max(g.nn.length, g.sub.length);
    for (let k = 0; k < n; k += 1) console.log(`  ${(g.nn[k] || '').padEnd(g.w + 2)} | ${g.sub[k] || ''}`);
  }
}
await browser.close(); await vite.close();
