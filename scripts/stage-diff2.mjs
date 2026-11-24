import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp('C:/Users/Plout/Pictures/12.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const CELL = 8.8, OX = -0.375, OY = -0.125;
const cal = { originX: OX * CELL, originY: OY * CELL, cellWidth: CELL, cellHeight: CELL, columns: Math.floor((source.width - OX*CELL)/CELL), rows: Math.floor((source.height - OY*CELL)/CELL) };
const base = { mode: 'precision', beadPhoto: true, autoColorBalance: true, autoAlign: true, edgeInsetRatio: 0.1 };
const run = (extra) => recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { ...base, ...extra });
const s1 = run({ shadingReference: true, smooth: false, unifyTwins: false });
const s2 = run({ shadingReference: true, smooth: true, unifyTwins: false });
const s2b = run({ shadingReference: true, smooth: true, unifyTwins: false });
console.log('s1 smoothing:', JSON.stringify(s1.smoothing), 'refine:', JSON.stringify(s1.shadingRefine), 'lowConf:', s1.summary.lowConfidence);
console.log('s2 smoothing:', JSON.stringify(s2.smoothing), 'refine:', JSON.stringify(s2.shadingRefine), 'lowConf:', s2.summary.lowConfidence);
console.log('s2b smoothing:', JSON.stringify(s2b.smoothing), 'lowConf:', s2b.summary.lowConfidence);
const diff = (A, B, tag) => {
  let n = 0; const m = new Map();
  for (let row = 0; row < cal.rows; row++) for (let col = 0; col < cal.columns; col++) {
    const a = A.cells[row][col], b = B.cells[row][col];
    if (a.colorId !== b.colorId) { n++; const k = `${a.colorId?.replace('MARD_','')}→${b.colorId?.replace('MARD_','')}`; m.set(k, (m.get(k) ?? 0) + 1); }
  }
  console.log(`${tag}: ${n} 格 | top: ${[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,c])=>`${k}:${c}`).join(' ')}`);
};
diff(s1, s2, 's1→s2');
diff(s2, s2b, 's2→s2b (同参数重跑)');
diff(s1, s2b, 's1→s2b');
await vite.close();
