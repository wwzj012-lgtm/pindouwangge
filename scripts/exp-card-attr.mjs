// 逐条目归因：anchor(resolveCodes 色点窗) -> refine 终值 vs truth
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync } from 'fs';

const card = process.argv[2] ?? 'card1';
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'));
const truthMap = new Map((truth[card]?.entries ?? []).map(e => [e[0], e[1]]));
const truthSeq = (truth[card]?.entries ?? []).map(e => e[0]);

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { debugColorCardParse, parseColorCard } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp(`benchmark/images/${card}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

// anchor 状态：debugColorCardParse 现返回 prior/resolved（resolveCodes 结果）。
// 但 parseCardLegend 内部 anchors 不外泄——改从 dbg.items 取 prior（先验码）
// 不够。此处直接跑两遍：一遍正式结果，一遍从 debug 的 prior/resolved 重建。
const dbg = debugColorCardParse(source, BRAND_PALETTES.MARD);
const r = parseColorCard(source, BRAND_PALETTES.MARD);
const finalCodes = r.entries.map(e => e.code);
console.log('=== 逐条目 anchor/终值 vs truth ===');
let anchorRight = 0, anchorTotal = 0;
for (let i = 0; i < truthSeq.length; i += 1) {
  const t = truthSeq[i];
  const it = dbg?.items[i];
  const anchor = it?.resolved ?? '-';
  const fin = finalCodes[i] ?? '-';
  const mark = fin === t ? 'OK' : 'XX';
  if (anchor === t) anchorRight += 1;
  if (anchor !== '-') anchorTotal += 1;
  if (mark === 'XX') console.log(`#${String(i).padStart(2)} truth=${t.padEnd(4)} anchor=${String(anchor).padEnd(5)} final=${String(fin).padEnd(5)} prior=${it?.prior ?? '-'} codeWs=[${it?.codeWs ?? ''}] countWs=[${it?.countWs ?? ''}]`);
}
console.log(`anchor 命中 ${anchorRight}/${anchorTotal}, final 错误 ${truthSeq.length - finalCodes.filter((c, i) => c === truthSeq[i]).length}/${truthSeq.length}`);
await vite.close();
