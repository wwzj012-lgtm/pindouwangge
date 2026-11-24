// 渲染 M13 单格大图 ASCII 看碎裂形态
import sharp from 'sharp';
const FONT = {
  M: ['#...#', '##.##', '#####', '#.#.#', '#...#', '#...#', '#...#'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  '3': ['#####', '....#', '....#', '.###.', '....#', '....#', '#####'],
};
const CELL = 80, px = 3;
function drawCode(parts, x, y, code, darkText) {
  const totalW = code.length * 5 * px + (code.length - 1) * 4;
  let cursor = Math.round(x + (CELL - totalW) / 2);
  const top = Math.round(y + (CELL - 7 * px) / 2);
  for (const ch of code) {
    const glyph = FONT[ch];
    for (let gy = 0; gy < glyph.length; gy++) for (let gx = 0; gx < glyph[gy].length; gx++) {
      if (glyph[gy][gx] === '#') parts.push(`<rect x="${cursor + gx * px}" y="${top + gy * px}" width="${px}" height="${px}" fill="${darkText ? '#222' : '#ddd'}"/>`);
    }
    cursor += 5 * px + 4;
  }
}
const parts = [`<rect width="100%" height="100%" fill="rgb(216,152,104)"/>`];
drawCode(parts, 0, 0, 'M13', false);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">${parts.join('')}</svg>`;
const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let y = 25; y < 55; y++) {
  let line = '';
  for (let x = 10; x < 70; x++) {
    const i = (y * info.width + x) * 4;
    const dark = data[i] > 200 && data[i+1] > 200;
    line += dark ? '#' : '.';
  }
  console.log(line);
}
