// 复现用户真实场景：App 全自动管线（估格距→细化→解析图例）跑导出原图
// 瑶_完整图纸.png（3180×3524，头部自标"总用量 7584 粒 | 共 27 色"）
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { estimateBeadPitch } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { parseLegend } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const { data, info } = await sharp('C:/Users/Plout/Downloads/瑶_完整图纸.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
console.log('image:', source.width, 'x', source.height);

const pitch = estimateBeadPitch(source);
console.log('pitch:', JSON.stringify(pitch));

let cal;
if (pitch) {
  const refined = refineGridAlignment(source, { originX: 0, originY: 0, cellSize: pitch.pitch ?? pitch.cell ?? 12 });
  console.log('refined:', refined.cell, refined.originX.toFixed(2), refined.originY.toFixed(2), 'coh', refined.coherenceX?.toFixed(2), refined.coherenceY?.toFixed(2));
  cal = { originX: refined.originX, originY: refined.originY, cellWidth: refined.cell, cellHeight: refined.cell, columns: 101, rows: 132 };
} else {
  console.log('pitch failed, fallback true cal');
  cal = { originX: 35, originY: 57, cellWidth: 25.75, cellHeight: 25.6, columns: 101, rows: 132 };
}

const legend = parseLegend(source, cal, BRAND_PALETTES.MARD, { gridRows: cal.rows, gridCols: cal.columns });
console.log('ok:', legend.ok, legend.failureReason ?? '');
if (legend.ok) {
  console.log('checks:', JSON.stringify(legend.checks));
  console.log('entries:', legend.entries.length);
  for (const e of legend.entries) console.log(`  ${e.code.padEnd(4)} count=${String(e.count).padStart(4)} conf=${e.confidence.toFixed(2)}${e.warn ? ' warn=' + e.warn : ''}`);
  const sum = legend.entries.reduce((s, e) => s + e.count, 0);
  console.log('Σ count =', sum, '(truth 7584)');
}
await vite.close();
