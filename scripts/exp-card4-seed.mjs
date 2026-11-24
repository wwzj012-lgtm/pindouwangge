// card4 种子回灌实验：两遍式。
// Pass1：无种子 parseLegend → countGlyphDump + codeDigitDump；
//        种子 = ①位置对齐（读出长度==真值长度的条目，逐位相等处采种子，
//        计数字同字体）②codeDigitDump（色号数字，全 10 数字覆盖，跨字体）
// Pass2：带 countSeedTemplates parseLegend → 判分。
// 用法：node scripts/exp-card4-seed.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const vite = await createServer({ root: process.cwd(), server: { port: 46131, strictPort: true }, logLevel: 'error' });
await vite.listen();

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage();
page.on('pageerror', err => console.log('[pageexception]', String(err).slice(0, 300)));
await page.goto('http://localhost:46131', { waitUntil: 'load', timeout: 60000 });

const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8')).card4.entries;

const out = await page.evaluate(async ({ truthEntries, full, iter }) => {
  const { parseLegend, countGlyphDump, codeDigitDump } = await import('/src/utils/importLegend.ts');
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const resp = await fetch('/benchmark/images/card4-strip.png');
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const source = { data: new Uint8ClampedArray(px.data.buffer), width: bmp.width, height: bmp.height };
  const calib = { originX: 0, originY: 0, cellWidth: 10, cellHeight: 10, columns: 1, rows: 1 };

  const run = (seeds) => parseLegend(source, calib, BRAND_PALETTES.MARD, seeds ? { countSeedTemplates: seeds } : {});
  const score = (r) => {
    if (!r.ok) return `fail:${r.failureReason}`;
    const got = new Map(r.entries.filter(e => e.code).map(e => [e.code, e]));
    let hit = 0, cnt = 0; const miss = [], wrong = [];
    for (const [c, n] of truthEntries) {
      const e = got.get(c);
      if (!e) { miss.push(c); continue; }
      hit += 1;
      if (e.count === n) cnt += 1; else wrong.push(`${c}:${e.count}≠${n}`);
    }
    return `entries=${r.entries.length} 色号=${hit}/27 数量=${cnt}/${hit} 错[${wrong.join(' ')}]`;
  };

  // ---- Pass 1：无种子 ----
  const r1 = run(null);
  const dump = countGlyphDump.map(d => ({ entry: d.entry, digit: d.digit, x0: d.x0, w: d.bitmap.w, h: d.bitmap.h, data: Array.from(d.bitmap.data) }));
  const codeDump = codeDigitDump.map(d => ({ digit: d.digit, w: d.bitmap.w, h: d.bitmap.h, data: Array.from(d.bitmap.data) }));

  // ---- 构建种子 ----
  const byEntry = new Map();
  for (const d of dump) {
    const list = byEntry.get(d.entry) ?? [];
    list.push(d);
    byEntry.set(d.entry, list);
  }
  // ---- 迭代种子闭环：每轮用最新 dump 按真值位重采种子，滚雪球 ----
  let seeds = null;
  const rounds = [];
  const ITER = iter;
  for (let it = 0; it <= ITER; it++) {
    const r = run(it === 0 ? null : seeds);
    // 重建 dump（run 内部已刷新 countGlyphDump）
    const dump2 = countGlyphDump.map(d => ({ entry: d.entry, digit: d.digit, x0: d.x0, w: d.bitmap.w, h: d.bitmap.h, data: Array.from(d.bitmap.data) }));
    const byEntry2 = new Map();
    for (const d of dump2) {
      const list = byEntry2.get(d.entry) ?? [];
      list.push(d);
      byEntry2.set(d.entry, list);
    }
    const sc = {};
    let n = 0;
    for (const [entry, glyphs] of byEntry2) {
      if (entry >= truthEntries.length) continue;
      const tCount = String(truthEntries[entry][1]);
      glyphs.sort((a, b) => a.x0 - b.x0);
      if (full) {
        if (glyphs.length !== tCount.length) continue;
        for (let i = 0; i < glyphs.length; i++) {
          const d = tCount[i];
          (sc[d] = sc[d] || []).push({ w: glyphs[i].w, h: glyphs[i].h, data: glyphs[i].data });
          n++;
        }
      } else if (glyphs.map(g => g.digit).join('') === tCount) {
        for (const g of glyphs) {
          (sc[g.digit] = sc[g.digit] || []).push({ w: g.w, h: g.h, data: g.data });
          n++;
        }
      }
    }
    for (const d of codeDump) {
      if (!sc[d.digit]) { sc[d.digit] = [{ w: d.w, h: d.h, data: d.data }]; n++; }
    }
    seeds = new Map(Object.entries(sc).map(([ch, arr]) => {
      const picked = arr.slice(0, 3).map(x => ({ data: new Uint8Array(x.data), w: x.w, h: x.h }));
      return [ch, picked];
    }));
    rounds.push(`#${it}: ${score(r)}  [种子${n}个 覆盖${[...seeds.keys()].sort().join('')}]`);
  }
  return { rounds, dumpSizes: { count: dump.length, code: codeDump.length } };
}, { truthEntries: truth, full: process.env.SEED_MODE === 'full', iter: Number(process.env.SEED_ITER ?? 3) });

out.rounds.forEach(r => console.log(r));
await browser.close();
await vite.close();
