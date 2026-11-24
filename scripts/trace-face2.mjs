// 更宽定义：异常格 = 最终色与 8 邻居众数 ΔE>18（脸頬区域），来源阶段 + 数量统计
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
const run = (extra) => recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { ...base, ...extra });
const stages = [
  ['采样', run({ shadingReference: false, smooth: false, unifyTwins: false })],
  ['refine', run({ shadingReference: true, smooth: false, unifyTwins: false })],
  ['smooth', run({ shadingReference: true, smooth: true, unifyTwins: false })],
  ['twin', run({ shadingReference: true, smooth: true, unifyTwins: true })],
];
const pal = preparePaletteLab(BRAND_PALETTES.MARD);
const labOf = new Map(pal.map(p => [p.color.id, p.lab]));
const R0=34, R1=91, C0=57, C1=100;
const anomaly = (cells) => {
  const list = [];
  for (let r = R0; r <= R1; r++) for (let c = C0; c <= C1; c++) {
    const id = cells[r][c].colorId; if (!id) continue;
    const lab = labOf.get(id); if (!lab) continue;
    const neigh = [];
    for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) {
      if (!dr && !dc) continue; const rr=r+dr, cc=c+dc;
      if (rr<0||cc<0||rr>=cal.rows||cc>=cal.columns) continue;
      const nid = cells[rr][cc].colorId; if (nid && labOf.get(nid)) neigh.push(labOf.get(nid));
    }
    if (neigh.length < 5) continue;
    // 众数色 = 与其他邻居平均 ΔE 最小的
    let best=null, bestSum=1e9;
    for (const a of neigh) { let s=0; for (const b of neigh) s += deltaE2000(a,b); if (s<bestSum) {bestSum=s; best=a;} }
    if (deltaE2000(lab, best) > 18) list.push([r,c]);
  }
  return list;
};
const lists = stages.map(([tag, r]) => [tag, anomaly(r.cells)]);
for (const [tag, l] of lists) console.log(`${tag}: 异常格 ${l.length}`);
// 每个最终异常格的来源
const [,, , , fin] = stages;
const srcMap = new Map(lists[0][1].map(([r,c]) => [`${r},${c}`, 1]));
const refMap = new Map(lists[1][1].map(([r,c]) => [`${r},${c}`, 1]));
const smoMap = new Map(lists[2][1].map(([r,c]) => [`${r},${c}`, 1]));
const finale = lists[3][1];
const stage = ([r,c]) => srcMap.has(`${r},${c}`) ? '采样' : refMap.has(`${r},${c}`) ? 'refine' : smoMap.has(`${r},${c}`) ? 'smooth' : 'twin';
const dist = new Map();
for (const k of finale.map(stage)) dist.set(k, (dist.get(k)??0)+1);
console.log('最终异常格来源:', [...dist.entries()].map(([k,n])=>`${k}:${n}`).join(' | '));
// 标注到 grid 上：红框标异常格
const GS = 4;
const rects = finale.map(([r,c]) => `<rect x="${c*GS}" y="${r*GS}" width="${GS}" height="${GS}" fill="none" stroke="red" stroke-width="1.2"/>`).join('');
const W = cal.columns*GS, H = cal.rows*GS;
const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect x="${C0*GS}" y="${R0*GS}" width="${(C1-C0)*GS}" height="${(R1-R0)*GS}" fill="none" stroke="yellow" stroke-width="2"/>${rects}</svg>`;
const grid = await sharp('C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import/v5_grid.png');
const meta = await grid.metadata();
await sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: {r:0,g:0,b:0} } })
  .composite([{ input: await grid.png().toBuffer(), left: 0, top: 0 }, { input: Buffer.from(svg), left: 0, top: 0 }])
  .png().toFile('C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import/face_anomaly.png');
console.log(`-> face_anomaly.png (红框=最终异常格 ${finale.length}, 黄框=脸部区域)`);
// 列出来源为 refine/smooth/twin 的格子（采样没判出来的才是新伤害）
console.log('\n采样阶段没判异常但后来变异常的格子:');
for (const [r,c] of finale) {
  if (stage([r,c]) !== '采样') {
    const s0c = stages[0][1].cells[r][c], f = fin.cells[r][c];
    console.log(`  (${r},${c}) ${stage([r,c])}: 采样=${s0c.colorId?.replace('MARD_','')} dom=${s0c.dominantRatio?.toFixed(2)} → 最终=${f.colorId?.replace('MARD_','')}`);
  }
}
await vite.close();
