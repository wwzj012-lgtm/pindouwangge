// 探测：用户导出的「瑶·大耳狗之梦」完整图纸（右上图例面板版式）回灌解析
// 复现用户反馈：81 行重复色号、计数 0-2、出现色板外颜色。
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { parseLegend, debugLegendParse } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { estimateBeadPitch } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const { data, info } = await sharp(process.argv[2] ?? 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-15T03-22-12-361Z-ca506670.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
console.log('image:', source.width, 'x', source.height);

const pitch = estimateBeadPitch(source);
console.log('pitch:', JSON.stringify(pitch));
if (!pitch) { await vite.close(); process.exit(1); }

const { refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const seedCell = Number(process.argv[3] ?? 12.5);
const refined = refineGridAlignment(source, { originX: 0, originY: 0, cellSize: seedCell });
console.log('refined:', refined.cell, refined.originX.toFixed(2), refined.originY.toFixed(2), 'coh', refined.coherenceX?.toFixed(2), refined.coherenceY?.toFixed(2));

const COLS = 101, ROWS = 132;
const CAL = { originX: refined.originX, originY: refined.originY, cellWidth: refined.cell, cellHeight: refined.cell, columns: COLS, rows: ROWS };
const legend = parseLegend(source, CAL, BRAND_PALETTES.MARD, { gridRows: ROWS, gridCols: COLS });
console.log('ok:', legend.ok, legend.failureReason ?? '');
if (legend.ok) {
  console.log('checks:', JSON.stringify(legend.checks));
  console.log('entries:', legend.entries.length);
  for (const e of legend.entries) console.log(`  ${e.code.padEnd(4)} count=${String(e.count).padStart(4)} conf=${e.confidence.toFixed(2)}${e.warn ? ' warn=' + e.warn : ''}`);
}
const dbg = debugLegendParse(source, CAL, BRAND_PALETTES.MARD, { gridRows: ROWS, gridCols: COLS });
console.log('dbg keys:', Object.keys(dbg));
for (const k of Object.keys(dbg)) {
  const v = dbg[k];
  if (v && typeof v === 'object' && !Array.isArray(v)) continue;
  console.log(' ', k, '=', Array.isArray(v) ? `len=${v.length}` : v);
}
console.log('anchorTrace: lines with anchors (diagnose false-anchor row splits)');
for (const t of (dbg.anchorTrace ?? []).slice(0, 8)) {
  const anchors = t.comps.filter(c => c.anchor);
  console.log(`  line y${t.y0}-${t.y1} comps=${t.comps.length} anchors=${anchors.length}`);
  if (anchors.length) console.log('    anchor comps:', anchors.map(c => `[x${c.x0}-${c.x1} y${c.y0}+${c.y1 - c.y0} area=${c.area} fill=${(c.area / ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1))).toFixed(2)}]`).join(' '));
}
console.log('digitW =', dbg.digitW, ' templateChars =', dbg.templateChars.join(''), ' countTemplateChars =', dbg.countTemplateChars.join(''));
const { countTemplateAssignment } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
console.log('countTemplateAssignment:');
for (const a of countTemplateAssignment) console.log('  ', JSON.stringify(a));
console.log('priors/resolved:');
const { rgbToLab: r2l, deltaE2000: dE2 } = await vite.ssrLoadModule('/src/utils/colorUtils.ts').catch(() => ({}));
let dEfn = dE2, labfn = r2l;
if (!dEfn) { const m = await vite.ssrLoadModule('/src/utils/importLegend.ts'); dEfn = m.deltaE2000; labfn = m.rgbToLab; }
const preparedAll = Object.values(BRAND_PALETTES.MARD).filter(c => c && c.code);
dbg.priors.forEach((p, i) => {
  const r = dbg.resolvedCodes[i];
  const s = dbg.splits[i];
  let margin = '';
  if (p && dbg.rawEntries[i].dotRgb && labfn) {
    const lab = labfn(...dbg.rawEntries[i].dotRgb);
    const ranked = preparedAll
      .filter(c => c.code.length === p.code.length)
      .map(c => {
        const h = c.hex.replace('#', '');
        const rgb = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
        return { code: c.code, d: dEfn(lab, labfn(...rgb)) };
      })
      .sort((a, b) => a.d - b.d);
    margin = ` margins=[${ranked.slice(0, 3).map(x => `${x.code}@${x.d.toFixed(1)}`).join(' ')}]`;
  }
  console.log(`  #${i} prior=${p ? `${p.code}@dE${p.deltaE.toFixed(1)}` : 'null'} resolved=${r ? `${r.code}${r.unique ? '!' : ''}` : 'null'} splitCode=${s ? s.codeGlyphs.length : '-'}${margin}`);
});
console.log('rawEntries:', dbg.rawEntries.length);
dbg.rawEntries.slice(0, 10).forEach((e, i) => {
  const s = dbg.splits[i];
  const p = dbg.parsed[i];
  const fmt = g => `[x${g.x0}-${g.x1} w${g.x1 - g.x0 + 1} h${g.y1 - g.y0 + 1}]`;
  console.log(`  #${i} dot=${e.dotRgb ? 'Y' : 'N'} glyphs=${e.glyphs.length} parsed=${p ? `code=${p.code} count=${p.count}` : 'null'}`);
  console.log(`     ${e.glyphs.map(fmt).join(' ')}`);
  if (s) console.log(`     split code=${s.codeGlyphs.length}${s.codeGlyphs.map(g => 'w' + (g.x1 - g.x0 + 1)).join(',')} count=${s.countGlyphs.length}${s.countGlyphs.map(g => 'w' + (g.x1 - g.x0 + 1)).join(',')}`);
});
await vite.close();
