// 已知真值字形 vs 两套模板的距离排序（countTemplates / synth 锚）
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const PORT = 46224;
const card = process.argv[2] || 'card1';
const entries = (process.argv[3] || '6,8').split(',').map(Number);
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'))[card].entries;
const vite = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageexception]', String(e).slice(0, 300)));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 60000 });
const out = await page.evaluate(async ({ card, entries }) => {
  const S = await import('/src/utils/importLegend.ts');
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const resp = await fetch(`/benchmark/images/${card}.png`);
  const bmp = await createImageBitmap(await resp.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  S.parseColorCard({ data: img.data, width: img.width, height: img.height }, BRAND_PALETTES.MARD);
  const real = S.lastCountTemplates.current;
  const synth = S.lastSyntheticAnchors.current;
  const rank = (bm, tpl, pad) => {
    if (!tpl) return [];
    return [...tpl].map(([k, t]) => ({ k, d: pad ? 0 : 0 })).map(o => o) && [...tpl]
      .map(([k, t]) => {
        // 直接用 matchGlyph 单模板比较：临时构造单元素 map
        const m = S.matchGlyph(bm, new Map([[k, t]]), pad);
        return `${k}:${m ? m.distance.toFixed(3) : '-'}`;
      })
      .sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]))
      .slice(0, 4);
  };
  return S.countGlyphDump.filter(d => entries.includes(d.entry)).map(d => ({
    entry: d.entry, digit: d.digit, w: d.bitmap.w, h: d.bitmap.h,
    real: rank(d.bitmap, real, false), synth: rank(d.bitmap, synth, true),
  }));
}, { card, entries });
for (const g of out) {
  const t = truth[g.entry];
  console.log(`#${g.entry} ${t ? t.join(':') : '?'} 真位数=${t ? String(t[1]).length : '?'} ${g.w}x${g.h} 派'${g.digit}'`);
  console.log(`   real : ${g.real.join(' ')}`);
  console.log(`   synth: ${g.synth.join(' ')}`);
}
await browser.close(); await vite.close();
