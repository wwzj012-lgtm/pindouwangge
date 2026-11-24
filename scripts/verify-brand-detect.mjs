// 品牌探测验证：妲己图应判 MARD，且各品牌得分拉开
import { createServer } from 'vite';
import sharp from 'sharp';

const ORIG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const ROOT = 'D:/Build_Apps/pindouwangge';

const vite = await createServer({ root: ROOT, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: ROOT + '/vite.config.ts' });
const { BRAND_PALETTES, BRAND_NAMES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { detectPaletteBrand, recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');

const { data, info } = await sharp(ORIG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const estRows = Math.round(info.height / 29.54);
const cal = { originX: 0, originY: 0, cellWidth: 29.6, cellHeight: 29.54, columns: 52, rows: estRows };

let t0 = performance.now();
const det = detectPaletteBrand(source, cal);
const tDet = performance.now() - t0;
console.log(`品牌探测耗时 ${(tDet).toFixed(0)}ms, 采样 ${det.sampled} 格:`);
for (const s of det.scores) console.log(`  ${BRAND_NAMES[s.brand].padEnd(14)} 平均ΔE ${s.meanDistance.toFixed(2)}  (${s.colors} 色)`);
const best = det.scores[0];
console.log(`\n判定: ${best.brand} (${BRAND_NAMES[best.brand]})`);

// 用判定品牌跑识别，测端到端耗时
t0 = performance.now();
const r = recognizeImportImage(source, cal, BRAND_PALETTES[best.brand], 'precision', undefined, { mode: 'precision', edgeInsetRatio: 0.1, symbolAssist: true });
console.log(`品牌内识别耗时 ${((performance.now() - t0) / 1000).toFixed(2)}s, symbolAssist:`, JSON.stringify(r.symbolAssist));
await vite.close();
