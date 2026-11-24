// card4 码字种子回灌实验：两遍式（与计数种子同构）。
// Pass1：无种子 parseLegend → codeGlyphDump；
//        种子 = 最终 code 与真值逐位相等的已验证条目，其 code 字形按真值位标注。
// Pass2：带 codeSeedGlyphs parseLegend → 判分（色号层）。
// 用法：node scripts/exp-card4-codeseed.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const vite = await createServer({ root: process.cwd(), server: { port: 46161, strictPort: true }, logLevel: 'error' });
await vite.listen();

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage();
page.on('pageerror', err => console.log('[pageexception]', String(err).slice(0, 300)));
await page.goto('http://localhost:46161', { waitUntil: 'load', timeout: 60000 });

const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8')).card4.entries;

const out = await page.evaluate(async (truthEntries) => {
  const { parseLegend, codeGlyphDump } = await import('/src/utils/importLegend.ts');
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

  const run = (codeSeeds) => parseLegend(source, calib, BRAND_PALETTES.MARD, codeSeeds ? { codeSeedGlyphs: codeSeeds } : {});
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
    return `entries=${r.entries.length} 色号=${hit}/27 数量=${cnt}/${hit} 漏[${miss}] 错[${wrong.join(' ')}]`;
  };

  // ---- Pass 1：无种子 ----
  const r1 = run(null);
  const dump = codeGlyphDump.map(d => ({ entry: d.entry, index: d.index, x0: d.x0, w: d.bitmap.w, h: d.bitmap.h, data: Array.from(d.bitmap.data) }));

  // ---- 构建码字种子：已验证条目（最终 code == 真值）逐位标注 ----
  const seedChars = {};
  let seededEntries = 0;
  r1.entries.forEach((e, i) => {
    if (!e.code) return;
    const t = truthEntries.find(([c]) => c === e.code);
    if (!t) return;
    const glyphs = dump.filter(d => d.entry === i).sort((a, b) => a.index - b.index);
    if (glyphs.length !== e.code.length) return;
    seededEntries += 1;
    e.code.split('').forEach((ch, j) => {
      (seedChars[ch] = seedChars[ch] || []).push({ w: glyphs[j].w, h: glyphs[j].h, data: glyphs[j].data });
    });
  });
  const seeds = new Map(Object.entries(seedChars).map(([ch, arr]) => {
    const picked = arr.slice(0, 3).map(x => ({ data: new Uint8Array(x.data), w: x.w, h: x.h }));
    return [ch, picked];
  }));

  // ---- Pass 2：带码字种子 ----
  const r2 = run(seeds);
  const dump2 = codeGlyphDump.filter(d => d.entry >= 0).length;
  return {
    pass1: score(r1),
    pass2: score(r2),
    seededEntries,
    seedChars: [...seeds.keys()].sort().join(''),
    seedCount: [...seeds.values()].reduce((s, a) => s + a.length, 0),
    dump2,
  };
}, truth);

console.log(`Pass1(无种子): ${out.pass1}`);
console.log(`种子: ${out.seededEntries} 个已验证条目 → ${out.seedCount} 个字形，覆盖 [${out.seedChars}]`);
console.log(`Pass2(带种子): ${out.pass2}`);

await browser.close();
await vite.close();
