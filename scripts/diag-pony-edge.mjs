// 渲染小马图识别结果：原图 | 识别网格着色（blank 标红），定位边缘漏格
import sharp from 'sharp';

const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-09T04-29-31-478Z-f7362be0.jpg';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

const { createServer } = await import('vite');
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const rec = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const pal = await vite.ssrLoadModule('/src/data/palettes.ts');
const palette = pal.BRAND_PALETTES[process.argv[3] || 'MARD_291'];

const calibration = { originX: 42, originY: 47, cellWidth: 14.4, cellHeight: 14.4, columns: 39, rows: 37 };
const useAssist = process.argv[2] !== 'noassist';

const result = rec.recognizeImportImage(source, calibration, palette, 'precision', undefined, {
  edgeInsetRatio: 0,
  symbolAssist: useAssist,
});
const { cells } = result;
const stats = { mapped: 0, blank: 0, invalid: 0 };
let edgeBlank = 0, edgeTotal = 0;
for (const row of cells) for (const cell of row) {
  stats[cell.status] = (stats[cell.status] || 0) + 1;
  if (cell.row === 0 || cell.column === 0 || cell.row === calibration.rows - 1 || cell.column === calibration.columns - 1) {
    edgeTotal += 1;
    if (cell.status === 'blank') edgeBlank += 1;
  }
}
console.log(`symbolAssist=${useAssist} 全图:`, JSON.stringify(stats), `边缘一圈 blank: ${edgeBlank}/${edgeTotal}`);
if (result.symbolAssist) console.log('symbolAssist 统计:', JSON.stringify(result.symbolAssist));

// 渲染：左原图 右网格覆盖（mapped=色板色, blank=红, invalid=黑）
const W = info.width, H = info.height, S = 2;
const scale = Math.min(1.5, 1600 / (W * S));
const outW = Math.round(W * S * scale), outH = Math.round(H * S * scale);
const canvas = sharp({ create: { width: outW * 2 + 20, height: outH, channels: 3, background: { r: 40, g: 40, b: 40 } } });
const overlay = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  overlay[i * 3] = data[i * 4]; overlay[i * 3 + 1] = data[i * 4 + 1]; overlay[i * 3 + 2] = data[i * 4 + 2];
}
// 画格子
for (const row of cells) for (const cell of row) {
  const x0 = calibration.originX + cell.column * calibration.cellWidth;
  const y0 = calibration.originY + cell.row * calibration.cellHeight;
  let rgb = null;
  if (cell.status === 'mapped' && cell.sampleRgb) rgb = cell.sampleRgb;
  else if (cell.status === 'blank') rgb = [255, 40, 40];
  else rgb = [0, 0, 0];
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y0 + calibration.cellHeight)); y++) {
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x0 + calibration.cellWidth)); x++) {
      const i = (y * W + x) * 3;
      overlay[i] = Math.round(overlay[i] * 0.35 + rgb[0] * 0.65);
      overlay[i + 1] = Math.round(overlay[i + 1] * 0.35 + rgb[1] * 0.65);
      overlay[i + 2] = Math.round(overlay[i + 2] * 0.35 + rgb[2] * 0.65);
    }
  }
}
const left = await sharp(SRC).resize(outW, outH).png().toBuffer();
const right = await sharp(overlay, { raw: { width: W, height: H, channels: 3 } }).resize(outW, outH).png().toBuffer();
const label = useAssist ? 'assist-on' : 'assist-off';
await canvas.composite([
  { input: left, left: 0, top: 0 },
  { input: right, left: outW + 20, top: 0 },
]).jpeg({ quality: 90 }).toFile(`C:/Users/Plout/Desktop/pindouwangge/pattern_compare/detail/pony-edge-${label}.jpg`);
console.log('输出: pattern_compare/detail/pony-edge-' + label + '.jpg');
await vite.close();
