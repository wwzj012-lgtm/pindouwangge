// 实验：对比「剖面谷峰反差评分」能否在候选窗口里选出真格距
// score(p,o) = mean(profile at cell centers) - mean(profile at cell borders)，越大越好
import sharp from 'sharp';

const FILES = [
  ['小马图(真值14.4)', 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-09T04-29-31-478Z-f7362be0.jpg'],
  ['妲己图(真值29.6)', 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg'],
];

function diffProfile(data, W, H, C, axis) {
  const length = axis === 'x' ? W : H;
  const lines = axis === 'x' ? H : W;
  const stride = axis === 'x' ? 1 : W;
  const profile = new Float64Array(length);
  const step = lines > 400 ? 2 : 1;
  for (let line = 0; line < lines; line += step) {
    const base = axis === 'x' ? line * W : line;
    for (let i = 1; i < length; i += 1) {
      const a = (base + (i - 1) * stride) * C;
      const b = (base + i * stride) * C;
      profile[i] += Math.abs(data[b] - data[a]) + Math.abs(data[b + 1] - data[a + 1]) + Math.abs(data[b + 2] - data[a + 2]);
    }
  }
  return profile;
}

// 对给定 (p, o)：k 覆盖 [o, L) 的边界采样与中心采样的均值差
function contrast(profile, p, o, L) {
  let border = 0, center = 0, bn = 0, cn = 0;
  for (let x = o; x < L; x += p) {
    const b = Math.round(x), c = Math.round(x + p / 2);
    if (b >= 1 && b < L) { border += profile[b]; bn++; }
    if (c >= 1 && c < L) { center += profile[c]; cn++; }
  }
  if (bn < 3 || cn < 3) return -Infinity;
  return border / bn - center / cn;
}

for (const [name, path] of FILES) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const pX = diffProfile(data, W, H, C, 'x');
  const pY = diffProfile(data, W, H, C, 'y');
  console.log('==', name, `${W}x${H}`);
  for (const target of name.includes('小马') ? [9.6, 14.4] : [29.6]) {
    let best = null;
    for (let p = target - 1.5; p <= target + 1.5; p += 0.05) {
      for (let o = 0; o < p; o += 0.1) {
        const s = Math.min(contrast(pX, p, o, W), contrast(pY, p, o, H));
        if (!best || s > best.s) best = { s: s.toFixed(1), p: p.toFixed(2), o: o.toFixed(1) };
      }
    }
    console.log(`窗口 ${target}±1.5 → best`, JSON.stringify(best));
  }
}
