// 孔洞特征可分性：card3 计数单字的孔洞数 vs 真值数字
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const PORT = 46220;
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
  const source = { data: img.data, width: img.width, height: img.height };
  S.parseColorCard(source, BRAND_PALETTES.MARD);
  const holes = (bm) => {
    const { data, w, h } = bm;
    const vis = new Uint8Array(w * h);
    const flood = (s) => { const st = [s]; vis[s] = 1; while (st.length) { const p = st.pop(); const x = p % w, y = Math.floor(p / w);
      if (x > 0 && !data[p - 1] && !vis[p - 1]) { vis[p - 1] = 1; st.push(p - 1); }
      if (x < w - 1 && !data[p + 1] && !vis[p + 1]) { vis[p + 1] = 1; st.push(p + 1); }
      if (y > 0 && !data[p - w] && !vis[p - w]) { vis[p - w] = 1; st.push(p - w); }
      if (y < h - 1 && !data[p + w] && !vis[p + w]) { vis[p + w] = 1; st.push(p + w); } } };
    for (let x = 0; x < w; x += 1) { if (!data[x] && !vis[x]) flood(x); if (!data[(h - 1) * w + x] && !vis[(h - 1) * w + x]) flood((h - 1) * w + x); }
    for (let y = 0; y < h; y += 1) { if (!data[y * w] && !vis[y * w]) flood(y * w); if (!data[y * w + w - 1] && !vis[y * w + w - 1]) flood(y * w + w - 1); }
    let n = 0;
    for (let p = 0; p < w * h; p += 1) if (!data[p] && !vis[p]) { flood(p); n += 1; }
    return n;
  };
  return S.countGlyphDump.map(d => ({ entry: d.entry, digit: d.digit, x0: Math.round(d.x0), w: d.bitmap.w, h: d.bitmap.h, holes: holes(d.bitmap) }));
}, { card });
const by = new Map();
for (const d of out) { if (!by.has(d.entry)) by.set(d.entry, []); by.get(d.entry).push(d); }
const stat = new Map();
for (const [entry, gs] of [...by].sort((a, b) => a[0] - b[0])) {
  gs.sort((a, b) => a.x0 - b.x0);
  const t = truth[entry]; if (!t) continue;
  const want = String(t[1]);
  if (gs.length !== want.length) continue;
  gs.forEach((g, i) => {
    const k = `${want[i]}:h${g.holes}`;
    stat.set(k, (stat.get(k) || 0) + 1);
    if (g.digit !== want[i]) console.log(`#${entry} 真${want[i]} 派${g.digit} ${g.w}x${g.h} holes=${g.holes}`);
  });
}
console.log('\n真值数字→孔洞数 分布:');
console.log([...stat].sort().map(([k, v]) => `${k}×${v}`).join('  '));
await browser.close(); await vite.close();
