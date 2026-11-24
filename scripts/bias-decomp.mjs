// 明度偏差分解：sample L* − 原图整格 L*（采样环节） 与 色号 L* − sample L*（色板环节）
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
// 全图统计（发丝区 + 脸区 + 整图）
const zones = { 发丝区: [43,78,0,46], 整图: [0, cal.rows-1, 0, cal.columns-1] };
for (const [name, [R0, R1, C0, C1]] of Object.entries(zones)) {
  const sampleBias = [], paletteBias = [];
  for (let r = R0; r <= R1; r++) for (let c = C0; c <= C1; c++) {
    const cell = res.cells[r][c]; if (!cell.colorId || !cell.sampleRgb) continue;
    const x0 = Math.max(0, Math.round(OX * CELL + c * CELL)), x1 = Math.min(source.width, Math.round(OX * CELL + (c+1) * CELL));
    const y0 = Math.max(0, Math.round(OY * CELL + r * CELL)), y1 = Math.min(source.height, Math.round(OY * CELL + (r+1) * CELL));
    let pr=0, pg=0, pb=0, n=0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * source.width + x) * ch; pr+=data[i]; pg+=data[i+1]; pb+=data[i+2]; n++; }
    const srcL = rgbToLab(pr/n, pg/n, pb/n)[0];
    const smpL = rgbToLab(cell.sampleRgb[0], cell.sampleRgb[1], cell.sampleRgb[2])[0];
    const palL = labOf.get(cell.colorId)[0];
    sampleBias.push(smpL - srcL);
    paletteBias.push(palL - smpL);
  }
  const avg = (a) => a.reduce((x,y)=>x+y,0)/a.length;
  const dark = sampleBias.length;
  // 暗格（原图 L*<50）单独看
  console.log(`${name}: n=${dark} | 采样偏差 sample−src = ${avg(sampleBias).toFixed(2)} | 色板偏差 pal−sample = ${avg(paletteBias).toFixed(2)} | 总偏差 ${ (avg(sampleBias)+avg(paletteBias)).toFixed(2) }`);
}
// 暗格子群
{
  const [R0, R1, C0, C1] = zones.发丝区;
  const sB = [], pB = [];
  for (let r = R0; r <= R1; r++) for (let c = C0; c <= C1; c++) {
    const cell = res.cells[r][c]; if (!cell.colorId || !cell.sampleRgb) continue;
    const x0 = Math.max(0, Math.round(OX * CELL + c * CELL)), x1 = Math.min(source.width, Math.round(OX * CELL + (c+1) * CELL));
    const y0 = Math.max(0, Math.round(OY * CELL + r * CELL)), y1 = Math.min(source.height, Math.round(OY * CELL + (r+1) * CELL));
    let pr=0, pg=0, pb=0, n=0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * source.width + x) * ch; pr+=data[i]; pg+=data[i+1]; pb+=data[i+2]; n++; }
    const srcLab = rgbToLab(pr/n, pg/n, pb/n);
    if (srcLab[0] >= 50) continue;
    const smpL = rgbToLab(cell.sampleRgb[0], cell.sampleRgb[1], cell.sampleRgb[2])[0];
    sB.push(smpL - srcLab[0]);
    pB.push(labOf.get(cell.colorId)[0] - smpL);
  }
  const avg = (a) => a.reduce((x,y)=>x+y,0)/a.length;
  console.log(`发丝区暗格(L*<50): n=${sB.length} | 采样偏差 ${avg(sB).toFixed(2)} | 色板偏差 ${avg(pB).toFixed(2)} | 总 ${(avg(sB)+avg(pB)).toFixed(2)}`);
}
// MARD 色板在蓝灰区的覆盖：b*-10~-40, L* 20-75 各 5 段的色号数
const holes = {};
for (const p of pal) { if (p.lab[2] < -5) { const b = Math.floor(p.lab[0] / 5) * 5; holes[b] = (holes[b] ?? 0) + 1; } }
console.log('MARD 蓝调色号按 L* 分布:', Object.entries(holes).sort((a,b)=>a[0]-b[0]).map(([k,v])=>`L*${k}:${v}`).join(' '));
await vite.close();
