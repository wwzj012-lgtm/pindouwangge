// 用模块真实实现诊断豆距精修
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: 'D:/Build_Apps/pindouwangge', appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'D:/Build_Apps/pindouwangge/vite.config.ts' });
const { debugPitchAxis } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { data, info } = await sharp('C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

for (const axis of ['x', 'y']) {
  const { spikes, estimate } = debugPitchAxis(source, axis);
  const gaps = [];
  for (let i = 1; i < spikes.length; i++) gaps.push(spikes[i] - spikes[i - 1]);
  console.log(`[${axis}] 尖峰 ${spikes.length}:`, spikes.join(' '));
  console.log(`[${axis}] 间距:`, gaps.map(g => (g >= 20 && g <= 40) ? g : `[${g}]`).join(' '));
  console.log(`[${axis}] 估算:`, JSON.stringify(estimate));
}
await vite.close();
