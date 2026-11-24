// 妲己图端到端：识别 → 清除孤立点（标准档）→ 前后对比渲染
import sharp from 'sharp';

const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-09T10-08-37-160Z-336cc6c8.jpg';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/detail/clear-isolated-real.jpg';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

const { createServer } = await import('vite');
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const pitch = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const align = await vite.ssrLoadModule('/src/utils/importGridAlignment.ts');
const rec = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const stray = await vite.ssrLoadModule('/src/utils/strayBeanConsolidation.ts');
const pal = (await vite.ssrLoadModule('/src/data/palettes.ts')).BRAND_PALETTES;

const est = pitch.estimateBeadPitch(source);
console.log('估算 cell=%s conf=%s', est.cell, est.confidence.toFixed(2));
const dims = { width: info.width, height: info.height };
const alignment = { ...align.createDefaultGridAlignment(dims), cellSize: est.cell };
const derived = align.deriveAlignedCalibration(alignment, { x: 0, y: 0, ...dims }, dims);
const cal = derived.calibration;
const brand = rec.detectPaletteBrand(source, cal);
const palette = pal[brand.brand] ?? pal.MARD_291;
console.log('品牌=%s 网格=%sx%s', brand.brand ?? '(fallback MARD)', cal.columns, cal.rows);
const result = rec.recognizeImportImage(source, cal, palette, 'precision', undefined, { edgeInsetRatio: 0, symbolAssist: true });
console.log('识别: mapped=%s blank=%s', result.summary.mapped, result.summary.blank);

const cells = result.cells;
const { grid: next, stats } = stray.clearIsolatedBeans(cells, {
  isFilled: c => c.status === 'mapped',
  getColorKey: c => c.colorId ?? '',
  clearCell: c => ({ ...c, status: 'blank', color: null, colorId: null, sampleRgb: null }),
}, 'standard');
console.log('清除孤立点:', JSON.stringify(stats));

// 渲染对比（每格 5px + 标签）
const S = 5, W = cal.columns * S, H = cal.rows * S;
function render(cs) {
  const buf = Buffer.alloc(W * H * 3, 255);
  for (let r = 0; r < cal.rows; r++) for (let c = 0; c < cal.columns; c++) {
    const cell = cs[r][c];
    const rgb = cell.status === 'mapped' && cell.color ? cell.color.rgb : [240, 239, 244];
    for (let y = r * S; y < (r + 1) * S; y++) for (let x = c * S; x < (c + 1) * S; x++) {
      const i = (y * W + x) * 3;
      buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2];
    }
  }
  return sharp(buf, { raw: { width: W, height: H, channels: 3 } }).toBuffer();
}
const [left, right] = await Promise.all([render(cells), render(next)]);
const labelH = 30;
const label = (text, w) => sharp({ create: { width: w, height: labelH, channels: 3, background: { r: 30, g: 30, b: 36 } } })
  .composite([{ input: Buffer.from('<svg width="' + w + '" height="' + labelH + '"><text x="10" y="21" font-size="15" fill="#fff" font-family="sans-serif">' + text + '</text></svg>'), left: 0, top: 0 }]).png().toBuffer();
const [lt, rt] = await Promise.all([label('BEFORE 清除前 (mapped=' + result.summary.mapped + ')', W), label('AFTER 清除孤立点 标准档 ≤5', W)]);
const gap = 14;
await sharp({ create: { width: W * 2 + gap, height: H + labelH, channels: 3, background: { r: 40, g: 40, b: 46 } } })
  .composite([
    { input: lt, left: 0, top: 0 },
    { input: left, left: 0, top: labelH, raw: { width: W, height: H, channels: 3 } },
    { input: rt, left: W + gap, top: 0 },
    { input: right, left: W + gap, top: labelH, raw: { width: W, height: H, channels: 3 } },
  ])
  .jpeg({ quality: 92 }).toFile(OUT);
console.log('对比图:', OUT);
await vite.close();
