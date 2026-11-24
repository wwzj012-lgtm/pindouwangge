// 发丝区：原图格 L* 直方图 vs 识别色号 L* 直方图
import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { preparePaletteLab, rgbToLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const { data, info } = await sharp('C:/Users/Plout/Pictures/12.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const CELL = 8.8, OX = -0.375, OY = -0.25;
const cal = { originX: OX * CELL, originY: OY * CELL, cellWidth: CELL, cellHeight: CELL, columns: Math.floor((source.width - OX*CELL)/CELL), rows: Math.floor((source.height - OY*CELL)/CELL) };
const base = { mode: 'precision', beadPhoto: true, autoColorBalance: true, autoAlign: true, edgeInsetRatio: 0.1 };
const res = recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, base);
const pal = preparePaletteLab(BRAND_PALETTES.MARD);
const labOf = new Map(pal.map(p => [p.color.id, p.lab]));
const ch = info.channels;
const srcH = new Array(10).fill(0), palH = new Array(10).fill(0);
for (let r = 43; r <= 78; r++) for (let c = 0; c <= 46; c++) {
  const cell = res.cells[r][c]; if (!cell.colorId || !cell.sampleRgb) continue;
  const x0 = Math.max(0, Math.round(OX * CELL + c * CELL)), x1 = Math.min(source.width, Math.round(OX * CELL + (c+1) * CELL));
  const y0 = Math.max(0, Math.round(OY * CELL + r * CELL)), y1 = Math.min(source.height, Math.round(OY * CELL + (r+1) * CELL));
  let pr=0, pg=0, pb=0, n=0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * source.width + x) * ch; pr+=data[i]; pg+=data[i+1]; pb+=data[i+2]; n++; }
  const sL = rgbToLab(pr/n, pg/n, pb/n)[0];
  const pL = labOf.get(cell.colorId)[0];
  srcH[Math.min(9, Math.floor(sL/10))]++; palH[Math.min(9, Math.floor(pL/10))]++;
}
console.log('L*桶  原图格数  识别格数');
for (let i = 0; i < 10; i++) console.log(`${i*10}-${i*10+9}   ${String(srcH[i]).padStart(5)}    ${String(palH[i]).padStart(5)}`);
await vite.close();
