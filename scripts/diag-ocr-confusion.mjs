// OCR 字形混淆诊断：错读格的候选分数分布 + 模板标注来源审计
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync } from 'fs';

const ORIG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
const ROOT = 'D:/Build_Apps/pindouwangge';
const { manual } = JSON.parse(readFileSync(`${OUT}/manual_vs_rec.json`, 'utf8'));

const vite = await createServer({ root: ROOT, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: ROOT + '/vite.config.ts' });
const { diagnoseSymbols } = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const P = BRAND_PALETTES.MARD;

const { data, info } = await sharp(ORIG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const cal = { originX: 0, originY: 0, cellWidth: 29.6, cellHeight: 29.54, columns: 52, rows: 52 };
const { items, templates, gap, textCells } = diagnoseSymbols(source, cal, P);
console.log(`文字格 ${textCells}, 模板字符 ${templates.size}: ${[...templates.keys()].sort().join('')}, gap=${gap}`);

// 模板审计：每个数字模板的宽度
const widths = {};
for (const [k, t] of templates) widths[k] = t.w;
console.log('模板宽度:', JSON.stringify(widths));

// 错读格分析（当前 OCR 输出 vs 手动——用修复后 compare 的 ocrCode；这里直接用 diagnose 的 best）
// 与手动对比：找 best != manual 的格
const byPair = new Map();
let wrong = 0, right = 0, correctRank = [];
for (const it of items) {
  const mc = manual[it.row]?.[it.column]?.code;
  if (!mc) continue;
  if (it.best === mc) { right++; continue; }
  wrong++;
  // 正确候选在 candidates 里的形状排名
  const sorted = [...it.candidates].sort((a, b) => b.shape - a.shape);
  const rank = sorted.findIndex(c => c.code === mc);
  correctRank.push(rank === -1 ? 'notInTop6' : rank + 1);
  const key = `${mc}→${it.best}`;
  byPair.set(key, (byPair.get(key) || 0) + 1);
}
console.log(`\nOCR best vs 手动: 对 ${right}, 错 ${wrong}`);
console.log('错读对 top:', [...byPair.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `${k}:${n}`).join(' '));
const rankCnt = {};
for (const r of correctRank) rankCnt[r] = (rankCnt[r] || 0) + 1;
console.log('正确候选的形状排名分布:', JSON.stringify(rankCnt));

// 典型案例明细：D9→D1 / D9→D8 / D6→D5 / H2→H1 各 2 例
console.log('\n=== 典型错读格明细 ===');
const shown = new Map();
for (const it of items) {
  const mc = manual[it.row]?.[it.column]?.code;
  if (!mc || it.best === mc) continue;
  const key = `${mc}→${it.best}`;
  const want = ['D9→D1', 'D9→D8', 'D6→D5', 'H2→H1', 'F24→F14', 'D18→D11'];
  if (!want.includes(key) || (shown.get(key) || 0) >= 2) continue;
  shown.set(key, (shown.get(key) || 0) + 1);
  console.log(`r${it.row + 1}c${it.column + 1} 手动${mc} best=${it.best}(${it.bestShape.toFixed(3)}) second=${it.second}(${it.secondShape?.toFixed(3)}) bandW=${it.bandWidth} parts=${it.partCount} 底色=${it.baseRgb.join(',')} prior=${it.prior}(ΔE${it.priorDE.toFixed(1)})`);
  console.log('   候选:', it.candidates.map(c => `${c.code}[色ΔE${c.colorDE.toFixed(1)}/形${c.shape.toFixed(3)}]`).join(' '));
}
await vite.close();
