// 四参数独立拟合：pitchX/pitchY/originX/originY 分开，并检测真实行列数
import sharp from 'sharp';

const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-09T04-29-31-478Z-f7362be0.jpg';
const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const px = (x, y) => { const i = (y * W + x) * C; return [data[i], data[i + 1], data[i + 2]]; };

function score(pitchX, pitchY, ox, oy, cols, rows) {
  let total = 0;
  for (let r = 0; r < rows; r++) {
    const cy = Math.round(oy + (r + 0.5) * pitchY);
    if (cy < 1 || cy >= H - 1) return Infinity;
    for (let c = 0; c < cols; c++) {
      const cx = Math.round(ox + (c + 0.5) * pitchX);
      if (cx < 1 || cx >= W - 1) return Infinity;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const a = px(cx + dx, cy + dy), b = px(cx + dx + 1, cy + dy);
        total += Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
      }
      const a = px(cx, cy), b = px(cx, cy + 1);
      total += Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    }
  }
  return total;
}

// 粗拟合：非正方格
let best = null;
for (let pX = 12; pX <= 18; pX += 0.2)
  for (let pY = 12; pY <= 18; pY += 0.2)
    for (let ox = 25; ox <= 55; ox += 2)
      for (let oy = 30; oy <= 60; oy += 2) {
        const cols = Math.floor((W - 12 - ox) / pX);
        const rows = Math.floor((H - 12 - oy) / pY);
        if (cols < 20 || rows < 20) continue;
        const s = score(pX, pY, ox, oy, cols, rows) / (cols * rows);
        if (!best || s < best.s) best = { s: +s.toFixed(2), pX: +pX.toFixed(1), pY: +pY.toFixed(1), ox, oy, cols, rows };
      }
console.log('粗拟合(非正方):', JSON.stringify(best));

// 细化 + 尝试不同行列数：真实格数未必是「撑满到 W-12」
// 对行列数做扫描，找每格成本最小且行列数合理的组合
const { pX, pY, ox: box, oy: boy } = best;
let best2 = null;
for (let cols = Math.max(20, best.cols - 6); cols <= best.cols + 2; cols++)
  for (let rows = Math.max(20, best.rows - 6); rows <= best.rows + 2; rows++)
    for (let oX = box - 3; oX <= box + 3; oX += 0.5)
      for (let oY = boy - 3; oY <= boy + 3; oY += 0.5) {
        const s = score(pX, pY, oX, oY, cols, rows) / (cols * rows);
        if (!best2 || s < best2.s) best2 = { s: +s.toFixed(2), pX: +pX.toFixed(2), pY: +pY.toFixed(2), ox: oX, oy: oY, cols, rows };
      }
console.log('细化+行列数扫描:', JSON.stringify(best2));

// 相位精修
function coherence(spikes, p) {
  let re = 0, im = 0;
  for (const pos of spikes) { const ang = 2 * Math.PI * pos / p; re += Math.cos(ang); im += Math.sin(ang); }
  return Math.sqrt(re * re + im * im) / spikes.length;
}
