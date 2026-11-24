// 增益上限 A/B：当前 1.25 vs 模拟 clamp。通过 monkey-patch estimateChannelGains 不便，直接比较
// 方案：手动构造 gains 覆盖 context —— 用 recognizeImportImage 无法注入，改为临时改 importColorBalance 的钳制
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
console.log('gains:', JSON.stringify(res.autoCorrection?.colorGains));
const pal = preparePaletteLab(BRAND_PALETTES.MARD);
const labOf = new Map(pal.map(p => [p.color.id, p.lab]));
const ch = info.channels;
const stat = (res, tag) => {
  // 发丝区中间调 ΔE + 脸区异常数 + 手区
  let midDE = [], faceBad = 0;
  const labOfE = labOf;
  const R0=43, R1=78, C0=0, C1=46;
  const FR0=34, FR1=91, FC0=57, FC1=100;
  const grid = [];
  for (let r = 0; r < cal.rows; r++) { grid.push([]); for (let c = 0; c < cal.columns; c++) grid[r].push(res.cells[r][c]); }
  for (let r = R0; r <= R1; r++) for (let c = C0; c <= C1; c++) {
    const cell = res.cells[r][c]; if (!cell.colorId || !cell.sampleRgb) continue;
    const x0 = Math.max(0, Math.round(OX * CELL + c * CELL)), x1 = Math.min(source.width, Math.round(OX * CELL + (c+1) * CELL));
    const y0 = Math.max(0, Math.round(OY * CELL + r * CELL)), y1 = Math.min(source.height, Math.round(OY * CELL + (r+1) * CELL));
    let pr=0, pg=0, pb=0, n=0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * source.width + x) * ch; pr+=data[i]; pg+=data[i+1]; pb+=data[i+2]; n++; }
    const srcLab = rgbToLab(pr/n, pg/n, pb/n);
    const sL = srcLab[0];
    if (sL >= 30 && sL < 60) midDE.push(deltaE2000(srcLab, labOfE.get(cell.colorId)));
  }
  for (let r = FR0; r <= FR1; r++) for (let c = FC0; c <= FC1; c++) {
    const id = res.cells[r][c].colorId; if (!id) continue;
    const lab = labOfE.get(id); if (!lab) continue;
    const neigh = [];
    for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) {
      if (!dr && !dc) continue; const rr=r+dr, cc=c+dc;
      if (rr<0||cc<0||rr>=cal.rows||cc>=cal.columns) continue;
      const nid = res.cells[rr][cc].colorId; if (nid && labOfE.get(nid)) neigh.push(labOfE.get(nid));
    }
    if (neigh.length < 5) continue;
    let best=null, bs=1e9;
    for (const a of neigh) { let s=0; for (const b of neigh) s += deltaE2000(a,b); if (s<bs){bs=s;best=a;} }
    if (deltaE2000(lab, best) > 18) faceBad++;
  }
  console.log(`${tag}: 发丝中间调ΔE=${(midDE.reduce((x,y)=>x+y,0)/midDE.length).toFixed(2)} (n=${midDE.length}) 脸区异常=${faceBad} lowConf=${res.summary.lowConfidence}`);
};
stat(res, '当前增益1.25');
await vite.close();
