// 渲染当前管线的 street-boy 100×100 图纸并导出脸部/帽徽特写，用于主色采样 A/B。
// 运行: node scripts/render-detail.mjs [outPrefix]
import { createServer } from 'vite';
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC_IMAGE = 'benchmark/images/street-boy.jpg';
const prefix = process.argv[2] ?? 'dom';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/detail';

const settings = {
  width: 100, height: 100, keepAspectRatio: true, brand: 'MARD',
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
console.log('pipeline:', result.diagnostics.detectedPipeline, '| meanΔE', result.diagnostics.meanDeltaE?.toFixed?.(3));

const colorById = new Map(MARD_PALETTE.map(c => [c.id, c]));
const CELL = 12, M = 22, SZ = M + 100 * CELL + 2;
const px = Buffer.alloc(SZ * SZ * 3, 255);
const set = (x, y, r, g, b) => { const i = (y * SZ + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b; };
for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
  const id = result.grid[y][x];
  const [r, g, b] = id ? colorById.get(id).rgb : [244, 244, 246];
  for (let dy = 1; dy < CELL - 1; dy++) for (let dx = 1; dx < CELL - 1; dx++) {
    set(M + x * CELL + dx, M + y * CELL + dy, r, g, b);
  }
}
const gridPng = await sharp(px, { raw: { width: SZ, height: SZ, channels: 3 } }).png().toBuffer();
await writeFile(`${OUT}/${prefix}_full.png`, gridPng);

// 特写：脸 x42-60,y42-54；帽徽 x44-60,y25-37
const crops = [
  { name: 'face', gx0: 42, gy0: 42, gx1: 60, gy1: 54 },
  { name: 'capA', gx0: 44, gy0: 25, gx1: 60, gy1: 37 },
];
for (const c of crops) {
  const left = M + c.gx0 * CELL, top = M + c.gy0 * CELL, w = (c.gx1 - c.gx0) * CELL, h = (c.gy1 - c.gy0) * CELL;
  await sharp(gridPng).extract({ left, top, width: w, height: h })
    .resize(w * 2, h * 2, { kernel: 'nearest' }).png()
    .toFile(`${OUT}/${prefix}_${c.name}.png`);
  await sharp(SRC_IMAGE)
    .extract({ left: Math.round(c.gx0 * 19.2), top: Math.round(c.gy0 * 19.2), width: Math.round((c.gx1 - c.gx0) * 19.2), height: Math.round((c.gy1 - c.gy0) * 19.2) })
    .resize(w * 2, h * 2, { kernel: 'nearest' }).png()
    .toFile(`${OUT}/${prefix}_${c.name}_src.png`);
}
console.log('done ->', `${OUT}/${prefix}_*.png`);
await vite.close();
