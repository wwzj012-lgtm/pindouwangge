// water-box.jpg 网格拟合：estimateBeadPitch + refineGridAlignment（暗线投影）。
// 输出冻结校准，供 HEAD 基线捕获与 legend-benchmark 共用（确定性）。
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { estimateBeadPitch, refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { createDefaultGridAlignment, normalizeGridAlignment, deriveAlignedCalibration } = await vite.ssrLoadModule('/src/utils/importGridAlignment.ts');

const { data, info } = await sharp('benchmark/images/water-box.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

const estimate = estimateBeadPitch(source);
console.log('estimate:', estimate && {
  cell: estimate.cell, columns: estimate.columns, rows: estimate.rows,
  originX: estimate.originX, originY: estimate.originY,
  originTrustedX: estimate.originTrustedX, originTrustedY: estimate.originTrustedY,
  confidence: estimate.confidence,
});

let working = createDefaultGridAlignment({ width: source.width, height: source.height });
if (estimate && estimate.confidence >= 0.15) {
  working = normalizeGridAlignment({
    ...working,
    cellSize: estimate.cell,
    originX: estimate.originTrustedX ? estimate.originX : working.originX,
    originY: estimate.originTrustedY ? estimate.originY : working.originY,
  });
}
const refinement = refineGridAlignment(source, working);
console.log('refinement:', { applied: refinement.applied, cell: refinement.cell, originX: refinement.originX, originY: refinement.originY, message: refinement.message });
const finalAlignment = refinement.applied
  ? { ...working, cellSize: refinement.cell, originX: refinement.originX, originY: refinement.originY }
  : working;
const region = { x: 0, y: 0, width: source.width, height: source.height };
const derived = deriveAlignedCalibration(finalAlignment, region, { width: source.width, height: source.height });
console.log('calibration:', JSON.stringify(derived.calibration));
console.log('error:', derived.error ?? 'none');
await vite.close();
