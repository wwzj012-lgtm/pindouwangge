// 浏览器端色卡识别测试（2026-11-23）：真实浏览器（DOM canvas → 合成数字锚可用）
// 里跑 parseColorCard，benchmark/truth-cards.json 真值判分（集合级色号 + 数量）。
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
page.on('console', msg => { if (msg.type() === 'error') console.log('[page-error]', msg.text().slice(0, 200)); });
page.on('pageerror', err => console.log('[pageexception]', String(err).slice(0, 300)));
await page.goto('http://localhost:46121', { waitUntil: 'load', timeout: 60000 });

const cards = process.argv[2] ? [process.argv[2]] : ['card1', 'card2', 'card3'];
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'));

for (const card of cards) {
  const truthCard = truth[card];
  const result = await page.evaluate(async ({ card }) => {
    const { parseColorCard, debugColorCardParse } = await import('/src/utils/importLegend.ts');
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
    const t0 = performance.now();
    const r = parseColorCard(source, BRAND_PALETTES.MARD);
    const ms = Math.round(performance.now() - t0);
    const dbg = debugColorCardParse(source);
    return {
      ok: r.ok,
      failureReason: r.failureReason ?? null,
      ms,
      entries: r.entries.map(e => ({ code: e.code || null, count: e.count, warn: e.warn ?? null })),
      gates: dbg?.gates ?? null,
    };
  }, { card });

  const truthEntries = truthCard.entries ?? truthCard;
  const truthMap = new Map(truthEntries);
  const got = new Map(result.entries.filter(e => e.code).map(e => [e.code, e]));
  let codeHit = 0, countHit = 0;
  const miss = [], wrong = [], extra = [];
  for (const [c, n] of truthMap) {
    const e = got.get(c);
    if (!e) { miss.push(c); continue; }
    codeHit += 1;
    if (e.count === n) countHit += 1;
    else wrong.push(`${c}:${e.count}≠${n}`);
  }
  for (const c of got.keys()) if (!truthMap.has(c)) extra.push(c);
  console.log(`\n=== ${card}（浏览器 ${result.ms}ms ok=${result.ok}） ===`);
  console.log(`色号 ${codeHit}/${truthMap.size} 漏[${miss.join(',') || '无'}] 多报${extra.length}[${extra.slice(0, 12).join(',')}]`);
  console.log(`数量对 ${countHit}/${codeHit} 错[${wrong.slice(0, 8).join(' ')}${wrong.length > 8 ? ' …' : ''}]`);
}

await browser.close();
await vite.close();
