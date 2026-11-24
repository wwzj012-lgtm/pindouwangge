// 条目的 code/count 两侧字形统计（含 ASCII 可选）
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const PORT = 46223;
const card = process.argv[2] || 'card1';
const want = (process.argv[3] || '2,21,35').split(',').map(Number);
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
  const scan = S.collectCardEntries({ data: img.data, width: img.width, height: img.height });
  const art = (bm) => { const rows = []; for (let y = 0; y < bm.h; y += 1) { let s = ''; for (let x = 0; x < bm.w; x += 1) s += bm.data[y * bm.w + x] ? '#' : '.'; rows.push(s); } return rows; };
  const pack = (g) => ({ x0: Math.round(g.x0), x1: Math.round(g.x1), w: g.x1 - g.x0 + 1, h: g.y1 - g.y0 + 1, rows: art(g.bitmap) });
  return { digitW: scan.digitW, vertical: scan.vertical, items: want.map(i => ({ i, code: scan.splits[i].codeGlyphs.map(pack), cnt: scan.splits[i].countGlyphs.map(pack) })) };
}, { card, want });
console.log(`digitW=${out.digitW} vertical=${out.vertical}`);
for (const it of out.items) {
  const t = truth[it.i];
  console.log(`\n#${it.i} ${t ? t.join(':') : '?'} code=[${it.code.map(g => `${g.x0}:${g.w}x${g.h}`).join(' ')}] cnt=[${it.cnt.map(g => `${g.x0}:${g.w}x${g.h}`).join(' ')}]`);
  for (const g of [...it.code, ...it.cnt]) { console.log(` -- x${g.x0} ${g.w}x${g.h}`); console.log(g.rows.map(r => '    ' + r).join('\n')); }
}
await browser.close(); await vite.close();
