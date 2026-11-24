// 标定敏感性扫描（2026-11-15）：App 实测（用户截图）与 browser-legend-test
// 基线（17/27）不一致——唯一自由变量是标定参数。本脚本在同一页面会话里
// 扫描 cell/origin 微扰，找出复现 App 错误模式（D10 886 / D24 177 / D8 403）
// 的标定域，再针对性加固。
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const vite = await createServer({ root: process.cwd(), server: { port: 46121, strictPort: true }, logLevel: 'error' });
await vite.listen();

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage();
page.on('pageerror', err => console.log('[pageexception]', String(err).slice(0, 300)));
await page.goto('http://localhost:46121', { waitUntil: 'load', timeout: 60000 });

const out = await page.evaluate(async () => {
  const { parseLegend } = await import('/src/utils/importLegend.ts');
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const resp = await fetch('/benchmark/images/water-box.jpg');
  const bmp = await createImageBitmap(await resp.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const source = { data: img.data, width: img.width, height: img.height };

  const results = [];
  const cells = [8.72, 8.76, 8.79, 8.82, 8.86, 8.9];
  const origins = [[275, 115], [276, 116], [277, 117], [275.5, 116.5]];
  for (const cell of cells) {
    for (const [ox, oy] of origins) {
      const CAL = { originX: ox, originY: oy, cellWidth: cell, cellHeight: cell, columns: 101, rows: 132 };
      // 模拟用户框选图例区域（底部条带）：App 的 region 直通路径
      const region = { x0: 0, y0: 1180, x1: 1440, y1: 1440 };
      const legend = parseLegend(source, CAL, BRAND_PALETTES.MARD, { gridRows: 132, gridCols: 101, region });
      if (!legend.ok) { results.push({ cell, ox, oy, fail: legend.failureReason }); continue; }
      const byCode = new Map(legend.entries.map(e => [e.code, e.count]));
      results.push({
        cell, ox, oy,
        n: legend.entries.length,
        D10: byCode.get('D10') ?? '-',
        D24: byCode.get('D24') ?? '-',
        D8: byCode.get('D8') ?? '-',
        H1: byCode.get('H1') ?? '-',
        C13: byCode.get('C13') ?? '-',
        unknown: legend.entries.filter(e => !['C13','D1','D3','D7','D9','D17','D24','E14','E17','F17','G1','G16','H1','M14','C29','D2','D4','D8','D10','D23','E2','E16','F16','F20','G15','G17','H13'].includes(e.code)).map(e => e.code + ':' + e.count).join(' '),
      });
    }
  }
  return results;
});

for (const r of out) console.log(JSON.stringify(r));

await browser.close();
await vite.close();
process.exit(0);
