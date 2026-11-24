// 脸部区域噪点追踪：纯采样 → +refine → +smooth → +twin，找出"邻域浅色但我深色"的噪点格及其来源阶段
import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { deltaE2000 } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const { data, info } = await sharp('C:/Users/Plout/Pictures/12.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const CELL = 8.8, OX = -0.375, OY = -0.25;
const cal = { originX: OX * CELL, originY: OY * CELL, cellWidth: CELL, cellHeight: CELL, columns: Math.floor((source.width - OX*CELL)/CELL), rows: Math.floor((source.height - OY*CELL)/CELL) };
const base = { mode: 'precision', beadPhoto: true, autoColorBalance: true, autoAlign: true, edgeInsetRatio: 0.1 };
const run = (extra) => recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { ...base, ...extra });
const s0 = run({ shadingReference: false, smooth: false, unifyTwins: false });
const s1 = run({ shadingReference: true,  smooth: false, unifyTwins: false });
const s2 = run({ shadingReference: true,  smooth: true,  unifyTwins: false });
const s3 = run({ shadingReference: true,  smooth: true,  unifyTwins: true  });

// 脸部区域 rows 34-91, cols 57-100
const R0=34, R1=91, C0=57, C1=100;
// 噪点定义：格子的最终色是"深色系"（明度 L<55），但它的 8 邻居中 ≥5 格是浅色（L>70）
const { preparePaletteLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const pal = preparePaletteLab(BRAND_PALETTES.MARD);
const labOf = new Map(pal.map(p => [p.color.id, p.lab]));
const L = (id) => { const l = labOf.get(id); return l ? l[0] : 50; };
const noisers = [];
for (let r = R0; r <= R1; r++) for (let c = C0; c <= C1; c++) {
  const id = s3.cells[r][c].colorId;
  if (!id || L(id) >= 55) continue;
  let lightN = 0, n = 0;
  for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) {
    if (!dr && !dc) continue;
    const rr=r+dr, cc=c+dc; if (rr<0||cc<0||rr>=cal.rows||cc>=cal.columns) continue;
    n++; if (s3.cells[rr][cc].colorId && L(s3.cells[rr][cc].colorId) > 70) lightN++;
  }
  if (lightN / n >= 5/8) noisers.push([r,c]);
}
console.log(`脸部区域噪点格（深色但≥5/8邻居浅色）: ${noisers.length} 格`);
const stageOf = (r,c) => {
  const a=s0.cells[r][c].colorId?.replace('MARD_',''), b=s1.cells[r][c].colorId?.replace('MARD_',''), d=s2.cells[r][c].colorId?.replace('MARD_',''), e=s3.cells[r][c].colorId?.replace('MARD_',' ');
  if (L('MARD_'+a.trim()) < 55) return `采样即深(${a})`;
  if (L('MARD_'+b.trim()) < 55) return `refine拉深(${a}→${b})`;
  if (L('MARD_'+d.trim()) < 55) return `smooth改深(${b}→${d})`;
  return `twin改深(${d}→${e.trim()})`;
};
const from = new Map();
for (const [r,c] of noisers) { const s = stageOf(r,c); from.set(s, (from.get(s)??0)+1); }
console.log('来源分布:', [...from.entries()].map(([k,n])=>`${k}:${n}`).join(' | '));
// 展示 10 个典型噪点格的完整轨迹
for (const [r,c] of noisers.slice(0, 10)) {
  const show = (tag, cell) => console.log(`    ${tag}: ${cell.colorId?.replace('MARD_','')} dom=${cell.dominantRatio?.toFixed(2)} dist=${cell.distance?.toFixed(1)} run=${cell.runnerUpColorId?.replace('MARD_','')}:${cell.runnerUpRatio?.toFixed(2)} sample=(${cell.sampleRgb?.join(',')})`);
  console.log(`格(${r},${c}) ${stageOf(r,c)}:`);
  show('采样', s0.cells[r][c]); show('refine', s1.cells[r][c]); show('smooth', s2.cells[r][c]);
}
await vite.close();
