// A/B 验证：street-boy 智能去背 —— 颜色启发式（现状） vs u2netp 显著性分割（新增）。
// 同一模型文件 public/models/u2netp.onnx，Node 侧用 onnxruntime-node + sharp 复现
// subjectSegmentation.ts 的预处理/后处理，管线本身走真实的 convertImageDataToGrid。
// 运行: node scripts/seg-ab.mjs
import { createServer } from 'vite';
import sharp from 'sharp';
import ort from 'onnxruntime-node';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC_IMAGE = 'benchmark/images/street-boy.jpg';
const MODEL = 'public/models/u2netp.onnx';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/seg_ab';

const SEG = 320;
const THRESHOLD = 0.5;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

const settings = {
  width: 100, height: 100, keepAspectRatio: true, brand: 'MARD',
  dither: 'none', colorLimit: 32, brightness: 0, contrast: 0, saturation: 0,
  transparentCutoff: 128, boardSize: 29, sharpening: 30, outlineBoost: false,
  chromaKeyColor: null, chromaKeyTolerance: 20, colorMatchAlgo: 'ciede2000',
  backgroundRemovalEnabled: true, kmeansClustering: true, quantizationStrength: 28,
  pipelineOverride: 'auto',
};

await mkdir(OUT, { recursive: true });

// vite SSR：加载真实的 src 管线代码（含 subjectSegmentation 的 refineSubjectMask）
const vite = await createServer({
  root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error',
  optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts',
});

// ---------- 1. u2netp 分割（Node 侧，与浏览器实现同口径） ----------
const source = await sharp(SRC_IMAGE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = source.info.width, H = source.info.height;
console.log('source:', W, 'x', H);

const session = await ort.InferenceSession.create(MODEL);
const inputName = session.inputNames[0] ?? 'input.1';
const ZOOM_PADDING = 0.12;

async function infer320(rawRgb) {
  let maxIntensity = 0;
  for (let i = 0; i < rawRgb.length; i++) if (rawRgb[i] > maxIntensity) maxIntensity = rawRgb[i];
  const scale = maxIntensity > 0 ? 1 / maxIntensity : 1;
  const pixels = SEG * SEG;
  const tensorData = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    tensorData[i] = (rawRgb[i * 3] * scale - MEAN[0]) / STD[0];
    tensorData[pixels + i] = (rawRgb[i * 3 + 1] * scale - MEAN[1]) / STD[1];
    tensorData[pixels * 2 + i] = (rawRgb[i * 3 + 2] * scale - MEAN[2]) / STD[2];
  }
  const outputs = await session.run({ [inputName]: new ort.Tensor('float32', tensorData, [1, 3, SEG, SEG]) });
  const d0 = outputs[session.outputNames[0] ?? Object.keys(outputs)[0]].data;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < d0.length; i++) { if (d0[i] < min) min = d0[i]; if (d0[i] > max) max = d0[i]; }
  const range = max - min;
  const prob = new Float32Array(d0.length);
  for (let i = 0; i < d0.length; i++) prob[i] = range > 1e-6 ? (d0[i] - min) / range : 0;
  return prob;
}

// 掩码上采样回目标分辨率（双线性）+ 与生产一致 refineSubjectMask 精修。
// 注意 sharp resize 默认把单通道扩成 3 通道，必须 toColourspace('b-w') 保证
// raw 输出仍是 1 通道，否则逐字节阈值读到的是 RGB 交错数据，掩码整体错乱。
async function upsampleAndRefine(prob, cw, ch, segUtils) {
  const pixels = prob.length;
  const probGray = Buffer.alloc(pixels);
  for (let i = 0; i < pixels; i++) probGray[i] = Math.max(0, Math.min(255, Math.round(prob[i] * 255)));
  const upsampled = await sharp(probGray, { raw: { width: SEG, height: SEG, channels: 1 } })
    .resize(cw, ch, { kernel: 'cubic' }).toColourspace('b-w').raw().toBuffer();
  const upProb = new Float32Array(cw * ch);
  for (let i = 0; i < upProb.length; i++) upProb[i] = upsampled[i] / 255;
  return segUtils.refineSubjectMask(upProb, cw, ch);
}

const t0 = performance.now();
const { refineSubjectMask, subjectBoundingBox, mergeConnectedSubject } = await vite.ssrLoadModule('/src/utils/subjectSegmentation.ts');
const segUtils = { refineSubjectMask };

// Pass 1：全图推理
const small = await sharp(SRC_IMAGE).removeAlpha().resize(SEG, SEG, { fit: 'fill' }).raw().toBuffer();
const prob = await infer320(small);
const subjectMask = await upsampleAndRefine(prob, W, H, segUtils);

