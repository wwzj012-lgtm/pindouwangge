// 僵尸图全链路识别 vs 目读真值（行<66 网格区）
import { createServer } from 'vite';
import sharp from 'sharp';
const IMG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-22T09-39-58-552Z-fe2f92b2.jpg';
const TRUTH = { A1:23,A17:11,B11:9,B14:32,B25:59,B26:12,C10:70,C16:56,C17:7,C19:26,C20:2,C22:1,C24:9,C26:1,F6:8,H2:106,H5:36,H6:136,H7:433,M1:16,M3:2,M14:23 };
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImageAsync } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { estimateBeadPitch, refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const est = estimateBeadPitch(source);
let cal = { originX: est.originTrustedX ? est.originX : 0, originY: est.originTrustedY ? est.originY : 0, cellWidth: est.cell, cellHeight: est.cell, columns: Math.min(est.columns, Math.floor((source.width - est.originX) / est.cell)), rows: Math.min(est.rows, Math.floor((source.height - est.originY) / est.cell)) };
const ref = refineGridAlignment(source, cal);
if (ref.applied) cal = { ...cal, cellWidth: ref.cell, cellHeight: ref.cell, originX: ref.originX, originY: ref.originY };
const result = await recognizeImportImageAsync(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { symbolAssist: true, batchSize: 256 });
const counts = new Map();
let mapped = 0;
for (const [ri, row] of result.cells.entries()) {
  if (ri >= 66) continue;
  for (const cell of row) if (cell.status === 'mapped') { counts.set(cell.color.code, (counts.get(cell.color.code) ?? 0) + 1); mapped++; }
}
let okN = 0;
const lines = [];
for (const [code, t] of Object.entries(TRUTH)) {
  const f = counts.get(code) ?? 0;
  const ok = Math.abs(f - t) <= Math.max(2, t * 0.08);
  if (ok) okN++;
  lines.push(`${code}:${f}/${t}${ok ? '✓' : '✗'}`);
}
console.log(`mapped=${mapped} count-match ${okN}/${Object.keys(TRUTH).length}`);
console.log('  ' + lines.join(' '));
const extra = [...counts.entries()].filter(([c]) => !(c in TRUTH)).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log('ghost:', extra.map(([c, n]) => `${c}:${n}`).join(' ') || '(无)');
const lowConf = result.cells.flat().filter(c => c.status === 'mapped' && (c.confidence ?? 1) < 0.6).length;
console.log('lowConf(<0.6):', lowConf);
await vite.close(); process.exit(0);
