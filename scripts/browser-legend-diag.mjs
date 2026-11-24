// 浏览器端逐字诊断：重建 countTemplates，打印每个计数字形的匹配详情
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const vite = await createServer({ root: process.cwd(), server: { port: 46122, strictPort: true }, logLevel: 'error' });
await vite.listen();

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage();
page.on('pageerror', err => console.log('[pageexception]', String(err).slice(0, 300)));
await page.goto('http://localhost:46122/', { waitUntil: 'load', timeout: 60000 });

const REGION = process.env.REGION === '1';
const WL = process.env.WL === '1';
const result = await page.evaluate(async ({ REGION, WL }) => {
  const L = await import('/src/utils/importLegend.ts');
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const resp = await fetch('/benchmark/images/water-box.jpg');
  const bmp = await createImageBitmap(await resp.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const source = { data: img.data, width: img.width, height: img.height };
  const CAL = { originX: 276, originY: 116, cellWidth: 8.79, cellHeight: 8.79, columns: 101, rows: 132 };
  const WL27 = ['C13','D1','D3','D7','D9','D17','D24','E14','E17','F17','G1','G16','H1','M14','C29','D2','D4','D8','D10','D23','E2','E16','F16','F20','G15','G17','H13'];
  const palette = WL ? BRAND_PALETTES.MARD.filter(c => WL27.includes(c.code)) : BRAND_PALETTES.MARD;
  const region = REGION ? { x0: 0, y0: 1180, x1: 1440, y1: 1440 } : undefined;
  const dbg = L.debugLegendParse(source, CAL, palette, { gridRows: 132, gridCols: 101, region });

  // 复刻 parseLegend 的自举 + countTemplates 构建（诊断用）
  const prepared = palette;
  const widthOf = g => g.x1 - g.x0 + 1;
  const labeled = new Map();
  for (let i = 0; i < dbg.rawEntries.length; i += 1) {
    const r = dbg.resolvedCodes[i];
    const s = dbg.splits[i];
    if (!r || !s || s.codeGlyphs.length !== r.code.length) continue;
    for (let j = 0; j < r.code.length; j += 1) {
      if (widthOf(s.codeGlyphs[j]) > dbg.digitW * 1.9) continue;
      const list = labeled.get(r.code[j]) ?? [];
      list.push(s.codeGlyphs[j].bitmap);
      labeled.set(r.code[j], list);
    }
  }
  const templates = L.buildTemplates(labeled);
  const codeDigitTemplates = new Map([...templates].filter(([c]) => c >= '0' && c <= '9'));
  const heights = dbg.splits.flatMap(s => s ? s.countGlyphs.filter(g => widthOf(g) <= dbg.digitW * 1.2).map(g => g.y1 - g.y0 + 1) : []);
  const medH = heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)];
  const synth = L.renderSyntheticDigitTemplates(medH);
  const countTemplates = L.buildCountTemplates(dbg.rawEntries, dbg.splits, dbg.digitW, codeDigitTemplates, [synth], true);
  const countW = (() => {
    const w = dbg.splits.flatMap(s => s ? s.countGlyphs.filter(g => widthOf(g) <= dbg.digitW * 1.4).map(widthOf) : []);
    return w.length ? w.sort((a, b) => a - b)[Math.floor(w.length / 2)] : 5;
  })();

  return {
    digitW: dbg.digitW,
    countW,
    medH,
    synthChars: synth ? [...synth.keys()].join('') : 'null',
    synthDims: synth ? [...synth].map(([c, b]) => `${c}:${b.w}x${b.h}`).join(' ') : '',
    countChars: [...countTemplates.keys()].sort().join(''),
    ascii: [...countTemplates].sort((a, b) => a[0].localeCompare(b[0])).map(([c, b]) => {
      const rows = [];
      for (let y = 0; y < b.h; y += 1) {
        let line = '';
        for (let x = 0; x < b.w; x += 1) line += b.data[y * b.w + x] ? '#' : '.';
        rows.push(line);
      }
      return `${c}(${b.w}x${b.h}):\n  ${rows.join('\n  ')}`;
    }).join('\n'),
    synthAscii: synth ? [...synth].sort((a, b) => a[0].localeCompare(b[0])).map(([c, b]) => {
      const rows = [];
      for (let y = 0; y < b.h; y += 1) {
        let line = '';
        for (let x = 0; x < b.w; x += 1) line += b.data[y * b.w + x] ? '#' : '.';
        rows.push(line);
      }
      return `${c}(${b.w}x${b.h}):\n  ${rows.join('\n  ')}`;
    }).join('\n') : '',
    rows: dbg.rawEntries.map((e, i) => {
      const s = dbg.splits[i];
      if (!s) return { i, split: 'null' };
      const detail = s.countGlyphs.map(g => {
        const w = widthOf(g);
        const both = bitmap => {
          const mr = countTemplates.size ? L.matchGlyph(bitmap, countTemplates) : null;
          const ms = synth ? L.matchGlyph(bitmap, synth) : null;
          const f = m => m ? `${m.char}@${m.distance.toFixed(2)}` : '?';
          return `R:${f(mr)} S:${f(ms)}`;
        };
        if (w <= dbg.digitW * 1.4) {
          return `w${w}[${both(g.bitmap)}]`;
        }
        // 宽块：逐 k 切片看各片匹配
        const centerK = Math.max(2, Math.round(w / countW));
        const parts = [];
        for (const k of [centerK - 1, centerK, centerK + 1]) {
          if (k < 2 || k > 4) continue;
          const slices = L.splitBitmap(g.bitmap, k);
          const ms = slices.map(sl => both(sl));
          parts.push(`k${k}:${ms.join(', ')}`);
        }
        return `w${w}blob[${parts.join(' | ')}]`;
      });
      const p = dbg.parsed[i];
      return { i, prior: dbg.priors[i]?.code ?? 'null', resolved: dbg.resolvedCodes[i]?.code ?? 'null', parsed: p ? `${p.code}/${p.count}` : 'null', countDetail: detail.join(' ') };
    }),
  };
}, { REGION, WL });

console.log('digitW=', result.digitW, 'countW=', result.countW, 'medH=', result.medH, REGION ? 'REGION' : 'DIRECT', WL ? 'WL' : '');
console.log("synth:", result.synthChars, " dims:", result.synthDims);
console.log("countTemplates:", result.countChars);
console.log(result.ascii);
console.log("=== SYNTH ===");
console.log(result.synthAscii);
console.log('countTemplates:', result.countChars);
for (const r of result.rows) {
  console.log(`#${r.i} prior=${r.prior} resolved=${r.resolved} parsed=${r.parsed}`);
  if (r.countDetail) console.log(`   count: ${r.countDetail}`);
}
await browser.close();
await vite.close();
