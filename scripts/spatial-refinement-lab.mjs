// 实验原型：Potts 空间一致性精修（现代全局优化思路 vs 启发式规则堆叠）。
// 能量 E(label) = Σ格 deltaE(源色, 豆) + λ · Σ邻界 不同豆惩罚(边缘自适应)
// 作为现有管线输出的后处理验证效果；指标通过 accuracy-benchmark 对比。
// 运行：node scripts/spatial-refinement-lab.mjs [--lambda 6] [--iters 6]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createServer } from 'vite';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lambda = (() => { const i = process.argv.indexOf('--lambda'); return i > -1 ? Number(process.argv[i + 1]) : 6; })();
const iterations = (() => { const i = process.argv.indexOf('--iters'); return i > -1 ? Number(process.argv[i + 1]) : 6; })();

const settings = {
  width: 100, height: 100, keepAspectRatio: false, brand: 'MARD', dither: 'none',
  colorLimit: 0, brightness: 0, contrast: 0, saturation: 0, transparentCutoff: 128,
  boardSize: 29, colorMatchAlgo: 'ciede2000', sharpening: 30, outlineBoost: true,
  chromaKeyColor: null, chromaKeyTolerance: 20, pipelineOverride: 'photo',
};

function rgbToLab([r, g, b]) {
  const lin = (v) => { const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; };
  let x = (lin(r) * 0.4124 + lin(g) * 0.3576 + lin(b) * 0.1805) / 0.95047;
  let y = lin(r) * 0.2126 + lin(g) * 0.7152 + lin(b) * 0.0722;
  let z = (lin(r) * 0.0193 + lin(g) * 0.1192 + lin(b) * 0.9505) / 1.08883;
  const t = (v) => (v > 0.008856 ? v ** (1 / 3) : 7.787 * v + 16 / 116);
  x = t(x); y = t(y); z = t(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1, [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = (Math.atan2(b1, a1p) * 180 / Math.PI + 360) % 360;
  const h2p = (Math.atan2(b2, a2p) * 180 / Math.PI + 360) % 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = h2p - h1p;
  if (Math.abs(dhp) > 180) dhp = dhp > 0 ? dhp - 360 : dhp + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360);
  const Lbar = (L1 + L2) / 2, Cbarp = (C1p + C2p) / 2;
  let hbar = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
  if (C1p * C2p === 0) hbar = h1p + h2p;
  const T = 1 - 0.17 * Math.cos((hbar - 30) * Math.PI / 180) + 0.24 * Math.cos(2 * hbar * Math.PI / 180)
    + 0.32 * Math.cos((3 * hbar + 6) * Math.PI / 180) - 0.20 * Math.cos((4 * hbar - 63) * Math.PI / 180);
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const Sl = 1 + 0.015 * (Lbar - 50) ** 2 / Math.sqrt(20 + (Lbar - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dTheta * Math.PI / 180) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/** Potts ICM 精修：能量 = 保真 + λ·邻界不同豆惩罚（惩罚随局部边缘强度减弱）。 */
function refineSpatialCoherence(grid, sourceLabs, palette, width, height, lambdaValue, iterations) {
  const labById = new Map(palette.map((color) => [color.id, color.lab]));
  const localDelta = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  const neighbours = (x, y) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
    .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < width && ny < height);
  // 每格的局部边缘强度（源色邻域最大差），决定该格的平滑惩罚：边缘处惩罚小，允许真实轮廓。
  const edgeStrength = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = sourceLabs[y * width + x];
      if (!source) continue;
      let max = 0;
      for (const [nx, ny] of neighbours(x, y)) {
        const n = sourceLabs[ny * width + nx];
        if (n) max = Math.max(max, localDelta(source, n));
      }
      edgeStrength[y * width + x] = max;
    }
  }
  let changed = 0;
  for (let iter = 0; iter < iterations; iter += 1) {
    let iterChanged = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const source = sourceLabs[index];
        const current = grid[y][x];
        if (!source || !current) continue;
        // 候选：当前豆 + 邻格的豆（限制搜索空间；多数改善来自邻格标签）。
        const candidates = new Set([current]);
        for (const [nx, ny] of neighbours(x, y)) {
          const n = grid[ny][nx];
          if (n) candidates.add(n);
        }
        const penaltyScale = lambdaValue / (1 + edgeStrength[index] / 14);
        let bestLabel = current;
        let bestEnergy = Infinity;
        for (const candidate of candidates) {
          const beadLab = labById.get(candidate);
          if (!beadLab) continue;
          let energy = localDelta(source, beadLab);
          for (const [nx, ny] of neighbours(x, y)) {
            const n = grid[ny][nx];
            if (!n) continue;
            if (n !== candidate) {
              const neighbourSource = sourceLabs[ny * width + nx];
              const boundary = neighbourSource ? Math.min(1, localDelta(source, neighbourSource) / 30) : 1;
              energy += penaltyScale * (0.35 + 0.65 * boundary);
            }
          }
          if (energy < bestEnergy - 1e-9) { bestEnergy = energy; bestLabel = candidate; }
        }
        if (bestLabel !== current) {
          grid[y][x] = bestLabel;
          iterChanged += 1;
        }
      }
    }
    changed += iterChanged;
    if (iterChanged === 0) break;
  }
  return changed;
}

