// 暗峰位置线性拟合：peak ≈ origin + k * pitch
import sharp from 'sharp';
const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const { data, info } = await sharp(SRC).ensureAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const colMean = new Array(W).fill(0), rowMean = new Array(H).fill(0);
for (let x = 0; x < W; x++) { let s = 0; for (let y = 0; y < H; y++) s += data[y * W + x]; colMean[x] = s / H; }
for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) s += data[y * W + x]; rowMean[y] = s / H; }
const peaks = (m, n) => {
  const out = [];
  for (let i = 2; i < n - 2; i++) {
    let nb = 0, cnt = 0;
    for (let d = -4; d <= 4; d++) { if (d) { nb += m[i + d]; cnt++; } }
    if (m[i] < nb / cnt - 6) out.push(i);
  }
  const merged = [];
  for (const p of out) { if (merged.length && p - merged[merged.length-1] <= 3) merged[merged.length-1] = (merged[merged.length-1] + p) / 2; else merged.push(p); }
  return merged;
};
const fit = (pk, tag) => {
  // RANSAC 式：假设峰序对应 k=0..N-1，最小二乘；若残差大则剔除离群峰重拟合
  let pts = pk.map((p, i) => [i, p]);
  for (let iter = 0; iter < 6; iter++) {
    const n = pts.length;
    const sx = pts.reduce((s, p) => s + p[0], 0), sy = pts.reduce((s, p) => s + p[1], 0);
    const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0), sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n;
    const resid = pts.map(p => Math.abs(p[1] - (intercept + slope * p[0])));
    const med = [...resid].sort((a, b) => a - b)[Math.floor(n / 2)];
    const keep = pts.filter((_, i) => resid[i] <= Math.max(1.5, med * 3));
    if (keep.length === n) { pts = keep; break; }
    pts = keep;
  }
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p[0], 0), sy = pts.reduce((s, p) => s + p[1], 0);
  const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0), sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  const resid = Math.max(...pts.map(p => Math.abs(p[1] - (intercept + slope * p[0]))));
  console.log(`${tag}: pitch=${slope.toFixed(3)} origin=${intercept.toFixed(2)} 内点=${n}/${pk.length} 最大残差=${resid.toFixed(2)} 推算格数=${((n > 5 ? slope * (n - 1) : 0)).toFixed(0)}`);
  return { pitch: slope, origin: intercept };
};
const cp = peaks(colMean, W), rp = peaks(rowMean, H);
const fC = fit(cp, '列');
const fR = fit(rp, '行');
console.log(`列推算 ${((W - fC.origin) / fC.pitch).toFixed(2)} 格, 行推算 ${((H - fR.origin) / fR.pitch).toFixed(2)} 格`);
