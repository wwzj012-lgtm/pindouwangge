// 浅灰格文字条带宽度：H3(2字) vs H11(3字) 判别
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
// 参照组：已知 2 字符码（H6 深底白字）与 3 字符码（A17/M14）的条带宽度
const extract = SO.debugExtractCellBands ?? SO.__debugExtract ?? null;
console.log('extract fn:', typeof extract);
// 用 diagnoseSamples 拿 band 信息
const diag = SO.diagnoseSymbols(source, cal, BRAND_PALETTES.MARD);
const buckets = new Map();
for (const it of diag.items) {
  if (it.bandWidth < 6) continue;
  const row = result.cells[it.row]?.[it.column];
  const cc = row && row.status === 'mapped' ? row.color.code : '?';
  if (!['H2','H9','H11','H3','H1','H17','H6','H7','A17','M14','M2','B25','H5'].includes(cc)) continue;
  const list = buckets.get(cc) ?? [];
  list.push(it.bandWidth);
  buckets.set(cc, list);
}
for (const [cc, list] of buckets) {
  list.sort((a,b)=>a-b);
  const h = new Map();
  for (const w of list) h.set(w, (h.get(w)??0)+1);
  console.log(`${cc} n=${list.length} median=${list[Math.floor(list.length/2)]} hist:`, [...h.entries()].map(([w,n])=>`${w}:${n}`).join(' '));
}
await vite.close(); process.exit(0);
