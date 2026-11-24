// 深灰族诊断：H5/H11/H3/H17 的读数分布、形状对决、色距
import { createServer } from 'vite';
import sharp from 'sharp';
const IMG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-22T09-39-58-552Z-fe2f92b2.jpg';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const SO = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
const { estimateBeadPitch, refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const palette = BRAND_PALETTES.MARD;
const est = estimateBeadPitch(source);
let cal = { originX: est.originTrustedX ? est.originX : 0, originY: est.originTrustedY ? est.originY : 0, cellWidth: est.cell, cellHeight: est.cell, columns: Math.min(est.columns, Math.floor((source.width - est.originX) / est.cell)), rows: Math.min(est.rows, Math.floor((source.height - est.originY) / est.cell)) };
const ref = refineGridAlignment(source, cal);
if (ref.applied) cal = { ...cal, cellWidth: ref.cell, cellHeight: ref.cell, originX: ref.originX, originY: ref.originY };
const diag = SO.diagnoseSymbols(source, cal, palette);
const byCode = new Map(palette.map(c => [c.code, c.rgb]));
const d76 = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
// 深灰格：低明度低饱和
const grays = diag.items.filter(it => {
  const [r, g, b] = it.baseRgb;
  const lum = 0.299*r + 0.587*g + 0.114*b;
  const sat = Math.max(r,g,b) - Math.min(r,g,b);
  return lum > 40 && lum < 130 && sat < 40 && it.bandWidth >= 10;
});
console.log('gray cells:', grays.length);
const nearest = new Map();
for (const it of grays) {
  let best = null;
  for (const [code, rgb] of byCode) { const d = d76(it.baseRgb, rgb); if (!best || d < best.d) best = { code, d }; }
  nearest.set(best.code, (nearest.get(best.code) ?? 0) + 1);
}
console.log('nearest-prior:', [...nearest.entries()].sort((a,b)=>b[1]-a[1]).map(([c,n])=>`${c}:${n}`).join(' '));
const reads = new Map();
for (const it of grays) reads.set(it.best ?? '?', (reads.get(it.best ?? '?') ?? 0) + 1);
console.log('ocr-best:', [...reads.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([c,n])=>`${c}:${n}`).join(' '));
// 抽样打印候选
for (const it of grays.slice(0, 10)) {
  console.log(`cell(${it.row},${it.column}) bw=${it.bandWidth} best=${it.best} shape=${it.bestShape?.toFixed(3)} margin=${it.margin?.toFixed(3)}`);
  console.log('  ', it.candidates.map(c => `${c.code}(dE${c.colorDE?.toFixed(1)},s${c.shape?.toFixed(3)})`).join(' '));
}
await vite.close(); process.exit(0);
