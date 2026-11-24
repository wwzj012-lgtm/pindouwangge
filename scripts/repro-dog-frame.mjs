// 回归：狗狗图（1108x1215）框选图例条，左右边界内缩若干像素都必须出条目。
//
// 背景（2026-11-24）：这类色卡芯片仅 ~51px 宽、白字压在芯片中部，实色游程被
// 字打断，40px 主路径检出 0 张，只有 12px 小游程救援路径能出 68 张。用户框选
// 时左缘内缩 4px 会让文字行路径恰好凑出 2 条垃圾条目，旧救援门槛「<MIN_ENTRIES
// (2)」判定不成立 → 救援被挡 → 整条图例报 templateStarved（UI 文案「图例字形
// 无法自举识别」）。门槛已提到 RESCUE_SPARSE_ENTRIES(6)。
//
// 用法: node scripts/repro-dog-frame.mjs    （失败退出码 1）
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const PORT = 46161;
const vite = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage();
page.on('crash', () => console.log('[page CRASH]'));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 60000 });

const out = await page.evaluate(async () => {
  const { parseLegend } = await import('/src/utils/importLegend.ts');
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const resp = await fetch('/benchmark/images/dog-girl.png');
  const bmp = await createImageBitmap(await resp.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const source = { data: img.data, width: img.width, height: img.height };
  const cell = 14.439;
  const cal = { originX: 0, originY: 0, cellWidth: cell, cellHeight: cell,
    columns: Math.round(bmp.width / cell), rows: Math.round(bmp.height / cell) };
  const palette = BRAND_PALETTES.MARD;

  const res = [];
  // 左缘/右缘内缩 0-8px、上下各留 1-5px 余量（模拟用户手框）
  for (const x0 of [0, 1, 2, 3, 4, 5, 6, 8]) {
    for (const dx1 of [0, 5]) {
      const region = { x0, y0: 1129, x1: 1107 - dx1, y1: 1211 };
      const r = parseLegend(source, cal, palette, { gridRows: cal.rows, gridCols: cal.columns, region });
      res.push({ region, ok: r.ok, reason: r.failureReason ?? null, n: r.entries.length });
    }
  }
  return res;
});

let failed = 0;
for (const r of out) {
  const pass = r.ok && r.n >= 40;
  if (!pass) failed += 1;
  const { region } = r;
  console.log(`${pass ? 'PASS' : 'FAIL'}  x0=${region.x0} x1=${region.x1}  ok=${r.ok} entries=${r.n} ${r.reason ?? ''}`);
}
console.log(`\n${out.length - failed}/${out.length} 通过`);

await browser.close();
await vite.close();
process.exit(failed ? 1 : 0);
