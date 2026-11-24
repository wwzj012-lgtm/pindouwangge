import { createServer } from 'vite';
import sharp from 'sharp';
const IMG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-22T09-39-58-552Z-fe2f92b2.jpg';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const SO = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
const { estimateBeadPitch, refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const est = estimateBeadPitch(source);
let cal = { originX: est.originTrustedX ? est.originX : 0, originY: est.originTrustedY ? est.originY : 0, cellWidth: est.cell, cellHeight: est.cell, columns: Math.min(est.columns, Math.floor((source.width - est.originX) / est.cell)), rows: Math.min(est.rows, Math.floor((source.height - est.originY) / est.cell)) };
const ref = refineGridAlignment(source, cal);
if (ref.applied) cal = { ...cal, cellWidth: ref.cell, cellHeight: ref.cell, originX: ref.originX, originY: ref.originY };
// 直接调 analyzeCells 拿 retryUsed 明细
const { cells } = SO.analyzeCells(source, cal);
const retryCells = cells.filter(c => c.retryUsed);
console.log('retry cells:', retryCells.length);
const resolved = retryCells.filter(c => c.refinedBase);
console.log('retry with refinedBase:', resolved.length);
// retry 格的 baseRgb 分布
const lums = retryCells.map(c => Math.round(0.299*c.baseRgb[0]+0.587*c.baseRgb[1]+0.114*c.baseRgb[2])).sort((a,b)=>a-b);
console.log('retry base lum p10/p50/p90:', lums[Math.floor(lums.length*0.1)], lums[Math.floor(lums.length*0.5)], lums[Math.floor(lums.length*0.9)]);
// 跑完整符号提取，看 retry 格的解析结果
const sym = SO.extractBeadSymbols(source, cal, BRAND_PALETTES.MARD);
let resolvedReads = 0;
const readDist = new Map();
for (const c of retryCells) {
  const r = sym.codes.get(`${c.row}:${c.column}`);
  if (r) { resolvedReads++; readDist.set(r.code, (readDist.get(r.code)??0)+1); }
}
console.log('retry resolved reads:', resolvedReads, [...readDist.entries()].sort((a,b)=>b[1]-a[1]).map(([c,n])=>`${c}:${n}`).join(' '));
await vite.close(); process.exit(0);
