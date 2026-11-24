// 灰度感知端到端求解实验：自体种子（管线输出无 warn）+ 软灰度模板 +
// text×color 联合裁决。对照：硬二值距离 vs 软灰度距离；自体种子 vs oracle 真值种子。
// 联合分 = W_T * text + W_C * color（color = 1 - ΔE/ΔE_MAX，无先验时纯 text）。
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync } from 'fs';

const vite = await createServer({
  root: process.cwd(), appType: 'custom',
  server: { middlewareMode: true }, logLevel: 'error',
  optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts',
});
const m = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { rgbToLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'));

const prepared = BRAND_PALETTES.MARD
  .filter(c => c.enabled !== false)
  .map(c => ({ color: c, lab: rgbToLab(...c.rgb) }));
const paletteCodes = new Set(prepared.map(p => p.color.code));
const paletteList = prepared.map(p => p.color.code);

const W_T = 0.7, W_C = 0.3;
const DE_MAX = 40;
const JOINT_MIN = 0.5, MARGIN = 0.02;
const THR = Number(process.env.THR ?? 0.30);
const INK_SCALE = 160;

// ---- 软灰度 patch（与 exp-gray-patch 相同） ----
function softPatch(colorBuf, bg, x0, y0, x1, y1) {
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = ((y0 + y) * colorBuf.width + (x0 + x)) * 4;
      const dr = colorBuf.data[i] - bg[0], dg = colorBuf.data[i + 1] - bg[1], db = colorBuf.data[i + 2] - bg[2];
      data[y * w + x] = Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / INK_SCALE);
    }
  }
  return { data, w, h };
}
function resizeSoftBilinear(b, w, h) {
  if (b.w === w && b.h === h) return b;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const sy = (y + 0.5) * b.h / h - 0.5;
    const y0 = Math.max(0, Math.min(b.h - 1, Math.floor(sy)));
    const y1 = Math.min(b.h - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sy - y0));
    for (let x = 0; x < w; x += 1) {
      const sx = (x + 0.5) * b.w / w - 0.5;
      const x0 = Math.max(0, Math.min(b.w - 1, Math.floor(sx)));
      const x1 = Math.min(b.w - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const v00 = b.data[y0 * b.w + x0], v01 = b.data[y0 * b.w + x1];
      const v10 = b.data[y1 * b.w + x0], v11 = b.data[y1 * b.w + x1];
      data[y * w + x] = (v00 * (1 - fx) + v01 * fx) * (1 - fy) + (v10 * (1 - fx) + v11 * fx) * fy;
    }
  }
  return { data, w, h };
}
function softDist(a, b, shift = 2) {
  const w = Math.max(a.w, b.w), h = Math.max(a.h, b.h);
  const sa = resizeSoftBilinear(a, w, h), sb = resizeSoftBilinear(b, w, h);
  let best = 1;
  for (let dy = -shift; dy <= shift; dy += 1) {
    for (let dx = -shift; dx <= shift; dx += 1) {
      let inter = 0, union = 0;
      for (let y = 0; y < h; y += 1) {
        const ay = y + dy;
        if (ay < 0 || ay >= h) continue;
        for (let x = 0; x < w; x += 1) {
          const ax = x + dx;
          const av = ax >= 0 && ax < w ? sa.data[ay * w + ax] : 0;
          const bv = sb.data[y * w + x];
          inter += Math.min(av, bv);
          union += Math.max(av, bv);
        }
      }
      const d = union === 0 ? 1 : 1 - inter / union;
      if (d < best) best = d;
    }
  }
  return best;
}
const hardDist = (a, b) => m.bitmapJaccard(a, b);

function buildTemplates(patches, seedCodes, dist, thr) {
  const pools = new Map();
  for (let i = 0; i < seedCodes.length; i++) {
    const code = seedCodes[i];
    const glyphs = patches[i];
    if (!code || !glyphs || glyphs.length !== code.length) continue;
    glyphs.forEach((g, j) => {
      if (!pools.has(code[j])) pools.set(code[j], []);
      pools.get(code[j]).push(g);
    });
  }
  const templates = new Map();
  for (const [ch, arr] of pools) {
    let bestGroup = null;
    for (let s = 0; s < arr.length; s++) {
      const group = [];
      for (let t = 0; t < arr.length; t++) if (dist(arr[s], arr[t]) <= thr) group.push(arr[t]);
      if (!bestGroup || group.length > bestGroup.length) bestGroup = group;
    }
    if (bestGroup && bestGroup.length >= 2) templates.set(ch, bestGroup);
    else if (bestGroup && bestGroup.length === 1 && arr.length <= 2) templates.set(ch, bestGroup);
  }
  return templates;
}

function textScore(glyphs, code, templates, dist) {
  if (glyphs.length !== code.length) return null;
  let sum = 0;
  for (let j = 0; j < glyphs.length; j++) {
    const group = templates.get(code[j]);
    if (!group) return null;
    let best = 1;
    for (const bmp of group) best = Math.min(best, dist(glyphs[j], bmp));
    sum += 1 - best;
  }
  return sum / glyphs.length;
}

