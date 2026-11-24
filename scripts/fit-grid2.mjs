// 色差直方图：相邻列/行颜色差异总和，格边界=尖峰，自相关找周期
import sharp from 'sharp';
const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
// 每隔 2 行采样加速
const colDiff = new Float64Array(W), rowDiff = new Float64Array(H);
for (let y = 0; y < H; y += 2) {
  for (let x = 1; x < W; x++) {
    const i = (y * W + x) * C, j = i - C;
    colDiff[x] += Math.abs(data[i]-data[j]) + Math.abs(data[i+1]-data[j+1]) + Math.abs(data[i+2]-data[j+2]);
  }
}
for (let x = 0; x < W; x += 2) {
  for (let y = 1; y < H; y++) {
    const i = (y * W + x) * C, j = i - W * C;
    rowDiff[y] += Math.abs(data[i]-data[j]) + Math.abs(data[i+1]-data[j+1]) + Math.abs(data[i+2]-data[j+2]);
  }
}
// 平滑后取峰
const smooth = (a) => a.map((_, i) => {
  if (i < 2 || i >= a.length - 2) return a[i];
  return (a[i-2] + a[i-1] + a[i] + a[i+1] + a[i+2]) / 5;
});
const findPeaks = (a) => {
  const s = smooth(a);
  const out = [];
  for (let i = 3; i < s.length - 3; i++) if (s[i] > s[i-3] && s[i] > s[i+3] && s[i] > s[i-2] && s[i] > s[i+2]) out.push(i);
  const merged = [];
  for (const p of out) { if (merged.length && p - merged[merged.length-1] <= 4) { if (s[p] > s[merged[merged.length-1]]) merged[merged.length-1] = p; } else merged.push(p); }
  return merged;
};
const analyze = (d, tag) => {
  const pk = findPeaks(d);
  // 峰间距直方图（25-35 范围）
  const hist = new Map();
  for (let i = 0; i < pk.length; i++) for (let j = i + 1; j < Math.min(i + 8, pk.length); j++) {
    const g = pk[j] - pk[i];
    if (g >= 25 && g <= 35) hist.set(g, (hist.get(g) ?? 0) + 1);
  }
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`${tag}: ${pk.length} 峰 | 间距直方图 top5: ${top.map(([g, n]) => `${g}(${n})`).join(' ')}`);
  // 相邻峰间距（最常见值）
  const adj = new Map();
  for (let i = 1; i < pk.length; i++) { const g = pk[i] - pk[i-1]; if (g >= 24 && g <= 36) adj.set(g, (adj.get(g) ?? 0) + 1); }
  const best = [...adj.entries()].sort((a, b) => b[1] - a[1])[0];
  const pitch = best[0];
  const inl = pk.filter((p, i) => i === 0 || true);
  // 用 pitch 对齐求 origin：每个峰对 pitch 取模的余数直方图
  const phase = new Map();
  for (const p of pk) { const r = ((p % pitch) + pitch) % pitch; const k = Math.round(r); phase.set(k, (phase.get(k) ?? 0) + 1); }
  const bestPhase = [...phase.entries()].sort((a, b) => b[1] - a[1])[0];
  console.log(`  pitch=${pitch} (${best[1]}次) | 相位 ${bestPhase[0]}px (${bestPhase[1]}峰一致) | 峰序列头: ${pk.slice(0, 8).join(',')}`);
  return { pitch, origin: bestPhase[0] };
};
console.log('colDiff[0..80]:', Array.from(colDiff.slice(0, 80)).map(v=>Math.round(v/1000)).join(','));
analyze(colDiff, '列');
analyze(rowDiff, '行');
