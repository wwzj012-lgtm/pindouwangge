// card1 逐行混淆对：output[i] vs truth[i]
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync } from 'fs';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const m = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'));
const tseq = (truth.card1.entries ?? truth.card1).map(e => e[0]);
const { data, info } = await sharp('benchmark/images/card1.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const r = m.parseColorCard(source, BRAND_PALETTES.MARD);
const out = r.entries.map(e => e.code);
console.log(`输出 ${out.length} 真值 ${tseq.length}`);
const pairs = [];
for (let i = 0; i < Math.max(out.length, tseq.length); i++) {
  const o = out[i] ?? '—', t = tseq[i] ?? '—';
  if (o !== t) pairs.push(`#${i} ${t}→${o}`);
}
console.log(pairs.join(' '));
await vite.close();
