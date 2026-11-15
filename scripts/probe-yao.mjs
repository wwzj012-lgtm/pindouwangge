// 探测：瑶_大耳狗（右侧竖排图例）图例解析（CAL: origin(25,51) cell 12.5 101×132 实测投影）
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { parseLegend } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const { data, info } = await sharp('benchmark/images/yao-dalugou.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const CAL = { originX: 25, originY: 51, cellWidth: 12.5, cellHeight: 12.5, columns: 101, rows: 132 };
const legend = parseLegend(source, CAL, BRAND_PALETTES.MARD, { gridRows: CAL.rows, gridCols: CAL.columns });
console.log('ok:', legend.ok, legend.failureReason ?? '');
if (legend.ok) {
  console.log('checks:', JSON.stringify(legend.checks));
  for (const e of legend.entries) console.log(`  ${e.code.padEnd(4)} count=${String(e.count).padStart(4)} conf=${e.confidence.toFixed(2)}${e.warn ? ' warn=' + e.warn : ''}`);
}
await vite.close();
