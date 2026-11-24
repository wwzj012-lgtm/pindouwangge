// 暴力拟合：score(pitch,origin) = Σ_k max(colDiff[k*pitch+origin ± 2])
import sharp from 'sharp';
const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const colDiff = new Float64Array(W), rowDiff = new Float64Array(H);
for (let y = 0; y < H; y += 2) for (let x = 1; x < W; x++) {
  const i = (y * W + x) * C, j = i - C;
  colDiff[x] += Math.abs(data[i]-data[j]) + Math.abs(data[i+1]-data[j+1]) + Math.abs(data[i+2]-data[j+2]);
}
for (let x = 0; x < W; x += 2) for (let y = 1; y < H; y++) {
  const i = (y * W + x) * C, j = i - W * C;
  rowDiff[y] += Math.abs(data[i]-data[j]) + Math.abs(data[i+1]-data[j+1]) + Math.abs(data[i+2]-data[j+2]);
}
const fit = (d, n, tag) => {
  let best = null;
  for (let pitch = 29.0; pitch <= 30.6; pitch += 0.02) {
    for (let origin = 0; origin < pitch; origin += 0.25) {
      let score = 0, k = 0;
      for (let pos = origin; pos < n - 2; pos += pitch, k++) {
        const c = Math.round(pos);
        let m = 0;
        for (let dx = -2; dx <= 2; dx++) { const x = c + dx; if (x >= 0 && x < n) m = Math.max(m, d[x]); }
        score += m;
      }
      score /= Math.max(1, k); // 平均每条线的能量（避免线多占优）
      if (!best || score > best.score) best = { pitch, origin, score, lines: k };
    }
  }
  console.log(`${tag}: pitch=${best.pitch.toFixed(2)} origin=${best.origin.toFixed(2)} lines=${best.lines} score=${(best.score/1000).toFixed(1)}k`);
  return best;
};
const c = fit(colDiff, W, '列');
const r = fit(rowDiff, H, '行');
console.log(`格数: ${Math.floor((W - c.origin) / c.pitch)}列 x ${Math.floor((H - r.origin) / r.pitch)}行`);
