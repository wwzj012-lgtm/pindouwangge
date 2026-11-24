// 阶段1 实验：颜色 top6 宽候选池 × 字符模板打分 → cardJointSolve 联合裁决
// 严格口径指标：精确率（对/输出）、召回率（对/真值）、uncertain 占比。
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync } from 'fs';

process.chdir('D:/Build_Apps/pindouwangge');

const vite = await createServer({
  root: process.cwd(), appType: 'custom',
  server: { middlewareMode: true }, logLevel: 'error',
  optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts',
});
const m = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { rgbToLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'));

const card = process.argv[2] ?? 'card1';
const palette = BRAND_PALETTES.MARD;
const prepared = palette
  .filter(c => c.enabled !== false)
  .map(c => ({ color: c, lab: rgbToLab(...c.rgb) }));

// ---- 字符模板：bold sans-serif SVG 渲染 → bbox 裁剪 → Bitmap（1=笔画） ----
const chars = [...new Set(prepared.flatMap(p => p.color.code.split('')))].sort();
const templates = new Map();
for (const ch of chars) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="320"><rect width="260" height="320" fill="#fff"/><text x="30" y="250" font-family="sans-serif" font-weight="bold" font-size="200" fill="#000">${ch}</text></svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).raw().toBuffer({ resolveWithObject: true });
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    if (data[i] < 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y0 + y) * info.width + (x0 + x)) * info.channels;
    bits[y * w + x] = data[i] < 128 ? 1 : 0;
  }
  templates.set(ch, { data: bits, w, h });
}
console.log('模板字符数', templates.size, '字符集', [...templates.keys()].join(''));

// ---- 卡图 → 条目收集 → 联合求解 ----
const { data, info } = await sharp(`benchmark/images/${card}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const collected = m.collectCardEntries(source);
if (!collected) { console.log(card, 'collectCardEntries null'); process.exit(1); }
const resolved = m.cardJointSolve(collected.rawEntries, collected.splits, prepared, templates);

const truthEntries = truth[card].entries ?? truth[card];
const truthSeq = truthEntries.map(e => (Array.isArray(e) ? e[0] : e.code));

let hit = 0, out = 0, uncertain = 0;
const detail = [];
for (let i = 0; i < Math.max(resolved.length, truthSeq.length); i++) {
  const r = resolved[i], t = truthSeq[i];
  if (r) out++;
  else uncertain++;
  if (r && r.code === t) hit++;
  detail.push(`#${i} ${t}/${r ? r.code : '—'}${r && r.code === t ? '✓' : ''}`);
}
console.log(`${card} 色号: 对 ${hit} | 输出 ${out} | uncertain ${uncertain} | 真值 ${truthSeq.length}`);
console.log(`精确率 ${out ? (hit / out * 100).toFixed(0) : 0}% | 召回 ${(hit / truthSeq.length * 100).toFixed(0)}%`);
console.log(detail.join(' '));
await vite.close();
