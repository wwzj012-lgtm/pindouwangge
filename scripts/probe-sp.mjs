import { createServer } from 'vite';
import sharp from 'sharp';
const root = process.cwd();
const settings = {
  width: 100, height: 100, keepAspectRatio: true, brand: 'MARD',
  dither: 'none', colorLimit: 32, brightness: 0, contrast: 0, saturation: 0,
  transparentCutoff: 128, boardSize: 29, sharpening: 30, outlineBoost: false,
  chromaKeyColor: null, chromaKeyTolerance: 20, colorMatchAlgo: 'ciede2000',
  backgroundRemovalEnabled: true, kmeansClustering: true, quantizationStrength: 28,
  pipelineOverride: 'auto',
};
const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { convertImageDataToGrid } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts');
const { MARD_PALETTE } = await vite.ssrLoadModule('/src/data/palettes.ts');
const source = await sharp('benchmark/images/spongebob-patrick.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const clamped = new Uint8ClampedArray(source.data.buffer, source.data.byteOffset, source.data.length);
const r = convertImageDataToGrid(clamped, source.info.width, source.info.height, settings, MARD_PALETTE);
const grid = r.grid;
console.log('grid', grid.length, 'x', grid[0].length, 'pipeline', r.diagnostics.detectedPipeline);
// 每行非空格数（首尾）
for (const y of [0, 5, 10, 21, 22, 50, 77, 78, 90, 99]) {
  const n = grid[y].filter(x => x).length;
  console.log('row', y, 'nonEmpty', n);
}
// 海绵宝宝身体区（原图 x~14-24,y~40-58 → 格约 14-24, 40-58? 原图1920宽/100=19.2px每格）
// 海绵宝宝身体约源 x250-700, y500-1050 → 格 13-36, 26-54（若拉伸则 y*100/1078*100... 直接采样）
// 统计身体区选豆分布
const count = {};
for (let y = 30; y < 50; y++) for (let x = 15; x < 30; x++) { const id = grid[y][x]; if (id) count[id] = (count[id] || 0) + 1; }
console.log('海绵宝宝身体区(15-30,30-50)选豆分布:', Object.entries(count).sort((a,b)=>b[1]-a[1]).slice(0,8));
const count2 = {};
for (let y = 35; y < 75; y++) for (let x = 65; x < 85; x++) { const id = grid[y][x]; if (id) count2[id] = (count2[id] || 0) + 1; }
console.log('派大星身体区(65-85,35-75)选豆分布:', Object.entries(count2).sort((a,b)=>b[1]-a[1]).slice(0,8));
await vite.close();
