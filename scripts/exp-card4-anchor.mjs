// card4 静态基准锚实验：锚绕过 prune，只补实时池缺字。
// Pass1：无锚 → 已验证条目（code==truth）字形按真值标注 = 锚库。
// Pass2：带 codeAnchorGlyphs → 判分。
// 用法：node scripts/exp-card4-anchor.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const vite = await createServer({ root: process.cwd(), server: { port: 46171, strictPort: true }, logLevel: 'error' });
await vite.listen();

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage();
page.on('pageerror', err => console.log('[pageexception]', String(err).slice(0, 300)));
await page.goto('http://localhost:46171', { waitUntil: 'load', timeout: 60000 });

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

  const run = (anchors) => parseLegend(source, calib, BRAND_PALETTES.MARD, anchors ? { codeAnchorGlyphs: anchors } : {});
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

  // ---- Pass 1：无锚 ----
  const r1 = run(null);
  const dump = codeGlyphDump.map(d => ({ entry: d.entry, index: d.index, w: d.bitmap.w, h: d.bitmap.h, data: Array.from(d.bitmap.data) }));

  // ---- 锚库：已验证条目（最终 code == 真值）逐位标注，每字符留全部实例 ----
  const anchorChars = {};
  r1.entries.forEach((e, i) => {
    if (!e.code) return;
    if (!truthEntries.some(([c]) => c === e.code)) return;
    const glyphs = dump.filter(d => d.entry === i).sort((a, b) => a.index - b.index);
    if (glyphs.length !== e.code.length) return;
    e.code.split('').forEach((ch, j) => {
      (anchorChars[ch] = anchorChars[ch] || []).push({ w: glyphs[j].w, h: glyphs[j].h, data: glyphs[j].data });
    });
  });
  const anchors = new Map(Object.entries(anchorChars).map(([ch, arr]) => {
    // 静态锚不重复与自举同源——同一位图多实例对均值无益且加剧聚类路径敏感，
    // 每字符最多留 2 个代表实例（位图串去重）。
    const seen = new Set();
    const uniq = [];
    for (const x of arr) {
      const key = `${x.w}x${x.h}:${x.data.join('')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push({ data: new Uint8Array(x.data), w: x.w, h: x.h });
      if (uniq.length >= 2) break;
    }
    return [ch, uniq];
  }));

  // ---- Pass 2：带锚 ----
  const r2 = run(anchors);
  return {
    pass1: score(r1),
    pass2: score(r2),
    anchorChars: [...anchors.keys()].sort().join(''),
    anchorCount: [...anchors.values()].reduce((s, a) => s + a.length, 0),
  };
}, truth);

console.log(`Pass1(无锚): ${out.pass1}`);
console.log(`锚库: ${out.anchorCount} 个字形，覆盖 [${out.anchorChars}]`);
console.log(`Pass2(带锚): ${out.pass2}`);

await browser.close();
await vite.close();
