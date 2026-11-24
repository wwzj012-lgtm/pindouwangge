// dump card1 unresolved 条目的码字形位图（识别字母身份 → 定位 G2/H22/C28/D17）
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const IL = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp('benchmark/images/card1.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

const dbg = IL.debugColorCardParse(source, BRAND_PALETTES.MARD);
const IDS = JSON.parse(process.env.IDS ?? 'null');
const targets = IDS ?? dbg.items.map((it, i) => ({ it, i })).filter(x => x.it.resolved === null || process.env.ALL === '1').map(x => x.i);
for (const idx of targets) {
  const it = dbg.items[idx];
  console.log(`\n===== item[${idx}] prior=${it.prior} resolved=${it.resolved} codeG=${it.codeGlyphs} codeSpan=${it.codeSpan} countG=${it.countGlyphs} cws=[${it.countWs.join(',')}] =====`);
  const gd = dbg.glyphDump.filter(g => g.i === idx);
  for (const g of gd) {
    console.log(`  [${g.kind}] w=${g.w} h=${g.h} rgb=${g.rgb}`);
    for (const row of g.rows) console.log('    ' + row);
  }
}
await vite.close();
