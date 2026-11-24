// 计数字形的墨色统计（rgb/modeRgb 亮度）——门控依据是否可分
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const PORT = 46227;
const vite = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageexception]', String(e).slice(0, 300)));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 60000 });
for (const card of ['card1', 'card2']) {
  const out = await page.evaluate(async ({ card }) => {
    const S = await import('/src/utils/importLegend.ts');
    const resp = await fetch(`/benchmark/images/${card}.png`);
    const bmp = await createImageBitmap(await resp.blob());
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const scan = S.collectCardEntries({ data: img.data, width: img.width, height: img.height });
    const lum = (p) => Math.round(0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]);
    return scan.splits.slice(0, 8).map(sp => sp ? sp.countGlyphs.map(g => `${lum(g.modeRgb)}/${lum(g.rgb)}`) : []);
  }, { card });
  console.log(card, JSON.stringify(out));
}
await browser.close(); await vite.close();
