// 发丝丢失格统计：原图格平均亮(L>55) 但识别判深(L<40)，对比不同 BEAD_BODY_RADIUS2
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
// 原图格平均明度（简单整格平均）
const ch = info.channels;
const srcL = (r, c) => {
  const x0 = Math.max(0, Math.round(OX * CELL + c * CELL)), x1 = Math.min(source.width, Math.round(OX * CELL + (c+1) * CELL));
  const y0 = Math.max(0, Math.round(OY * CELL + r * CELL)), y1 = Math.min(source.height, Math.round(OY * CELL + (r+1) * CELL));
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * source.width + x) * ch; sum += 0.2126*data[i] + 0.7152*data[i+1] + 0.0722*data[i+2]; n++; }
  return sum / n;
};
const pal = preparePaletteLab(BRAND_PALETTES.MARD);
const labOf = new Map(pal.map(p => [p.color.id, p.lab]));
const R0=43, R1=78, C0=0, C1=46;
const run = async (r2) => {
  const mod = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
  // 动态改常量不便，用不同 preset 不行——直接在这里 import 两次不行。改为外部循环 sed。
  const res = recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, base);
  let lost = 0, gained = 0, total = 0;
  for (let r = R0; r <= R1; r++) for (let c = C0; c <= C1; c++) {
    const cell = res.cells[r][c]; if (!cell.colorId) continue;
    total++;
    const cl = labOf.get(cell.colorId)[0];
    const sl = srcL(r, c);
    if (cl < 40 && sl > 58) { lost++; }
    if (cl > 55 && sl < 42) gained++;
  }
  return { lost, gained, lowConf: res.summary.lowConfidence, meanConf: res.summary.meanConfidence.toFixed(3) };
};
const mode = process.argv[2] ?? 'current';
console.log(`R2=${mode}:`, JSON.stringify(await run()));
await vite.close();
