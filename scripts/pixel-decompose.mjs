// 逐格像素误差分解：跑当前管线的 street-boy 转换，输出每格的逐像素平均 ΔE 数组。
// 用法: node scripts/pixel-decompose.mjs benchmark/results/decomp-<name>.json
import { createServer } from 'vite';
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_IMAGE = path.join(ROOT, 'benchmark', 'images', 'street-boy.jpg');
const OUT = process.argv[2] ?? 'benchmark/results/decomp.json';

const SETTINGS = {
  width: 100, height: 100, keepAspectRatio: true, brand: 'MARD', dither: 'none',
  colorLimit: 32, brightness: 0, contrast: 0, saturation: 0, transparentCutoff: 128,
  boardSize: 29, sharpening: 30, outlineBoost: false, chromaKeyColor: null,
  chromaKeyTolerance: 20, colorMatchAlgo: 'ciede2000', backgroundRemovalEnabled: true,
  kmeansClustering: true, quantizationStrength: 28, pipelineOverride: 'auto',
};

const vite = await createServer({
  root: ROOT, appType: 'custom', server: { middlewareMode: true },
  logLevel: 'error', optimizeDeps: { noDiscovery: true },
});
const { convertImageDataToGrid } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts');
const { MARD_PALETTE } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { rgbToLab, deltaE2000 } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');

const { data, info } = await sharp(SRC_IMAGE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const srcW = info.width, srcH = info.height;
const px = (x, y) => {
  const i = (y * srcW + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};

const t0 = performance.now();
const result = convertImageDataToGrid(
  new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), srcW, srcH, SETTINGS, MARD_PALETTE,
);
console.log('pipeline:', result.diagnostics.detectedPipeline, 'meanΔE', result.diagnostics.meanDeltaE?.toFixed?.(3), `${Math.round(performance.now() - t0)}ms`);

const grid = result.grid;
const rows = grid.length, cols = grid[0].length;
const colorById = new Map(MARD_PALETTE.map((c) => [c.id, c]));

// 背景参照色：与 quality-benchmark 相同的边框中位数
const border = [];
for (let x = 0; x < srcW; x += 7) border.push(px(x, 0), px(x, srcH - 1));
for (let y = 0; y < srcH; y += 7) border.push(px(0, y), px(srcW - 1, y));
const bg = [0, 1, 2].map((c) => {
  const vals = border.map((p) => p[c]).sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
});

// 每格逐像素平均 ΔE（步长 4 采样足够稳定）
const cellErr = [];
for (let gy = 0; gy < rows; gy++) {
  cellErr.push(new Array(cols).fill(null));
}
const PX_STRIDE = 4;
for (let gy = 0; gy < rows; gy++) {
  const y0 = Math.floor((gy * srcH) / rows);
  const y1 = Math.min(srcH, Math.ceil(((gy + 1) * srcH) / rows));
  for (let gx = 0; gx < cols; gx++) {
    const x0 = Math.floor((gx * srcW) / cols);
    const x1 = Math.min(srcW, Math.ceil(((gx + 1) * srcW) / cols));
    const id = grid[gy][gx];
    const rgb = id ? colorById.get(id).rgb : bg;
    const bead = rgbToLab(rgb[0], rgb[1], rgb[2]);
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y += PX_STRIDE) {
      for (let x = x0; x < x1; x += PX_STRIDE) {
        const [pr, pg, pb, pa] = px(x, y);
        if (pa < 128) continue;
        sum += deltaE2000(rgbToLab(pr, pg, pb), bead);
        n++;
      }
    }
    if (n > 0) cellErr[gy][gx] = sum / n;
  }
}

await writeFile(OUT, JSON.stringify({
  grid, cellErr, cols, rows, srcW, srcH,
  mean: cellErr.flat().filter((v) => v !== null).reduce((s, v) => s + v, 0) / cellErr.flat().filter((v) => v !== null).length,
}, null, 1));
console.log('saved ->', OUT);
await vite.close();
