// 识别速度分段剖析：妲己图 52x52
import { createServer } from 'vite';
import sharp from 'sharp';

const ORIG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const ROOT = 'D:/Build_Apps/pindouwangge';

const vite = await createServer({ root: ROOT, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: ROOT + '/vite.config.ts' });
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const PALETTE = BRAND_PALETTES.MARD;
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { extractBeadSymbols } = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');

const { data, info } = await sharp(ORIG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const estRows = Math.round(info.height / 29.54);
const cal = { originX: 0, originY: 0, cellWidth: 29.6, cellHeight: 29.54, columns: 52, rows: estRows };
console.log(`图 ${info.width}x${info.height}, 网格 ${cal.columns}x${cal.rows} = ${cal.columns * cal.rows} 格`);

const t = () => performance.now();

let t0 = t();
const rPlain = recognizeImportImage(source, cal, PALETTE, 'precision', undefined, { mode: 'precision', edgeInsetRatio: 0.1 });
const tPlain = t() - t0;
console.log(`\n[1] 主管线(无symbolAssist): ${(tPlain / 1000).toFixed(2)}s`);

t0 = t();
const sym = extractBeadSymbols(source, cal, PALETTE);
const tSym = t() - t0;
console.log(`[2] extractBeadSymbols(OCR): ${(tSym / 1000).toFixed(2)}s  (textCells=${sym.textCellCount})`);

t0 = t();
const rAssist = recognizeImportImage(source, cal, PALETTE, 'precision', undefined, { mode: 'precision', edgeInsetRatio: 0.1, symbolAssist: true });
const tAssist = t() - t0;
console.log(`[3] 主管线+symbolAssist: ${(tAssist / 1000).toFixed(2)}s`);

// async 版本（向导实际调用路径，含 setTimeout 让步）
t0 = t();
const rAsync = await recognizeImportImage ? null : null;
console.log(`\n合计: plain ${(tPlain / 1000).toFixed(2)}s + ocr ${(tSym / 1000).toFixed(2)}s ≈ ${((tPlain + tSym) / 1000).toFixed(2)}s`);
await vite.close();
