// 双版局部对比：node scripts/crop-ab.mjs <l> <t> <w> <h> <tag>
import sharp from 'sharp';
const [,, l, t, w, h, tag] = process.argv;
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
const CELL = 8.8, OX = -0.375, OY = -0.25, GS = 4;
const gL = Math.max(0, Math.round((+l - OX * CELL) / CELL * GS)), gT = Math.max(0, Math.round((+t - OY * CELL) / CELL * GS));
const gW = Math.round(+w / CELL * GS), gH = Math.round(+h / CELL * GS);
const H = 560;
const W = Math.round(+w * H / +h);
const a = await sharp(`${OUT}/v5_grid.png`).extract({ left: gL, top: gT, width: gW, height: gH }).resize(W, H, { kernel: 'nearest' }).png().toBuffer();
const b = await sharp(`${OUT}/v8_grid.png`).extract({ left: gL, top: gT, width: gW, height: gH }).resize(W, H, { kernel: 'nearest' }).png().toBuffer();
const label = (txt) => Buffer.from(`<svg width="${W}" height="30"><rect width="100%" height="100%" fill="#1e293b"/><text x="${W/2}" y="21" text-anchor="middle" font-size="15" font-weight="bold" fill="#fff" font-family="Microsoft YaHei">${txt}</text></svg>`);
await sharp({ create: { width: W * 2 + 8, height: H + 30, channels: 3, background: { r: 60, g: 65, b: 75 } } })
  .composite([
    { input: label('上一版 v5'), left: 0, top: 0 }, { input: a, left: 0, top: 30 },
    { input: label('本版 v8'), left: W + 8, top: 0 }, { input: b, left: W + 8, top: 30 },
  ]).png().toFile(`${OUT}/ab_${tag}.png`);
console.log(`-> ab_${tag}.png`);
