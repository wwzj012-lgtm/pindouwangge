// mid 亮度 blank 格的颜色与位置
import { createServer } from 'vite';
import sharp from 'sharp';
const IMG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-22T09-39-58-552Z-fe2f92b2.jpg';
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
const px = (x, y) => { const i = (y * info.width + x) * 4; return [data[i], data[i+1], data[i+2]]; };
for (let r = 0; r < 66; r++) {
  for (let c = 0; c < cal.columns; c++) {
    const cell = result.cells[r]?.[c];
    if (!cell || cell.status !== 'blank') continue;
    const x0 = Math.round(cal.originX + c * cal.cellWidth), y0 = Math.round(cal.originY + r * cal.cellHeight);
    const w = Math.round(cal.cellWidth), h = Math.round(cal.cellHeight);
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let y = y0 + 2; y < y0 + h - 2; y++) for (let x = x0 + 2; x < x0 + w - 2; x++) {
      if (x < 0 || y < 0 || x >= info.width || y >= info.height) continue;
      const [pr, pg, pb] = px(x, y); sr += pr; sg += pg; sb += pb; n++;
    }
    if (!n) continue;
    const [mr, mg, mb] = [sr/n, sg/n, sb/n];
    const lum = (0.299*mr + 0.587*mg + 0.114*mb);
    if (lum < 200) {
      console.log(`blank (${r},${c}) area-avg=(${Math.round(mr)},${Math.round(mg)},${Math.round(mb)}) lum=${Math.round(lum)}`);
    }
  }
}
await vite.close(); process.exit(0);