// 联合裁决：种子保留 + 未解条目 joint 分裁决 + 全局唯一性（并列撞码保留高分者）
function jointSolve(seedCodes, patches, priors, templates, dist) {
  const resolved = seedCodes.map(c => (c && paletteCodes.has(c)) ? { code: c } : null);
  const n = seedCodes.length;
  const cand = [];
  for (let i = 0; i < n; i++) {
    if (resolved[i]) continue;
    const glyphs = patches[i];
    if (!glyphs || !glyphs.length) continue;
    const prior = priors[i];
    const L = glyphs.length;
    const scored = paletteList
      .filter(c => c.length === L)
      .map(c => {
        const text = textScore(glyphs, c, templates, dist);
        if (text === null) return null;
        const color = prior ? Math.max(0, 1 - prior.deltaE / DE_MAX) : null;
        const joint = color === null ? text * (W_T + W_C) : W_T * text + W_C * color;
        return { code: c, text, color, joint };
      })
      .filter(Boolean)
      .sort((a, b) => b.joint - a.joint);
    cand.push({ i, scored });
  }
  // margin 裁决
  for (const { i, scored } of cand) {
    if (!scored.length) continue;
    const t1 = scored[0], t2 = scored[1];
    if (t1.joint >= JOINT_MIN && (!t2 || t1.joint - t2.joint >= MARGIN)) resolved[i] = { code: t1.code };
  }
  // 撞码消解：同码多实例保留 joint 最高者（未裁决者直接 null）
  const best = new Map();
  for (let i = 0; i < n; i++) {
    if (!resolved[i]) continue;
    const code = resolved[i].code;
    if (!best.has(code)) best.set(code, i);
    else {
      const j = best.get(code);
      const si = scoreOf(resolved[i], i), sj = scoreOf(resolved[j], j);
      if (si > sj) { best.set(code, i); resolved[j] = null; }
      else resolved[i] = null;
    }
  }
  function scoreOf(r, i) {
    const glyphs = patches[i];
    const prior = priors[i];
    const text = glyphs ? (textScore(glyphs, r.code, templates, dist) ?? 0) : 0;
    const color = prior ? Math.max(0, 1 - prior.deltaE / DE_MAX) : 0;
    return color === null ? text : W_T * text + W_C * color;
  }
  return resolved;
}

for (const card of ['card1', 'card3']) {
  const { data, info } = await sharp(`benchmark/images/${card}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
  const collected = m.collectCardEntries(source);
  if (!collected) { console.log(card, 'collect null'); continue; }
  const { rawEntries, splits, digitW } = collected;
  const priors = rawEntries.map(e => e.dotRgb ? m.priorFromDot(e.dotRgb, prepared) : null);
  for (let i = 0; i < splits.length; i++) {
    if (splits[i] && priors[i] && priors[i].deltaE <= 6) m.sliceMergedCodeGlyphs(splits[i], priors[i], digitW);
  }
  const anchors = m.resolveCodes(rawEntries, splits, priors, prepared);
  const refined = m.cardRefineCodes(rawEntries, splits, anchors, prepared);
  const { entries } = m.recognizeLegendEntries(rawEntries, splits, priors, refined, prepared, paletteCodes, digitW);

  const truthEntries = truth[card].entries ?? truth[card];
  const truthSeq = truthEntries.map(e => e[0]);

  // 种子：管线最终输出无 warn 的色板内码
  const selfSeeds = rawEntries.map((_, i) => {
    const e = entries[i];
    if (!e || !e.code || !paletteCodes.has(e.code)) return null;
    if ((e.warn ?? '').includes('codeFromSwatch')) return null;
    return e.code;
  });
  const oracleSeeds = truthSeq;

  const bgNative = m.cardPageBg(source);
  const colorBuf = m.upscalePixelsBilinear(source, 4);
  const softPatches = splits.map(s => s ? s.codeGlyphs.map(g => softPatch(colorBuf, bgNative, g.x0, g.y0, g.x1, g.y1)) : null);
  const hardPatches = splits.map(s => s ? s.codeGlyphs.map(g => g.bitmap) : null);

  const seedPurity = (seeds) => {
    let s = 0, h = 0;
    seeds.forEach((c, i) => { if (c) { s += 1; if (c === truthSeq[i]) h += 1; } });
    return `${h}/${s}`;
  };

  console.log(`\n===== ${card}（真值 ${truthSeq.length}） THR=${THR} 自体种子纯度 ${seedPurity(selfSeeds)} =====`);
  const configs = [
    ['自体+硬二值', selfSeeds, hardPatches, hardDist],
    [`自体+软灰度t${THR}`, selfSeeds, softPatches, softDist],
    ['oracle+硬二值', oracleSeeds, hardPatches, hardDist],
    [`oracle+软灰度t${THR}`, oracleSeeds, softPatches, softDist],
  ];
  for (const [name, seeds, patches, dist] of configs) {
    const templates = buildTemplates(patches, seeds, dist, THR);
    const resolved = jointSolve(seeds, patches, priors, templates, dist);
    let hit = 0, out = 0;
    const detail = [];
    for (let i = 0; i < truthSeq.length; i++) {
      const r = resolved[i], t = truthSeq[i];
      if (r) out++;
      if (r && r.code === t) hit++;
      else if (r) detail.push(`#${i}${t}/${r.code}`);
    }
    console.log(`[${name}] 模板 ${templates.size}字 | 对 ${hit} 输出 ${out} | 精确 ${out ? (hit / out * 100).toFixed(0) : 0}% 召回 ${(hit / truthSeq.length * 100).toFixed(0)}%${detail.length ? '\n  误判: ' + detail.join(' ') : ''}`);
  }
}
await vite.close();
