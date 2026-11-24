// 浏览器端图例解析测试通道（2026-11-15）：用户真实场景 = 浏览器（有 Canvas
// 字体引擎，合成数字锚只在浏览器可用）。Node 探针测不到浏览器路径，
// 本脚本用 playwright-core + 系统 Edge 在真实浏览器里跑 parseLegend，
// 用 benchmark/water-box.legend.json 真值判分。
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const vite = await createServer({ root: process.cwd(), server: { port: 46120, strictPort: true }, logLevel: 'error' });
await vite.listen();
const viteUrl = 'http://localhost:46120';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage();
page.on('console', msg => { if (msg.type() === 'error') console.log('[page-error]', msg.text().slice(0, 200)); });
page.on('pageerror', err => console.log('[pageexception]', String(err).slice(0, 300)));
await page.goto(viteUrl, { waitUntil: 'load', timeout: 60000 });

const useRegion = process.env.REGION === '1';
const YAOFULL = process.env.YAOFULL === '1';
const useWhitelist = process.env.WL === '1';
const result = await page.evaluate(async ({ useRegion, useWhitelist, YAOFULL }) => {
  const { parseLegend, debugLegendParse, countTemplateAssignment } = await import('/src/utils/importLegend.ts');
  const { parseEntriesToRows } = await import('/src/components/ImportLegendPanel.tsx');
  const { parseEntriesToRows: _unused } = { parseEntriesToRows };
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const { refineGridAlignment } = await import('/src/utils/importGridPitch.ts');

  // 用 benchmark 真值图 water-box.jpg（= 用户导入的瑶.jpg 同图）
  const IMG = YAOFULL ? '/.tmp/yao-full.png' : '/benchmark/images/water-box.jpg';
  const resp = await fetch(IMG);
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const source = { data: img.data, width: img.width, height: img.height };
  const meta = { w: img.width, h: img.height, canvasFonts: typeof document !== 'undefined' };

  // 基准真值标定（与 legend-benchmark.mjs 一致）
  const CAL = YAOFULL
    ? { originX: 552, originY: 232, cellWidth: 17.58, cellHeight: 17.58, columns: 101, rows: 132 }
    : { originX: 276, originY: 116, cellWidth: 8.79, cellHeight: 8.79, columns: 101, rows: 132 };
  // REGION=1 模拟用户框选图例区域；WL=1 模拟白名单（色板收窄到图纸 27 色）
  const region = YAOFULL && useRegion ? { x0: 1900, y0: 150, x1: 3180, y1: 1000 }
    : useRegion ? { x0: 0, y0: 1180, x1: 1440, y1: 1440 } : undefined;
  const WL27 = ['C13','D1','D3','D7','D9','D17','D24','E14','E17','F17','G1','G16','H1','M14','C29','D2','D4','D8','D10','D23','E2','E16','F16','F20','G15','G17','H13'];
  // FLOW=1 模拟真实用户流：第一遍全色板解析→装配行→行集收窄重解析
  const t0 = performance.now();
  const firstPass = useWhitelist
    ? parseLegend(source, CAL, BRAND_PALETTES.MARD, { gridRows: 132, gridCols: 101, region })
    : null;
  const wlFromRows = firstPass && firstPass.ok
    ? parseEntriesToRows(firstPass.entries, new Set(BRAND_PALETTES.MARD.filter(c => c.enabled !== false).map(c => c.code)), BRAND_PALETTES.MARD)
        .filter(r => r.enabled).map(r => r.code)
    : WL27;
  const paletteWL = useWhitelist ? BRAND_PALETTES.MARD.filter(c => wlFromRows.includes(c.code)) : BRAND_PALETTES.MARD;
  const legend = parseLegend(source, CAL, paletteWL, { gridRows: 132, gridCols: 101, region });
  const parseMs = Math.round(performance.now() - t0);
  const dbg = debugLegendParse(source, CAL, paletteWL, { gridRows: 132, gridCols: 101, region });

  // 装配层验证：色板外码纠正 + 同码去重（2026-11-15 用户反馈）
  const palette = paletteWL;
  const rows = legend.ok ? parseEntriesToRows(legend.entries, new Set(palette.map(c => c.code)), palette) : [];
  // 错读码行色点的最近三近邻 ΔE（定纠正阈值）
  const { rgbToLab } = await import('/src/utils/colorUtils.ts');
  const { deltaE2000 } = await import('/src/utils/colorUtils.ts');
  const truth = ['C13','D1','D3','D7','D9','D17','D24','E14','E17','F17','G1','G16','H1','M14','C29','D2','D4','D8','D10','D23','E2','E16','F16','F20','G15','G17','H13'];
  const diag = legend.ok ? legend.entries.filter(e => !truth.includes(e.code)).map(e => {
    if (!e.dotRgb) return `${e.code}:noDot`;
    const lab = rgbToLab(...e.dotRgb);
    const near = palette.filter(c => c.enabled !== false)
      .map(c => ({ c: c.code, d: deltaE2000(lab, rgbToLab(...c.rgb)) }))
      .sort((a, b) => a.d - b.d).slice(0, 3);
    return `${e.code}→${near.map(n => n.c + '@' + n.d.toFixed(1)).join(' ')}`;
  }) : [];
  return {
    diag,
    rows: rows.map(r => ({ code: r.code, count: r.count, enabled: r.enabled, warn: r.warn })),
    parseMs,
    imgSize: `${img.width}x${img.height}`,
    meta,
    ok: legend.ok,
    failureReason: legend.failureReason ?? '',
    checks: legend.checks,
    entries: legend.ok ? legend.entries.map(e => ({ code: e.code, count: e.count, conf: +e.confidence.toFixed(2), warn: e.warn ?? '' })) : [],
    digitW: dbg ? dbg.digitW : -1,
    assignment: countTemplateAssignment.slice(0, 30).map(a => ({ ...a })),
    countTemplateChars: dbg ? dbg.countTemplateChars : [],
  };
}, { useRegion, useWhitelist, YAOFULL });

