// card4（water-box 瑶图底部图例条）浏览器端判分：parseLegend 图例分支。
// 关键差异：浏览器有 DOM canvas → renderSyntheticDigitTemplates 可用
// （synthTemplates 并入计数候选池），Node 里恒 null——数量成绩须以浏览器为准。
// 用法：node scripts/browser-card4-test.mjs [strip|full]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const vite = await createServer({ root: process.cwd(), server: { port: 46123, strictPort: true }, logLevel: 'error' });
await vite.listen();

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage();
page.on('pageerror', err => console.log('[pageexception]', String(err).slice(0, 300)));
if (process.env.CARD_DEBUG) {
  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('[cnt-') || t.includes('[vdbg') || t.includes('[adb]')) console.log('[page]', t.slice(0, 200));
  });
}
await page.goto('http://localhost:46123', { waitUntil: 'load', timeout: 60000 });

const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'));
const file = process.argv[2] === 'full' ? 'card4-full.jpg' : 'card4-strip.png';
const result = await page.evaluate(async ({ file, truthEntries, debug }) => {
  // 注入 process shim：让源码里 `process.env?.CARD_DEBUG` 守卫在浏览器生效
  if (debug) { window.process = { env: { CARD_DEBUG: '1' } }; }
  const { parseLegend } = await import('/src/utils/importLegend.ts');
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const resp = await fetch(`/benchmark/images/${file}`);
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const source = { data: new Uint8ClampedArray(px.data.buffer), width: bmp.width, height: bmp.height };
  const calib = { originX: 0, originY: 0, cellWidth: 10, cellHeight: 10, columns: 1, rows: 1 };
  const r = parseLegend(source, calib, BRAND_PALETTES.MARD, {});
  return { ok: r.ok, reason: r.failureReason ?? '', entries: r.entries.map(e => ({ code: e.code, count: e.count, warn: e.warn ?? '' })) };
}, { file, truthEntries: truth.card4.entries, debug: !!process.env.CARD_DEBUG });

if (!result.ok) {
  console.log(`[${file}] parseLegend fail: ${result.reason}`);
} else {
  const truthMap = new Map(truth.card4.entries);
  const got = new Map(result.entries.filter(e => e.code).map(e => [e.code, e]));
  let hit = 0, cnt = 0;
  const miss = [], wrong = [], extra = [];
  for (const [c, n] of truthMap) {
    const e = got.get(c);
    if (!e) { miss.push(c); continue; }
    hit += 1;
    if (e.count === n) cnt += 1; else wrong.push(`${c}:${e.count}≠${n}`);
  }
  for (const c of got.keys()) if (!truthMap.has(c)) extra.push(c);
  console.log(`[${file}] entries=${result.entries.length} 色号=${hit}/27 数量=${cnt}/${hit} 漏[${miss}] 多报${extra.length}[${extra}] 错[${wrong}]`);
}
await browser.close();
await vite.close();
