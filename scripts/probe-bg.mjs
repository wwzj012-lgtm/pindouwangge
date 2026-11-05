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
console.log('diagnostics.backgroundPixelsRemoved =', r.diagnostics.backgroundPixelsRemoved, '/', info.width * info.height);
console.log('diagnostics.background =', JSON.stringify(r.diagnostics.background));
// 图像四边像素颜色采样
const edgeSample = (x, y) => { const o = (y * info.width + x) * 4; return [data[o], data[o+1], data[o+2]]; };
console.log('顶边中点', edgeSample(960, 0), ' 左边中点', edgeSample(0, 539), ' 右边中点', edgeSample(1919, 539), ' 底边中点', edgeSample(960, 1077));
console.log('顶边 x=500', edgeSample(500, 0), '顶边 x=1500', edgeSample(1500, 0));
// 蓝色背景板区域格统计（浅蓝区 gy 5-15, gx 35-55）
const grid = r.grid;
let empty = 0, total = 0;
const ids = {};
for (let gy = 4; gy <= 15; gy++) for (let gx = 36; gx <= 58; gx++) {
  total++; const id = grid[gy][gx]; if (!id) empty++; else ids[id] = (ids[id]||0)+1;
}
console.log(`浅蓝背景区(36-58,4-15): ${empty}/${total} 空格`, Object.entries(ids).sort((a,b)=>b[1]-a[1]).slice(0,5));
// 深蓝区 (gy 30-45, gx 40-55)
let empty2 = 0, total2 = 0; const ids2 = {};
for (let gy = 30; gy <= 45; gy++) for (let gx = 40; gx <= 55; gx++) {
  total2++; const id = grid[gy][gx]; if (!id) empty2++; else ids2[id] = (ids2[id]||0)+1;
}
console.log(`深蓝背景区(40-55,30-45): ${empty2}/${total2} 空格`, Object.entries(ids2).sort((a,b)=>b[1]-a[1]).slice(0,5));
await vite.close();