console.log('parseMs:', result.parseMs, result.imgSize);
console.log('mode:', useRegion ? 'REGION(框选)' : 'DIRECT(自动)');
console.log('meta:', JSON.stringify(result.meta));
console.log('ok:', result.ok, result.failureReason);
console.log('checks:', JSON.stringify(result.checks));
console.log('digitW:', result.digitW, 'countTemplateChars:', result.countTemplateChars.join(''));
for (const d of result.diag ?? []) console.log('  DOT', d);
console.log('rows(装配层):');
for (const r of result.rows) console.log(`  ${r.code.padEnd(4)} ${String(r.count).padStart(4)}${r.enabled ? '' : ' [禁]'}${r.warn ? ' warn=' + r.warn : ''}`);

const truth = JSON.parse(readFileSync('benchmark/water-box.legend.json', 'utf8'));
const truthMap = new Map(truth.entries.map(t => [t.code, t.count]));
if (result.ok) {
  console.log('entries:', result.entries.length);
  let sumErr = 0, countOk = 0;
  const seen = new Map();
  for (const e of result.entries) {
    const line = `  ${e.code.padEnd(4)} count=${String(e.count).padStart(4)} conf=${e.conf}${e.warn ? ' warn=' + e.warn : ''}`;
    // 真值比对（识别码对得上时）
    if (truthMap.has(e.code)) {
      const err = e.count - truthMap.get(e.code);
      sumErr += Math.abs(err);
      if (Math.abs(err) <= 2) countOk += 1;
      seen.set(e.code, err);
      console.log(line + `  真值${truthMap.get(e.code)} 误差${err > 0 ? '+' : ''}${err}`);
    } else {
      console.log(line + '  (色板外/错读码)');
    }
  }
  const total = [...truthMap.values()].reduce((a, b) => a + b, 0);
  console.log(`Σ|误差|=${sumErr} / 真值Σ=${total}（1%上限=${Math.round(total * 0.01)}）  粒数命中±2=${countOk}/${truth.entries.length}`);
  const missed = [...truthMap.keys()].filter(c => !seen.has(c));
  if (missed.length) console.log('漏/错读色号:', missed.join(','));
}
console.log('countTemplateAssignment:');
for (const a of result.assignment) console.log('  ', JSON.stringify(a));

await browser.close();
await vite.close();
