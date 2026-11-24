// 扫描种子格距，找用户导出图的真实网格标定
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');

const { data, info } = await sharp('C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-15T03-22-12-361Z-ca506670.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

for (const seed of [11, 11.5, 12, 12.5, 13, 14, 16, 17.86]) {
  const r = refineGridAlignment(source, { originX: 0, originY: 0, cellSize: seed });
  console.log(`seed=${seed} -> cell=${r.cell} origin=(${r.originX.toFixed(1)},${r.originY.toFixed(1)}) cohX=${r.coherenceX?.toFixed(2)} cohY=${r.coherenceY?.toFixed(2)} applied=${r.applied} msg=${r.message}`);
}
await vite.close();
