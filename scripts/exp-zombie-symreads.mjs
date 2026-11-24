// 亮色格：颜色映射组 × 符号OCR读数 交叉表
import { createServer } from 'vite';
import sharp from 'sharp';
const IMG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-22T09-39-58-552Z-fe2f92b2.jpg';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const SO = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
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
const sym = SO.extractBeadSymbols(source, cal, BRAND_PALETTES.MARD);
const cross = new Map(); // colorCode -> Map(symCode -> n)
for (const row of result.cells.slice(0, 66)) for (const cell of row) {
  if (cell.status !== 'mapped') continue;
  if (!['H2','H9','H11','H3','H1','H17','H5','H6','H7'].includes(cell.color.code)) continue;
  const s = sym.codes.get(`${cell.row}:${cell.column}`);
  const inner = cross.get(cell.color.code) ?? new Map();
  const key = s ? s.code : '(unread)';
  inner.set(key, (inner.get(key) ?? 0) + 1);
  cross.set(cell.color.code, inner);
}
for (const [cc, inner] of cross) {
  console.log(`${cc} ←`, [...inner.entries()].sort((a,b)=>b[1]-a[1]).map(([c,n])=>`${c}:${n}`).join(' '));
}
await vite.close(); process.exit(0);
