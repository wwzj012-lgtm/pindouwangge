// 图例解析诊断脚本（dbg-* 惯例）：water-box.jpg 全图例逐条打分。
// 运行: node scripts/dbg-legend.mjs
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { parseLegend } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

// 网格校准：暗线投影实测（major gridlines at x=276/1155, y=116; cell=8.79, 101×132）。
const CAL = { originX: 276, originY: 116, cellWidth: 8.79, cellHeight: 8.79, columns: 101, rows: 132 };

const { data, info } = await sharp('benchmark/images/water-box.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

const t0 = performance.now();
const result = parseLegend(source, CAL, BRAND_PALETTES.MARD, { gridRows: 132, gridCols: 101 });
const elapsed = performance.now() - t0;
console.log('ok:', result.ok, 'failureReason:', result.failureReason ?? '-', `(${elapsed.toFixed(0)}ms)`);
console.log('checks:', JSON.stringify(result.checks));
if (result.entries.length) {
  for (const [i, e] of result.entries.entries()) {
    console.log(String(i + 1).padStart(2), e.code.padEnd(4), String(e.count).padStart(4), e.confidence.toFixed(3), e.warn ?? '');
  }
}
await vite.close();
