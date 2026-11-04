// 对比脚本：用本仓库管线处理同一张图，与本地 Python 管线（workspace pattern_100x100）同口径对比
// 用法: node scripts/compare-vs-local.mjs
import { createServer } from 'vite';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC_IMAGE = 'benchmark/images/street-boy.jpg';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare';
const LOCAL_JSON = 'C:/Users/Plout/Desktop/pindouwangge/pattern_100x100/pattern_data.json';

await mkdir(OUT, { recursive: true });
const vite = await createServer({
  root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error',
  optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts',
});
try {
  const { convertImageDataToGrid } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts');
  const { MARD_PALETTE } = await vite.ssrLoadModule('/src/data/palettes.ts');
  const { deltaE2000, rgbToLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');

  const source = await sharp(SRC_IMAGE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  console.log('source:', source.info.width, 'x', source.info.height);

  const settings = {
    width: 100, height: 100, keepAspectRatio: true, brand: 'MARD',
    dither: 'none', colorLimit: 32, brightness: 0, contrast: 0, saturation: 0,
    transparentCutoff: 128, boardSize: 29, sharpening: 30, outlineBoost: false,
    chromaKeyColor: null, chromaKeyTolerance: 20, colorMatchAlgo: 'ciede2000',
    backgroundRemovalEnabled: true, kmeansClustering: true, quantizationStrength: 28,
    pipelineOverride: 'auto',
  };
  const t0 = performance.now();
  const result = convertImageDataToGrid(
    new Uint8ClampedArray(source.data.buffer, source.data.byteOffset, source.data.length),
    source.info.width, source.info.height, settings, MARD_PALETTE,
  );
  const ms = Math.round(performance.now() - t0);
  const { grid, diagnostics } = result;
  console.log('pipeline =', diagnostics.detectedPipeline, '(confidence', diagnostics.confidence?.toFixed?.(2) ?? diagnostics.confidence, ')');
  console.log('background =', diagnostics.background?.color ?? 'kept', '| removed px =', diagnostics.backgroundPixelsRemoved);
  console.log('meanDeltaE(app) =', diagnostics.meanDeltaE?.toFixed?.(3), '| convert ms =', ms);

  const colorById = new Map(MARD_PALETTE.map(c => [c.id, c]));
  const counts = new Map();
  let filled = 0;
  for (const row of grid) for (const id of row) {
    if (!id) continue;
    filled++;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  console.log('filled cells =', filled, '| colors =', counts.size);

  // 与本地版同口径：共享 100x100 源格平均色（由本地 JSON 旁的同名中间产物提供）
  // 这里直接用同参数重算一遍共享取样，保证两个网格用完全相同的格心参考色
  const ref = await buildReferenceCells(source.data, source.info.width, source.info.height, 100, 100);
  let sum = 0, n = 0, worst = null;
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    const id = grid[y][x];
    if (!id) continue;
    const c = colorById.get(id);
    if (!c || !ref[y][x]) continue;
    const de = deltaE2000(rgbToLab(ref[y][x][0], ref[y][x][1], ref[y][x][2]), rgbToLab(...c.rgb));
    sum += de; n++;
    if (!worst || de > worst.de) worst = { x, y, de: +de.toFixed(2), code: c.code };
  }
  const meanDe = sum / n;
  console.log('同口径 meanDeltaE(2000) =', meanDe.toFixed(3), '| worst cell =', JSON.stringify(worst));

  // 渲染对比 PNG（与本地版同风格：12px 格、22px 边距、每 10 格刻度）
  const CELL = 12, M = 22, W = M + 100 * CELL + 2;
  const px = Buffer.alloc(W * W * 3, 255);
  const set = (x, y, r, g, b) => { const i = (y * W + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b; };
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    const id = grid[y][x];
    const [r, g, b] = id ? colorById.get(id).rgb : [244, 244, 246];
    for (let dy = 1; dy < CELL - 1; dy++) for (let dx = 1; dx < CELL - 1; dx++) {
      set(M + x * CELL + dx, M + y * CELL + dy, r, g, b);
    }
  }
  for (let k = 0; k <= 100; k += 10) {
    const p = M + k * CELL;
    for (let t = 0; t <= 100 * CELL; t++) {
      if (k > 0 && k < 100) { set(p, M + t, 150, 150, 150); set(M + t, p, 150, 150, 150); }
    }
  }
  await sharp(px, { raw: { width: W, height: W, channels: 3 } }).png().toFile(`${OUT}/theirs_pattern_100x100.png`);

  // 清单 CSV
  const csv = ['色号,颜色名,RGB,数量',
    ...[...counts.entries()].sort((a, b) => b[1] - a[1])
      .map(([id, n2]) => { const c = colorById.get(id); return `${c.code},${c.name},${c.rgb.join(',')},${n2}`; }),
  ].join('\n');
  await writeFile(`${OUT}/theirs_bead_list.csv`, '\uFEFF' + csv, 'utf8');

  await writeFile(`${OUT}/theirs_result.json`, JSON.stringify({
    pipeline: diagnostics.detectedPipeline, confidence: diagnostics.confidence,
    background: diagnostics.background, backgroundPixelsRemoved: diagnostics.backgroundPixelsRemoved,
    meanDeltaE_app: diagnostics.meanDeltaE, meanDeltaE_shared: meanDe, worstCell: worst,
    filledCells: filled, colors: counts.size, convertMs: ms,
  }, null, 2));
  console.log('done ->', OUT);
} finally {
  await vite.close();
}

// 共享参考格色：预乘 alpha 面积平均（与本地 Python 版一致），覆盖率<0.3 返回 null
async function buildReferenceCells(data, w, h, cols, rows) {
  const covBuf = new Float64Array(cols * rows);
  const rgbBuf = new Float64Array(cols * rows * 3);
  const sx = w / cols, sy = h / rows;
  for (let y = 0; y < h; y++) {
    const gy = Math.min(rows - 1, Math.floor(y / sy));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3] / 255;
      const gx = Math.min(cols - 1, Math.floor(x / sx));
      const gi = gy * cols + gx;
      covBuf[gi] += a;
      rgbBuf[gi * 3] += data[i] * a; rgbBuf[gi * 3 + 1] += data[i + 1] * a; rgbBuf[gi * 3 + 2] += data[i + 2] * a;
    }
  }
  const ref = [];
  for (let gy = 0; gy < rows; gy++) {
    const row = [];
    for (let gx = 0; gx < cols; gx++) {
      const gi = gy * cols + gx, cov = covBuf[gi];
      row.push(cov >= 0.3 * (sx * sy)
        ? [rgbBuf[gi * 3] / cov, rgbBuf[gi * 3 + 1] / cov, rgbBuf[gi * 3 + 2] / cov]
        : null);
    }
    ref.push(row);
  }
  return ref;
}
