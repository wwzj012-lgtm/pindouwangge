// 对同一张图渲染多个设置变体并横向拼接
import { createServer } from 'vite';
import sharp from 'sharp';
import path from 'node:path';
const root = process.cwd();
const IMG = 'benchmark/images/spongebob-patrick.jpg';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/detail';
const base = {
  width: 100, height: 100, keepAspectRatio: true, brand: 'MARD',
  dither: 'none', colorLimit: 32, brightness: 0, contrast: 0, saturation: 0,
  transparentCutoff: 128, boardSize: 29, sharpening: 30, outlineBoost: false,
  chromaKeyColor: null, chromaKeyTolerance: 20, colorMatchAlgo: 'ciede2000',
  backgroundRemovalEnabled: true, kmeansClustering: true, quantizationStrength: 28,
  pipelineOverride: 'auto',
};
const variants = [
  { name: 'V1 当前设置', over: {} },
  { name: 'V2 无锐化', over: { sharpening: 0 } },
  { name: 'V3 无kmeans量化', over: { kmeansClustering: false, quantizationStrength: 0 } },
  { name: 'V4 无锐化+无量化', over: { sharpening: 0, kmeansClustering: false, quantizationStrength: 0 } },
  { name: 'V5 cartoon管线', over: { pipelineOverride: 'cartoon' } },
  { name: 'V6 logo管线', over: { pipelineOverride: 'logo' } },
];
const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { convertImageDataToGrid } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts');
const { MARD_PALETTE } = await vite.ssrLoadModule('/src/data/palettes.ts');
const colorById = new Map(MARD_PALETTE.map(c => [c.id, c]));
const source = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const clamped = new Uint8ClampedArray(source.data.buffer, source.data.byteOffset, source.data.length);
const CELL = 12, M = 4;
const tiles = [];
for (const v of variants) {
  const settings = { ...base, ...v.over };
  const r = convertImageDataToGrid(clamped, source.info.width, source.info.height, settings, MARD_PALETTE);
  const cols = r.grid[0].length, rows = r.grid.length;
  const SZ_W = M + cols * CELL, SZ_H = M + rows * CELL;
  const px = Buffer.alloc(SZ_W * SZ_H * 3, 255);
  const set = (x, y, rr, gg, bb) => { const i = (y * SZ_W + x) * 3; px[i] = rr; px[i+1] = gg; px[i+2] = bb; };
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const id = r.grid[y][x];
    const [rr, gg, bb] = id ? colorById.get(id).rgb : [250, 250, 250];
    for (let dy = 1; dy < CELL - 1; dy++) for (let dx = 1; dx < CELL - 1; dx++) set(M + x*CELL + dx, M + y*CELL + dy, rr, gg, bb);
  }
  const gridPng = await sharp(px, { raw: { width: SZ_W, height: SZ_H, channels: 3 } }).png().toBuffer();
  const label = Buffer.from(`<svg width="${SZ_W}" height="34"><rect width="100%" height="100%" fill="#222"/><text x="8" y="25" font-family="Microsoft YaHei" font-size="20" font-weight="bold" fill="#fff">${v.name} (${r.diagnostics.detectedPipeline})</text></svg>`);
  const withLabel = await sharp({ create: { width: SZ_W, height: SZ_H + 34, channels: 3, background: {r:255,g:255,b:255} } })
    .composite([{ input: label, top: 0, left: 0 }, { input: gridPng, top: 34, left: 0 }]).png().toBuffer();
  tiles.push(withLabel);
  console.log(v.name, 'meanΔE', r.diagnostics.meanDeltaE?.toFixed?.(3));
}
const metas = await Promise.all(tiles.map(t => sharp(t).metadata()));
const totalW = metas.reduce((s, m) => s + m.width + 12, 0);
const maxH = Math.max(...metas.map(m => m.height));
let left = 0;
const comps = tiles.map((t, i) => { const c = { input: t, top: 0, left }; left += metas[i].width + 12; return c; });
await sharp({ create: { width: totalW, height: maxH, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite(comps).png().toFile(`${OUT}/sp_variants.png`);
console.log('done -> sp_variants.png');
await vite.close();
