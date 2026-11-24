// dump 发丝丢失格：采样值、判定、原图像素分布
import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { preparePaletteLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const { data, info } = await sharp('C:/Users/Plout/Pictures/12.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const CELL = 8.8, OX = -0.375, OY = -0.25;
const cal = { originX: OX * CELL, originY: OY * CELL, cellWidth: CELL, cellHeight: CELL, columns: Math.floor((source.width - OX*CELL)/CELL), rows: Math.floor((source.height - OY*CELL)/CELL) };
const base = { mode: 'precision', beadPhoto: true, autoColorBalance: true, autoAlign: true, edgeInsetRatio: 0.1 };
const res = recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, base);
const pal = preparePaletteLab(BRAND_PALETTES.MARD);
const labOf = new Map(pal.map(p => [p.color.id, p.lab]));
const ch = info.channels;
const R0=43, R1=78, C0=0, C1=46;
const lost = [];
for (let r = R0; r <= R1; r++) for (let c = C0; c <= C1; c++) {
  const cell = res.cells[r][c]; if (!cell.colorId) continue;
  const x0 = Math.max(0, Math.round(OX * CELL + c * CELL)), x1 = Math.min(source.width, Math.round(OX * CELL + (c+1) * CELL));
  const y0 = Math.max(0, Math.round(OY * CELL + r * CELL)), y1 = Math.min(source.height, Math.round(OY * CELL + (r+1) * CELL));
  let sum = 0, n = 0, pr = 0, pg = 0, pb = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * source.width + x) * ch; const lum = 0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2]; sum += lum; pr += data[i]; pg += data[i+1]; pb += data[i+2]; n++; }
  const sl = sum / n;
  if (labOf.get(cell.colorId)[0] < 40 && sl > 58) lost.push([r, c, sl, [pr/n|0, pg/n|0, pb/n|0], cell]);
}
console.log(`发丝丢失格: ${lost.length}`);
for (const [r, c, sl, avg, cell] of lost.slice(0, 12)) {
  console.log(`(${r},${c}) 原图均值rgb=(${avg}) L=${sl.toFixed(0)} → 判${cell.colorId.replace('MARD_','')} L=${labOf.get(cell.colorId)[0].toFixed(0)} | sample=(${cell.sampleRgb?.join(',')}) dom=${cell.dominantRatio?.toFixed(2)} dist=${cell.distance?.toFixed(1)} run=${cell.runnerUpColorId?.replace('MARD_','')}:${cell.runnerUpRatio?.toFixed(2)} q=${cell.quality}`);
}
await vite.close();
