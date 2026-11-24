// 浏览器端 card 诊断：注入 process.env.CARD_DEBUG，抓管线日志 + 指定条目状态
// 用法：node scripts/browser-card-dbg.mjs [card] [grep关键字]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const card = process.argv[2] ?? 'card1';
const filter = process.argv[3] ?? '';

const vite = await createServer({ root: process.cwd(), server: { port: 46123, strictPort: true }, logLevel: 'error' });
await vite.listen();

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage();
const logs = [];
page.on('console', msg => {
  if (msg.type() === 'error' || msg.type() === 'warning') logs.push(msg.text());
});
page.on('pageerror', err => logs.push('[pageexception] ' + String(err)));
await page.addInitScript(() => {
  window.process = { env: { CARD_DEBUG: '1' } };
});
await page.goto('http://localhost:46123', { waitUntil: 'load', timeout: 60000 });

const result = await page.evaluate(async ({ card }) => {
  const { parseColorCard } = await import('/src/utils/importLegend.ts');
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const resp = await fetch(`/benchmark/images/${card}.png`);
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const source = { data: img.data, width: img.width, height: img.height };
  const r = parseColorCard(source, BRAND_PALETTES.MARD);
  return {
    ok: r.ok,
    entries: r.entries.map(e => ({ code: e.code || null, count: e.count, conf: Number(e.confidence.toFixed(2)), warn: e.warn ?? null })),
  };
}, { card });

for (const l of logs) {
  if (!filter || l.includes(filter)) console.log(l);
}
console.log('=== entries ===');
result.entries.forEach((e, i) => console.log(`#${i}`, JSON.stringify(e.code), e.count, e.conf, e.warn || ''));

await browser.close();
await vite.close();
