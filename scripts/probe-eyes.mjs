import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { convertImageDataToGrid } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts');
const { MARD_PALETTE } = await vite.ssrLoadModule('/src/data/palettes.ts');
const colorById = new Map(MARD_PALETTE.map(c => [c.id, c]));
const settings = {
  width: 100, height: 56, keepAspectRatio: true, brand: 'MARD',
  dither: 'none', colorLimit: 32, brightness: 0, contrast: 0, saturation: 0,
  transparentCutoff: 128, boardSize: 29, sharpening: 30, outlineBoost: false,
  chromaKeyColor: null, chromaKeyTolerance: 20, colorMatchAlgo: 'ciede2000',
  backgroundRemovalEnabled: true, kmeansClustering: true, quantizationStrength: 28,
  pipelineOverride: 'auto',
};
const { data, info } = await sharp('benchmark/images/spongebob-patrick.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const clamped = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
const r = convertImageDataToGrid(clamped, info.width, info.height, settings, MARD_PALETTE);
const grid = r.grid;
const SX = 19.2, SY = 1078 / 56;
// 源格平均色（中心 60% 区域）
const srcAvg = (gx, gy) => {
  const x0 = Math.round(gx * SX + SX * 0.2), x1 = Math.round(gx * SX + SX * 0.8);
  const y0 = Math.round(gy * SY + SY * 0.2), y1 = Math.round(gy * SY + SY * 0.8);
  let r2 = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * info.width + x) * 4; r2 += data[o]; g += data[o+1]; b += data[o+2]; n++; }
  return [Math.round(r2/n), Math.round(g/n), Math.round(b/n)];
};
console.log('左眼区 (gx 20-25, gy 22-27)：');
for (let gy = 22; gy <= 27; gy++) {
  const row = [];
  for (let gx = 20; gx <= 25; gx++) {
    const id = grid[gy][gx];
    const bead = id ? colorById.get(id).rgb.join(',') : 'EMPTY';
    row.push(`(${gx},${gy}) src[${srcAvg(gx,gy)}] -> ${id ?? '空'} [${bead}]`);
  }
  console.log(row.join('  |  '));
}
console.log('\n右眼虹膜区 (gx 27-31, gy 22-26)：');
for (let gy = 22; gy <= 26; gy++) {
  const row = [];
  for (let gx = 27; gx <= 31; gx++) {
    const id = grid[gy][gx];
    row.push(`(${gx},${gy}) src[${srcAvg(gx,gy)}] -> ${id ?? '空'}`);
  }
  console.log(row.join('  |  '));
}
await vite.close();
