// 直接检测图纸青色格线的真实位置：颜色掩码 + 投影峰值
import sharp from 'sharp';

const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-09T04-29-31-478Z-f7362be0.jpg';
const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const rgb = (x, y) => { const i = (y * W + x) * C; return [data[i], data[i + 1], data[i + 2]]; };

// 青色格线色：从左上角图纸边缘取样看（原图边缘粗线）。先统计全图低饱和青色像素分布
// 格线色 ≈ teal (g>b? 实际青绿)。取样图纸内空白处的格线：打印几行像素找规律
// 更稳的做法：格线 = 比两侧邻域暗且偏青的细线。用「局部暗线」检测：
// 对每列 x，统计所有 y 上 min(RGB) 显著低于左右 3px 邻域的像素数 → 投影
const colProj = new Float32Array(W);
for (let x = 3; x < W - 3; x++) {
  let cnt = 0;
  for (let y = 2; y < H - 2; y += 1) {
    const c = rgb(x, y), l = rgb(x - 3, y), r = rgb(x + 3, y);
    const lc = (c[0] + c[1] + c[2]) / 3, ll = (l[0] + l[1] + l[2]) / 3, lr = (r[0] + r[1] + r[2]) / 3;
    if (ll - lc > 18 && lr - lc > 18) cnt += 1; // 暗于两侧
  }
  colProj[x] = cnt;
}
const rowProj = new Float32Array(H);
for (let y = 3; y < H - 3; y++) {
  let cnt = 0;
  for (let x = 2; x < W - 2; x += 1) {
    const c = rgb(x, y), u = rgb(x, y - 3), d = rgb(x, y + 3);
    const lc = (c[0] + c[1] + c[2]) / 3, lu = (u[0] + u[1] + u[2]) / 3, ld = (d[0] + d[1] + d[2]) / 3;
    if (lu - lc > 18 && ld - lc > 18) cnt += 1;
  }
  rowProj[y] = cnt;
}

// 找峰（局部极大，间隔>=5px 取最高）
function peaks(proj, minVal) {
  const cand = [];
  for (let i = 3; i < proj.length - 3; i++) {
    if (proj[i] < minVal) continue;
    let isPeak = true;
    for (let d = -5; d <= 5; d++) if (d !== 0 && proj[i + d] > proj[i]) { isPeak = false; break; }
    if (isPeak) cand.push(i);
  }
  // 合并近邻（<=6px）
  const merged = [];
  for (const p of cand) {
    if (merged.length && p - merged[merged.length - 1] <= 6) continue;
    merged.push(p);
  }
  return merged;
}

const cp = peaks(colProj, Math.max(...colProj) * 0.3);
const rp = peaks(rowProj, Math.max(...rowProj) * 0.3);
console.log('列线峰数:', cp.length);
console.log('列线位置:', cp.join(','));
if (cp.length > 2) {
  const gaps = cp.slice(1).map((v, i) => v - cp[i]);
  console.log('列线间距:', gaps.join(','));
  const sorted = [...gaps].sort((a, b) => a - b);
  console.log('间距中位数:', sorted[Math.floor(sorted.length / 2)]);
}
console.log('行线峰数:', rp.length);
console.log('行线位置:', rp.join(','));
if (rp.length > 2) {
  const gaps = rp.slice(1).map((v, i) => v - rp[i]);
  console.log('行线间距:', gaps.join(','));
  const sorted = [...gaps].sort((a, b) => a - b);
  console.log('间距中位数:', sorted[Math.floor(sorted.length / 2)]);
}
