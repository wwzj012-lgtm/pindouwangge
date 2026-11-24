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
const base = await recognizeImportImageAsync(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { batchSize: 256 });
const full = await recognizeImportImageAsync(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { symbolAssist: true, batchSize: 256 });
// 找纯颜色=B25 的格子，看辅助后变成什么
const changes = new Map();
for (let r = 0; r < 66; r++) for (let c = 0; c < full.cells[r].length; c++) {
  const b = base.cells[r][c], f = full.cells[r][c];
  if (b.status !== 'mapped' || f.status !== 'mapped') continue;
  if (b.color.code !== f.color.code) {
    const k = `${b.color.code}->${f.color.code}`;
    changes.set(k, (changes.get(k) ?? 0) + 1);
  }
}
console.log('overrides (colorOnly -> withAssist):');
console.log([...changes.entries()].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k}:${n}`).join(' '));
await vite.close(); process.exit(0);