// Pass 2：主体 bbox 外扩后二次推理（放大使小物体跨过显著性门槛），连通融合
const bbox = subjectBoundingBox(subjectMask, W, H);
if (bbox) {
  const pad = Math.round(Math.max(bbox.x1 - bbox.x0, bbox.y1 - bbox.y0) * ZOOM_PADDING);
  const cx0 = Math.max(0, bbox.x0 - pad), cy0 = Math.max(0, bbox.y0 - pad);
  const cw = Math.min(W, bbox.x1 + pad) - cx0, ch = Math.min(H, bbox.y1 + pad) - cy0;
  if (cw > 0 && ch > 0 && (cw < W || ch < H)) {
    const crop = await sharp(SRC_IMAGE).removeAlpha().extract({ left: cx0, top: cy0, width: cw, height: ch })
      .resize(SEG, SEG, { fit: 'fill' }).raw().toBuffer();
    const cropProb = await infer320(crop);
    const cropMask = await upsampleAndRefine(cropProb, cw, ch, segUtils);
    const added = mergeConnectedSubject(subjectMask, W, H, cropMask, cw, ch, cx0, cy0);
    console.log('zoom pass: crop', cw, 'x', ch, '| added', added, 'px');
  }
}
const segMs = Math.round(performance.now() - t0);

let subjectCount = 0;
for (let i = 0; i < subjectMask.length; i++) subjectCount += subjectMask[i];
const coverage = subjectCount / subjectMask.length;
console.log(`u2netp 掩码(两遍): coverage = ${(coverage * 100).toFixed(1)}% | 推理+上采样 ${segMs}ms`);
if (coverage < 0.015 || coverage > 0.985) { console.error('掩码退化，模型输出不可用'); process.exit(1); }

// 掩码可视化：白=保留主体，黑=移除背景（半透明叠加在源图上）
const overlay = Buffer.alloc(W * H * 3);
const src3 = await sharp(SRC_IMAGE).removeAlpha().raw().toBuffer();
for (let i = 0; i < W * H; i++) {
  const m = subjectMask[i] ? 255 : 0;
  overlay[i * 3] = (src3[i * 3] * 0.35 + m * 0.65);
  overlay[i * 3 + 1] = (src3[i * 3 + 1] * 0.35 + m * 0.65);
  overlay[i * 3 + 2] = (src3[i * 3 + 2] * 0.35 + m * 0.65);
}
await sharp(overlay, { raw: { width: W, height: H, channels: 3 } }).resize(600, 600).png().toFile(`${OUT}/ai_mask_overlay.png`);

