// 诊断 card1：走了哪条 location 路径 + rawEntries 字形几何
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';

const card = process.argv[2] ?? 'card1';
const scale = Number(process.argv[3] ?? 1);
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { parseLegend, debugLegendParse, debugLegendLocation } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

let img = sharp(`benchmark/images/${card}.png`).ensureAlpha();
if (scale > 1) img = img.resize({ width: Math.round(863 * scale), kernel: 'lanczos3' });
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const CAL = { originX: 0, originY: 0, cellWidth: 10, cellHeight: 10, columns: Math.ceil(source.width / 10), rows: Math.ceil(source.height / 10) };
const region = { x0: 0, y0: 0, x1: source.width - 1, y1: source.height - 1 };
const legend = parseLegend(source, CAL, BRAND_PALETTES.MARD, { region, gridRows: CAL.rows, gridCols: CAL.columns });
console.log('ok:', legend.ok, legend.failureReason ?? '', 'entries:', legend.entries?.length);
console.log('location debug:');
for (const l of debugLegendLocation()) console.log(' ', JSON.stringify(l));
const dbg = debugLegendParse(source, CAL, BRAND_PALETTES.MARD, { region, gridRows: CAL.rows, gridCols: CAL.columns });
console.log('rawEntries:', dbg.rawEntries.length, 'digitW:', dbg.digitW);
// 芯片盒诊断
for (const minRun of [40, 12, 8]) {
  const boxes = debugLegendParse._unused; // noop
  void boxes;
}
const { detectLegendChips } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
for (const minRun of [40, 12, 8]) {
  const boxes = detectLegendChips(source, [255, 255, 255], 0, 0, source.width - 1, source.height - 1, minRun);
  console.log(`chipBoxes minRun=${minRun}: ${boxes.length}`);
  if (minRun === 12) console.log('  ' + boxes.map(b => `[${b.x0}-${b.x1} y${b.y0}-${b.y1} w${b.x1 - b.x0 + 1}]`).join(' '));
}
const fmt = g => `[x${g.x0}-${g.x1} y${g.y0}-${g.y1} w${g.x1 - g.x0 + 1} h${g.y1 - g.y0 + 1}]`;
dbg.rawEntries.slice(0, 16).forEach((e, i) => {
  const s = dbg.splits[i]; const p = dbg.parsed[i];
  console.log(`#${i} dot=${e.dotRgb ? e.dotRgb.join(',') : 'N'} parsed=${p ? `${p.code}@${p.count}` : 'null'}`);
  console.log('   ', e.glyphs.map(fmt).join(' '));
  if (s) console.log(`    split code=${s.codeGlyphs.length}${s.codeGlyphs.map(g => 'w' + (g.x1 - g.x0 + 1)).join(',')} count=${s.countGlyphs.length}${s.countGlyphs.map(g => 'w' + (g.x1 - g.x0 + 1)).join(',')}`);
});
await vite.close();
