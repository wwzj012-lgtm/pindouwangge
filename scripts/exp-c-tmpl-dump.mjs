// 计数模板自身：宽高/孔洞数/ASCII（card 路径，胜出模板）
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const PORT = 46221;
const card = process.argv[2] || 'card3';
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
  S.parseColorCard({ data: img.data, width: img.width, height: img.height }, BRAND_PALETTES.MARD);
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
  const art = (bm) => { const rows = []; for (let y = 0; y < bm.h; y += 1) { let s = ''; for (let x = 0; x < bm.w; x += 1) s += bm.data[y * bm.w + x] ? '#' : '.'; rows.push(s); } return rows; };
  const t = S.lastCountTemplates.current;
  return t ? [...t].sort((a, b) => a[0].localeCompare(b[0])).map(([k, b]) => ({ k, w: b.w, h: b.h, holes: holes(b), rows: art(b) })) : null;
}, { card });
if (!out) console.log('null');
else for (const g of out) {
  console.log(`'${g.k}' ${g.w}x${g.h} holes=${g.holes}`);
  console.log(g.rows.map(r => '   ' + r).join('\n'));
}
await browser.close(); await vite.close();
