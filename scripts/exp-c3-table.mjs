// card3/card1 计数区统计表（无 ASCII）：逐条目打印 countGlyphs 的 宽x高 + 真值位数，
// 用于判断「粒」在字形序列里的位置/尺寸特征，以及 4 位数字的可行性。
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const PORT = 46212;
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
  const resp = await fetch(`/benchmark/images/${card}.png`);
  const bmp = await createImageBitmap(await resp.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const source = { data: img.data, width: img.width, height: img.height };
  const scan = S.collectCardEntries(source);
  if (!scan) return { fail: true };
  return {
    fail: false,
    digitW: scan.digitW,
    vertical: scan.vertical,
    rows: scan.splits.map(sp => sp ? {
      code: sp.codeGlyphs.map(g => `${g.x1 - g.x0 + 1}x${g.y1 - g.y0 + 1}`).join(','),
      cnt: sp.countGlyphs.map(g => `${Math.round(g.x0)}:${g.x1 - g.x0 + 1}x${g.y1 - g.y0 + 1}`).join(' '),
      cntH: sp.countGlyphs.map(g => g.y1 - g.y0 + 1),
      cntW: sp.countGlyphs.map(g => g.x1 - g.x0 + 1),
      cntX: sp.countGlyphs.map(g => Math.round(g.x0)),
    } : null),
  };
}, { card });

if (out.fail) console.log('null');
else {
  console.log(`card=${card} n=${out.rows.length} digitW=${out.digitW} vertical=${out.vertical}`);
  out.rows.forEach((r, i) => {
    const t = truth[i];
    const td = t ? String(t[1]) : '';
    const hs = r ? `H[${r.cntH.join(' ')}]` : '';
    console.log(`#${String(i).padStart(2)} 真${(t ? t[0] : '?')}:${td.padStart(5)}(位${td.length}) n=${r ? r.cntH.length : 0} ${hs} ${r ? r.cnt : 'NULL'}`);
  });
}
await browser.close();
await vite.close();
