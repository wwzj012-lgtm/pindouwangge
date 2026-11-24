import sharp from 'sharp';
const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-09T04-29-31-478Z-f7362be0.jpg';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const { createServer } = await import('vite');
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const m = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const est = m.estimateBeadPitch(source);
console.log('估算:', JSON.stringify(est, null, 1));
if (m.debugPitchAxis) {
  const dbg = m.debugPitchAxis(source);
  console.log('debug:', JSON.stringify(dbg, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v).slice(0, 2000));
}
await vite.close();
