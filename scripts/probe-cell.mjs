import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp('C:/Users/Plout/Pictures/12.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const CELL = 8.8, OX = -0.375, OY = -0.125;
const cal = { originX: OX * CELL, originY: OY * CELL, cellWidth: CELL, cellHeight: CELL, columns: Math.floor((source.width - OX*CELL)/CELL), rows: Math.floor((source.height - OY*CELL)/CELL) };
const base = { mode: 'precision', beadPhoto: true, autoColorBalance: true, autoAlign: true, edgeInsetRatio: 0.1 };
const run = (extra) => recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { ...base, ...extra });
const s1 = run({ shadingReference: true, smooth: false, unifyTwins: false });
const s2 = run({ shadingReference: true, smooth: true, unifyTwins: false });
// 找前 8 个 diff 格子
let found = 0;
const show = (tag, c) => console.log(`  ${tag}: ${c.colorId} dom=${c.dominantRatio?.toFixed(3)} dist=${c.distance?.toFixed(2)} sample=(${c.sampleRgb?.join(',')}) q=${c.quality} run=${c.runnerUpRatio?.toFixed(2)}(${c.runnerUpColorId?.replace('MARD_','')})`);
for (let row = 0; row < cal.rows && found < 8; row++) for (let col = 0; col < cal.columns && found < 8; col++) {
  if (s1.cells[row][col].colorId !== s2.cells[row][col].colorId) {
    found++;
    console.log(`格子 (${row},${col}):`);
    show('s1(无smooth)', s1.cells[row][col]);
    show('s2(有smooth)', s2.cells[row][col]);
  }
}
await vite.close();
