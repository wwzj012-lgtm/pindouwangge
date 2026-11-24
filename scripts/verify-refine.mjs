// 妲己图实测精修：以偏移的手动对齐为先验，验证远端漂移被抹平
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: 'D:/Build_Apps/pindouwangge', appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'D:/Build_Apps/pindouwangge/vite.config.ts' });
const { estimateBeadPitch, refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { data, info } = await sharp('C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

const global_ = estimateBeadPitch(source);
console.log('全局估算（真值 29.6）:', JSON.stringify({ cell: global_?.cell, conf: global_?.confidence?.toFixed(3) }));

const truth = global_?.cell ?? 29.6;
// 模拟"手动只对齐了局部"：格距偏 +2%、原点偏 0.9px —— 30 格远处漂 18px+
const rough = { originX: 0.9, originY: 0.9, cellSize: Number((truth * 1.02).toFixed(2)) };
console.log('模拟手动初值:', JSON.stringify(rough), '→ 第 30 格预测漂移:', (rough.originX + 30 * rough.cellSize - (truth * 30 + rough.originX)).toFixed(1), 'px');
const t0 = performance.now();
const refined = refineGridAlignment(source, rough);
console.log('精修耗时', (performance.now() - t0).toFixed(0) + 'ms');
console.log(JSON.stringify(refined));
await vite.close();
