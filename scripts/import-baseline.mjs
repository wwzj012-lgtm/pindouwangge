// 颜色识别 A/B 测试：给定图片+格宽，搜索网格原点（模拟手工对齐），跑识别并渲染结果。
// 运行: node scripts/import-baseline.mjs <imagePath> <cellPx> <prefix> [preset]
// preset: fast(默认参数) | photo(precision+beadPhoto+全开)
import { createServer } from 'vite';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const root = process.cwd();
const [imgArg, cellArg, prefixArg, presetArg, oxArg, oyArg] = process.argv.slice(2);
const IMG = imgArg ?? 'C:/Users/Plout/Pictures/12.jpg';
const CELL = Number(cellArg) || 8.8;
const prefix = prefixArg ?? 'base';
const preset = presetArg ?? 'photo';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
await mkdir(OUT, { recursive: true });

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const palette = BRAND_PALETTES.MARD;

const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

function buildCalibration(cellW, ox, oy) {
  const columns = Math.max(1, Math.floor((source.width - ox * cellW) / cellW));
  const rows = Math.max(1, Math.floor((source.height - oy * cellW) / cellW));
  return { originX: ox * cellW, originY: oy * cellW, cellWidth: cellW, cellHeight: cellW, columns, rows };
}

function optionsFor(mode) {
  if (mode === 'fast') {
    return { mode: 'fast', beadPhoto: true, autoAlign: false };
  }
  return { mode: 'precision', beadPhoto: true, autoColorBalance: true, autoAlign: true, unifyTwins: true, smooth: true, edgeInsetRatio: 0.1 };
}

// 阶段 1：粗搜原点（±0.5 格），用平均主色占比打分；指定 ox/oy 参数时跳过搜索
let best = null;
if (oxArg !== undefined && oyArg !== undefined) {
  const cal = buildCalibration(CELL, Number(oxArg), Number(oyArg));
  best = { ox: Number(oxArg), oy: Number(oyArg), score: 0, cal };
  console.log(`[${prefix}] 固定原点: (${best.ox}, ${best.oy})`);
} else
for (const ox of [-0.5, -0.25, 0, 0.25, 0.5]) {
  for (const oy of [-0.5, -0.25, 0, 0.25, 0.5]) {
    const cal = buildCalibration(CELL, ox, oy);
    const r = recognizeImportImage(source, cal, palette, 'fast', undefined, optionsFor('fast'));
    const score = r.summary.meanConfidence ?? 0;
    if (!best || score > best.score) best = { ox, oy, score, cal };
  }
}
console.log(`[${prefix}] 原点搜索: (${best.ox}, ${best.oy}) meanConf=${best.score.toFixed(3)} grid=${best.cal.columns}x${best.cal.rows}`);

// 细搜 ±0.125（固定原点时跳过）
if (oxArg === undefined || oyArg === undefined)
for (const dx of [-0.125, 0, 0.125]) {
  for (const dy of [-0.125, 0, 0.125]) {
    const cal = buildCalibration(CELL, best.ox + dx, best.oy + dy);
    const r = recognizeImportImage(source, cal, palette, 'fast', undefined, optionsFor('fast'));
    const score = r.summary.meanConfidence ?? 0;
    if (score > best.score) best = { ox: best.ox + dx, oy: best.oy + dy, score, cal };
  }
}
console.log(`[${prefix}] 细搜后: (${best.ox}, ${best.oy}) meanConf=${best.score.toFixed(3)}`);

// 阶段 2：正式识别
const opts = optionsFor(preset);
const t0 = Date.now();
const result = recognizeImportImage(source, best.cal, palette, opts.mode, undefined, opts);
const elapsed = Date.now() - t0;
const s = result.summary;
console.log(`[${prefix}] ${s.mapped}/${s.total} 格 | 色数 ${s.distinctColors} | meanDist=${s.meanDistance?.toFixed(2)} meanConf=${s.meanConfidence?.toFixed(3)} lowConf=${s.lowConfidence} | quality=${s.quality} | ${elapsed}ms`);
if (result.shadingRefine) console.log(`  shadingRefine: ${result.shadingRefine.refined} 格重判 (参考色 ${result.shadingRefine.references} 支)`);
if (result.smoothing) console.log(`  smoothing: ${result.smoothing.changed} 格改写`);
if (result.twinUnification) console.log(`  twinUnification: ${result.twinUnification.remapped} 格`);
if (result.autoCorrection?.colorGains) console.log(`  colorGains: ${JSON.stringify(result.autoCorrection.colorGains)}`);

// 渲染识别结果
const SCALE = 4;
const W = best.cal.columns * SCALE, H = best.cal.rows * SCALE;
const px = Buffer.alloc(W * H * 3, 255);
const hex2rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
for (let row = 0; row < best.cal.rows; row++) {
  for (let col = 0; col < best.cal.columns; col++) {
    const cell = result.cells[row][col];
    const [r, g, b] = cell.colorId ? hex2rgb(cell.color.hex) : (cell.status === 'blank' ? [245, 245, 245] : [255, 0, 255]);
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) {
      const i = ((row * SCALE + dy) * W + col * SCALE + dx) * 3;
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
  }
}
await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toFile(`${OUT}/${prefix}_grid.png`);

// 质量热力图：good=白, fair=黄, poor=红, blank=浅灰
const qm = Buffer.alloc(W * H * 3, 255);
const qColor = { good: [255, 255, 255], fair: [255, 210, 80], poor: [230, 60, 60] };
for (let row = 0; row < best.cal.rows; row++) {
  for (let col = 0; col < best.cal.columns; col++) {
    const cell = result.cells[row][col];
    const [r, g, b] = cell.status === 'mapped' ? qColor[cell.quality] : [200, 200, 200];
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) {
      const i = ((row * SCALE + dy) * W + col * SCALE + dx) * 3;
      qm[i] = r; qm[i + 1] = g; qm[i + 2] = b;
    }
  }
}
await sharp(qm, { raw: { width: W, height: H, channels: 3 } }).png().toFile(`${OUT}/${prefix}_quality.png`);

// 原图缩略（同尺寸对照）
await sharp(IMG).resize(W, H, { kernel: 'nearest' }).png().toFile(`${OUT}/${prefix}_src.png`);

await writeFile(`${OUT}/${prefix}_stats.json`, JSON.stringify({ prefix, preset, cell: CELL, origin: [best.ox, best.oy], summary: s, elapsed }, null, 2));
console.log(`[${prefix}] -> ${OUT}/${prefix}_grid.png`);
await vite.close();
