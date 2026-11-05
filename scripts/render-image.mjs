// 渲染任意图片的 100 宽图纸（keepAspectRatio），输出整图 + 与原图并排对比。
// 运行: node scripts/render-image.mjs <imagePath> <outPrefix> [gridWidth]
import { createServer } from 'vite';
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const [imgArg, prefixArg, widthArg] = process.argv.slice(2);
const SRC_IMAGE = imgArg ?? 'benchmark/images/street-boy.jpg';
const prefix = prefixArg ?? 'out';
const GRID_W = Number(widthArg) || 100;
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/detail';

const settings = {
  width: GRID_W, height: GRID_W, keepAspectRatio: true, brand: 'MARD',
  dither: 'none', colorLimit: 32, brightness: 0, contrast: 0, saturation: 0,
  transparentCutoff: 128, boardSize: 29, sharpening: 30, outlineBoost: false,
  chromaKeyColor: null, chromaKeyTolerance: 20, colorMatchAlgo: 'ciede2000',
  backgroundRemovalEnabled: true, kmeansClustering: true, quantizationStrength: 28,
  pipelineOverride: 'auto',
};

const vite = await createServer({
  root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error',
  optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts',
});
const { convertImageDataToGrid } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts');
const { MARD_PALETTE } = await vite.ssrLoadModule('/src/data/palettes.ts');

const source = await sharp(SRC_IMAGE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = source.info.width, H = source.info.height;
const clamped = new Uint8ClampedArray(source.data.buffer, source.data.byteOffset, source.data.length);
const result = convertImageDataToGrid(clamped, W, H, settings, MARD_PALETTE);
const cols = result.grid[0].length, rows = result.grid.length;
console.log('pipeline:', result.diagnostics.detectedPipeline, '| grid', cols + 'x' + rows,
  '| meanΔE', result.diagnostics.meanDeltaE?.toFixed?.(3));

const colorById = new Map(MARD_PALETTE.map(c => [c.id, c]));
const CELL = 12, M = 22, SZ_W = M + cols * CELL + 2, SZ_H = M + rows * CELL + 2;
const px = Buffer.alloc(SZ_W * SZ_H * 3, 255);
const set = (x, y, r, g, b) => { const i = (y * SZ_W + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b; };
for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
  const id = result.grid[y][x];
  const [r, g, b] = id ? colorById.get(id).rgb : [244, 244, 246];
  for (let dy = 1; dy < CELL - 1; dy++) for (let dx = 1; dx < CELL - 1; dx++) {
    set(M + x * CELL + dx, M + y * CELL + dy, r, g, b);
  }
}
const gridPng = await sharp(px, { raw: { width: SZ_W, height: SZ_H, channels: 3 } }).png().toBuffer();
await writeFile(`${OUT}/${prefix}_full.png`, gridPng);

// 整图并排：上=原图（等比缩到与图纸同宽），下=图纸
const srcFit = await sharp(SRC_IMAGE).flatten({ background: '#ffffff' })
  .resize(cols * CELL, rows * CELL, { kernel: 'nearest' }).png().toBuffer();
const label = (t, w) => Buffer.from(
  `<svg width="${w}" height="40"><rect width="100%" height="100%" fill="#222"/><text x="10" y="30" font-family="Microsoft YaHei, sans-serif" font-size="24" font-weight="bold" fill="#fff">${t}</text></svg>`);
const BW = cols * CELL;
await sharp({ create: { width: BW * 2 + 24, height: rows * CELL + 48, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite([
    { input: label('原图', BW), top: 0, left: 0 },
    { input: label(`图纸 ${cols}x${rows} (${result.diagnostics.detectedPipeline})`, BW), top: 0, left: BW + 24 },
    { input: srcFit, top: 40, left: 0 },
    { input: gridPng, top: 40, left: BW + 24, },
  ])
  .png().toFile(`${OUT}/${prefix}_side.png`);

console.log('done ->', `${OUT}/${prefix}_full.png , ${prefix}_side.png`);
await vite.close();
