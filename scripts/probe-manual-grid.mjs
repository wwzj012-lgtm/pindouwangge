import sharp from 'sharp';

const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T13-16-17-405Z-08d1e2aa.jpg';
const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
console.log('size', info.width, info.height, 'channels', info.channels);

const W = info.width, H = info.height, C = info.channels;
const px = (x, y) => {
  const i = (y * W + x) * C;
  return [data[i], data[i + 1], data[i + 2]];
};

// 每列/每行 非白像素计数（距白 > 24）
const colCnt = new Array(W).fill(0), rowCnt = new Array(H).fill(0);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const [r, g, b] = px(x, y);
  if (255 - r > 24 || 255 - g > 24 || 255 - b > 24) { colCnt[x]++; rowCnt[y]++; }
}
// 找连续区段（计数 > H*0.02 的列）
const segs = [];
let s = -1;
for (let x = 0; x < W; x++) {
  const on = colCnt[x] > H * 0.02;
  if (on && s < 0) s = x;
  if (!on && s >= 0) { if (x - s > 8) segs.push([s, x - 1]); s = -1; }
}
if (s >= 0) segs.push([s, W - 1]);
console.log('column segments (width>8):', segs.map(g => `${g[0]}-${g[1]}(${g[1] - g[0] + 1})`).join(' '));

const rsegs = [];
s = -1;
for (let y = 0; y < H; y++) {
  const on = rowCnt[y] > W * 0.02;
  if (on && s < 0) s = y;
  if (!on && s >= 0) { if (y - s > 8) rsegs.push([s, y - 1]); s = -1; }
}
if (s >= 0) rsegs.push([s, H - 1]);
console.log('row segments (height>8):', rsegs.map(g => `${g[0]}-${g[1]}(${g[1] - g[0] + 1})`).join(' '));
