// 对暗线峰列做相位相干扫描：真周期是多少？18 和 9.9 谁对？
import { createServer } from 'vite';
import sharp from 'sharp';

const file = 'C:/Users/Plout/Downloads/拼豆图纸转高清图.png';
const vite = await createServer({ root: 'D:/Build_Apps/pindouwangge', appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'D:/Build_Apps/pindouwangge/vite.config.ts' });
const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

function lineSpikes(source, axis) {
  const { data, width, height } = source;
  const length = axis === 'x' ? width : height;
  const lines = axis === 'x' ? height : width;
  const profile = new Float64Array(length);
  const at = (line, i) => {
    const base = axis === 'x' ? (line * width + i) * 4 : (i * width + line) * 4;
    return (data[base] + data[base + 1] + data[base + 2]) / 3;
  };
  const step = lines > 400 ? 2 : 1;
  for (let line = 0; line < lines; line += step) {
    for (let i = 3; i < length - 3; i += 1) {
      const center = at(line, i);
      if (at(line, i - 3) - center > 18 && at(line, i + 3) - center > 18) profile[i] += 1;
    }
  }
  let max = 0;
  for (let i = 0; i < profile.length; i += 1) max = Math.max(max, profile[i]);
  if (max <= 0) return [];
  const threshold = max * 0.25;
  const spikes = [];
  for (let i = 5; i < profile.length - 5; i += 1) {
    if (profile[i] < threshold) continue;
    let isPeak = true;
    for (let d = -4; d <= 4; d += 1) if (d !== 0 && profile[i + d] > profile[i]) { isPeak = false; break; }
    if (!isPeak) continue;
    const last = spikes[spikes.length - 1];
    if (last !== undefined && i - last <= 5) { if (profile[i] > profile[last]) spikes[spikes.length - 1] = i; continue; }
    spikes.push(i);
  }
  return spikes;
}
const coherence = (spikes, p) => {
  let c = 0, s = 0;
  for (const pos of spikes) { const a = (2 * Math.PI * pos) / p; c += Math.cos(a); s += Math.sin(a); }
  return Math.hypot(c, s) / spikes.length;
};

for (const axis of ['x', 'y']) {
  const spikes = lineSpikes(source, axis);
  console.log(`${axis}: ${spikes.length} 峰`);
  // 全范围扫描 top-5 相干周期
  const cands = [];
  for (let p = 5; p <= 64; p += 0.02) cands.push({ p, c: coherence(spikes, p) });
  cands.sort((a, b) => b.c - a.c);
  const shown = [];
  for (const cand of cands) {
    if (shown.every(s => Math.abs(s - cand.p) > 1.5)) shown.push(cand.p);
    if (shown.length >= 5) break;
  }
  for (const p of shown) {
    const c = coherence(spikes, p);
    // 覆盖率
    const span = spikes[spikes.length - 1] - spikes[0];
    const coverage = Math.min(1, ((spikes.length - 1) * p) / span);
    console.log(`  p=${p.toFixed(2)} 相干=${c.toFixed(3)} 覆盖率=${coverage.toFixed(2)}`);
  }
}
await vite.close();
