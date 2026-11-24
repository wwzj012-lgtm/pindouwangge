import sharp from 'sharp';

const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T13-16-17-405Z-08d1e2aa.jpg';
const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const px = (x, y) => { const i = (y * W + x) * C; return [data[i], data[i + 1], data[i + 2]]; };

// 格线探测：浅蓝/浅灰线（偏蓝、比白暗一点），统计每列命中比例
const isGridLine = ([r, g, b]) => b > r && (b - r) >= 2 && r < 245 && r > 180;
const colHits = new Float64Array(W);
for (let x = 30; x <= 1415; x++) {
  let hit = 0, tot = 0;
  for (let y = 90; y < 1440; y += 2) { tot++; if (isGridLine(px(x, y))) hit++; }
  colHits[x] = hit / tot;
}
// 峰值（局部极大且 > 0.5）
const peaks = [];
for (let x = 31; x < 1415; x++) {
  if (colHits[x] > 0.5 && colHits[x] >= colHits[x - 1] && colHits[x] >= colHits[x + 1]) peaks.push([x, colHits[x].toFixed(2)]);
}
console.log('col line peaks:', peaks.map(p => p[0]).join(','));
if (peaks.length > 2) {
  const xs = peaks.map(p => p[0]);
  const gaps = [];
  for (let i = 1; i < xs.length; i++) gaps.push(xs[i] - xs[i - 1]);
  console.log('gaps:', gaps.join(','));
}
const rowHits = new Float64Array(H);
for (let y = 60; y <= 1450; y++) {
  let hit = 0, tot = 0;
  for (let x = 40; x < 1400; x += 2) { tot++; if (isGridLine(px(x, y))) hit++; }
  rowHits[y] = hit / tot;
}
const rpeaks = [];
for (let y = 61; y < 1450; y++) {
  if (rowHits[y] > 0.5 && rowHits[y] >= rowHits[y - 1] && rowHits[y] >= rowHits[y + 1]) rpeaks.push(y);
}
console.log('row line peaks:', rpeaks.join(','));
if (rpeaks.length > 2) {
  const gaps = [];
  for (let i = 1; i < rpeaks.length; i++) gaps.push(rpeaks[i] - rpeaks[i - 1]);
  console.log('row gaps:', gaps.join(','));
}
