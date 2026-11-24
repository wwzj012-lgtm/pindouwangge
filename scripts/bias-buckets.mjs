// 按 src L* 分桶：每桶内 sample−src 与 pal−sample 偏差 + ΔE
import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { preparePaletteLab, rgbToLab, deltaE2000 } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const { data, info } = await sharp('C:/Users/Plout/Pictures/12.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const CELL = 8.8, OX = -0.375, OY = -0.25;
const cal = { originX: OX * CELL, originY: OY * CELL, cellWidth: CELL, cellHeight: CELL, columns: Math.floor((source.width - OX*CELL)/CELL), rows: Math.floor((source.height - OY*CELL)/CELL) };
const base = { mode: 'precision', beadPhoto: true, autoColorBalance: true, autoAlign: true, edgeInsetRatio: 0.1 };
const res = recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, base);
const pal = preparePaletteLab(BRAND_PALETTES.MARD);
const labOf = new Map(pal.map(p => [p.color.id, p.lab]));
const ch = info.channels;
const buckets = new Map(); // L*桶 → {sB:[], pB:[], dE:[]}
for (let r = 0; r < cal.rows; r++) for (let c = 0; c < cal.columns; c++) {
  const cell = res.cells[r][c]; if (!cell.colorId || !cell.sampleRgb) continue;
  const x0 = Math.max(0, Math.round(OX * CELL + c * CELL)), x1 = Math.min(source.width, Math.round(OX * CELL + (c+1) * CELL));
  const y0 = Math.max(0, Math.round(OY * CELL + r * CELL)), y1 = Math.min(source.height, Math.round(OY * CELL + (r+1) * CELL));
  let pr=0, pg=0, pb=0, n=0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * source.width + x) * ch; pr+=data[i]; pg+=data[i+1]; pb+=data[i+2]; n++; }
  const srcLab = rgbToLab(pr/n, pg/n, pb/n);
  const smpLab = rgbToLab(cell.sampleRgb[0], cell.sampleRgb[1], cell.sampleRgb[2]);
  const palLab = labOf.get(cell.colorId);
  const b = Math.min(90, Math.max(10, Math.floor(srcLab[0]/10)*10));
  if (!buckets.has(b)) buckets.set(b, { sB: [], pB: [], dE: [], n: 0 });
  const B = buckets.get(b);
  B.sB.push(smpLab[0] - srcLab[0]);
  B.pB.push(palLab[0] - smpLab[0]);
  B.dE.push(deltaE2000(srcLab, palLab));
  B.n++;
}
const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
console.log('srcL* | n    | sample−src | pal−sample | ΔE(src,pal)');
for (const [b, B] of [...buckets.entries()].sort((a,b)=>a[0]-b[0])) {
  console.log(`${String(b).padStart(3)}-${String(b+10).padStart(3)} | ${String(B.n).padStart(4)} | ${avg(B.sB).toFixed(1).padStart(8)} | ${avg(B.pB).toFixed(1).padStart(8)} | ${avg(B.dE).toFixed(1).padStart(6)}`);
}
await vite.close();
