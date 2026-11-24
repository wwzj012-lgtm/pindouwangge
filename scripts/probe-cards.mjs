// 三张色卡（图一 card1 / 图二 card2 / 图三 card3）当前解析基线 + 真值对照
// 用法: node scripts/probe-cards.mjs [card1|card2|card3]
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync } from 'fs';

const cardName = process.argv[2] ?? 'card1';
const TRUTH = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'));
const card = TRUTH[cardName];

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { parseLegend, debugLegendParse } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const { data, info } = await sharp(`benchmark/${card.file}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
console.log(`=== ${cardName}: ${source.width}x${source.height} ===`);

// 无豆网格的纯色卡：整图框选直通（region 路径不做仲裁）。
const CAL = { originX: 0, originY: 0, cellWidth: 10, cellHeight: 10, columns: Math.ceil(source.width / 10), rows: Math.ceil(source.height / 10) };
const region = { x0: 0, y0: 0, x1: source.width - 1, y1: source.height - 1 };

const legend = parseLegend(source, CAL, BRAND_PALETTES.MARD, { region, gridRows: CAL.rows, gridCols: CAL.columns });
console.log('ok:', legend.ok, legend.failureReason ?? '');
if (legend.ok) {
  console.log('entries:', legend.entries.length, 'sumCount:', legend.checks.sumCount);
  for (const e of legend.entries) {
    console.log(`  ${(e.code || '?').padEnd(4)} count=${String(e.count).padStart(5)} conf=${e.confidence.toFixed(2)}${e.warn ? ' warn=' + e.warn : ''}`);
  }
}

// 真值对照：code 准确率 + count 准确率
const truth = new Map(card.entries);
const got = new Map((legend.entries ?? []).filter(e => e.code).map(e => [e.code, e]));
let codeHit = 0, codeMiss = [], countHit = 0, countMiss = [];
for (const [code, count] of truth) {
  const e = got.get(code);
  if (!e) { codeMiss.push(code); continue; }
  codeHit += 1;
  if (e.count === count) countHit += 1; else countMiss.push(`${code}:${e.count}≠${count}`);
}
const extra = [...got.keys()].filter(c => !truth.has(c));
console.log(`--- 对照: 真值 ${truth.size} 项 | 色号命中 ${codeHit} 漏 ${codeMiss.length} ${codeMiss.slice(0, 12).join(',')} | 多报 ${extra.length} ${extra.slice(0, 12).join(',')}`);
console.log(`    数量对 ${countHit}/${codeHit} 错: ${countMiss.slice(0, 15).join(' ')}`);

// debug 行切分信息
const dbg = debugLegendParse(source, CAL, BRAND_PALETTES.MARD, { region, gridRows: CAL.rows, gridCols: CAL.columns });
console.log('digitW =', dbg.digitW, ' lines =', (dbg.anchorTrace ?? []).length);
await vite.close();
