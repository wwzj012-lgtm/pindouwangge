// card3 计数簇标注质量：countGlyphDump 的 (entry,x0,digit) vs 真值逐位对照，
// 判断错误属于「簇整体错标」还是「逐字形匹配不稳」。
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const PORT = 46217;
const card = process.argv[2] || 'card3';
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'))[card].entries;
const vite = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageexception]', String(e).slice(0, 300)));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 60000 });
const out = await page.evaluate(async ({ card }) => {
  const S = await import('/src/utils/importLegend.ts');
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const resp = await fetch(`/benchmark/images/${card}.png`);
  const bmp = await createImageBitmap(await resp.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const source = { data: img.data, width: img.width, height: img.height };
  const scan = S.collectCardEntries(source);
  const truthPool = S.countGlyphDump.map(d => ({ entry: d.entry, digit: d.digit, x0: d.x0 }));
  S.parseColorCard(source, BRAND_PALETTES.MARD);
  return { dump: S.countGlyphDump.map(d => ({ entry: d.entry, digit: d.digit, x0: Math.round(d.x0) })), fails: !scan };
}, { card });
// 按 entry 分组，按 x0 排序
const by = new Map();
for (const d of out.dump) { if (!by.has(d.entry)) by.set(d.entry, []); by.get(d.entry).push(d); }
let pos = 0, hit = 0;
const confusion = new Map();
for (const [entry, gs] of [...by].sort((a, b) => a[0] - b[0])) {
  gs.sort((a, b) => a.x0 - b.x0);
  const t = truth[entry]; if (!t) continue;
  const want = String(t[1]);
  if (gs.length !== want.length) { console.log(`#${entry} 段位不符 dump=${gs.length} truth=${want.length} ${t.join(':')}`); continue; }
  const line = gs.map((g, i) => {
    pos += 1;
    const ok = g.digit === want[i];
    if (ok) hit += 1;
    else { const k = `${want[i]}→${g.digit}`; confusion.set(k, (confusion.get(k) || 0) + 1); }
    return ok ? '.' : `${want[i]}→${g.digit}`;
  }).join(' ');
  console.log(`#${String(entry).padStart(2)} ${t[0].padEnd(4)} ${want} | ${line}`);
}
console.log(`\n位级 ${hit}/${pos}`);
console.log('混淆:', [...confusion].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
await browser.close(); await vite.close();
