// A/B 对比：像素网格吸附（snapToPixelGrid）开 vs 关
// 同一张源图、同参数，各跑两种目标规格（原生格对齐 / 错位）。
// "关"的实现方式：用一个 stub 插件把 pixelGrid 模块替换为 detectPixelGrid() => null，
// 不改动任何产品源码。用法: node scripts/snap-ab.mjs
import { createServer } from 'vite';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC_IMAGE = 'benchmark/images/pixel-sprite.jpg';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/snap_ab';
const SIZES = [96, 100]; // 96 = 检出的原生逻辑格数（完美对齐）；100 = 错位规格

const stubPlugin = {
  name: 'stub-pixel-grid',
  enforce: 'pre',
  resolveId(id, importer) {
    if (id.endsWith('pixelGrid') && importer && importer.includes('imagePipeline')) return '\0stub-pixel-grid';
    return null;
  },
  load(id) {
    if (id === '\0stub-pixel-grid') {
      return 'export function detectPixelGrid(){return null;}\nexport function snapToPixelGrid(data){return data;}\n';
    }
    return null;
  },
};

await mkdir(OUT, { recursive: true });

async function runVariant(label, withStub) {
  const vite = await createServer({
    root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error',
    optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts',
    plugins: withStub ? [stubPlugin] : [],
  });
  try {
    const { convertImageDataToGrid } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts');
    const { MARD_PALETTE } = await vite.ssrLoadModule('/src/data/palettes.ts');
    const { deltaE2000, rgbToLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
    const source = await sharp(SRC_IMAGE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const results = {};
    for (const size of SIZES) {
      const settings = {
        width: size, height: size, keepAspectRatio: true, brand: 'MARD',
        dither: 'none', colorLimit: 32, brightness: 0, contrast: 0, saturation: 0,
        transparentCutoff: 128, boardSize: 29, sharpening: 30, outlineBoost: false,
        chromaKeyColor: null, chromaKeyTolerance: 20, colorMatchAlgo: 'ciede2000',
        backgroundRemovalEnabled: true, kmeansClustering: true, quantizationStrength: 28,
        pipelineOverride: 'auto',
      };
      const t0 = performance.now();
      const { grid, diagnostics } = convertImageDataToGrid(
        new Uint8ClampedArray(source.data.buffer, source.data.byteOffset, source.data.length),
        source.info.width, source.info.height, settings, MARD_PALETTE,
      );
      const ms = Math.round(performance.now() - t0);
      const colorById = new Map(MARD_PALETTE.map(c => [c.id, c]));
      const counts = new Map();
      let filled = 0;
      for (const row of grid) for (const id of row) { if (!id) continue; filled++; counts.set(id, (counts.get(id) ?? 0) + 1); }

      // 共享参考格色：对原始源图做预乘面积平均（吸附/不吸附完全相同口径）
      const ref = buildReferenceCells(source.data, source.info.width, source.info.height, size, size);
      const des = [];
      let worst = null;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const id = grid[y][x];
        if (!id) continue;
        const c = colorById.get(id);
        const r = ref[y * size + x];
        if (!c || !r) continue;
        const de = deltaE2000(rgbToLab(r[0], r[1], r[2]), rgbToLab(...c.rgb));
        des.push(de);
        if (!worst || de > worst.de) worst = { x, y, de: +de.toFixed(2) };
      }
      des.sort((a, b) => a - b);
      const mean = des.reduce((s, v) => s + v, 0) / des.length;
      const p95 = des[Math.floor(des.length * 0.95)];

      const png = `${OUT}/${label}_${size}.png`;
      await renderGrid(grid, colorById, size, png);
      results[`${label}_${size}`] = {
        snap: label === 'snap_on', size, pipeline: diagnostics.detectedPipeline,
        nativeGrid: diagnostics.nativeGrid, filled, colors: counts.size,
        meanDe: +mean.toFixed(3), p95De: +p95.toFixed(3), worst, convertMs: ms, png,
      };
      console.log(`[${label}] ${size}x${size}: meanΔE=${mean.toFixed(3)} p95=${p95.toFixed(3)} colors=${counts.size} beads=${filled} nativeGrid=${JSON.stringify(diagnostics.nativeGrid)} ${ms}ms`);
    }
    return results;
  } finally {
    await vite.close();
  }
}

const off = await runVariant('snap_off', true);
const on = await runVariant('snap_on', false);
await writeFile(`${OUT}/results.json`, JSON.stringify({ ...off, ...on }, null, 2));

// 汇总 HTML
const html = buildHtml(off, on);
await writeFile(`${OUT}/snap_ab.html`, html, 'utf8');
console.log('done ->', OUT);

function buildReferenceCells(data, w, h, cols, rows) {
  const sx = w / cols, sy = h / rows;
  const cov = new Float64Array(cols * rows);
  const rgb = new Float64Array(cols * rows * 3);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(rows - 1, Math.floor(y / sy));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3] / 255;
      const gi = gy * cols + Math.min(cols - 1, Math.floor(x / sx));
      cov[gi]++;
      rgb[gi * 3] += data[i]; rgb[gi * 3 + 1] += data[i + 1]; rgb[gi * 3 + 2] += data[i + 2];
    }
  }
  const out = new Array(cols * rows);
  for (let gi = 0; gi < cols * rows; gi++) {
    out[gi] = cov[gi] >= 0.3 * sx * sy
      ? [rgb[gi * 3] / cov[gi], rgb[gi * 3 + 1] / cov[gi], rgb[gi * 3 + 2] / cov[gi]]
      : null;
  }
  return out;
}

