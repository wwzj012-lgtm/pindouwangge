import sharp from 'sharp';

const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T13-16-17-405Z-08d1e2aa.jpg';
const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
const W = info.width, C = info.channels;
const px = (x, y) => { const i = (y * W + x) * C; return [data[i], data[i + 1], data[i + 2]]; };

// 对齐指标：每格中心 2x2 采样的通道内极差总和（对齐好=纯色，方差小）
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
        const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
        total += d;
      }
      const a = px(cx, cy), b = px(cx, cy + 1);
      total += Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    }
  }
  return total;
}

let best = null;
for (const rows of [51, 52]) {
  for (let pitch = 26.0; pitch <= 27.2; pitch += 0.1) {
    for (let ox = 33; ox <= 45; ox += 1) {
      for (let oy = 78; oy <= 96; oy += 1) {
        const s = score(pitch, pitch, ox, oy, 52, rows);
        if (!best || s < best.s) best = { s, pitch, ox, oy, rows };
      }
    }
  }
}
console.log('coarse best:', JSON.stringify(best));

// 细化
let b2 = { ...best };
for (let pitch = best.pitch - 0.15; pitch <= best.pitch + 0.15; pitch += 0.02) {
  for (let ox = best.ox - 1.5; ox <= best.ox + 1.5; ox += 0.25) {
    for (let oy = best.oy - 1.5; oy <= best.oy + 1.5; oy += 0.25) {
      const s = score(pitch, pitch, ox, oy, 52, best.rows);
      if (s < b2.s) b2 = { s, pitch, ox, oy, rows: best.rows };
    }
  }
}
console.log('fine best:', JSON.stringify(b2));
