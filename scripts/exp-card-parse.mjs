// 直接调用 parseColorCard（独立色卡路径）查看原始输出
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync } from 'fs';

const card = process.argv[2] ?? 'card1';
const TRUTH = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'))[card];
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { parseColorCard, debugColorCardParse } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp(`benchmark/images/${card}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const dbg = debugColorCardParse(source);
console.log('bands:', JSON.stringify(dbg?.bands));
console.log('bg:', JSON.stringify(dbg?.bg), 'maxRowContent:', dbg?.maxRowContent);
console.log('gates:', JSON.stringify(dbg?.gates));
console.log('items[0..12]:', JSON.stringify(dbg?.items.slice(0, 12), null, 0).slice(0, 1200));
const r = parseColorCard(source, BRAND_PALETTES.MARD);
console.log(`=== ${card} parseColorCard: ok=${r.ok} ${r.failureReason ?? ''} entries=${r.entries.length}`);
for (const e of r.entries) console.log(`  ${(e.code || '?').padEnd(4)} count=${String(e.count).padStart(5)} conf=${e.confidence.toFixed(2)}${e.warn ? ' warn=' + e.warn : ''}`);
if (TRUTH) {
  const truth = new Map(TRUTH.entries);
  const got = new Map(r.entries.filter(e => e.code).map(e => [e.code, e]));
  let codeHit = 0, countHit = 0; const miss = [], wrong = [];
  for (const [c, n] of truth) { const e = got.get(c); if (!e) { miss.push(c); continue; } codeHit += 1; if (e.count === n) countHit += 1; else wrong.push(`${c}:${e.count}≠${n}`); }
  const extra = [...got.keys()].filter(c => !truth.has(c));
  console.log(`--- 色号 ${codeHit}/${truth.size} 漏[${miss.slice(0, 10).join(',')}] 多报${extra.length}[${extra.slice(0, 10).join(',')}] 数量对 ${countHit}/${codeHit} 错[${wrong.slice(0, 10).join(' ')}]`);
}
await vite.close();
