// card4 终局组合实验：码字锚（codeAnchorGlyphs）+ 计数种子（countSeedTemplates）
// 数据源 = 27 槽全量人工校对（card4-calibrated.json）。
// 用法：node scripts/exp-card4-final.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const vite = await createServer({ root: process.cwd(), server: { port: 46179, strictPort: true }, logLevel: 'error' });
await vite.listen();

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage();
page.on('pageerror', err => console.log('[pageexception]', String(err).slice(0, 300)));
await page.goto('http://localhost:46179', { waitUntil: 'load', timeout: 60000 });

const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8')).card4.entries;

const out = await page.evaluate(async (truthEntries) => {
  const { parseLegend, codeGlyphDump, countGlyphDump } = await import('/src/utils/importLegend.ts');
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

  const run = (opts) => parseLegend(source, calib, BRAND_PALETTES.MARD, opts || {});
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

  // ---- Pass 1：无种子（采集 dump）----
  const r1 = run(null);
  const codeDump = codeGlyphDump.map(d => ({ entry: d.entry, index: d.index, w: d.bitmap.w, h: d.bitmap.h, data: Array.from(d.bitmap.data) }));
  const cntDump = countGlyphDump.map(d => ({ entry: d.entry, digit: d.digit, x0: d.x0, w: d.bitmap.w, h: d.bitmap.h, data: Array.from(d.bitmap.data) }));

  // ---- 码字锚：已验证 + 人工确认漏槽前缀对齐（与 exp-card4-anchor-full 同逻辑）----
  const MANUAL = new Set(['E2', 'G15', 'M14', 'G17', 'H13']);
  const anchorChars = {};
  r1.entries.forEach((e, i) => {
    if (!e.code) return;
    const glyphs = codeDump.filter(d => d.entry === i).sort((a, b) => a.index - b.index);
    const t = truthEntries.find(([c]) => c === e.code);
    if (t && glyphs.length === e.code.length) {
      e.code.split('').forEach((ch, j) => push(ch, glyphs[j]));
      return;
    }
    const tCode = truthEntries[i]?.[0];
    if (tCode && e.code !== tCode && MANUAL.has(tCode)) {
      const n = Math.min(glyphs.length, tCode.length);
      for (let j = 0; j < n; j += 1) push(tCode[j], glyphs[j]);
    }
  });
  function push(ch, g) { (anchorChars[ch] = anchorChars[ch] || []).push({ w: g.w, h: g.h, data: g.data }); }
  const codeAnchors = new Map(Object.entries(anchorChars).map(([ch, arr]) => {
    const seen = new Set(); const uniq = [];
    for (const x of arr) {
      const key = `${x.w}x${x.h}:${x.data.join('')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push({ data: new Uint8Array(x.data), w: x.w, h: x.h });
      if (uniq.length >= 3) break;
    }
    return [ch, uniq];
  }));

  // ---- 计数种子：数量已验证条目（count == 真值）的 dump 字形。
  // 注意：dump 字形可能稀疏（部分字形被毒标进别的簇不进本条目组），
  // 但「数量读对」这一事实保证该条目留在 dump 里的字形标签整体可信——
  // 逐个按管线标签入种子，不强求全对齐。 ----
  const cntChars = {};
  const pushCnt = (ch, g) => { (cntChars[ch] = cntChars[ch] || []).push({ w: g.w, h: g.h, data: g.data }); };
  r1.entries.forEach((e, i) => {
    if (!e.code || !e.count) return;
    const t = truthEntries.find(([c]) => c === e.code);
    if (!t || e.count !== t[1]) return;
    for (const d of cntDump.filter(x => x.entry === i)) pushCnt(d.digit, d);
  });
  // 更严谨：数量对 = digit 串 == 真值串，直接用 dump 的 digit 标签
  const countSeeds = new Map(Object.entries(cntChars).map(([ch, arr]) => {
    const picked = arr.slice(0, 3).map(x => ({ data: new Uint8Array(x.data), w: x.w, h: x.h }));
    return [ch, picked];
  }));

  // ---- Pass 2：双种子 ----
  const r2 = run({ codeAnchorGlyphs: codeAnchors, countSeedTemplates: countSeeds });
  // ---- Pass 3：仅码锚（对照）----
  const r3 = run({ codeAnchorGlyphs: codeAnchors });
  return {
    pass1: score(r1),
    pass2: score(r2),
    pass3: score(r3),
    codeChars: [...codeAnchors.keys()].sort().join(''),
    cntChars: [...countSeeds.keys()].sort().join(''),
  };
}, truth);

console.log(`Pass1(无种子): ${out.pass1}`);
console.log(`Pass3(仅码锚): ${out.pass3}`);
console.log(`Pass2(码锚+数量种子): ${out.pass2}`);
console.log(`锚覆盖: 码[${out.codeChars}] 数量[${out.cntChars}]`);

await browser.close();
await vite.close();
