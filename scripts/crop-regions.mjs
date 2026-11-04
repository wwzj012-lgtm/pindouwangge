// 裁剪 avg(旧) 与 dom2(新) 整图的最差区域 + 原图对照，输出三联。
import sharp from 'sharp';

const DIR = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/detail';
const M = 22, CELL = 12; // render-detail 的边距与格像素

const regions = [
  { name: 'capline', gx0: 68, gy0: 22, gx1: 80, gy1: 34 },   // (72,26-29) 竖线区
  { name: 'leftface', gx0: 14, gy0: 30, gx1: 26, gy1: 44 },  // (18,39)(19,34)
  { name: 'backpack', gx0: 62, gy0: 52, gx1: 86, gy1: 68 },  // (76,58)(81,63)
  { name: 'bottom', gx0: 62, gy0: 78, gx1: 76, gy1: 90 },    // (68,84)
];
const SRC_SCALE = 19.2;

for (const r of regions) {
  const w = (r.gx1 - r.gx0), h = (r.gy1 - r.gy0);
  const left = M + r.gx0 * CELL, top = M + r.gy0 * CELL;
  const extract = { left, top, width: w * CELL, height: h * CELL };
  const label = (t, W) => Buffer.from(`<svg width="${W}" height="44"><rect width="100%" height="100%" fill="#111"/><text x="10" y="32" font-family="Microsoft YaHei" font-size="26" font-weight="bold" fill="#fff">${t}</text></svg>`);
  const parts = [];
  parts.push({ buf: await sharp(`${DIR}/avg_full.png`).extract(extract).resize(w * 24, h * 24, { kernel: 'nearest' }).png().toBuffer(), t: 'A. 旧版·面积平均' });
  parts.push({ buf: await sharp(`${DIR}/dom2_full.png`).extract(extract).resize(w * 24, h * 24, { kernel: 'nearest' }).png().toBuffer(), t: 'C. 主色 v2·当前版' });
  parts.push({ buf: await sharp('D:/Build_Apps/pindouwangge/benchmark/images/street-boy.jpg')
    .extract({ left: Math.round(r.gx0 * SRC_SCALE), top: Math.round(r.gy0 * SRC_SCALE), width: Math.round(w * SRC_SCALE), height: Math.round(h * SRC_SCALE) })
    .resize(w * 24, h * 24, { kernel: 'nearest' }).png().toBuffer(), t: '0. 原图' });
  const pw = w * 24, ph = h * 24 + 44;
  const totalW = pw * 3 + 16, totalH = ph;
  await sharp({ create: { width: totalW, height: totalH, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(parts.map((p, i) => [
      { input: label(p.t, pw), top: 0, left: i * (pw + 8) },
      { input: p.buf, top: 44, left: i * (pw + 8) },
    ]).flat())
    .png().toFile(`${DIR}/_reg_${r.name}.png`);
  console.log('saved', r.name);
}
