// 按最终码统计底色明度分布，并检查未映射格
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
console.log('grid:', cal.columns, 'x', cal.rows, 'cell', cal.cellWidth.toFixed(2));
const result = await recognizeImportImageAsync(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { symbolAssist: true, batchSize: 256 });
// 每码的底色明度中位数
const byCode = new Map();
let totalRows = 0, unmapped = 0, statusCounts = new Map();
for (const [ri, row] of result.cells.entries()) {
  if (ri >= 66) continue;
  totalRows++;
  for (const cell of row) {
    statusCounts.set(cell.status, (statusCounts.get(cell.status) ?? 0) + 1);
    if (cell.status !== 'mapped') { unmapped++; continue; }
    const list = byCode.get(cell.color.code) ?? [];
    // cell 上可能没有 baseRgb，用 distance 或重采样？先看有什么字段
    list.push(cell);
    byCode.set(cell.color.code, list);
  }
}
console.log('rows<66:', totalRows, 'status:', [...statusCounts.entries()].map(([s,n])=>`${s}:${n}`).join(' '));
for (const code of ['H2','H5','H6','H7','H9','H11','H3','H1','H17','H16','M2','M14','C17','C22']) {
  const list = byCode.get(code) ?? [];
  const lums = list.map(c => c.color ? Math.round(0.299*c.color.rgb[0]+0.587*c.color.rgb[1]+0.114*c.color.rgb[2]) : -1);
  console.log(`${code}: n=${list.length} conf=${list.length?(list.reduce((s,c)=>s+(c.confidence??1),0)/list.length).toFixed(2):'-'}`);
}
// cell 对象字段
const sample = byCode.get('H5')?.[0];
console.log('H5 cell fields:', sample ? Object.keys(sample).join(',') : 'none');
await vite.close(); process.exit(0);
