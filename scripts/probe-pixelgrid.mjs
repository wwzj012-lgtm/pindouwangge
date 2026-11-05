import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { detectPixelGrid } = await vite.ssrLoadModule('/src/utils/pixelGrid.ts');
for (const img of ['benchmark/images/spongebob-patrick.jpg', 'benchmark/images/street-boy.jpg']) {
  const { data, info } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const clamped = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  const det = detectPixelGrid(clamped, info.width, info.height);
  console.log(img, '->', det ? `cell=${det.cell} cols=${det.cols} rows=${det.rows} conf=${det.confidence}` : 'null (拒绝)');
}
await vite.close();
