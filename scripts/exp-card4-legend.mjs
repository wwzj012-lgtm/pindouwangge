// card4（点状图例「色号 数量」裸格式）识别检验：源图 913x70 字高仅 ~8px，
// parseColorCard 报 noLegendBand（无票式色块）、parseLegend 原生跑条目数对但码全毒化。
// 本脚本检验杠杆：放大后再走 parseLegend（nearest/lanczos × 4/6/8）。
// 用法：node scripts/exp-card4-legend.mjs
process.chdir('D:/Build_Apps/pindouwangge');
const { createServer } = await import('vite');
const sharp = (await import('sharp')).default;
const fs = (await import('fs')).default;
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const IL = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const truth = JSON.parse(fs.readFileSync('benchmark/truth-cards.json', 'utf8')).card4.entries;
const truthMap = new Map(truth);
const calib = { originX: 0, originY: 0, cellWidth: 10, cellHeight: 10, columns: 1, rows: 1 };

function score(r) {
  const got = new Map(r.entries.filter(e => e.code).map(e => [e.code, e]));
  let hit = 0, cnt = 0;
  const miss = [], wrong = [], extra = [];
  for (const [c, n] of truthMap) {
    const e = got.get(c);
    if (!e) { miss.push(c); continue; }
    hit += 1;
    if (e.count === n) cnt += 1; else wrong.push(`${c}:${e.count}≠${n}`);
  }
  for (const c of got.keys()) if (!truthMap.has(c)) extra.push(c);
  return { hit, cnt, miss, wrong, extra, total: truthMap.size };
}

for (const [tag, kernel, up] of [['native1x', 'nearest', 1], ['nearest4x', 'nearest', 4], ['lanczos4x', 'lanczos3', 4], ['lanczos6x', 'lanczos3', 6], ['lanczos8x', 'lanczos3', 8]]) {
  const meta = await sharp('benchmark/images/card4.png').metadata();
  const { data, info } = await sharp('benchmark/images/card4.png')
    .ensureAlpha()
    .resize(meta.width * up, meta.height * up, { kernel })
    .raw().toBuffer({ resolveWithObject: true });
  const native = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
  const r = IL.parseLegend(native, calib, BRAND_PALETTES.MARD, {});
  const s = r.ok ? score(r) : null;
  console.log(`${tag}: ok=${r.ok} entries=${r.entries.length}` + (s ? ` 色号=${s.hit}/${s.total} 数量=${s.cnt}/${s.hit} 漏[${s.miss.slice(0, 8)}] 多报${s.extra.length}[${s.extra.slice(0, 5)}] 错[${s.wrong.slice(0, 6)}]` : ` (${r.failureReason})`));
  if (tag === 'lanczos4x' && r.ok) {
    for (const e of r.entries.slice(0, 27)) console.log('   ', (e.code || '?').padEnd(4), String(e.count).padStart(5), e.warn ?? '');
  }
}
await vite.close();
