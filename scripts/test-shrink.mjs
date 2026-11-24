// 验证串扰假设：异常格用中心收缩窗口重采样，看多少格回到邻域众数色
import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { deltaE2000, preparePaletteLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const { data, info } = await sharp('C:/Users/Plout/Pictures/12.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const CELL = 8.8, OX = -0.375, OY = -0.25;
const cal = { originX: OX * CELL, originY: OY * CELL, cellWidth: CELL, cellHeight: CELL, columns: Math.floor((source.width - OX*CELL)/CELL), rows: Math.floor((source.height - OY*CELL)/CELL) };
const base = { mode: 'precision', beadPhoto: true, autoColorBalance: true, autoAlign: true, edgeInsetRatio: 0.1 };
const rFull = recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, base);
const rShrink = recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { ...base, edgeInsetRatio: 0.3 });
const pal = preparePaletteLab(BRAND_PALETTES.MARD);
const labOf = new Map(pal.map(p => [p.color.id, p.lab]));
const R0=34, R1=91, C0=57, C1=100;
const modeLab = (cells, r, c) => {
  const neigh = [];
  for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) {
    if (!dr && !dc) continue; const rr=r+dr, cc=c+dc;
    if (rr<0||cc<0||rr>=cal.rows||cc>=cal.columns) continue;
    const nid = cells[rr][cc].colorId; if (nid && labOf.get(nid)) neigh.push(labOf.get(nid));
  }
  if (neigh.length < 5) return null;
  let best=null, bs=1e9;
  for (const a of neigh) { let s=0; for (const b of neigh) s += deltaE2000(a,b); if (s<bs){bs=s;best=a;} }
  return best;
};
let fullBad=0, shrinkBad=0, fixed=0, broken=0;
for (let r=R0; r<=R1; r++) for (let c=C0; c<=C1; c++) {
  const nb = modeLab(rFull.cells, r, c); if (!nb) continue;
  const f = rFull.cells[r][c], s = rShrink.cells[r][c];
  const fBad = f.colorId && labOf.get(f.colorId) && deltaE2000(labOf.get(f.colorId), nb) > 18;
  const sBad = s.colorId && labOf.get(s.colorId) && deltaE2000(labOf.get(s.colorId), nb) > 18;
  if (fBad) { fullBad++; if (!sBad) fixed++; else if (sBad && s.colorId !== f.colorId) broken++; }
  if (sBad && !fBad) broken++;
}
console.log(`edgeInset 0.1→0.3: 全窗异常 ${fullBad} → 收缩异常后 fixed=${fixed} broken新增=${broken}`);
console.log(`shrink total异常: ${[...Array(1)].map(()=>{let n=0; for(let r=R0;r<=R1;r++)for(let c=C0;c<=C1;c++){const nb=modeLab(rShrink.cells,r,c); if(nb&&deltaE2000(labOf.get(rShrink.cells[r][c].colorId),nb)>18)n++;} return n;})[0]}`);
// 也试试更收缩 0.45
const rShrink2 = recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { ...base, edgeInsetRatio: 0.45 });
let n2 = 0;
for (let r=R0; r<=R1; r++) for (let c=C0; c<=C1; c++) { const nb = modeLab(rShrink2.cells, r, c); if (nb && rShrink2.cells[r][c].colorId && labOf.get(rShrink2.cells[r][c].colorId) && deltaE2000(labOf.get(rShrink2.cells[r][c].colorId), nb) > 18) n2++; }
console.log(`edgeInset 0.45: 脸区异常 ${n2}`);
console.log(`summary: full=${JSON.stringify(rFull.summary.lowConfidence)}/${rFull.summary.meanConfidence?.toFixed(3)} shrink03=${JSON.stringify(rShrink.summary.lowConfidence)}/${rShrink.summary.meanConfidence?.toFixed(3)} shrink045=${JSON.stringify(rShrink2.summary.lowConfidence)}/${rShrink2.summary.meanConfidence?.toFixed(3)}`);
await vite.close();
