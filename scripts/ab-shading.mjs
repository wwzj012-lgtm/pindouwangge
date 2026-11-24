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
const base = { mode: 'precision', beadPhoto: true, autoColorBalance: true, autoAlign: true, unifyTwins: true, smooth: true, edgeInsetRatio: 0.1 };
const pairs = [[5,81],[9,78],[2,57]];
for (const shading of [false, true]) {
  const opts = { ...base, shadingReference: shading };
  const r = recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, opts);
  console.log(`--- shadingReference=${shading} | shadingRefine=${JSON.stringify(r.shadingRefine)} | lowConf=${r.summary.lowConfidence} meanConf=${r.summary.meanConfidence?.toFixed(3)}`);
  for (const [row, col] of pairs) {
    const c = r.cells[row][col];
    console.log(`  (${row},${col}) ${c.colorId} ${c.color?.hex} dom=${c.dominantRatio?.toFixed(3)} run=${c.runnerUpRatio?.toFixed(3)}(${c.runnerUpColorId}) dist=${c.distance?.toFixed(1)} sample=(${c.sampleRgb?.join(',')})`);
  }
}
await vite.close();