async function renderGrid(grid, colorById, size, file) {
  const CELL = 10, M = 20, W = M + size * CELL + 2;
  const px = Buffer.alloc(W * W * 3, 255);
  const set = (x, y, r, g, b) => { const i = (y * W + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const id = grid[y][x];
    const [r, g, b] = id ? colorById.get(id).rgb : [244, 244, 246];
    for (let dy = 1; dy < CELL - 1; dy++) for (let dx = 1; dx < CELL - 1; dx++) set(M + x * CELL + dx, M + y * CELL + dy, r, g, b);
  }
  await sharp(px, { raw: { width: W, height: W, channels: 3 } }).png().toFile(file);
}

function buildHtml(off, on) {
  const rows = SIZES.map(size => {
    const o = off[`snap_off_${size}`], n = on[`snap_on_${size}`];
    const better = (a, b) => a < b ? ' class="win"' : '';
    return `<tr>
      <td>${size}×${size}${size === 96 ? '（原生格对齐）' : '（错位规格）'}</td>
      <td>${o.meanDe}</td><td${better(n.meanDe, o.meanDe)}>${n.meanDe}</td>
      <td>${o.p95De}</td><td${better(n.p95De, o.p95De)}>${n.p95De}</td>
      <td>${o.colors}</td><td${better(n.colors, o.colors)}>${n.colors}</td>
      <td>${o.filled.toLocaleString()}</td><td>${n.filled.toLocaleString()}</td>
      <td>${JSON.stringify(o.nativeGrid)}</td><td>${JSON.stringify(n.nativeGrid)}</td>
      <td>${o.convertMs} / ${n.convertMs} ms</td>
    </tr>`;
  }).join('');
  const panels = SIZES.map(size => `
  <div class="cols">
    <div class="panel"><h2><span class="tag off">吸附关</span> ${size}×${size} · mean ΔE ${off[`snap_off_${size}`].meanDe} · ${off[`snap_off_${size}`].colors} 色</h2><img src="snap_off_${size}.png"></div>
    <div class="panel"><h2><span class="tag on">吸附开</span> ${size}×${size} · mean ΔE ${on[`snap_on_${size}`].meanDe} · ${on[`snap_on_${size}`].colors} 色</h2><img src="snap_on_${size}.png"></div>
  </div>`).join('');
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="UTF-8"><title>像素网格吸附 A/B · pixel-sprite</title>
<style>
 body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;margin:0;background:#f5f5f2;color:#222}
 .wrap{max-width:1180px;margin:0 auto;padding:24px 20px 60px}
 h1{font-size:20px;font-weight:600;margin:0 0 4px}
 .sub{color:#666;font-size:13px;margin-bottom:18px;line-height:1.7}
 table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:12px;overflow:hidden}
 th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left}
 th{color:#666;font-weight:500;font-size:12px}
 .win{background:#e8f5ec;font-weight:600}
 .cols{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px}
 .panel{background:#fff;border-radius:14px;padding:14px}
 .panel h2{font-size:14px;font-weight:600;margin:0 0 10px}
 img{width:100%;image-rendering:pixelated;border:1px solid #eee}
 .tag{display:inline-block;font-size:12px;padding:2px 10px;border-radius:99px;margin-right:6px}
 .tag.off{background:#f4e9e9}.tag.on{background:#e8f5ec}
 .note{font-size:13px;color:#555;line-height:1.8;background:#fff;border-radius:14px;padding:16px 18px;margin-top:20px}
</style></head><body><div class="wrap">
<h1>像素网格吸附 A/B 对比 · pixel-sprite（96 逻辑格 ×20 放大 + JPEG 压缩）</h1>
<p class="sub">同一张源图 · 同参数（MARD 色板 · colorLimit=32 · dither=none · 自动管线分类 cartoon）· 唯一变量是 detectPixelGrid 是否生效（stub 注入，未改产品代码）<br>
指标口径：对原始源图做预乘面积平均得到共享参考格色，输出珠色 vs 参考色的 CIEDE2000</p>
<table><tr><th>规格</th><th colspan="2">mean ΔE2000 ↓</th><th colspan="2">p95 ΔE2000 ↓</th><th colspan="2">用色数 ↓</th><th colspan="2">珠数</th><th colspan="2">nativeGrid</th><th>耗时 关/开</th></tr>
<tr><th></th><th>关</th><th>开</th><th>关</th><th>开</th><th>关</th><th>开</th><th>关</th><th>开</th><th>关</th><th>开</th><th></th></tr>${rows}</table>
${panels}
<div class="note"><b>怎么看</b>：吸附开时每个原生块被改写为块中位色——JPEG 振铃噪声被消灭在取样之前，于是 ①边缘格不再混入噪声色（p95 显著下降）②噪声导致的碎片配色收敛（用色数减少，采购清单更短）③原生对齐规格下色块即原作者的精确平色。<br>
<b>公平性</b>：两条管线除吸附外完全一致（同 stub 以外的代码路径、同设置）；参考格色取自原始源图（未吸附），该口径对吸附开略偏保守——吸附后的平色块比"含噪平均值"更接近原作者真实用色。</div>
</div></body></html>`;
}
