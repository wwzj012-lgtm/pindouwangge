import sharp from 'sharp';

const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T13-16-17-405Z-08d1e2aa.jpg';
const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const pitch = 26.29, ox = 35.5, oy = 87, cols = 52, rows = 51;

// 画红色十字标记每格中心 + 绿框网格
const lines = [];
for (let c = 0; c <= cols; c++) {
  const x = ox + c * pitch;
  lines.push(`<line x1="${x}" y1="${oy}" x2="${x}" y2="${oy + rows * pitch}" stroke="red" stroke-width="0.6" opacity="0.8"/>`);
}
for (let r = 0; r <= rows; r++) {
  const y = oy + r * pitch;
  lines.push(`<line x1="${ox}" y1="${y}" x2="${ox + cols * pitch}" y2="${y}" stroke="red" stroke-width="0.6" opacity="0.8"/>`);
}
const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${lines.join('')}</svg>`;
await sharp(SRC).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).png().toFile('C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import/manual_grid_overlay.png');
console.log('-> manual_grid_overlay.png');
