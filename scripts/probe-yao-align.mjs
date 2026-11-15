// 复现用户「自动对齐」后的网格：estimateBeadPitch + refineGridAlignment 全流水线
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({
  root: process.cwd(), appType: 'custom',
  server: { middlewareMode: true }, logLevel: 'error',
  optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts',
});
const { estimateBeadPitch, refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { deriveAlignedCalibration } = await vite.ssrLoadModule('/src/utils/importGridAlignment.ts');

const { data, info } = await sharp('benchmark/images/yao-waterbox.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const dims = { width: info.width, height: info.height };
const region = { x: 0, y: 0, width: dims.width, height: dims.height };

console.log('image:', dims.width, 'x', dims.height, ' truth: origin(276,116) cell 8.79 cols 132 rows 150');

// 场景 1：默认 5px 网格直接点「自动对齐」
const def = {
  originX: Math.floor(Math.max(0, dims.width / 2 - 7.5) / 5) * 5,
  originY: Math.floor(Math.max(0, dims.height / 2 - 7.5) / 5) * 5,
  cellSize: 5,
};
console.log('\n== 场景1 默认5px 起点:', JSON.stringify(def));
const est1 = estimateBeadPitch(source);
console.log('estimate:', est1 ? `cell=${est1.cell} origin=(${est1.originX},${est1.originY}) cols=${est1.columns} rows=${est1.rows} conf=${est1.confidence} trustedX=${est1.originTrustedX} trustedY=${est1.originTrustedY}` : 'null');
let working1 = def;
if (est1 && est1.confidence >= 0.15) {
  working1 = {
    ...def,
    cellSize: est1.cell,
    originX: est1.originTrustedX ? est1.originX : def.originX,
    originY: est1.originTrustedY ? est1.originY : def.originY,
  };
}
const ref1 = refineGridAlignment(source, working1);
console.log('refine:', JSON.stringify(ref1));
const final1 = ref1.applied ? { ...working1, cellSize: ref1.cell, originX: ref1.originX, originY: ref1.originY } : working1;
const cal1 = deriveAlignedCalibration(final1, region, dims);
console.log('最终 calibration:', cal1.calibration ? `${cal1.calibration.columns} × ${cal1.calibration.rows} @ ${cal1.calibration.cellWidth.toFixed(3)}px origin(${cal1.calibration.originX.toFixed(1)},${cal1.calibration.originY.toFixed(1)})` : `error: ${cal1.error}`);

// 场景 2：用户已手动拖到大致正确（origin 270,110 cell 9）再点自动对齐
const manual = { originX: 270, originY: 110, cellSize: 9 };
console.log('\n== 场景2 手动起点 origin(270,110) cell 9:');
const est2 = estimateBeadPitch(source);
let working2 = manual;
if (est2 && est2.confidence >= 0.15) {
  working2 = {
    ...manual,
    cellSize: est2.cell,
    originX: est2.originTrustedX ? est2.originX : manual.originX,
    originY: est2.originTrustedY ? est2.originY : manual.originY,
  };
}
console.log('estimate 应用后 working:', JSON.stringify(working2));
const ref2 = refineGridAlignment(source, working2);
console.log('refine:', JSON.stringify(ref2));
const final2 = ref2.applied ? { ...working2, cellSize: ref2.cell, originX: ref2.originX, originY: ref2.originY } : working2;
const cal2 = deriveAlignedCalibration(final2, region, dims);
console.log('最终 calibration:', cal2.calibration ? `${cal2.calibration.columns} × ${cal2.calibration.rows} @ ${cal2.calibration.cellWidth.toFixed(3)}px origin(${cal2.calibration.originX.toFixed(1)},${cal2.calibration.originY.toFixed(1)})` : `error: ${cal2.error}`);

await vite.close();
