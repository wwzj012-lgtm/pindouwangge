// card1 指定条目：整行 ASCII（1x 采样自 4x 二值缓冲）+ 字形框标注
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const PORT = 46302;
const card = process.argv[2] || 'card1';
const idx = (process.argv[3] || '2').split(',').map(Number);
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'))[card].entries;
const vite = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageexception]', String(e).slice(0, 300)));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 60000 });
const out = await page.evaluate(async ({ card, idx }) => {
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
  const bin = S.buildCardBuffers(source, bg, 4, 60).bin;
  const res = [];
  for (const i of idx) {
    const sp = scan.splits[i];
    if (!sp) { res.push({ i, none: true }); continue; }
    const all = [...sp.codeGlyphs, ...sp.countGlyphs];
    if (!all.length) { res.push({ i, none: true }); continue; }
    const y0 = Math.min(...all.map(g => g.y0)), y1 = Math.max(...all.map(g => g.y1));
    const xa = Math.min(...all.map(g => g.x0)) - 40, xb = Math.max(...all.map(g => g.x1)) + 60;
    const rows = [];
    for (let y = y0; y <= y1; y += 4) {
      let s = '';
      for (let x = xa; x <= xb; x += 4) s += bin.data[(y * bin.width + x) * 4] === 0 ? '#' : '.';
      rows.push(s);
    }
    res.push({ i, y0, y1, xa, xb, rows, nCode: sp.codeGlyphs.length, nCount: sp.countGlyphs.length });
  }
  return res;
}, { card, idx });
for (const r of out) {
  const t = truth[r.i];
  console.log(`\n===== #${r.i} ${t ? t.join(':') : '?'} code=${r.nCode} count=${r.nCount} y${r.y0}-${r.y1} x${r.xa}..${r.xb} =====`);
  if (r.rows) console.log(r.rows.map(x => '  ' + x).join('\n'));
}
await browser.close(); await vite.close();
