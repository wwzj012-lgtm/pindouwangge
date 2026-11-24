import { createServer } from 'vite';
import sharp from 'sharp';
const IMG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-22T09-39-58-552Z-fe2f92b2.jpg';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { estimateBeadPitch, refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const est = estimateBeadPitch(source);
let cal = { originX: est.originTrustedX ? est.originX : 0, originY: est.originTrustedY ? est.originY : 0, cellWidth: est.cell, cellHeight: est.cell, columns: Math.min(est.columns, Math.floor((source.width - est.originX) / est.cell)), rows: Math.min(est.rows, Math.floor((source.height - est.originY) / est.cell)) };
const ref = refineGridAlignment(source, cal);
if (ref.applied) cal = { ...cal, cellWidth: ref.cell, cellHeight: ref.cell, originX: ref.originX, originY: ref.originY };
const cells = [[11,2,'H9'],[30,28,'H11'],[32,26,'H3'],[37,20,'H1'],[37,25,'H17'],[44,22,'H9b'],[43,26,'H11b'],[33,25,'H3b']];
const tiles = [];
for (const [r, c] of cells) {
  const cx = Math.round(cal.originX + (c + 0.5) * cal.cellWidth);
  const cy = Math.round(cal.originY + (r + 0.5) * cal.cellHeight);
  const buf = await sharp(IMG).extract({ left: cx - 7, top: cy - 7, width: 14, height: 14 }).resize({ width: 190, height: 190, kernel: 'lanczos3' }).png().toBuffer();
  tiles.push(buf);
}
// 横向拼
const composite = tiles.map((t, i) => ({ input: t, left: i * 196 + 3, top: 3 }));
await sharp({ create: { width: tiles.length * 196 + 6, height: 196, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite(composite).png().toFile('C:/Users/Plout/Desktop/pindouwangge/zombie-cells-zoom.png');
console.log('order:', cells.map(c => `${c[2]}(${c[0]},${c[1]})`).join(' | '));
await vite.close(); process.exit(0);
