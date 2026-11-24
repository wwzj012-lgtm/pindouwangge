// 量测各基准图图例行的 色票高度/行内字形中位高 比值，为锚点守卫选阈值
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { debugLegendParse } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const CASES = [
  { name: 'water-box', file: 'benchmark/images/water-box.jpg', cal: { originX: -0.375, originY: -0.25, cellWidth: 8.8, cellHeight: 8.8, columns: 148, rows: 148 } },
  { name: 'yao-dalugou', file: 'benchmark/images/yao-dalugou.jpg', cal: { originX: 25, originY: 51, cellWidth: 12.5, cellHeight: 12.5, columns: 101, rows: 132 } },
  { name: 'yao-full-png', file: 'benchmark/images/yao_完整图纸.png', cal: null },
];
for (const c of CASES) {
  if (!c.cal) { console.log(c.name, ': skip (no cal handy)'); continue; }
  const { data, info } = await sharp(c.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
  const dbg = debugLegendParse(source, c.cal, BRAND_PALETTES.MARD, {});
  if (!dbg) { console.log(c.name, ': parse null'); continue; }
  console.log(`== ${c.name} (${info.width}x${info.height}) entries=${dbg.rawEntries.length}`);
  const ratios = [];
  for (const t of (dbg.anchorTrace ?? []).slice(0, 6)) {
    const anchors = t.comps.filter(x => x.anchor);
    if (!anchors.length) continue;
    const hs = t.comps.map(x => x.y1 - x.y0 + 1).sort((a, b) => a - b);
    const medianH = hs[Math.floor(hs.length / 2)];
    for (const a of anchors) {
      const h = a.y1 - a.y0 + 1;
      const ratio = h / medianH;
      ratios.push(ratio);
      console.log(`  line y${t.y0}: anchor x${a.x0}-${a.x1} h=${h} medianH=${medianH} ratio=${ratio.toFixed(2)} fill=${(a.area / ((a.x1 - a.x0 + 1) * h)).toFixed(2)}`);
    }
  }
  await vite.close();
}
