// card3 计数区解剖（2026-11-24 数量方向）：collectCardEntries 后逐条目 dump
// countGlyphs 的宽高与 ASCII，判断「粒」是否混进数字池、数字位宽是否可比。
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const PORT = 46211;
const card = process.argv[2] || 'card3';
const limit = process.argv[3] ? Number(process.argv[3]) : 6;
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'))[card];

const vite = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageexception]', String(e).slice(0, 300)));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 60000 });

const out = await page.evaluate(async ({ card, limit }) => {
  const mod = await import('/src/utils/importLegend.ts');
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const resp = await fetch(`/benchmark/images/${card}.png`);
  const bmp = await createImageBitmap(await resp.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const source = { data: img.data, width: img.width, height: img.height };
  const S = await import('/src/utils/importLegend.ts');
  const scan = S.collectCardEntries(source);
  if (!scan) return { fail: true };
  const art = (bm) => {
    const rows = [];
    for (let y = 0; y < bm.h; y += 1) {
      let s = '';
      for (let x = 0; x < bm.w; x += 1) s += bm.data[y * bm.w + x] ? '#' : '.';
      rows.push(s);
    }
    return rows;
  };
  const items = scan.splits.slice(0, limit).map((sp, i) => ({
    i,
    codeN: sp ? sp.codeGlyphs.length : -1,
    countN: sp ? sp.countGlyphs.length : -1,
    codeWs: sp ? sp.codeGlyphs.map(g => `${Math.round(g.x0)}:${g.x1 - g.x0 + 1}x${g.y1 - g.y0 + 1}`) : [],
    cnt: sp ? sp.countGlyphs.map(g => ({ x0: Math.round(g.x0), w: g.x1 - g.x0 + 1, h: g.y1 - g.y0 + 1, rows: art(g.bitmap) })) : [],
  }));
  return { fail: false, digitW: scan.digitW, n: scan.splits.length, vertical: scan.vertical, items };
}, { card, limit });

if (out.fail) { console.log('collectCardEntries = null'); }
else {
  console.log(`card=${card} entries=${out.n} digitW=${out.digitW} vertical=${out.vertical}`);
  const T = (truth.entries ?? truth);
  for (const it of out.items) {
    const t = T[it.i];
    console.log(`\n#${it.i} truth=${t ? t.join(':') : '?'}  codeN=${it.codeN}[${it.codeWs.join(' ')}] countN=${it.countN}`);
    for (const g of it.cnt) {
      console.log(`  -- x${g.x0} ${g.w}x${g.h}`);
      console.log(g.rows.map(r => '     ' + r).join('\n'));
    }
  }
}
await browser.close();
await vite.close();
