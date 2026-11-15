// 诊断：water-box 图例 parse 中间产物
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { debugLegendParse, debugSwatchDetection } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const truth = JSON.parse(readFileSync('benchmark/water-box.legend.json', 'utf-8'));
const CAL = { originX: 276, originY: 116, cellWidth: 8.79, cellHeight: 8.79, columns: truth.grid.cols, rows: truth.grid.rows };
const { data, info } = await sharp('benchmark/images/water-box.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
console.log('image:', info.width, 'x', info.height, 'gridRight=', CAL.originX + CAL.columns * CAL.cellWidth);
const { debugLegendLocation } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const dbg = debugLegendParse(source, CAL, BRAND_PALETTES.MARD, { gridRows: CAL.rows, gridCols: CAL.columns });
// 用"右带挤掉"技巧强制走底部：columns 拉大使 bandLeft 越过图宽。
const { debugLegendLines } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const bottom = debugLegendLines(source, { ...CAL, columns: 200 }, BRAND_PALETTES.MARD);
if (bottom) {
  console.log('== bottom band ==', 'bg=', bottom.background);
  bottom.lines.forEach(l => {
    console.log(`line y${l.y0}-${l.y1} comps=${l.comps.length}:`, l.comps.map(c => `${c.x0}-${c.x1}(${c.x1 - c.x0 + 1}x${c.y1 - c.y0 + 1}${c.dot ? 'DOT' : ''})`).join(' '));
  });
  console.log('entries:', bottom.entries.length, JSON.stringify(bottom.entries.slice(0, 30)));
}
if (!dbg) { console.log('null'); process.exit(0); }
console.log('locationDebug:', JSON.stringify(debugLegendLocation()));
console.log('rawEntries:', dbg.rawEntries.length, 'digitW:', dbg.digitW);
dbg.rawEntries.slice(0, 30).forEach((e, i) => {
  const parts = e.glyphs.map(g => `${g.x0}-${g.x1}(${g.x1 - g.x0 + 1}x${g.y1 - g.y0 + 1})`).join(' ');
  const prior = dbg.priors[i];
  const split = dbg.splits[i];
  const resolved = dbg.resolvedCodes[i];
  const p = dbg.parsed[i];
  console.log(`#${String(i).padStart(2, '0')} prior=${prior ? prior.code + '@' + prior.deltaE.toFixed(1) : 'null'} resolved=${resolved ? resolved.code + (resolved.unique ? '!' : '?') : '-'} ` +
    `split=${split ? `c${split.codeGlyphs.length}/n${split.countGlyphs.length}` : 'null'} code="${p?.code ?? '?'}" count=${p?.count ?? '?'} conf=${p ? p.confidence.toFixed(2) : '?'} warns=${p ? p.warns.join('|') : ''}`);
  console.log(`     ${e.dotRgb ? 'dot=[' + e.dotRgb.join(',') + '] ' : ''}${parts}`);
});
console.log('templateChars:', dbg.templateChars.join(''));
console.log('countTemplateChars:', dbg.countTemplateChars.join(''));
const { countTemplateAssignment } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
console.log('countClusters:', JSON.stringify(countTemplateAssignment.slice(0, 20), null, 0));
await vite.close();
