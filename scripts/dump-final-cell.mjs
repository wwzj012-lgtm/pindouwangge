// 真实管线单格终态 dump：看指定格子最终判什么色、sampleRgb、以及全程诊断。
// 运行: node scripts/dump-final-cell.mjs <row> <col> [...]
import { createServer } from 'vite';
import sharp from 'sharp';

const root = process.cwd();
const IMG = 'C:/Users/Plout/Pictures/12.jpg';
const CELL = 8.8, OX = -0.375, OY = -0.125;
const TARGETS = process.argv[2] ? process.argv.slice(2).map(Number) : [5, 81, 9, 78, 2, 57];

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const columns = Math.floor((source.width - OX * CELL) / CELL);
const rows = Math.floor((source.height - OY * CELL) / CELL);
const cal = { originX: OX * CELL, originY: OY * CELL, cellWidth: CELL, cellHeight: CELL, columns, rows };
const opts = { mode: 'precision', beadPhoto: true, autoColorBalance: true, autoAlign: true, unifyTwins: true, smooth: true, edgeInsetRatio: 0.1 };
const result = recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, opts);
const pairs = [];
for (let i = 0; i < TARGETS.length; i += 2) pairs.push([TARGETS[i], TARGETS[i + 1]]);
for (const [row, col] of pairs) {
  const c = result.cells[row][col];
  console.log(`(${row},${col}) ${c.status} -> ${c.colorId} ${c.color?.hex} dom=${c.dominantRatio?.toFixed(3)} run=${c.runnerUpRatio?.toFixed(3)}(${c.runnerUpColorId}) sep=${c.runnerUpSeparation?.toFixed(1)} dist=${c.distance?.toFixed(2)} sampleRgb=(${c.sampleRgb?.join(',')}) quality=${c.quality}`);
}
console.log('shadingRefine:', JSON.stringify(result.shadingRefine));
await vite.close();
