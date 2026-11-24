import sharp from 'sharp';
const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i+1], data[i+2]]; };
function lineSpikes(axis) {
  const N = axis === 'y' ? H : W, M = axis === 'y' ? W : H;
  const proj = new Float32Array(N);
  for (let n = 3; n < N - 3; n++) {
    let cnt = 0;
    for (let m = 2; m < M - 2; m += 2) {
      const c = axis === 'y' ? px(m, n) : px(n, m);
      const u = axis === 'y' ? px(m, n - 3) : px(n - 3, m);
      const d = axis === 'y' ? px(m, n + 3) : px(n + 3, m);
      const lc = (c[0]+c[1]+c[2])/3, lu = (u[0]+u[1]+u[2])/3, ld = (d[0]+d[1]+d[2])/3;
      if (lu - lc > 18 && ld - lc > 18) cnt++;
    }
    proj[n] = cnt;
  }
  const thr = Math.max(...proj) * 0.25;
  const peaks = [];
  for (let n = 5; n < N - 5; n++) {
    if (proj[n] < thr) continue;
    let isPeak = true;
    for (let dd = -4; dd <= 4; dd++) if (dd !== 0 && proj[n+dd] > proj[n]) { isPeak = false; break; }
    if (isPeak) peaks.push(n);
  }
  const merged = [];
  for (const p of peaks) { if (merged.length && p - merged[merged.length-1] <= 5) continue; merged.push(p); }
  return { spikes: merged, proj };
}
for (const axis of ['x', 'y']) {
  const { spikes, proj } = lineSpikes(axis);
  console.log(axis, '峰数', spikes.length);
  console.log('位置:', spikes.join(','));
  const gaps = spikes.slice(1).map((v, i) => v - spikes[i]);
  console.log('间距:', gaps.join(','));
  // 峰强
  console.log('峰强:', spikes.map(s => Math.round(proj[s])).join(','));
}
