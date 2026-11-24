// 复现向导「按豆距自动估算格数」按钮的完整链路：
// estimateBeadPitch → 套用 cellSize（保留默认 origin）→ deriveAlignedCalibration
import sharp from 'sharp';

const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const { createServer } = await import('vite');
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { estimateBeadPitch } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { createDefaultGridAlignment, deriveAlignedCalibration } = await vite.ssrLoadModule('/src/utils/importGridAlignment.ts');

const est = estimateBeadPitch(source);
console.log('估算:', JSON.stringify(est));
const dims = { width: info.width, height: info.height };
const alignment = createDefaultGridAlignment(dims);
console.log('默认 alignment:', JSON.stringify(alignment));
const applied = { ...alignment, cellSize: est.cell };
const derived = deriveAlignedCalibration(applied, { x: 0, y: 0, ...dims }, dims);
console.log('派生 calibration:', JSON.stringify(derived.calibration));
console.log('error:', derived.error);
await vite.close();
