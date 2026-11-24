// 初音图诊断：格距极小的图纸（131x151 格）为什么对不齐
import { createServer } from 'vite';
import sharp from 'sharp';

const file = 'C:/Users/Plout/Downloads/拼豆图纸转高清图.png';
const vite = await createServer({ root: 'D:/Build_Apps/pindouwangge', appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'D:/Build_Apps/pindouwangge/vite.config.ts' });
const { estimateBeadPitch, debugPitchAxis, refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
console.log('图片尺寸:', info.width, 'x', info.height, '（131x151 格 → 期望格距约', (info.width / 131).toFixed(2), '/', (info.height / 151).toFixed(2), 'px）');

const est = estimateBeadPitch(source);
console.log('全局估算:', JSON.stringify(est));

for (const axis of ['x', 'y']) {
  const dbg = debugPitchAxis(source, axis);
  const spikes = dbg.spikes;
  console.log(`${axis} 轴: 暗线峰 ${spikes.length} 个, 前 12 个位置:`, spikes.slice(0, 12).join(','));
  if (spikes.length > 2) {
    const gaps = spikes.slice(1, 12).map((p, i) => p - spikes[i]);
    console.log(`  相邻峰间距:`, gaps.join(','));
  }
}

// 模拟用户手动大致对齐后精修
if (est) {
  const rough = { originX: 1, originY: 1, cellSize: Number((info.width / 131).toFixed(2)) };
  const refined = refineGridAlignment(source, rough);
  console.log('精修（先验 = 图宽/131）:', JSON.stringify(refined));
}
await vite.close();
