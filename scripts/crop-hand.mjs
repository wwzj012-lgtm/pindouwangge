// 局部放大：原图左下（手+衣服） vs 识别 grid 对应区域
import sharp from 'sharp';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
// 12.jpg 908x1047, grid 103x119, cell 8.8, origin -0.375,-0.125
// 手部区域约 col 0-30, row 55-95 → 原图像素 x 0-265, y 480-830
const SRC = { left: 0, top: 430, width: 300, height: 500 };
const GRID_SCALE = 4;
const g = await sharp(`${OUT}/v5_grid.png`).metadata(); // 412x476
// grid 像素 = 原图像素 / 8.8 * 4
const gLeft = Math.round((SRC.left - OXpx()) / 8.8 * GRID_SCALE), gTop = Math.round((SRC.top - OYpx()) / 8.8 * GRID_SCALE);
function OXpx() { return -0.375 * 8.8; }
function OYpx() { return -0.125 * 8.8; }
const gW = Math.round(SRC.width / 8.8 * GRID_SCALE), gH = Math.round(SRC.height / 8.8 * GRID_SCALE);
const H = 700;
const src = await sharp('C:/Users/Plout/Pictures/12.jpg').extract(SRC).resize(Math.round(300 * H / 500), H, { kernel: 'nearest' }).png().toBuffer();
const grid = await sharp(`${OUT}/v5_grid.png`).extract({ left: Math.max(0, gLeft), top: Math.max(0, gTop), width: gW, height: gH }).resize(Math.round(300 * H / 500), H, { kernel: 'nearest' }).png().toBuffer();
const W = Math.round(300 * H / 500);
await sharp({ create: { width: W * 2 + 8, height: H + 34, channels: 3, background: { r: 60, g: 65, b: 75 } } })
  .composite([
    { input: Buffer.from(`<svg width="${W}" height="34"><rect width="100%" height="100%" fill="#1e293b"/><text x="${W / 2}" y="23" text-anchor="middle" font-size="17" font-weight="bold" fill="#fff" font-family="Microsoft YaHei">原图（手部/衣服区域）</text></svg>`), left: 0, top: 0 },
    { input: src, left: 0, top: 34 },
    { input: Buffer.from(`<svg width="${W}" height="34"><rect width="100%" height="100%" fill="#1e293b"/><text x="${W / 2}" y="23" text-anchor="middle" font-size="17" font-weight="bold" fill="#fff" font-family="Microsoft YaHei">识别结果（v4）</text></svg>`), left: W + 8, top: 0 },
    { input: grid, left: W + 8, top: 34 },
  ]).png().toFile(`${OUT}/hand_region.png`);
console.log(`-> ${OUT}/hand_region.png`);
