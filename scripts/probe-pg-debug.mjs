import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { detectPixelGrid } = await vite.ssrLoadModule('/scripts/_pixelGridDebug.ts');
const { data, info } = await sharp('benchmark/images/spongebob-patrick.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const clamped = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
const det = detectPixelGrid(clamped, info.width, info.height);
console.log('RESULT:', det ? `cell=${det.cell} cols=${det.cols} rows=${det.rows} conf=${det.confidence}` : 'null');
await vite.close();
