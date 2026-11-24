// 图例字形锚库 v1：把人工校对确认的字形固化为持久化 JSON，按版式指纹隔离。
// 指纹 = `${digitW}x${glyphH}`（点状图例小字 4x9；票式色卡字体完全不同，
// 跨版式不借锚——water-box 跨字体锚 953→83 的老坑）。
// 用法：
//   node scripts/build-anchor-library.mjs card4   ← 从 card4 校对数据生成/合并
//   node scripts/build-anchor-library.mjs --verify card4  ← 端到端：加载库→识别→判分
process.chdir('D:/Build_Apps/pindouwangge');
const { createServer } = await import('vite');
const { chromium } = await import('playwright-core');
const fs = (await import('fs')).default;
const readFileSync = (await import('fs')).readFileSync;

const LIB_PATH = 'benchmark/anchors/legend-anchor-library.json';
const CARD = process.argv[2] === '--verify' ? process.argv[3] : process.argv[2];
const VERIFY = process.argv[2] === '--verify';
if (!CARD) { console.error('usage: node scripts/build-anchor-library.mjs [card|--verify card]'); process.exit(1); }

const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'))[CARD].entries;
const truthMap = new Map(truth);
const calibPath = `benchmark/results/${CARD}-calibrated.json`;
const calibrated = fs.existsSync(calibPath) ? JSON.parse(readFileSync(calibPath, 'utf8')) : null;
// 人工确认过的漏槽码（管线读错但用户校对了的）：card4 = M14/E2/G15/G17/H13
const manualCodes = calibrated ? calibrated.final.map(([c]) => c) : [];

