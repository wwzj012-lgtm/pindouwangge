// 僵尸图纸：图纸模式（symbolAssist）识别质量探针
// 量化：自动标定、图例芯片、色号 OCR 命中/冲突、逐色数量 vs 图例真值
import { createServer } from 'vite';
import sharp from 'sharp';

const IMG = process.env.IMG || 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-22T09-39-58-552Z-fe2f92b2.jpg';

const vite = await createServer({
  root: process.cwd(), appType: 'custom',
  server: { middlewareMode: true }, logLevel: 'error',
  optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts',
});
const { parseLegend } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { extractBeadSymbols, diagnoseSymbols } = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
const { recognizeImportImageAsync } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { estimateBeadPitch, refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const palette = BRAND_PALETTES.MARD;
console.log(`image ${info.width}x${info.height}, palette ${palette.length}`);

// 1) 自动标定
const est = estimateBeadPitch(source);
console.log('pitch:', est ? `cell=${est.cell.toFixed(2)} ${est.columns}x${est.rows} conf=${est.confidence.toFixed(2)} origin=(${est.originX},${est.originY}) trusted=(${est.originTrustedX},${est.originTrustedY})` : 'null');
let cal = null;
if (est && est.confidence >= 0.15) {
  cal = {
    originX: est.originTrustedX ? est.originX : 0,
    originY: est.originTrustedY ? est.originY : 0,
    cellWidth: est.cell, cellHeight: est.cell,
    columns: Math.min(est.columns, Math.floor((source.width - est.originX) / est.cell)),
    rows: Math.min(est.rows, Math.floor((source.height - est.originY) / est.cell)),
  };
  const ref = refineGridAlignment(source, cal);
  if (ref.applied) cal = { ...cal, cellWidth: ref.cell, cellHeight: ref.cell, originX: ref.originX, originY: ref.originY };
  console.log('cal:', JSON.stringify(cal));
}
if (!cal) { console.log('no calibration, abort'); await vite.close(); process.exit(1); }

// 2) 图例芯片
const parsed = parseLegend(source, cal, palette, { gridRows: cal.rows, gridCols: cal.columns });
const legendEntries = parsed.ok ? parsed.entries : [];
console.log('legend ok:', parsed.ok, 'entries:', legendEntries.length);
for (const e of legendEntries) console.log(`  ${e.code ?? '(?)'} count=${e.count ?? '?'} warn=${e.warn ?? ''} rgb=${e.dotRgb ? e.dotRgb.join(',') : '?'}`);
const legendCounts = new Map(legendEntries.filter(e => e.code).map(e => [e.code, e.count]));

// 3) symbol OCR 明细
const sym = extractBeadSymbols(source, cal, palette);
console.log(`\nsymbol: textCells=${sym.textCellCount} resolved=${sym.resolvedCount} unresolved=${sym.unresolvedCount} labels=${sym.templateLabels}[${sym.labelChars ?? ''}]`);
console.log('unresolved reasons:', JSON.stringify(sym.unresolvedReasons ?? {}));

// 4) 逐格 OCR 读数分布 vs 图例真值
const ocrCounts = new Map();
for (const r of sym.codes.values()) ocrCounts.set(r.code, (ocrCounts.get(r.code) ?? 0) + 1);
console.log('\ncode | ocrN | legendN | diff');
const allCodes = [...new Set([...ocrCounts.keys(), ...legendCounts.keys()])].sort();
for (const c of allCodes) {
  const o = ocrCounts.get(c) ?? 0, l = legendCounts.get(c) ?? 0;
  console.log(`${c.padEnd(4)} | ${String(o).padStart(4)} | ${String(l).padStart(4)} | ${o - l >= 0 ? '+' : ''}${o - l}`);
}

// 5) 完整识别（带 symbolAssist）→ 逐色总量 vs 图例
const enabledCodes = legendEntries.filter(e => e.code && palette.some(p => p.code === e.code)).map(e => e.code);
const options = { symbolAssist: true, batchSize: 256 };
if (enabledCodes.length >= 2) options.paletteLock = [...new Set(enabledCodes)];
const result = await recognizeImportImageAsync(source, cal, palette, 'precision', undefined, options);
console.log(`\nrecognize: mapped=${result.summary.mapped} lowConf=${result.summary.lowConfidence} symbolAssist=`, JSON.stringify(result.symbolAssist));
const finalCounts = new Map();
for (const row of result.cells) for (const cell of row) {
  if (cell.status === 'mapped') finalCounts.set(cell.color.code, (finalCounts.get(cell.color.code) ?? 0) + 1);
}
console.log('\ncode | finalN | legendN | match');
let matchN = 0, total = 0;
for (const c of allCodes.sort()) {
  const f = finalCounts.get(c) ?? 0, l = legendCounts.get(c) ?? 0;
  if (!l) continue;
  total += 1;
  const ok = Math.abs(f - l) <= Math.max(2, l * 0.05);
  if (ok) matchN += 1;
  console.log(`${c.padEnd(4)} | ${String(f).padStart(4)} | ${String(l).padStart(4)} | ${ok ? 'OK' : 'MISS'}`);
}
console.log(`count-match: ${matchN}/${total}`);

await vite.close();
