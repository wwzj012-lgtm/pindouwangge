// 白格候选明细：H2 是否进了 top6？shape 谁赢？
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
console.log('textCells:', diag.textCells);
// 白格：baseRgb 明度高且低饱和
const isWhite = ([r, g, b]) => Math.min(r, g, b) > 170 && (Math.max(r, g, b) - Math.min(r, g, b)) < 40;
const whites = diag.items.filter(it => isWhite(it.baseRgb) && it.bandWidth >= 10);
console.log('white cells:', whites.length);
// 汇总：H2/H9 在候选中的出现率与 shape 对比
let h2in = 0, h9in = 0, both = 0, h2win = 0, h9win = 0;
for (const it of whites) {
  const has = (c) => it.candidates.find(x => x.code === c);
  const h2 = has('H2'), h9 = has('H9');
  if (h2) h2in++; if (h9) h9in++; if (h2 && h9) both++;
  if (h2 && h9) { if (h2.shape > h9.shape) h2win++; else h9win++; }
}
console.log(`H2 in candidates: ${h2in}/${whites.length}, H9: ${h9in}, both: ${both}`);
console.log(`when both: H2 shape wins ${h2win}, H9 shape wins ${h9win}`);
// 抽样打印
for (const it of whites.slice(0, 8)) {
  console.log(`cell(${it.row},${it.column}) prior=${it.prior} dE=${it.priorDE.toFixed(1)} best=${it.best} shape=${it.bestShape.toFixed(3)} margin=${it.margin.toFixed(3)}`);
  console.log('  cands:', it.candidates.map(c => `${c.code}(dE${c.colorDE.toFixed(1)},s${c.shape.toFixed(3)})`).join(' '));
}
await vite.close(); process.exit(0);
