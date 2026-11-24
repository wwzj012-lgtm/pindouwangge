// 渲染三联对比：手动解析 / 识别结果 / 差异高亮
import sharp from 'sharp';
import { readFileSync } from 'fs';

const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
const { manual, recCodes } = JSON.parse(readFileSync(`${OUT}/manual_vs_rec.json`, 'utf8'));
const { BRAND_PALETTES } = await (async () => { const { createServer } = await import('vite'); const ROOT = 'D:/Build_Apps/pindouwangge'; const v = await createServer({ root: ROOT, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: ROOT + '/vite.config.ts' }); const m = await v.ssrLoadModule('/src/data/palettes.ts'); await v.close(); return m; })();
const rgbOf = {};
for (const c of BRAND_PALETTES.MARD) rgbOf[c.code] = c.rgb;
const R = 14, GAP = 6;
const rows = manual.length, cols = manual[0].length;

const renderGrid = (codes, tag) => {
  const rects = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const code = codes[r]?.[c];
    const rgb = code && rgbOf[code] ? rgbOf[code].join(',') : '255,255,255';
    rects.push(`<rect x="${c * R}" y="${r * R}" width="${R}" height="${R}" fill="rgb(${rgb})" stroke="#ddd" stroke-width="0.3"/>`);
  }
  return { rects, w: cols * R, h: rows * R };
};
const a = renderGrid(manual.map(row => row.map(e => e ? (e.code === '?' ? null : e.code) : null)), 'manual');
const b = renderGrid(recCodes, 'rec');
// 差异图：一致=白灰，错色=红，空白差异=黄
const drects = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const mc = manual[r]?.[c]?.code ?? null;
  const rc = recCodes[r]?.[c] ?? null;
  let fill = '#f1f5f9';
  if (mc === '?') fill = '#94a3b8';
  else if (mc && rc && mc !== rc) fill = '#ef4444';
  else if (mc && !rc) fill = '#f59e0b';
  else if (!mc && rc) fill = '#3b82f6';
  drects.push(`<rect x="${c * R}" y="${r * R}" width="${R}" height="${R}" fill="${fill}" stroke="#e2e8f0" stroke-width="0.3"/>`);
}
const W = a.w * 3 + GAP * 2, H = a.h + 40;
const panel = (g, x, label) => `<g><rect x="${x}" y="0" width="${g.w}" height="30" fill="#1e293b"/><text x="${x + g.w / 2}" y="21" text-anchor="middle" font-size="15" fill="#fff" font-family="Microsoft YaHei">${label}</text><g transform="translate(${x},30)">${g.rects.join('')}</g></g>`;
const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>${panel(a, 0, '手动图纸(解析)')}${panel(b, a.w + GAP, '自动识别(色号辅助)')}${panel({ rects: drects, w: a.w, h: a.h }, (a.w + GAP) * 2, '差异: 红=错色 黄=多拼 蓝=漏拼')}</svg>`;
await sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).png().toFile(`${OUT}/manual_vs_rec_compare.png`);
console.log('->', `${OUT}/manual_vs_rec_compare.png`, W, 'x', H);
