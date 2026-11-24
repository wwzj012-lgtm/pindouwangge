// 仲裁策略离线搜索：颜色 vs 新联合评分 OCR，2x2 混淆 + 置信度仲裁收益
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync } from 'fs';

const ORIG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
const ROOT = 'D:/Build_Apps/pindouwangge';
const { manual } = JSON.parse(readFileSync(`${OUT}/manual_vs_rec.json`, 'utf8'));

const vite = await createServer({ root: ROOT, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: ROOT + '/vite.config.ts' });
const { extractBeadSymbols, diagnoseSymbols } = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const P = BRAND_PALETTES.MARD;

const { data, info } = await sharp(ORIG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const cal = { originX: 0, originY: 0, cellWidth: 29.6, cellHeight: 29.54, columns: 52, rows: 52 };
const r = recognizeImportImage(source, cal, P, 'precision', undefined, { mode: 'precision', edgeInsetRatio: 0.1, symbolAssist: true });
const diag = diagnoseSymbols(source, cal, P);
const diagMap = new Map();
for (const it of diag.items) diagMap.set(`${it.row}:${it.column}`, it);

// 管线最终输出（chartMode：颜色主导 + blank 覆写）作为"颜色判定"基准。
// 注意 applySymbolAssist 冲突时保留颜色格；blank 覆写为 null。这里取管线 cells 的 colorId 即颜色判定。
let bothOk = 0, ocrOnly = 0, colorOnly = 0, bothBad = 0, n = 0;
const conflictCells = [];
for (let row = 0; row < manual.length; row++) for (let col = 0; col < manual[0].length; col++) {
  const mc = manual[row]?.[col]?.code;
  const cell = r.cells[row]?.[col];
  if (!mc || !cell || cell.status !== 'mapped' || !cell.colorId) continue;
  const oc = diagMap.get(`${row}:${col}`)?.best ?? null;
  const cc = cell.colorId.replace(/^MARD_/, '');
  n++;
  const oOk = oc === mc, cOk = cc === mc;
  if (oOk && cOk) bothOk++;
  else if (oOk) { ocrOnly++; conflictCells.push({ row, col, mc, oc, cc, ...diagMap.get(`${row}:${col}`) }); }
  else if (cOk) colorOnly++;
  else bothBad++;
}
console.log(`双方非空 ${n}: 都对 ${bothOk}, 仅OCR对 ${ocrOnly}, 仅颜色对 ${colorOnly}, 都错 ${bothBad}`);
console.log(`现状(信颜色)=${bothOk + colorOnly}/${n} ${(100 * (bothOk + colorOnly) / n).toFixed(2)}%`);
console.log(`信OCR=${bothOk + ocrOnly}/${n} ${(100 * (bothOk + ocrOnly) / n).toFixed(2)}%`);

// 置信仲裁：冲突时按 margin 阈值决定信谁
for (const mt of [0.02, 0.03, 0.05, 0.08, 0.1]) {
  let ok = 0;
  for (const c of conflictCells) {
    // 冲突格：margin > mt 时信 OCR，否则信颜色
    ok += (c.margin > mt) ? (c.oc === c.mc ? 1 : 0) : (c.cc === c.mc ? 1 : 0);
  }
  const total = bothOk + colorOnly + ok;
  console.log(`仲裁 margin>${mt}: ${total}/${n} ${(100 * total / n).toFixed(2)}% (冲突格救回 ${ok}/${conflictCells.length})`);
}
console.log(`\n冲突格 (OCR对颜色错) ${conflictCells.length} 个, 其 margin 分布:`);
const mHist = [0, 0, 0, 0, 0];
for (const c of conflictCells) mHist[c.margin > 0.1 ? 4 : c.margin > 0.05 ? 3 : c.margin > 0.03 ? 2 : c.margin > 0.015 ? 1 : 0]++;
console.log('  <0.015:', mHist[0], ' 0.015-0.03:', mHist[1], ' 0.03-0.05:', mHist[2], ' 0.05-0.1:', mHist[3], ' >0.1:', mHist[4]);
await vite.close();
