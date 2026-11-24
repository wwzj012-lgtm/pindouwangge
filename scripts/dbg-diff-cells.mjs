// 诊断典型错格：sampleRgb、distance、邻格、色板色
import { createServer } from 'vite';
import sharp from 'sharp';

const ORIG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const ROOT = 'D:/Build_Apps/pindouwangge';
const vite = await createServer({ root: ROOT, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: ROOT + '/vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const P = BRAND_PALETTES.MARD;
const byCode = Object.fromEntries(P.map(c => [c.code, c]));

const { data, info } = await sharp(ORIG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const cal = { originX: 0, originY: 0, cellWidth: 29.6, cellHeight: 29.54, columns: 52, rows: 52 };
const r = recognizeImportImage(source, cal, P, 'precision', undefined, { mode: 'precision', edgeInsetRatio: 0.1, symbolAssist: true });

const show = (r1, c1) => {
  const rr = r1 - 1, cc = c1 - 1;
  const cell = r.cells[rr][cc];
  console.log(`r${r1}c${c1}: id=${cell.colorId} dist=${cell.distance?.toFixed(1)} sampleRgb=${JSON.stringify(cell.sampleRgb)} dominant=${cell.dominantRatio?.toFixed(2)} coverage=${cell.coverage?.toFixed(0)}`);
  console.log(`   色板: ${cell.colorId} rgb=${JSON.stringify(byCode[cell.colorId]?.rgb)}`);
  // 3x3 邻域
  const grid = [];
  for (let dr = -1; dr <= 1; dr++) {
    const row = [];
    for (let dc = -1; dc <= 1; dc++) row.push(r.cells[rr + dr]?.[cc + dc]?.colorId ?? '-');
    grid.push(row.join(' '));
  }
  console.log('   邻域:\n     ' + grid.join('\n     '));
};
console.log('== H2 白底格错判 H9 ==');
show(3, 30); show(4, 12); show(7, 14);
console.log('== G16 错判 M4 ==');
show(9, 16); show(9, 25);
console.log('== 色板参考 ==');
for (const c of ['H1', 'H2', 'H9', 'H17', 'G16', 'G18', 'M4', 'G9']) console.log(`  ${c}: rgb=${JSON.stringify(byCode[c]?.rgb)}`);
await vite.close();
