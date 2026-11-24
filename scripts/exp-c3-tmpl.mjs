// card3 计数模板解剖：countTemplateAssignment + 模板 ASCII + 合成锚 ASCII
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const PORT = 46216;
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
  // 计数模板：从 countGlyphDump 里聚类后的模板不可直接取；用 lastSyntheticAnchors 看合成锚
  const synth = S.lastSyntheticAnchors.current;
  const synthArt = synth ? [...synth].sort((a, b) => a[0].localeCompare(b[0])).map(([k, b]) => `${k}(${b.w}x${b.h}):\n` + art(b).map(r => '  ' + r).join('\n')).join('\n') : 'null';
  return { assignment: S.countTemplateAssignment.map(a => `${a.size}:${a.digit}@${a.dims}`), synthArt };
}, { card });
console.log('指派:', out.assignment.join(' '));
console.log(out.synthArt);
await browser.close(); await vite.close();