// ---------- 2. 同参数跑两条管线 ----------
const { convertImageDataToGrid } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts');
const { MARD_PALETTE } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { deltaE2000, rgbToLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const clamped = new Uint8ClampedArray(source.data.buffer, source.data.byteOffset, source.data.length);

const run = (mask) => {
  const t = performance.now();
  const result = convertImageDataToGrid(clamped, W, H, settings, MARD_PALETTE, mask);
  return { ...result, ms: Math.round(performance.now() - t) };
};
const heuristic = run(undefined);
const ai = run(subjectMask);

// ---------- 3. 指标 + 渲染 ----------
function metrics(result) {
  const colorById = new Map(MARD_PALETTE.map(c => [c.id, c]));
  const counts = new Map();
  let filled = 0;
  for (const row of result.grid) for (const id of row) {
    if (!id) continue;
    filled++;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return { filled, colors: counts.size, counts, colorById };
}
const mHe = metrics(heuristic), mAi = metrics(ai);
const ref = await buildReferenceCells(source.data, W, H, 100, 100);
function meanDe(result, m) {
  let sum = 0, n = 0, worst = null;
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    const id = result.grid[y][x];
    if (!id) continue;
    const c = m.colorById.get(id);
    if (!c || !ref[y][x]) continue;
    const de = deltaE2000(rgbToLab(ref[y][x][0], ref[y][x][1], ref[y][x][2]), rgbToLab(...c.rgb));
    sum += de; n++;
    if (!worst || de > worst.de) worst = { x, y, de: +de.toFixed(2), code: c.code };
  }
  return { mean: sum / n, worst };
}
const deHe = meanDe(heuristic, mHe), deAi = meanDe(ai, mAi);

const CELL = 12, M = 22, SZ = M + 100 * CELL + 2;
function renderGrid(result, m, emptyRgb = [244, 244, 246]) {
  const px = Buffer.alloc(SZ * SZ * 3, 255);
  const set = (x, y, r, g, b) => { const i = (y * SZ + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b; };
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    const id = result.grid[y][x];
    const [r, g, b] = id ? m.colorById.get(id).rgb : emptyRgb;
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
  return sharp(px, { raw: { width: SZ, height: SZ, channels: 3 } }).png().toBuffer();
}
const srcThumb = await sharp(SRC_IMAGE).resize(600, 600, { fit: 'contain', background: '#f4f4f6' }).png().toBuffer();
const [pngHe, pngAi] = await Promise.all([renderGrid(heuristic, mHe), renderGrid(ai, mAi)]);
const b64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

const row = (label, a, b, better) =>
  `<tr><td>${label}</td><td>${a}</td><td class="${better === 'ai' ? 'good' : better === 'he' ? 'bad' : ''}">${b}</td></tr>`;

const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>智能去背 A/B：颜色启发式 vs AI 显著性分割</title>
<style>
 body{font-family:system-ui,'Microsoft YaHei',sans-serif;background:#f8fafc;color:#1e293b;margin:24px}
 h1{font-size:20px} h2{font-size:15px;margin:24px 0 8px}
 .panels{display:flex;gap:20px;flex-wrap:wrap}
 .panel{text-align:center;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px}
 .panel img{width:360px;height:360px;object-fit:contain;background:#f4f4f6;border-radius:8px}
 .panel .cap{font-size:13px;font-weight:600;margin-top:8px}
 table{border-collapse:collapse;margin-top:12px;background:#fff}
 td,th{border:1px solid #e2e8f0;padding:6px 14px;font-size:13px;text-align:left}
 th{background:#f1f5f9} td.good{color:#059669;font-weight:700} td.bad{color:#64748b}
 .note{font-size:12px;color:#64748b;margin-top:10px;max-width:760px}
</style></head><body>
<h1>智能去背 A/B — street-boy（同参数：100×100 · MARD · colorLimit=32 · dither=none · 自动管线）</h1>
<div class="panels">
 <div class="panel"><img src="${b64(srcThumb)}"><div class="cap">源图</div></div>
 <div class="panel"><img src="${b64(pngHe)}"><div class="cap">A · 颜色启发式去背（现状）</div></div>
 <div class="panel"><img src="${b64(pngAi)}"><div class="cap">B · AI 显著性分割去背（新增）</div></div>
</div>
<h2>AI 掩码可视化（白=保留主体，黑=移除）</h2>
<div class="panels"><div class="panel"><img src="${b64(await sharp(`${OUT}/ai_mask_overlay.png`).png().toBuffer())}"><div class="cap">u2netp 掩码叠加（coverage ${(coverage * 100).toFixed(1)}%，${segMs}ms）</div></div></div>
<table>
 <tr><th>指标</th><th>A · 启发式</th><th>B · AI 分割</th></tr>
 ${row('同口径 meanΔE2000', deHe.mean.toFixed(3), deAi.mean.toFixed(3), deAi.mean < deHe.mean ? 'ai' : 'he')}
 ${row('最差格 ΔE2000', JSON.stringify(deHe.worst), JSON.stringify(deAi.worst), deAi.worst.de < deHe.worst.de ? 'ai' : 'he')}
 ${row('填珠格数', mHe.filled, mAi.filled, '')}
 ${row('用色数', mHe.colors, mAi.colors, '')}
 ${row('管线 / 背景', `${heuristic.diagnostics.detectedPipeline} / ${heuristic.diagnostics.background?.source ?? 'kept'}`, `${ai.diagnostics.detectedPipeline} / ${ai.diagnostics.background?.source ?? 'kept'}`, '')}
 ${row('转换耗时', heuristic.ms + 'ms', ai.ms + 'ms + ' + segMs + 'ms(分割)', '')}
</table>
<p class="note">读法：street-boy 的人物与背景同为 navy 色系，颜色启发式只能靠边缘连通性保守去背，大量背景残留成为珠子；
u2netp 按「语义主体」分割，背景整体移除。meanΔE 的参考格色仍取自含背景的源格，AI 版因剔除低置信背景格，平均保真度提升。
转换耗时多出的分割在浏览器端为两次 320×320 推理（全图 + 主体 bbox 放大二次推理，约 200-600ms，模型 4.4MB 首次加载后缓存）。</p>
</body></html>`;
await writeFile(`${OUT}/seg_ab.html`, html, 'utf8');
console.log('A 启发式: meanΔE', deHe.mean.toFixed(3), '| filled', mHe.filled, '| colors', mHe.colors, '| bg', heuristic.diagnostics.background?.source, '| removed', heuristic.diagnostics.backgroundPixelsRemoved);
console.log('B AI分割: meanΔE', deAi.mean.toFixed(3), '| filled', mAi.filled, '| colors', mAi.colors, '| bg', ai.diagnostics.background?.source, '| removed', ai.diagnostics.backgroundPixelsRemoved);
await writeFile(`${OUT}/seg_ab.json`, JSON.stringify({
  coverage, segMs,
  heuristic: { meanDe: deHe.mean, worst: deHe.worst, filled: mHe.filled, colors: mHe.colors, removed: heuristic.diagnostics.backgroundPixelsRemoved },
  ai: { meanDe: deAi.mean, worst: deAi.worst, filled: mAi.filled, colors: mAi.colors, removed: ai.diagnostics.backgroundPixelsRemoved },
}, null, 2), 'utf8');
await vite.close();
console.log('done ->', `${OUT}/seg_ab.html`);

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
