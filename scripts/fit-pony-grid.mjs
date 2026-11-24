// 小马图暴力网格拟合：pitch × origin 穷举，格内采样一致性得分
import sharp from 'sharp';

const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-09T04-29-31-478Z-f7362be0.jpg';
const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
const W = info.width, C = info.channels;
const px = (x, y) => { const i = (y * W + x) * C; return [data[i], data[i + 1], data[i + 2]]; };

function score(pitchX, pitchY, ox, oy, cols, rows) {
  let total = 0;
  for (let r = 0; r < rows; r++) {
    const cy = Math.round(oy + (r + 0.5) * pitchY);
    if (cy < 1 || cy >= info.height - 1) return Infinity;
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

let best = null;
for (let pitch = 12; pitch <= 18; pitch += 0.1)
  for (let ox = 20; ox <= 45; ox += 1)
    for (let oy = 25; oy <= 50; oy += 1) {
      const cols = Math.floor((W - 12 - ox) / pitch);
      const rows = Math.floor((info.height - 12 - oy) / pitch);
      if (cols < 25 || rows < 25) continue;
      const s = score(pitch, pitch, ox, oy, cols, rows) / (cols * rows);
      if (!best || s < best.s) best = { s: s.toFixed(2), pitch: +pitch.toFixed(1), ox, oy, cols, rows };
    }
console.log('best:', JSON.stringify(best));
