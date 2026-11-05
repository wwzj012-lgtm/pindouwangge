import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const mod = await vite.ssrLoadModule('/src/utils/imagePipeline.ts');
const { classifyImageColors } = mod;
// 也复制一份分类逻辑打印内部指标
const { rgbToLab, deltaE76 } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const COLOR_CLUSTER_DELTA_E = 12; // 猜测，内部常量
const MAX_ANALYSIS_SAMPLES = 20000;
for (const img of ['benchmark/images/spongebob-patrick.jpg', 'benchmark/images/street-boy.jpg']) {
  const { data, info } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cls = classifyImageColors(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, 128);
  console.log(img, '->', JSON.stringify(cls));
}
await vite.close();
