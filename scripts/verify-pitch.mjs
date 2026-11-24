// 妲己图实测新豆距估算器
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: 'D:/Build_Apps/pindouwangge', appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'D:/Build_Apps/pindouwangge/vite.config.ts' });
const { estimateBeadPitch } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { data, info } = await sharp('C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const t0 = performance.now();
const est = estimateBeadPitch(source);
console.log('耗时', (performance.now() - t0).toFixed(0) + 'ms');
console.log(JSON.stringify(est));
await vite.close();
