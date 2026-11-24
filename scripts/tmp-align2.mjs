// card3 漏行定位：输出对应真值行 index → 缺失行 index + code；debugColorCardParse bands/items 对质
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const m = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'));
const tseq = (truth.card3.entries ?? truth.card3).map(e => e[0]);
const { data, info } = await sharp('benchmark/images/card3.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const r = m.parseColorCard(source, BRAND_PALETTES.MARD);
const out = r.entries.map(e => e.code);
// 贪心对齐
let ti = 0; const missing = [];
for (let oi = 0; oi < out.length; oi++) {
  let found = -1;
  for (let k = ti; k < Math.min(ti + 6, tseq.length); k++) if (tseq[k] === out[oi]) { found = k; break; }
  if (found < 0) console.log(`output#${oi} ${out[oi]} 无法对齐`);
  else { for (let k = ti; k < found; k++) missing.push(k); ti = found + 1; }
}
for (let k = ti; k < tseq.length; k++) missing.push(k);
console.log(`缺失真值行 ${missing.length} 个: ${missing.map(k => `#${k}=${tseq[k]}`).join(' ')}`);
// dbg bands
const dbg = m.debugColorCardParse(source);
console.log(`bands=${dbg.bands.length} items=${dbg.items.length}`);
dbg.bands.forEach((b, i) => console.log(`band${i} y=${b.y0}-${b.y1} tokens=${b.tokens} swatches=${b.swatches}`));
await vite.close();
