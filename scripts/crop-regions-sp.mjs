// 100x56 图纸的区域放大对比：原图 vs 图纸（带格线）
import sharp from 'sharp';
const D = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/detail/';
const IMG = 'benchmark/images/spongebob-patrick.jpg';
const SX = 19.2, SY = 1078 / 56; // 每格源像素
const CELL = 12, M = 22;
// [名称, gx0, gy0, gx1, gy1]
const regions = process.env.REGIONS ? JSON.parse(process.env.REGIONS) : [
  ['sbface', 18, 12, 34, 26],   // 海绵宝宝脸
  ['ptface', 58, 14, 74, 28],   // 派大星脸
  ['jelly', 42, 0, 60, 16],     // 水母
  ['net', 28, 0, 44, 12],       // 渔网
];
for (const [name, gx0, gy0, gx1, gy1] of regions) {
  const w = gx1 - gx0, h = gy1 - gy0;
  const Z = Math.max(8, Math.floor(480 / w));
  const rw = w * CELL, rh = h * CELL;
  const src = await sharp(IMG)
    .extract({ left: Math.round(gx0 * SX), top: Math.round(gy0 * SY), width: Math.round(w * SX), height: Math.round(h * SY) })
    .resize(rw * Z, rh * Z, { kernel: 'nearest' }).png().toBuffer();
  const grid = Buffer.from(`<svg width="${rw * Z}" height="${rh * Z}">` +
    Array.from({ length: h + 1 }, (_, i) => `<line x1="0" y1="${i * CELL * Z}" x2="${rw * Z}" y2="${i * CELL * Z}" stroke="lime" stroke-width="1" opacity="0.35"/>`).join('') +
    Array.from({ length: w + 1 }, (_, i) => `<line x1="${i * CELL * Z}" y1="0" x2="${i * CELL * Z}" y2="${rh * Z}" stroke="lime" stroke-width="1" opacity="0.35"/>`).join('') + '</svg>');
  const ren = await sharp(D + 'sp56_full.png')
    .extract({ left: M + gx0 * CELL, top: M + gy0 * CELL, width: rw, height: rh })
    .resize(rw * Z, rh * Z, { kernel: 'nearest' })
    .composite([{ input: grid, top: 0, left: 0 }]).png().toBuffer();
  const label = (t, W2) => Buffer.from(`<svg width="${W2}" height="36"><rect width="100%" height="100%" fill="#222"/><text x="8" y="27" font-family="Microsoft YaHei" font-size="22" font-weight="bold" fill="#fff">${t}</text></svg>`);
  await sharp({ create: { width: rw * Z * 2 + 16, height: rh * Z + 36, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([
      { input: label(`原图 ${name}`, rw * Z), top: 0, left: 0 },
      { input: label(`图纸 ${name}`, rw * Z), top: 0, left: rw * Z + 16 },
      { input: src, top: 36, left: 0 },
      { input: ren, top: 36, left: rw * Z + 16 },
    ]).png().toFile(D + '_sp56_' + name + '.png');
}
console.log('done');
