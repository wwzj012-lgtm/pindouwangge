import { createServer } from 'vite';
import sharp from 'sharp';
const root = process.cwd();
const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp('C:/Users/Plout/Pictures/12.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const CELL = 8.8, OX = -0.375, OY = -0.125;
const cal = { originX: OX * CELL, originY: OY * CELL, cellWidth: CELL, cellHeight: CELL, columns: Math.floor((source.width - OX*CELL)/CELL), rows: Math.floor((source.height - OY*CELL)/CELL) };
const base = { mode: 'precision', beadPhoto: true, autoColorBalance: true, autoAlign: true, edgeInsetRatio: 0.1 };
const run = (extra) => recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { ...base, ...extra });

const s0 = run({ shadingReference: false, smooth: false, unifyTwins: false }); // 纯采样
const s1 = run({ shadingReference: true, smooth: false, unifyTwins: false });  // +shading
const s2 = run({ shadingReference: true, smooth: true, unifyTwins: false });   // +smooth
const s3 = run({ shadingReference: true, smooth: true, unifyTwins: true });    // +twin 全开

const diff = (A, B, tag) => {
  const m = new Map();
  for (let row = 0; row < cal.rows; row++) for (let col = 0; col < cal.columns; col++) {
    const a = A.cells[row][col], b = B.cells[row][col];
    if (a.colorId !== b.colorId) { const k = `${a.colorId?.replace('MARD_','')}→${b.colorId?.replace('MARD_','')}`; m.set(k, (m.get(k) ?? 0) + 1); }
  }
  const top = [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10).map(([k,n])=>`${k}:${n}`).join(' ');
  console.log(`${tag}: ${[...m.values()].reduce((x,y)=>x+y,0)} 格 | top: ${top}`);
};
diff(s0, s1, '①shading ');
diff(s1, s2, '②smooth  ');
diff(s2, s3, '③twin    ');
const zone = (cells, r0, r1, c0, c1) => {
  const m = new Map();
  for (let r = r0; r <= Math.min(r1, cal.rows - 1); r++) for (let c = c0; c <= Math.min(c1, cal.columns - 1); c++) { const id = cells.cells[r][c].colorId?.replace('MARD_','') ?? 'null'; m.set(id, (m.get(id) ?? 0) + 1); }
  return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,n])=>`${k}:${n}`).join(' ');
};
console.log(`\n左下衣服区 (r88-118,c30-60):`);
console.log('  纯采样:', zone(s0, 88, 118, 30, 60));
console.log('  全开  :', zone(s3, 88, 118, 30, 60));
console.log('左上暗发区 (r15-70,c0-40):');
console.log('  纯采样:', zone(s0, 15, 70, 0, 40));
console.log('  全开  :', zone(s3, 15, 70, 0, 40));
console.log('手部 (r0-22,c75-102):');
console.log('  纯采样:', zone(s0, 0, 22, 75, 102));
console.log('  全开  :', zone(s3, 0, 22, 75, 102));
await vite.close();
