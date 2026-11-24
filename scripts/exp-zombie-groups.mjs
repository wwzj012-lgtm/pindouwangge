// 每个亮色映射组抽 3 格，拼图读印字
import { createServer } from 'vite';
import sharp from 'sharp';
const IMG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-22T09-39-58-552Z-fe2f92b2.jpg';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImageAsync } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { estimateBeadPitch, refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const est = estimateBeadPitch(source);
let cal = { originX: est.originTrustedX ? est.originX : 0, originY: est.originTrustedY ? est.originY : 0, cellWidth: est.cell, cellHeight: est.cell, columns: Math.min(est.columns, Math.floor((source.width - est.originX) / est.cell)), rows: Math.min(est.rows, Math.floor((source.height - est.originY) / est.cell)) };
const ref = refineGridAlignment(source, cal);
if (ref.applied) cal = { ...cal, cellWidth: ref.cell, cellHeight: ref.cell, originX: ref.originX, originY: ref.originY };
const result = await recognizeImportImageAsync(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { symbolAssist: true, batchSize: 256 });
const groups = new Map();
for (const row of result.cells.slice(0, 66)) for (const cell of row) {
  if (cell.status !== 'mapped') continue;
  if (!['H2','H9','H11','H3','H1','H17'].includes(cell.color.code)) continue;
  const list = groups.get(cell.color.code) ?? [];
  list.push(cell);
  groups.set(cell.color.code, list);
}
// 每组抽：最高 conf 的 2 格 + 中位 sampleRgb 的 1 格
const picks = [];
for (const [code, list] of groups) {
  list.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const mid = [...list].sort((a, b) => {
    const la = a.sampleRgb ? a.sampleRgb[0] : 0, lb = b.sampleRgb ? b.sampleRgb[0] : 0;
    return la - lb;
  })[Math.floor(list.length / 2)];
  picks.push(...list.slice(0, 2), mid);
}
console.log('group sizes:', [...groups.entries()].map(([c, l]) => `${c}:${l.length}`).join(' '));
const tiles = [];
for (const cell of picks) {
  const cx = Math.round(cal.originX + (cell.column + 0.5) * cal.cellWidth);
  const cy = Math.round(cal.originY + (cell.row + 0.5) * cal.cellHeight);
  const buf = await sharp(IMG).extract({ left: Math.max(0, cx - 7), top: Math.max(0, cy - 7), width: 14, height: 14 })
    .resize({ width: 150, height: 150, kernel: 'lanczos3' }).normalise({ lower: 55, upper: 95 }).png().toBuffer();
  tiles.push(buf);
}
const composite = tiles.map((t, i) => ({ input: t, left: i * 156 + 3, top: 3 }));
await sharp({ create: { width: tiles.length * 156 + 6, height: 156, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite(composite).png().toFile('C:/Users/Plout/Desktop/pindouwangge/zombie-group-read.png');
console.log('order:', picks.map(c => `${c.color.code}(${c.row},${c.column})`).join(' '));
await vite.close(); process.exit(0);
