// 找采样色接近 H5 的格子映射到了哪
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
const H5 = [72, 70, 78];
const near = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
const flow = new Map();
const examples = [];
for (const [ri, row] of result.cells.entries()) {
  if (ri >= 66) continue;
  for (const cell of row) {
    if (cell.status === 'blank') continue;
    const [sr, sg, sb] = cell.sampleRgb ?? [255,255,255];
    const lum = 0.299*sr + 0.587*sg + 0.114*sb;
    if (lum > 85 && lum < 175) {
      const key = cell.status === 'mapped' ? cell.color.code : cell.status;
      flow.set(key, (flow.get(key) ?? 0) + 1);
      if (examples.length < 10 && cell.status === 'mapped') examples.push(cell);
    }
  }
}
console.log('mid-lum flow:', [...flow.entries()].sort((a,b)=>b[1]-a[1]).map(([c,n])=>`${c}:${n}`).join(' '));
for (const c of examples) {
  console.log(`(${c.row},${c.column}) -> ${c.color.code} sampleRgb=(${(c.sampleRgb??[]).map(v=>Math.round(v)).join(',')}) dist=${c.distance?.toFixed(1)} conf=${c.confidence?.toFixed(2)} cov=${c.coverage?.toFixed(2)} domRatio=${c.dominantRatio?.toFixed(2)}`);
}
// H2 格子的 sampleRgb 分布（检查白豆格采样是否被文字污染偏灰）
const h2cells = [];
for (const row of result.cells.slice(0, 66)) for (const c of row) if (c.status === 'mapped' && c.color.code === 'H2') h2cells.push(c);
const lums = h2cells.map(c => { const [r,g,b] = c.sampleRgb ?? [255,255,255]; return Math.round(0.299*r+0.587*g+0.114*b); }).sort((a,b)=>a-b);
console.log('H2 sampleRgb lum p10/p50/p90:', lums[Math.floor(lums.length*0.1)], lums[Math.floor(lums.length*0.5)], lums[Math.floor(lums.length*0.9)]);
await vite.close(); process.exit(0);
