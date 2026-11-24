// 端到端：estimateBeadPitch(v2.2) -> deriveAlignedCalibration -> 识别 -> 边缘统计
import sharp from 'sharp';
const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-09T04-29-31-478Z-f7362be0.jpg';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const { createServer } = await import('vite');
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const m = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const rec = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const align = await vite.ssrLoadModule('/src/utils/importGridAlignment.ts');
const pal = await vite.ssrLoadModule('/src/data/palettes.ts');

const est = m.estimateBeadPitch(source);
console.log('估算:', JSON.stringify({ cell: est.cell, cellX: est.cellX, cellY: est.cellY, ox: est.originX, oy: est.originY, conf: +est.confidence.toFixed(3) }));
const dims = { width: info.width, height: info.height };
const alignment = { ...align.createDefaultGridAlignment(dims), cellSize: est.cell };
const derived = align.deriveAlignedCalibration(alignment, { x: 0, y: 0, ...dims }, dims);
const cal = derived.calibration;
console.log('派生:', JSON.stringify({ columns: cal.columns, rows: cal.rows, cellW: +cal.cellWidth.toFixed(1), cellH: +cal.cellHeight.toFixed(1) }), 'error:', derived.error);

const t0 = performance.now();
const result = rec.recognizeImportImage(source, cal, pal.BRAND_PALETTES.MARD_291, 'precision', undefined, { edgeInsetRatio: 0, symbolAssist: true });
console.log('识别', ((performance.now() - t0) / 1000).toFixed(2) + 's');
const stats = { mapped: 0, blank: 0, invalid: 0 };
let edgeBlank = 0, edgeTotal = 0;
for (const row of result.cells) for (const cell of row) {
  stats[cell.status] = (stats[cell.status] || 0) + 1;
  if (cell.row === 0 || cell.column === 0 || cell.row === cal.rows - 1 || cell.column === cal.columns - 1) {
    edgeTotal += 1;
    if (cell.status === 'blank') edgeBlank += 1;
  }
}
console.log('全图:', JSON.stringify(stats), '边缘 blank:', edgeBlank + '/' + edgeTotal);
await vite.close();
