import { createServer } from 'vite';
import sharp from 'sharp';
const IMG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-22T09-39-58-552Z-fe2f92b2.jpg';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const SO = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
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
const diag = SO.diagnoseSymbols(source, cal, BRAND_PALETTES.MARD);
// H11/H3/H9 映射格的诊断明细
const targets = new Set(['H11','H3','H9']);
const byReason = new Map();
for (const it of diag.items) {
  const row = result.cells[it.row]?.[it.column];
  const cc = row && row.status === 'mapped' ? row.color.code : '?';
  if (!targets.has(cc)) continue;
  const key = `${it.partCount}p_bw${it.bandWidth}_best${it.best ?? 'null'}`;
  byReason.set(key, (byReason.get(key) ?? 0) + 1);
}
console.log('diag signatures (mapped H11/H3/H9 cells):');
for (const [k, n] of [...byReason.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12)) console.log(`  ${k} x${n}`);
// 看这些格子在 items 里的完整明细 2 例
let shown = 0;
for (const it of diag.items) {
  const row = result.cells[it.row]?.[it.column];
  const cc = row && row.status === 'mapped' ? row.color.code : '?';
  if (cc !== 'H11' || shown >= 2) continue;
  console.log(`H11 cell (${it.row},${it.column}):`, JSON.stringify(it));
  shown++;
}
await vite.close(); process.exit(0);
