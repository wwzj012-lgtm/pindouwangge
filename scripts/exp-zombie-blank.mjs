// blank 格真实面积平均色：多少 blank 其实是深色豆
import { createServer } from 'vite';
import sharp from 'sharp';
const IMG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-22T09-39-58-552Z-fe2f92b2.jpg';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImageAsync } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { estimateBeadPitch, refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const est = estimateBeadPitch(source);
let cal = { originX: est.originTrustedX ? est.originX : 0, originY: est.originTrustedY ? est.originY : 0, cellWidth: est.cell, cellHeight: est.cell, columns: Math.min(est.columns, Math.floor((source.width - est.originX) / est.cell)), rows: Math.min(est.rows, Math.floor((source.height - est.originY) / est.cell)) };
const ref = refineGridAlignment(source, cal);
if (ref.applied) cal = { ...cal, cellWidth: ref.cell, cellHeight: ref.cell, originX: ref.originX, originY: ref.originY };
const result = await recognizeImportImageAsync(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { symbolAssist: true, batchSize: 256 });
const px = (x, y) => { const i = (y * info.width + x) * 4; return [data[i], data[i+1], data[i+2]]; };
// 对每个 blank 格算全格面积平均
const buckets = new Map();
let darkBlanks = 0, totalBlank = 0;
const darkExamples = [];
const perRowH5 = {};
for (let r = 0; r < cal.rows; r++) {
  for (let c = 0; c < cal.columns; c++) {
    const cell = result.cells[r]?.[c];
    if (!cell) continue;
    if (cell.status !== 'blank') { if (cell.status==='mapped' && cell.color.code==='H5') perRowH5[r]=(perRowH5[r]??0)+1; continue; }
    totalBlank++;
    const x0 = Math.round(cal.originX + c * cal.cellWidth), y0 = Math.round(cal.originY + r * cal.cellHeight);
    const w = Math.round(cal.cellWidth), h = Math.round(cal.cellHeight);
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let y = y0 + 2; y < y0 + h - 2; y++) for (let x = x0 + 2; x < x0 + w - 2; x++) {
      if (x < 0 || y < 0 || x >= info.width || y >= info.height) continue;
      const [pr, pg, pb] = px(x, y); sr += pr; sg += pg; sb += pb; n++;
    }
    if (!n) continue;
    const lum = (0.299*sr + 0.587*sg + 0.114*sb) / n;
    const b = lum < 100 ? 'dark(<100)' : lum < 200 ? 'mid' : 'light';
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
    if (lum < 100) {
      darkBlanks++;
      if (darkExamples.length < 6) darkExamples.push({ r, c, lum: Math.round(lum), rgb: [Math.round(sr/n), Math.round(sg/n), Math.round(sb/n)] });
    }
  }
}
console.log('H5 per row:', JSON.stringify(perRowH5));
console.log('blank area-lum buckets:', [...buckets.entries()].map(([b,n])=>`${b}:${n}`).join(' '));
console.log('dark blanks:', darkBlanks, '/', totalBlank);
for (const e of darkExamples) console.log(`  (${e.r},${e.c}) lum=${e.lum} rgb=(${e.rgb.join(',')})`);
await vite.close(); process.exit(0);
