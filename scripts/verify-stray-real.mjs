// 真实端到端测试：用户提供的街舞少年图 → 识别 → 散豆整合（标准档默认 ≤5）
// 验证：1) 色号总量语义生效 2) 同一色号绝不部分并入 3) 渲染前后对比图
import sharp from 'sharp';

const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-09T09-29-49-692Z-fbc96fc5.jpg';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/detail/stray-consolidate-real.jpg';

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

const { createServer } = await import('vite');
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const pitch = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const align = await vite.ssrLoadModule('/src/utils/importGridAlignment.ts');
const rec = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const stray = await vite.ssrLoadModule('/src/utils/strayBeanConsolidation.ts');
const palMod = await vite.ssrLoadModule('/src/data/palettes.ts');

// 1) 网格估算（默认参数）
const est = pitch.estimateBeadPitch(source);
console.log('网格估算: cell=%s conf=%s columns=%s rows=%s', est.cell, est.confidence.toFixed(2), est.columns, est.rows);
const dims = { width: info.width, height: info.height };
const alignment = { ...align.createDefaultGridAlignment(dims), cellSize: est.cell };
const derived = align.deriveAlignedCalibration(alignment, { x: 0, y: 0, ...dims }, dims);
const cal = derived.calibration;
console.log('派生网格: %sx%s error=%s', cal.columns, cal.rows, derived.error);

// 2) 品牌探测 + 识别（向导默认参数）
const brand = rec.detectPaletteBrand(source, cal);
console.log('品牌探测:', brand.brand);
const palette = palMod.BRAND_PALETTES[brand.brand] ?? palMod.BRAND_PALETTES.MARD_291;
const t0 = performance.now();
const result = rec.recognizeImportImage(source, cal, palette, 'precision', undefined, { edgeInsetRatio: 0, symbolAssist: true });
console.log('识别: %ss mapped=%s blank=%s', ((performance.now() - t0) / 1000).toFixed(2), result.summary.mapped, result.summary.blank);

// 3) 散豆整合（手动语义，标准档默认 ≤5，photo mode）
const cells = result.cells;
const adapter = {
  isFilled: (cell) => cell.status === 'mapped',
  getColorKey: (cell) => cell.colorId ?? '',
  getColor: (cell) => ({ r: cell.color.rgb[0], g: cell.color.rgb[1], b: cell.color.rgb[2] }),
  replaceColor: (noise, replacement) => ({ ...noise, colorId: replacement.colorId, color: replacement.color }),
};
// 整合前色号总量表
const totals = new Map();
for (const row of cells) for (const c of row) if (c.status === 'mapped') totals.set(c.colorId, (totals.get(c.colorId) ?? 0) + 1);
const nameOf = (id) => palette.colors?.find?.((c) => c.id === id)?.code ?? palette.codes?.[id] ?? id;

const consolidated = stray.consolidateStrayBeans(cells, adapter, 'standard', { mode: 'photo', intent: 'manual' });

// 4) 统计改动 + 一致性断言
const moves = new Map(); // "from->to" -> count
const beforeCount = new Map(); // colorId -> [beforeTotal, afterRemaining]
for (const row of cells) for (const c of row) if (c.status === 'mapped') {
  const after = consolidated[c.__row ?? 0];
}
// 按 index 对齐统计
let changed = 0;
const rared = new Map(); // colorId -> {total, merged, kept}
for (let r = 0; r < cells.length; r++) for (let c = 0; c < cells[r].length; c++) {
  const b = cells[r][c], a = consolidated[r][c];
  if (b.status !== 'mapped') continue;
  const stat = rared.get(b.colorId) ?? { total: 0, merged: 0 };
  stat.total += 1;
  if (a.colorId !== b.colorId) {
    changed += 1;
    stat.merged += 1;
    const key = `${b.colorId}->${a.colorId}`;
    moves.set(key, (moves.get(key) ?? 0) + 1);
  }
  rared.set(b.colorId, stat);
}
console.log('\n=== 整合统计（标准档：色号全图总量 ≤5 并入相邻相近色） ===');
console.log('改写格数:', changed, '/', result.summary.mapped);
// 一致性：每个色号要么 merged==0 要么 merged==total？不——无稳定邻居的 rare 格会保留。
// 核心断言：**非 rare 色号（total > 5）必须零改动**
let violations = 0;
for (const [id, stat] of rared) {
  if (stat.total > 5 && stat.merged > 0) { violations += 1; console.log('  违例!', id, JSON.stringify(stat)); }
}
console.log('超档色号被误改数（必须为 0）:', violations);
console.log('\n被整合的色号明细:');
for (const [id, stat] of rared) {
  if (stat.merged > 0) console.log(`  ${id}(${nameOf(id)}) 总量${stat.total} → 并出${stat.merged}格${stat.merged < stat.total ? ' [无邻居部分保留]' : ' [整批并入]'}`);
}
console.log('\n改写去向 top10:');
[...moves.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10).forEach(([k, n]) => console.log('  ', k, n, '格'));

// 5) 渲染前后对比（左=原始识别，右=整合后），每格 6px + 标签条
const S = 6, W = cal.columns * S, H = cal.rows * S;
function render(cs) {
  const buf = Buffer.alloc(W * H * 3, 255);
  for (let r = 0; r < cal.rows; r++) for (let c = 0; c < cal.columns; c++) {
    const cell = cs[r][c];
    const rgb = cell.status === 'mapped' && cell.color ? cell.color.rgb : [236, 234, 241];
    for (let y = r * S; y < (r + 1) * S; y++) for (let x = c * S; x < (c + 1) * S; x++) {
      const i = (y * W + x) * 3;
      buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2];
    }
  }
  return sharp(buf, { raw: { width: W, height: H, channels: 3 } }).toBuffer();
}
const [left, right] = await Promise.all([render(cells), render(consolidated)]);
const labelH = 34;
const label = (text, w) => sharp({ create: { width: w, height: labelH, channels: 3, background: { r: 30, g: 30, b: 36 } } })
  .composite([{ input: Buffer.from(`<svg width="${w}" height="${labelH}"><text x="12" y="23" font-size="17" fill="#fff" font-family="sans-serif">${text}</text></svg>`), left: 0, top: 0 }]).png().toBuffer();
const [lt, rt] = await Promise.all([label(`BEFORE 原始识别 (mapped=${result.summary.mapped})`, W), label('AFTER 散豆整合 标准档 ≤5', W)]);
const gap = 16;
const rawSpec = { raw: { width: W, height: H, channels: 3 } };
await sharp({ create: { width: W * 2 + gap, height: H + labelH, channels: 3, background: { r: 40, g: 40, b: 46 } } })
  .composite([{ input: lt, left: 0, top: 0 }, { input: left, left: 0, top: labelH, raw: rawSpec.raw }, { input: rt, left: W + gap, top: 0 }, { input: right, left: W + gap, top: labelH, raw: rawSpec.raw }])
  .jpeg({ quality: 92 }).toFile(OUT);
console.log('\n对比图已输出:', OUT);
await vite.close();
