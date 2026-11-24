// 图例解析组件级诊断：行聚类、连通域、色点判定、间隙、先验。
// 运行: node scripts/_dbg-legend-comps.mjs [lineIndex]
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { debugLegendLines } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const CAL = { originX: 276, originY: 116, cellWidth: 8.79, cellHeight: 8.79, columns: 101, rows: 132 };
const { data, info } = await sharp('benchmark/images/water-box.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

const dbg = debugLegendLines(source, CAL, BRAND_PALETTES.MARD);
const only = process.argv[2] !== undefined ? Number(process.argv[2]) : null;
dbg.lines.forEach((line, index) => {
  if (only !== null && index !== only) return;
  console.log(`== line ${index}: y ${line.y0}-${line.y1}, comps ${line.comps.length}`);
  let last = null;
  for (const c of line.comps) {
    const gap = last ? c.x0 - last - 1 : 0;
    last = c.x1;
    console.log(`  x ${String(c.x0).padStart(4)}-${String(c.x1).padStart(4)} y ${c.y0}-${c.y1} w${String(c.x1 - c.x0 + 1).padStart(3)} h${String(c.y1 - c.y0 + 1).padStart(3)} area ${String(c.area).padStart(5)} rgb [${c.rgb.join(',')}] gap ${String(gap).padStart(3)} ${c.dot ? 'DOT' : ''}`);
  }
});
if (only === null || only >= dbg.lines.length) {
  console.log('== entries');
  for (const e of dbg.entries) {
    console.log(`  dot rgb [${e.dotRgb.join(',')}] prior ${e.prior} (dE ${e.priorDE}) glyphs@ ${e.glyphX.join(',')}`);
  }
}
await vite.close();
