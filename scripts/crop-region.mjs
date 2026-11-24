// 通用区域裁剪对比：node scripts/crop-region.mjs <left> <top> <width> <height> <tag> [gridPath]
// 坐标是 12.jpg 原图像素。左=原图 crop，右=识别 grid 对应区域（4x）。
import sharp from 'sharp';
const [,, l, t, w, h, tag, gridPath] = process.argv;
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
const SRC_IMG = 'C:/Users/Plout/Pictures/12.jpg';
const GRID = gridPath ?? `${OUT}/v5_grid.png`;
const CELL = 8.8, OX = -0.375, OY = -0.25, GRID_SCALE = 4;
const SRC = { left: +l, top: +t, width: +w, height: +h };
const gLeft = Math.max(0, Math.round((SRC.left - OX * CELL) / CELL * GRID_SCALE));
const gTop = Math.max(0, Math.round((SRC.top - OY * CELL) / CELL * GRID_SCALE));
const gW = Math.round(SRC.width / CELL * GRID_SCALE), gH = Math.round(SRC.height / CELL * GRID_SCALE);
const H = 640;
const W = Math.round(SRC.width * H / SRC.height);
const src = await sharp(SRC_IMG).extract(SRC).resize(W, H, { kernel: 'nearest' }).png().toBuffer();
const grid = await sharp(GRID).extract({ left: gLeft, top: gTop, width: gW, height: gH }).resize(W, H, { kernel: 'nearest' }).png().toBuffer();
await sharp({ create: { width: W * 2 + 8, height: H + 34, channels: 3, background: { r: 60, g: 65, b: 75 } } })
  .composite([
    { input: Buffer.from(`<svg width="${W}" height="34"><rect width="100%" height="100%" fill="#1e293b"/><text x="${W / 2}" y="23" text-anchor="middle" font-size="16" font-weight="bold" fill="#fff" font-family="Microsoft YaHei">原图 ${tag}</text></svg>`), left: 0, top: 0 },
    { input: src, left: 0, top: 34 },
    { input: Buffer.from(`<svg width="${W}" height="34"><rect width="100%" height="100%" fill="#1e293b"/><text x="${W / 2}" y="23" text-anchor="middle" font-size="16" font-weight="bold" fill="#fff" font-family="Microsoft YaHei">识别 ${tag}</text></svg>`), left: W + 8, top: 0 },
    { input: grid, left: W + 8, top: 34 },
  ]).png().toFile(`${OUT}/region_${tag}.png`);
console.log(`-> ${OUT}/region_${tag}.png`);
