// 同一代码，height=100(留边) vs height=56(满格) 对比
import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { convertImageDataToGrid } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts');
const { MARD_PALETTE } = await vite.ssrLoadModule('/src/data/palettes.ts');
const base = {
  width: 100, keepAspectRatio: true, brand: 'MARD',
  dither: 'none', colorLimit: 32, brightness: 0, contrast: 0, saturation: 0,
  transparentCutoff: 128, boardSize: 29, sharpening: 30, outlineBoost: false,
  chromaKeyColor: null, chromaKeyTolerance: 20, colorMatchAlgo: 'ciede2000',
  backgroundRemovalEnabled: true, kmeansClustering: true, quantizationStrength: 28,
  pipelineOverride: 'auto',
};
const { data, info } = await sharp('benchmark/images/spongebob-patrick.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const clamped = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
const r100 = convertImageDataToGrid(clamped, info.width, info.height, { ...base, height: 100 }, MARD_PALETTE);
const r56 = convertImageDataToGrid(clamped, info.width, info.height, { ...base, height: 56 }, MARD_PALETTE);
console.log('100:', r100.grid.length + 'x' + r100.grid[0].length, r100.diagnostics.detectedPipeline, 'bgRemoved', r100.diagnostics.backgroundPixelsRemoved);
console.log(' 56:', r56.grid.length + 'x' + r56.grid[0].length, r56.diagnostics.detectedPipeline, 'bgRemoved', r56.diagnostics.backgroundPixelsRemoved);
console.log('100 diag keys bg:', JSON.stringify(r100.diagnostics.background));
console.log(' 56 diag keys bg:', JSON.stringify(r56.diagnostics.background));
// 对齐：100 版内容起始行
let top = 0; while (top < 100 && r100.grid[top].every(c => !c)) top++;
let bot = 99; while (bot > top && r100.grid[bot].every(c => !c)) bot--;
console.log('100版内容行范围:', top, '-', bot, '高度', bot - top + 1);
let diff = 0, total = 0;
for (let gy = 0; gy < 56; gy++) for (let gx = 0; gx < 100; gx++) {
  total++;
  if ((r100.grid[top + gy]?.[gx] ?? null) !== (r56.grid[gy][gx] ?? null)) diff++;
}
console.log('网格不同的格:', diff, '/', total, '=', (diff / total * 100).toFixed(1) + '%');
await vite.close();
