import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp('C:/Users/Plout/Pictures/12.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const CELL = 8.8, OX = -0.375, OY = -0.25;
const cal = { originX: OX * CELL, originY: OY * CELL, cellWidth: CELL, cellHeight: CELL, columns: Math.floor((source.width - OX*CELL)/CELL), rows: Math.floor((source.height - OY*CELL)/CELL) };
const base = { mode: 'precision', beadPhoto: true, autoColorBalance: true, autoAlign: true, edgeInsetRatio: 0.1 };
const r = recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, base);
console.log('autoCorrection:', JSON.stringify(r.autoCorrection, null, 1).slice(0, 600));
// 关闭白平衡对比中间调偏差
const r2 = recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { ...base, autoColorBalance: false });
const { preparePaletteLab, rgbToLab, deltaE2000 } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const pal = preparePaletteLab(BRAND_PALETTES.MARD);
const labOf = new Map(pal.map(p => [p.color.id, p.lab]));
const ch = info.channels;
const stat = (res, tag) => {
  const b30 = [], b60 = [];
  for (let r = 43; r <= 78; r++) for (let c = 0; c <= 46; c++) {
    const cell = res.cells[r][c]; if (!cell.colorId || !cell.sampleRgb) continue;
    const x0 = Math.max(0, Math.round(OX * CELL + c * CELL)), x1 = Math.min(source.width, Math.round(OX * CELL + (c+1) * CELL));
    const y0 = Math.max(0, Math.round(OY * CELL + r * CELL)), y1 = Math.min(source.height, Math.round(OY * CELL + (r+1) * CELL));
    let pr=0, pg=0, pb=0, n=0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * source.width + x) * ch; pr+=data[i]; pg+=data[i+1]; pb+=data[i+2]; n++; }
    const srcL = rgbToLab(pr/n, pg/n, pb/n)[0];
    const smpL = rgbToLab(cell.sampleRgb[0], cell.sampleRgb[1], cell.sampleRgb[2])[0];
    const dE = deltaE2000([srcL, rgbToLab(pr/n,pg/n,pb/n)[1], rgbToLab(pr/n,pg/n,pb/n)[2]], labOf.get(cell.colorId));
    if (srcL >= 30 && srcL < 60) b30.push([smpL - srcL, dE]);
    if (srcL >= 60 && srcL < 80) b60.push([smpL - srcL, dE]);
  }
  const avg = a => a.reduce((x,y)=>x+y,0)/a.length;
  console.log(`${tag}: L30-60 n=${b30.length} 采样偏差=${avg(b30.map(x=>x[0])).toFixed(1)} ΔE=${avg(b30.map(x=>x[1])).toFixed(1)} | L60-80 n=${b60.length} 偏差=${avg(b60.map(x=>x[0])).toFixed(1)} ΔE=${avg(b60.map(x=>x[1])).toFixed(1)}`);
};
stat(r, '增益开');
stat(r2, '增益关');
await vite.close();
