// 验证：暗线投影邻距自适应（±3px 写死 vs 小格距用 ±2px）
import { createServer } from 'vite';
import sharp from 'sharp';

const file = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-10T11-57-43-221Z-1347bf0f.jpg';
const vite = await createServer({ root: 'D:/Build_Apps/pindouwangge', appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'D:/Build_Apps/pindouwangge/vite.config.ts' });
const m = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

// 复刻内部实现但 radius 可调
function lineSpikes(source, axis, radius) {
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
    for (let i = radius; i < length - radius; i += 1) {
      const center = at(line, i);
      if (at(line, i - radius) - center > 18 && at(line, i + radius) - center > 18) profile[i] += 1;
    }
  }
  let max = 0;
  for (let i = 0; i < profile.length; i += 1) max = Math.max(max, profile[i]);
  if (max <= 0) return [];
  const threshold = max * 0.25;
  const spikes = [];
  const merge = radius >= 3 ? 5 : 4;
  for (let i = merge; i < profile.length - merge; i += 1) {
    if (profile[i] < threshold) continue;
    let isPeak = true;
    for (let d = -merge; d <= merge; d += 1) if (d !== 0 && profile[i + d] > profile[i]) { isPeak = false; break; }
    if (!isPeak) continue;
    const last = spikes[spikes.length - 1];
    if (last !== undefined && i - last <= merge) { if (profile[i] > profile[last]) spikes[spikes.length - 1] = i; continue; }
    spikes.push(i);
  }
  return spikes;
}

for (const axis of ['x', 'y']) {
  for (const radius of [3, 2]) {
    const spikes = lineSpikes(source, axis, radius);
    const span = spikes.length > 1 ? spikes[spikes.length - 1] - spikes[0] : 1;
    // 9.9px 周期下的覆盖率
    const coverage99 = spikes.length > 1 ? ((spikes.length - 1) * 9.9) / span : 0;
    console.log(`${axis} ±${radius}px: 峰 ${spikes.length} 个, 跨度 ${span}, 前邻间距:`, spikes.slice(1, 10).map((p, i) => p - spikes[i]).join(','));
  }
}
await vite.close();
