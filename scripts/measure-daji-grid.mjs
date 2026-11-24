// 投影法测网格：横向/纵向暗线（黑细线）周期
import sharp from 'sharp';
const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const { data, info } = await sharp(SRC).ensureAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
// 行/列平均亮度；网格线 = 局部极小值（暗）
const rowMean = new Array(H).fill(0), colMean = new Array(W).fill(0);
for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) s += data[y * W + x]; rowMean[y] = s / W; }
for (let x = 0; x < W; x++) { let s = 0; for (let y = 0; y < H; y++) s += data[y * W + x]; colMean[x] = s / H; }
// 找暗峰：低于邻域(±3)平均 8 以上的位置
const peaks = (m, n) => {
  const out = [];
  for (let i = 3; i < n - 3; i++) {
    let nb = 0, cnt = 0;
    for (let d = -3; d <= 3; d++) { if (d) { nb += m[i + d]; cnt++; } }
    if (m[i] < nb / cnt - 8) out.push(i);
  }
  // 合并相邻
  const merged = [];
  for (const p of out) { if (merged.length && p - merged[merged.length-1] <= 2) merged[merged.length-1] = Math.round((merged[merged.length-1] + p) / 2); else merged.push(p); }
  return merged;
};
const rp = peaks(rowMean, H), cp = peaks(colMean, W);
const gaps = (p) => { const g = []; for (let i = 1; i < p.length; i++) g.push(p[i] - p[i-1]); return g; };
const rg = gaps(rp), cg = gaps(cp);
const median = (a) => { const s = [...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; };
console.log(`行暗峰 ${rp.length} 个, 间距中位 ${median(rg)}, 分布: ${rg.slice(0, 20).join(',')}`);
console.log(`列暗峰 ${cp.length} 个, 间距中位 ${median(cg)}, 分布: ${cg.slice(0, 20).join(',')}`);
console.log(`首行峰 y=${rp[0]} 首列峰 x=${cp[0]}`);
// 52格假设检验: 1562/52=30.04 1535/52=29.5
console.log(`假设: W/30.04=${(W/30.04).toFixed(1)}列, H/29.5=${(H/29.5).toFixed(1)}行`);