const vite = await createServer({ root: process.cwd(), server: { port: 46191, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
page.on('pageerror', err => console.log('[pageexception]', String(err).slice(0, 300)));
page.on('console', m => { const t = m.text(); if (t.includes('verify-diag')) console.log(t.slice(0, 400)); });
await page.goto('http://localhost:46191', { waitUntil: 'load', timeout: 60000 });

const out = await page.evaluate(async ({ card, truthEntries, manual, verify }) => {
  const { parseLegend, codeGlyphDump } = await import('/src/utils/importLegend.ts');
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const resp = await fetch(`/benchmark/images/${card}-strip.png`);
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const source = { data: new Uint8ClampedArray(px.data.buffer), width: bmp.width, height: bmp.height };
  const calib = { originX: 0, originY: 0, cellWidth: 10, cellHeight: 10, columns: 1, rows: 1 };

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
    return `色号=${hit}/27 数量=${cnt}/${hit} 漏[${miss}]`;
  };

  // ---- Pass1：无锚（采集 dump + 指纹）----
  const r1 = parseLegend(source, calib, BRAND_PALETTES.MARD, {});
  const dump = codeGlyphDump.map(d => ({ entry: d.entry, index: d.index, w: d.bitmap.w, h: d.bitmap.h, data: Array.from(d.bitmap.data) }));
  const digitWidths = [];
  for (const e of r1.entries) void e;
  // 指纹：codeGlyphDump 字形的众数宽×众数高
  const ws = dump.map(d => d.w).sort((a, b) => a - b);
  const hs = dump.map(d => d.h).sort((a, b) => a - b);
  const med = (a) => a[Math.floor(a.length / 2)];
  const fingerprint = `${med(ws)}x${med(hs)}`;

  // ---- 采集锚字形（已验证 + 人工确认漏槽前缀对齐）----
  const chars = {};
  const push = (ch, g) => { (chars[ch] = chars[ch] || []).push({ w: g.w, h: g.h, data: g.data }); };
  r1.entries.forEach((e, i) => {
    if (!e.code) return;
    const glyphs = dump.filter(d => d.entry === i).sort((a, b) => a.index - b.index);
    const t = truthEntries.find(([c]) => c === e.code);
    if (t && glyphs.length === e.code.length) {
      e.code.split('').forEach((ch, j) => push(ch, glyphs[j]));
      return;
    }
    const tCode = truthEntries[i]?.[0];
    if (tCode && e.code !== tCode && manual.includes(tCode)) {
      const n = Math.min(glyphs.length, tCode.length);
      for (let j = 0; j < n; j += 1) push(tCode[j], glyphs[j]);
    }
  });
  const collect = {};
  for (const [ch, arr] of Object.entries(chars)) {
    const seen = new Set(); const uniq = [];
    for (const x of arr) {
      const key = `${x.w}x${x.h}:${x.data.join('')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push({ w: x.w, h: x.h, data: x.data });
      if (uniq.length >= 3) break;
    }
    collect[ch] = uniq;
  }

  if (!verify) {
    return { fingerprint, collect, pipeScore: score(r1) };
  }

  // ---- verify：加载既有库 + 合并本卡 → 带锚重识别 ----
  return { fingerprint, collect, pipeScore: score(r1), r1entries: r1.entries.length };
}, { card: CARD, truthEntries: truth, manual: manualCodes, verify: VERIFY });

if (!VERIFY) {
  // 生成/合并库
  fs.mkdirSync('benchmark/anchors', { recursive: true });
  const lib = fs.existsSync(LIB_PATH) ? JSON.parse(readFileSync(LIB_PATH, 'utf8')) : { version: 1, styles: {} };
  const style = lib.styles[out.fingerprint] ?? { cards: [], chars: {} };
  if (!style.cards.includes(CARD)) style.cards.push(CARD);
  for (const [ch, arr] of Object.entries(out.collect)) {
    const list = style.chars[ch] ?? [];
    const seen = new Set(list.map(x => `${x.w}x${x.h}:${x.data.join('')}`));
    for (const x of arr) {
      const key = `${x.w}x${x.h}:${x.data.join('')}`;
      if (!seen.has(key)) { seen.add(key); list.push(x); }
    }
    style.chars[ch] = list.slice(0, 8); // 每字符封顶 8 实例
  }
  lib.styles[out.fingerprint] = style;
  fs.writeFileSync(LIB_PATH, JSON.stringify(lib));
  console.log(`管线（无锚）: ${out.pipeScore}`);
  console.log(`锚库已写入 ${LIB_PATH}`);
  console.log(`指纹 ${out.fingerprint}（卡片 ${style.cards.join(',')}）字符 [${Object.keys(style.chars).sort().join('')}] 共 ${Object.values(style.chars).reduce((s, a) => s + a.length, 0)} 字形`);
} else {
  // verify：库 → 锚 → 重识别
  const lib = JSON.parse(readFileSync(LIB_PATH, 'utf8'));
  const style = lib.styles[out.fingerprint];
  if (!style) { console.error(`库中没有指纹 ${out.fingerprint}`); process.exit(1); }
  const anchors = new Map(Object.entries(style.chars).map(([ch, arr]) => [ch, arr.map(x => ({ data: x.data, w: x.w, h: x.h }))]));
  console.log(`管线（无锚）: ${out.pipeScore}`);
  console.log(`库指纹 ${out.fingerprint} 字符 [${Object.keys(style.chars).sort().join('')}]`);
  const r2 = await page.evaluate(async ({ card, truthEntries, anchorArr }) => {
    const { parseLegend } = await import('/src/utils/importLegend.ts');
    const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
    const resp = await fetch(`/benchmark/images/${card}-strip.png`);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width; canvas.height = bmp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const source = { data: new Uint8ClampedArray(px.data.buffer), width: bmp.width, height: bmp.height };
    const calib = { originX: 0, originY: 0, cellWidth: 10, cellHeight: 10, columns: 1, rows: 1 };
    const anchors = new Map(Object.entries(anchorArr).map(([ch, arr]) => [ch, arr.map(x => ({ data: new Uint8Array(x.data), w: x.w, h: x.h }))]));
    const r = parseLegend(source, calib, BRAND_PALETTES.MARD, { codeAnchorGlyphs: anchors });
    const diag = { aSize: anchors.size, mData: anchors.get('M')?.[0]?.data?.length, mWH: anchors.get('M')?.map(x => x.w + 'x' + x.h).join(','), codes: r.entries.map(e => e.code).join(',') };
    console.log('[verify-diag]', JSON.stringify(diag).slice(0, 400));
    const got = new Map(r.entries.filter(e => e.code).map(e => [e.code, e]));
    let hit = 0, cnt = 0; const miss = [], wrong = [];
    for (const [c, n] of truthEntries) {
      const e = got.get(c);
      if (!e) { miss.push(c); continue; }
      hit += 1;
      if (e.count === n) cnt += 1; else wrong.push(`${c}:${e.count}≠${n}`);
    }
    return `色号=${hit}/27 数量=${cnt}/${hit} 漏[${miss}] 错[${wrong.join(' ')}]`;
  }, { card: CARD, truthEntries: truth, anchorArr: JSON.parse(JSON.stringify(Object.fromEntries(anchors))) });
  console.log(`带库锚: ${r2}`);
}

await browser.close();
await vite.close();
