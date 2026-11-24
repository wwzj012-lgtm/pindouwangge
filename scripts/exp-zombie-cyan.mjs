// 亮青 C17 格流向 + C22 格明细
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
// 亮青格：r 低、g/b 高且 b>g
const flow = new Map();
const cyanCells = [];
for (const [ri, row] of result.cells.entries()) {
  if (ri >= 66) continue;
  for (const cell of row) {
    if (cell.status !== 'mapped') continue;
    const [r, g, b] = cell.sampleRgb ?? [255,255,255];
    if (['C11','C26'].includes(cell.color.code) && false) {
      cyanCells.push(cell);
      flow.set(cell.color.code, (flow.get(cell.color.code) ?? 0) + 1);
    }
  }
}
for (const row of result.cells.slice(0, 66)) {
  for (const cell of row) {
    if (cell.status === 'mapped' && ['C11','C26','H11','H3','H17','H1','H9'].includes(cell.color.code)) {
      console.log(`${cell.color.code} cell (${cell.row},${cell.column}) sampleRgb=(${(cell.sampleRgb??[]).map(v=>Math.round(v)).join(',')}) conf=${cell.confidence?.toFixed(2)}`);
    }
  }
}
console.log('bright-cyan cells flow:', [...flow.entries()].sort((a,b)=>b[1]-a[1]).map(([c,n])=>`${c}:${n}`).join(' '));
// 打印映射成 C22 的格子与其字形读数
for (const row of result.cells.slice(0, 66)) {
  for (const cell of row) {
    if (cell.status === 'mapped' && cell.color.code === 'C22') {
      console.log(`C22 cell (${cell.row},${cell.column}) sampleRgb=(${(cell.sampleRgb??[]).map(v=>Math.round(v)).join(',')}) conf=${cell.confidence?.toFixed(2)}`);
    }
  }
}
await vite.close(); process.exit(0);
