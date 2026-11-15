// 诊断：大耳狗图例 parse 中间产物（全 27 行 + x 区间 + 解析结果）
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { debugLegendParse } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const { data, info } = await sharp('benchmark/images/yao-dalugou.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const CAL = { originX: 25, originY: 51, cellWidth: 12.5, cellHeight: 12.5, columns: 101, rows: 132 };
const dbg = debugLegendParse(source, CAL, BRAND_PALETTES.MARD, { gridRows: CAL.rows, gridCols: CAL.columns });
if (!dbg) { console.log('null'); process.exit(0); }
console.log('rawEntries:', dbg.rawEntries.length, 'digitW:', dbg.digitW);
dbg.rawEntries.forEach((e, i) => {
  const parts = e.glyphs.map(g => `${g.x0}-${g.x1}(${g.x1 - g.x0 + 1}x${g.y1 - g.y0 + 1})`).join(' ');
  const prior = dbg.priors[i];
  const split = dbg.splits[i];
  const resolved = dbg.resolvedCodes[i];
  const p = dbg.parsed[i];
  console.log(`#${String(i).padStart(2, '0')} prior=${prior ? prior.code + '@' + prior.deltaE.toFixed(1) : 'null'} resolved=${resolved ? resolved.code : '-'} ` +
    `split=${split ? `c${split.codeGlyphs.length}/n${split.countGlyphs.length}` : 'null'} code="${p?.code ?? '?'}" count=${p?.count ?? '?'} conf=${p ? p.confidence.toFixed(2) : '?'} warns=${p ? p.warns.join('|') : ''}`);
  console.log(`     ${e.dotRgb ? 'dot=[' + e.dotRgb.join(',') + '] ' : ''}${parts}`);
});
console.log('templateChars:', dbg.templateChars.join(''));
console.log('countTemplateChars:', dbg.countTemplateChars.join(''));
const { countTemplateAssignment } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
console.log('countClusters:', JSON.stringify(countTemplateAssignment, null, 0));
await vite.close();
