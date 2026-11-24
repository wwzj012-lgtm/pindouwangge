import { createServer } from 'vite';
import sharp from 'sharp';
const IMG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-22T09-39-58-552Z-fe2f92b2.jpg';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { estimateBeadPitch, refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const est = await (async () => { const m = await import('sharp'); return null; })();
const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const e = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const est2 = e.estimateBeadPitch(source);
let cal = { originX: est2.originTrustedX ? est2.originX : 0, originY: est2.originTrustedY ? est2.originY : 0, cellWidth: est2.cell, cellHeight: est2.cell, columns: est2.columns, rows: est2.rows };
const ref = e.refineGridAlignment(source, cal);
if (ref.applied) cal = { ...cal, cellWidth: ref.cell, cellHeight: ref.cell, originX: ref.originX, originY: ref.originY };
const cells = [[30,28,'A'],[32,26,'B'],[33,25,'C'],[34,24,'D'],[43,26,'E'],[44,16,'F'],[35,22,'G'],[37,19,'H'],[42,26,'I'],[37,28,'J'],[27,2,'K'],[12,13,'L']];
const tiles = [];
for (const [r, c] of cells) {
  const cx = Math.round(cal.originX + (c + 0.5) * cal.cellWidth);
  const cy = Math.round(cal.originY + (r + 0.5) * cal.cellHeight);
  const buf = await sharp(IMG).extract({ left: cx - 7, top: cy - 7, width: 14, height: 14 })
    .resize({ width: 190, height: 190, kernel: 'lanczos3' })
    .normalise({ lower: 55, upper: 95 })
    .png().toBuffer();
  tiles.push(buf);
}
const composite = tiles.map((t, i) => ({ input: t, left: i * 196 + 3, top: 3 }));
await sharp({ create: { width: tiles.length * 196 + 6, height: 196, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite(composite).png().toFile('C:/Users/Plout/Desktop/pindouwangge/zombie-graytext.png');
console.log('order:', cells.map(c => `${c[2]}(${c[0]},${c[1]})`).join(' '));
await vite.close(); process.exit(0);
