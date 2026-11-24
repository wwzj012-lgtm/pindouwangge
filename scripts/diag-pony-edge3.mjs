// 用格线投影真值 (9.6px) 跑完整识别 + 渲染，对比 14.4px 错误网格
import sharp from 'sharp';

const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-09T04-29-31-478Z-f7362be0.jpg';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

const { createServer } = await import('vite');
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const rec = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const pal = await vite.ssrLoadModule('/src/data/palettes.ts');
const palette = pal.BRAND_PALETTES[process.argv[3] || 'MARD_291'];

// 格线投影真值：列线 28 起、行线 43 起、周期 9.6
// 精修：在 ±0.5 内微调 pitch 与 origin 使格线峰对齐
const calibration = { originX: 28, originY: 43, cellWidth: 9.6, cellHeight: 9.6, columns: 52, rows: 51 };

const result = rec.recognizeImportImage(source, calibration, palette, 'precision', undefined, {
  edgeInsetRatio: 0,
  symbolAssist: process.argv[2] !== 'noassist',
});
const { cells } = result;
const stats = { mapped: 0, blank: 0, invalid: 0 };
const edge = { mapped: 0, blank: 0, invalid: 0 };
let edgeTotal = 0;
for (const row of cells) for (const cell of row) {
  stats[cell.status] = (stats[cell.status] || 0) + 1;
  if (cell.row === 0 || cell.column === 0 || cell.row === calibration.rows - 1 || cell.column === calibration.columns - 1) {
    edgeTotal += 1;
    edge[cell.status] = (edge[cell.status] || 0) + 1;
  }
}
console.log(`pitch=9.6 52×51 全图:`, JSON.stringify(stats), `边缘一圈:`, JSON.stringify(edge), `/${edgeTotal}`);
if (result.symbolAssist) console.log('symbolAssist:', JSON.stringify(result.symbolAssist));

// 渲染覆盖图
const W = info.width, H = info.height;
const overlay = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) { overlay[i * 3] = data[i * 4]; overlay[i * 3 + 1] = data[i * 4 + 1]; overlay[i * 3 + 2] = data[i * 4 + 2]; }
for (const row of cells) for (const cell of row) {
  const x0 = calibration.originX + cell.column * calibration.cellWidth;
  const y0 = calibration.originY + cell.row * calibration.cellHeight;
  let rgb = cell.status === 'mapped' && cell.sampleRgb ? cell.sampleRgb : cell.status === 'blank' ? [255, 40, 40] : [0, 0, 0];
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y0 + calibration.cellHeight)); y++)
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x0 + calibration.cellWidth)); x++) {
      const i = (y * W + x) * 3;
      overlay[i] = Math.round(overlay[i] * 0.35 + rgb[0] * 0.65);
      overlay[i + 1] = Math.round(overlay[i + 1] * 0.35 + rgb[1] * 0.65);
      overlay[i + 2] = Math.round(overlay[i + 2] * 0.35 + rgb[2] * 0.65);
    }
}
await sharp(overlay, { raw: { width: W, height: H, channels: 3 } }).resize(W * 2, H * 2, { kernel: 'nearest' }).png().toFile('C:/Users/Plout/Desktop/pindouwangge/pattern_compare/detail/pony-edge-pitch96.jpg');
console.log('输出: pattern_compare/detail/pony-edge-pitch96.jpg');
await vite.close();
