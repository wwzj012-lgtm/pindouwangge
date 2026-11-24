// 猴子图图例 crop（1090×93，native res）standalone 解析测试
import { createServer } from 'vite';
import sharp from 'sharp';

const IMG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-22T10-39-36-173Z-31c26106.png';

const vite = await createServer({
  root: process.cwd(), appType: 'custom',
  server: { middlewareMode: true }, logLevel: 'error',
  optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts',
});
const { parseLegend } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const palette = BRAND_PALETTES.MARD;

const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
console.log('crop:', info.width, 'x', info.height);

const cal = { originX: 0, originY: 0, cellWidth: 24, cellHeight: 24, columns: 45, rows: 4 };
const region = { x0: 0, y0: 0, x1: info.width - 1, y1: info.height - 1 };
const parsed = parseLegend(source, cal, palette, { region, gridRows: 100, gridCols: 145 });
console.log('ok:', parsed.ok, 'failure:', parsed.failureReason ?? '-', 'entries:', parsed.entries.length);
for (const e of parsed.entries) {
  console.log(`  ${String(e.code ?? '?').padEnd(4)} count=${String(e.count ?? '?').padStart(4)} warn=${e.warn ?? ''} dotRgb=${e.dotRgb ? e.dotRgb.join(',') : '?'}`);
}
await vite.close();