function metrics(grid) {
  const height = grid.length, width = grid[0].length;
  const counts = new Map();
  let disagree = 0, pairs = 0, occupied = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const id = grid[y][x];
      if (!id) continue;
      occupied += 1;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      const right = grid[y][x + 1];
      const down = grid[y + 1]?.[x];
      if (right) { pairs += 1; if (right !== id) disagree += 1; }
      if (down) { pairs += 1; if (down !== id) disagree += 1; }
    }
  }
  return {
    colorTypes: counts.size,
    neighbourDisagreement: Number((disagree / Math.max(1, pairs)).toFixed(4)),
    occupied,
  };
}

async function run() {
  const vite = await createServer({
    configFile: false, root: projectDirectory, optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom',
  });
  let converter, palette;
  try {
    ({ convertImageDataToGrid: converter } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts'));
    ({ MARD_PALETTE: palette } = await vite.ssrLoadModule('/src/data/palettes.ts'));
  } finally {
    await vite.close();
  }
  const decoded = await sharp(path.join(projectDirectory, 'scripts/fixtures/pixel-art-character.jpg'))
    .ensureAlpha().resize({ width: 400, height: 400, fit: 'cover', position: 'centre', kernel: 'nearest' })
    .raw().toBuffer({ resolveWithObject: true });
  const data = new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
  const gridW = Number(process.argv[process.argv.indexOf('--gridw') > -1 ? process.argv.indexOf('--gridw') + 1 : 100]) || 100;
  const result = converter(data, decoded.info.width, decoded.info.height, { ...settings, width: gridW, height: gridW }, palette);
  const grid = result.grid.map((row) => [...row]);
  // sourceLabs 需要与管线一致：直接用 matches 的 sourceLab。
  const sourceLabs = result.diagnostics.matches.map((row) => row.map((match) => match ? match.sourceLab : null));
  const gridSize = result.grid.length;

  const before = metrics(grid);
  const changed = refineSpatialCoherence(grid, sourceLabs, palette, grid.length, grid[0].length, lambda, iterations);
  const after = metrics(grid);
  console.log(JSON.stringify({
    lambda, iterations, cellsChanged: changed,
    before, after,
  }, null, 2));

  // 生成对比预览：管线原始 / 精修后
  const scale = Math.max(2, Math.floor(400 / gridSize));
  const colors = new Map(palette.map((color) => [color.id, color.rgb]));
  const render = (sourceGrid) => {
    const buffer = Buffer.alloc(gridSize * scale * gridSize * scale * 4, 0);
    for (let y = 0; y < gridSize; y += 1) {
      for (let x = 0; x < gridSize; x += 1) {
        const rgb = sourceGrid[y][x] ? colors.get(sourceGrid[y][x]) : undefined;
        for (let py = y * scale; py < (y + 1) * scale; py += 1) {
          for (let px = x * scale; px < (x + 1) * scale; px += 1) {
            const offset = (py * gridSize * scale + px) * 4;
            buffer[offset] = rgb?.[0] ?? 0; buffer[offset + 1] = rgb?.[1] ?? 0;
            buffer[offset + 2] = rgb?.[2] ?? 0; buffer[offset + 3] = rgb ? 255 : 0;
          }
        }
      }
    }
    return sharp(buffer, { raw: { width: 100 * scale, height: 100 * scale, channels: 4 } }).png().toBuffer();
  };
  await mkdir(path.join(projectDirectory, 'artifacts', 'accuracy'), { recursive: true });
  await sharp({ create: { width: gridSize * scale * 2 + 8, height: gridSize * scale, channels: 4, background: { r: 15, g: 23, b: 42, alpha: 1 } } })
    .composite([
      { input: await render(result.grid), left: 0, top: 0 },
      { input: await render(grid), left: gridSize * scale + 8, top: 0 },
    ])
    .png().toFile(path.join(projectDirectory, 'artifacts', 'accuracy', `spatial-refine-l${lambda}.png`));
  console.log('preview: artifacts/accuracy/spatial-refine-l' + lambda + '.png');
}

import { mkdir } from 'node:fs/promises';
run().catch((error) => { console.error(error); process.exitCode = 1; });
