// card4 全真值锚实验：锚库 = 已验证条目 + 用户目检确认的漏槽（可对齐者）。
// E2：切分 3 字形 vs 真值 2 位——按位置对齐只标前两位（E/2）。
// G15：切分 3 字形 == 真值 3 位——全标（G/1/5，'5' 是池中唯一缺失数字）。
// G17/H13：字形数与真值对不上（焊连/少字），跳过。
// 用法：node scripts/exp-card4-anchor-full.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const vite = await createServer({ root: process.cwd(), server: { port: 46173, strictPort: true }, logLevel: 'error' });
await vite.listen();

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage();
page.on('pageerror', err => console.log('[pageexception]', String(err).slice(0, 300)));
await page.goto('http://localhost:46173', { waitUntil: 'load', timeout: 60000 });

const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8')).card4.entries;
const truthMap = new Map(truth);
// 用户目检确认的漏槽（本卡人工校对闭环的数据源）
const MANUAL = new Set(['E2', 'G15', 'M14', 'G17', 'H13']);

const out = await page.evaluate(async ({ truthEntries, manualCodes }) => {
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

  const r1 = run(null);
  const dump = codeGlyphDump.map(d => ({ entry: d.entry, index: d.index, x0: d.x0, w: d.bitmap.w, h: d.bitmap.h, data: Array.from(d.bitmap.data) }));

  // 锚库：①已验证条目（code==truth 全对齐）②人工确认漏槽（前缀对齐）
  const anchorChars = {};
  let viaVerify = 0, viaManual = 0;
  r1.entries.forEach((e, i) => {
    if (!e.code) return;
    const glyphs = dump.filter(d => d.entry === i).sort((a, b) => a.index - b.index);
    const t = truthMapGet(e.code);
    if (t && glyphs.length === e.code.length) {
      // 全对齐已验证
      e.code.split('').forEach((ch, j) => push(ch, glyphs[j]));
      viaVerify += 1;
      return;
    }
    // 人工确认漏槽：条目按真值槽位识别（用 x 坐标最近真值槽）——此处直接
    // 遍历真值里被人工确认的码，与该条目的槽位对应关系由调用方预处理。
  });
  function truthMapGet(code) { return truthEntries.find(([c]) => c === code); }
  function push(ch, g) { (anchorChars[ch] = anchorChars[ch] || []).push({ w: g.w, h: g.h, data: g.data }); }

  // 人工漏槽：pipe.code 与 truth 不一致 → 按 entry 顺序映射（27 条目严格
  // 对应 27 真值槽，顺序由装配层保证）。漏槽条目 = final code ∉ truth 或
  // duplicate——用槽位 i 直接取真值。
  r1.entries.forEach((e, i) => {
    if (!e.code) return;
    const tPair = truthEntries[i];
    if (!tPair) return;
    const [tCode] = tPair;
    if (e.code === tCode) return; // 已验证，上面处理过
    if (!manualCodes.includes(tCode)) return;
    const glyphs = dump.filter(d => d.entry === i).sort((a, b) => a.index - b.index);
    // 前缀对齐：真值码前 N 位与字形前 N 位一一对齐（N = min(长度)），
    // 前提：条目 codeGlyphs 从条目首字形开始，位置 0 必然是真值首位。
    const n = Math.min(glyphs.length, tCode.length);
    for (let j = 0; j < n; j += 1) push(tCode[j], glyphs[j]);
    viaManual += 1;
  });

  const anchors = new Map(Object.entries(anchorChars).map(([ch, arr]) => {
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

  const r2 = run(anchors);
  return {
    pass1: score(r1),
    pass2: score(r2),
    viaVerify, viaManual,
    anchorChars: [...anchors.keys()].sort().join(''),
    has5: anchors.has('5'),
  };
}, { truthEntries: truth, manualCodes: [...MANUAL] });

console.log(`Pass1(无锚): ${out.pass1}`);
console.log(`锚库: 已验证 ${out.viaVerify} 条 + 人工确认 ${out.viaManual} 条，覆盖 [${out.anchorChars}] 含'5'=${out.has5}`);
console.log(`Pass2(全真值锚): ${out.pass2}`);

await browser.close();
await vite.close();
