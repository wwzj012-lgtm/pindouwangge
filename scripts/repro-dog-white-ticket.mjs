// 回归：dog-girl 图例「白色票面条目丢失」修复。
//
// 背景（2026-11-24）：图上图例是 3 行 × 19 + 末行 5 = 62 个药丸条目，但框选
// 解析只出 54 条。根因不是"末行被裁"，而是 collectChipEntries 的 chipEnd 检测
// 要求票面左侧有"彩色码块"——白豆（H2 1770 粒，全图用量最大）的色块就是白纸
// 色，找不到彩色列 → 整条 continue 丢弃。丢的 8 条：H2/E16（行1）、行2 一条、
// 行3 四条、末行第一条。
//
// 本脚本断言修复后的下限：62 项至少解析出 60 条，且 H2 必须出现。
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const PORT = 46321;
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'));
const T = (truth.card1.entries ?? truth.card1);

const vite = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageexception]', String(e).slice(0, 200)));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 60000 });

const out = await page.evaluate(async () => {
  const mod = await import('/src/utils/importLegend.ts');
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const bmp = await createImageBitmap(await (await fetch('/benchmark/images/dog-girl.png')).blob());
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const source = { data: img.data, width: img.width, height: img.height };
  const cols = 78, rows = 78;
  const cal = { originX: 0, originY: 0, cellWidth: bmp.width / cols, cellHeight: bmp.height / rows, columns: cols, rows };
  const run = (region) => {
    const r = mod.parseLegend(source, cal, BRAND_PALETTES.MARD, { gridRows: rows, gridCols: cols, region });
    return { ok: r.ok, n: r.entries.length, codes: r.entries.map(e => e.code || '?') };
  };
  return {
    full: run({ x0: 0, y0: 1136, x1: bmp.width - 1, y1: bmp.height - 1 }),
    // 首行（含 H2 白票）单独框
    row1: run({ x0: 0, y0: 1136, x1: bmp.width - 1, y1: 1155 }),
    // 末行（只有 5 条，且贴图片底边）
    row4: run({ x0: 0, y0: 1197, x1: bmp.width - 1, y1: bmp.height - 1 }),
  };
});

const tset = new Set(T.map(x => x[0]));
const fails = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!cond) fails.push(name);
};

check('整条解析 62 项出 ≥60 条', out.full.ok && out.full.n >= 60, `entries=${out.full.n}`);
check('整条解析含 H2（白票恢复）', out.full.codes.includes('H2'), `codes 前6=${out.full.codes.slice(0, 6).join(',')}`);
const hit = out.full.codes.filter(c => tset.has(c)).length;
check('集合级色号 ≥40', hit >= 40, `${hit}/${out.full.n}`);
check('首行 19 条出 ≥18', out.row1.ok && out.row1.n >= 18, `entries=${out.row1.n}`);
check('首行含 H2', out.row1.codes.includes('H2'));
check('末行 ≥4 条（贴底边不整行丢弃）', out.row4.ok && out.row4.n >= 4, `entries=${out.row4.n}`);

await browser.close();
await vite.close();
console.log(`\n${fails.length ? `FAILED ${fails.length}: ${fails.join('; ')}` : 'ALL PASS'}`);
process.exit(fails.length ? 1 : 0);
