// water-box.jpg 全流程验收基准（T04）：
// 校准（实测暗线投影）→ 图例解析 → 色板锁定 + 数量锁定 → 识别 → per-code 粒数误差表。
// 同时验证：确定性、未锁定路径回归（无 legendBalance 字段 + 两次运行逐位一致）。
// 退出码：全部验收线通过 = 0，任一未达 = 1（每项打印 target/actual）。
// 运行: node scripts/legend-benchmark.mjs
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'vite';
import sharp from 'sharp';

const truthPath = 'benchmark/water-box.legend.json';
const imagePath = 'benchmark/images/water-box.jpg';
if (!existsSync(truthPath) || !existsSync(imagePath)) {
  console.error('缺少 benchmark/water-box.legend.json 或 benchmark/images/water-box.jpg');
  process.exit(1);
}
const truth = JSON.parse(readFileSync(truthPath, 'utf-8'));

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { parseLegend } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { recognizeImportImageAsync, recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

// 网格校准：暗线投影实测（major gridlines at x=276/1155, y=116; cell=8.79, 101×132）
const CAL = { originX: 276, originY: 116, cellWidth: 8.79, cellHeight: 8.79, columns: truth.grid.cols, rows: truth.grid.rows };

const { data, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const palette = BRAND_PALETTES.MARD;

const checks = [];
const record = (name, pass, detail) => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// ---- 1. 图例解析（确定性：两次解析逐位一致）----
const legendA = parseLegend(source, CAL, palette, { gridRows: CAL.rows, gridCols: CAL.columns });
const legendB = parseLegend(source, CAL, palette, { gridRows: CAL.rows, gridCols: CAL.columns });
record('图例解析确定性（两次逐位一致）', JSON.stringify(legendA) === JSON.stringify(legendB));

const entries = legendA.ok ? legendA.entries : [];
const codeHit = entries.filter(entry => truth.entries.some(t => t.code === entry.code)).length;
const countHit = entries.filter(entry => {
  const t = truth.entries.find(item => item.code === entry.code);
  return t && entry.count === t.count;
}).length;
const countWarned = entries.filter(entry => {
  const t = truth.entries.find(item => item.code === entry.code);
  return (!t || entry.count !== t.count) && entry.confidence < 0.9 && !!entry.warn;
}).length;
record('图例条目切分 = 27', entries.length === truth.entries.length, `actual ${entries.length}`);
record('图例色号命中 ≥ 90%', codeHit / truth.entries.length >= 0.9, `${codeHit}/${truth.entries.length} = ${(codeHit / truth.entries.length * 100).toFixed(1)}%`);
record('图例粒数命中 ≥ 85%', countHit / truth.entries.length >= 0.85, `${countHit}/${truth.entries.length} = ${(countHit / truth.entries.length * 100).toFixed(1)}%`);
record('错读条目 confidence<0.9 带 warn', countWarned === truth.entries.length - countHit, `${countWarned}/${truth.entries.length - countHit} 错读条目已降级标注`);

// ---- 2. 锁定识别：paletteLock = 解析出的色号，countQuota = 解析出的粒数 ----
const lockCodes = [...new Set(entries.filter(e => e.code).map(e => e.code))];
const quota = {};
for (const e of entries) if (e.code && e.count > 0 && !(e.code in quota)) quota[e.code] = e.count;
console.log(`\n锁定 ${lockCodes.length} 色 / Σ配额 ${Object.values(quota).reduce((a, b) => a + b, 0)} 粒，开始全图识别（precision）…`);

const t0 = performance.now();
const locked = await recognizeImportImageAsync(source, CAL, palette, 'precision', undefined, {
  paletteLock: lockCodes, countQuota: quota, batchSize: 256,
});
const elapsedLocked = performance.now() - t0;
console.log(`识别完成 ${elapsedLocked.toFixed(0)}ms，legendBalance=${JSON.stringify(locked.legendBalance ?? null)}`);

// 锁定后全部 mapped 格 ∈ 白名单
const whitelist = new Set(palette.filter(c => lockCodes.includes(c.code)).map(c => c.id));
let outside = 0;
for (const row of locked.cells) for (const cell of row) {
  if (cell.status === 'mapped' && cell.colorId && !whitelist.has(cell.colorId)) outside += 1;
}
record('锁定后全部色号 ∈ 锁定集', outside === 0, `${outside} 格越界`);

// per-code 粒数误差表（识别结果 vs 图例真值）
const gridCounts = new Map();
for (const row of locked.cells) for (const cell of row) {
  if (cell.status !== 'mapped' || !cell.colorId) continue;
  gridCounts.set(cell.colorId, (gridCounts.get(cell.colorId) ?? 0) + 1);
}
const codeById = new Map(palette.map(c => [c.id, c.code]));
console.log('\nper-code 粒数（图例真值 → 锁定识别 → 误差）：');
let within2 = 0;
let totalCompared = 0;
let sumError = 0;
const rows = [];
for (const t of truth.entries) {
  const expected = t.count;
  const id = palette.find(c => c.code === t.code)?.id;
  const got = id ? (gridCounts.get(id) ?? 0) : 0;
  const error = got - expected;
  const quotaValue = quota[t.code] ?? 0;
  rows.push({ code: t.code, expected, quota: quotaValue, got, error });
  totalCompared += 1;
  if (Math.abs(error) <= 2) within2 += 1;
  sumError += Math.abs(error);
}
for (const r of rows) {
  console.log(`  ${r.code.padEnd(4)} 真值${String(r.expected).padStart(4)} 配额${String(r.quota).padStart(4)} 识别${String(r.got).padStart(4)} 误差${r.error >= 0 ? '+' : ''}${r.error}`);
}
record('≥95% 色号粒数误差 ≤ ±2 格', within2 / Math.max(1, totalCompared) >= 0.95, `${within2}/${totalCompared} = ${(within2 / Math.max(1, totalCompared) * 100).toFixed(1)}%`);
record('Σ绝对误差 ≤ 总格数 1%', sumError <= CAL.rows * CAL.columns * 0.01, `Σ|误差| ${sumError} / ${CAL.rows * CAL.columns} 格`);

// ---- 2b. 数量锁定 + 图纸色号辅助（设计推荐组合：纸底空格不放豆）----
const lockedAssist = await recognizeImportImageAsync(source, CAL, palette, 'precision', undefined, {
  paletteLock: lockCodes, countQuota: quota, symbolAssist: true, batchSize: 256,
});
const assistCounts = new Map();
for (const row of lockedAssist.cells) for (const cell of row) {
  if (cell.status !== 'mapped' || !cell.colorId) continue;
  assistCounts.set(cell.colorId, (assistCounts.get(cell.colorId) ?? 0) + 1);
}
let assistWithin2 = 0;
for (const t of truth.entries) {
  const id = palette.find(c => c.code === t.code)?.id;
  const got = id ? (assistCounts.get(id) ?? 0) : 0;
  if (Math.abs(got - t.count) <= 2) assistWithin2 += 1;
}
record('锁定+色号辅助：≥95% 色号粒数误差 ≤ ±2 格', assistWithin2 / truth.entries.length >= 0.95, `${assistWithin2}/${truth.entries.length} = ${(assistWithin2 / truth.entries.length * 100).toFixed(1)}%`);
console.log(`（锁定+辅助 legendBalance=${JSON.stringify(lockedAssist.legendBalance ?? null)}）`);

// ---- 3. 未锁定回归：无 legendBalance 字段 + 确定性 ----
const unlockedA = recognizeImportImage(source, CAL, palette, 'fast');
const unlockedB = recognizeImportImage(source, CAL, palette, 'fast', undefined, {});
record('未锁定路径无 legendBalance 字段', !('legendBalance' in unlockedA) && !('legendBalance' in unlockedB));
record('未锁定两次运行逐位一致（含显式空 options）', JSON.stringify(unlockedA) === JSON.stringify(unlockedB));

await vite.close();
const failed = checks.filter(c => !c.pass);
console.log(`\n==== 基准汇总：${checks.length - failed.length}/${checks.length} 通过 ====`);
if (failed.length) {
  console.log('未达项：' + failed.map(c => c.name).join('；'));
  process.exit(1);
}
process.exit(0);
