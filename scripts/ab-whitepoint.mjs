// A/B 验证：白点校正能否修复印刷偏色错配
// 方法：取识别结果每格 sampleRgb，重采样估计纸白，增益校正后重新最近邻匹配，与手动图比
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync } from 'fs';

const ORIG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
const ROOT = 'D:/Build_Apps/pindouwangge';
const { manual } = JSON.parse(readFileSync(`${OUT}/manual_vs_rec.json`, 'utf8'));

const vite = await createServer({ root: ROOT, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: ROOT + '/vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const P = BRAND_PALETTES.MARD;

const { data, info } = await sharp(ORIG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const cal = { originX: 0, originY: 0, cellWidth: 29.6, cellHeight: 29.54, columns: 52, rows: 52 };
const r = recognizeImportImage(source, cal, P, 'precision', undefined, { mode: 'precision', edgeInsetRatio: 0.1, symbolAssist: true });

// 白点估计：亮度 P98 像素的均值
const W = info.width, C = info.channels;
const lums = [];
for (let i = 0; i < W * info.height; i++) {
  const o = i * C;
  lums.push(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
}
lums.sort((a, b) => a - b);
const p98 = lums[Math.floor(lums.length * 0.98)];
let acc = [0, 0, 0], n = 0;
for (let i = 0; i < W * info.height; i++) {
  const o = i * C;
  const l = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  if (l >= p98) { acc[0] += data[o]; acc[1] += data[o + 1]; acc[2] += data[o + 2]; n++; }
}
const paper = acc.map(v => v / n);
console.log('纸白估计(P98均值):', paper.map(v => v.toFixed(1)).join(','));

const lab = (rgb) => {
  let [r0, g0, b0] = rgb.map(v => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; });
  const x = (r0 * 0.4124 + g0 * 0.3576 + b0 * 0.1805) / 0.95047, y = r0 * 0.2126 + g0 * 0.7152 + b0 * 0.0722, z = (r0 * 0.0193 + g0 * 0.1192 + b0 * 0.9505) / 1.08883;
  const f = t => t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const nearest = (rgb) => {
  let bc = null, bd = Infinity;
  for (const c of P) {
    const lc = lab(c.rgb), l = lab(rgb);
    const d = (lc[0] - l[0]) ** 2 + (lc[1] - l[1]) ** 2 + (lc[2] - l[2]) ** 2;
    if (d < bd) { bd = d; bc = c.code; }
  }
  return bc;
};

for (const mode of ['无校正', '白点校正']) {
  const gain = mode === '无校正' ? [1, 1, 1] : paper.map(v => 255 / v);
  let same = 0, tot = 0;
  for (let row = 0; row < manual.length; row++) for (let col = 0; col < manual[0].length; col++) {
    const mc = manual[row][col]?.code;
    if (!mc) continue;
    const cell = r.cells[row][col];
    if (!cell?.sampleRgb) continue;
    // OCR 已覆写的格保持原判（其 distance 语义不同，这里只测颜色通道）——跳过 OCR 覆写格不可行（无标记），改为全测
    const corrected = cell.sampleRgb.map((v, i) => Math.min(255, Math.round(v * gain[i])));
    const code = nearest(corrected);
    tot++;
    if (code === mc) same++;
  }
  console.log(`${mode}: 可测 ${tot}, 一致 ${same} (${(100 * same / tot).toFixed(2)}%)`);
}
await vite.close();
