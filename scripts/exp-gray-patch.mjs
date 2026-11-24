// 灰度感知 patch 实验：根因=4× 最近邻硬二值化丢失灰度边缘。
// 对照设计：同一种子集（oracle 真值种子）下，硬二值 bitmapJaccard vs
// 软灰度 softJaccard（Σmin/Σmax，双线性拉伸 + ±shift 搜索）的
// 1-NN 字典分类准确率 + 真码/冒名码分离度。
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
const paletteList = prepared.map(p => p.color.code);

// ---- 软灰度 patch ----
function softPatch(colorBuf, bg, x0, y0, x1, y1, scale) {
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = ((y0 + y) * colorBuf.width + (x0 + x)) * 4;
      const dr = colorBuf.data[i] - bg[0], dg = colorBuf.data[i + 1] - bg[1], db = colorBuf.data[i + 2] - bg[2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      data[y * w + x] = Math.min(1, dist / scale);
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

/** 软 Jaccard：Σmin/Σmax（二值 {0,1} 时退化为 inter/union）。 */
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

// 模板池构建：每字符取最大自相似组（阈值参数化）
function buildTemplates(patches, codes, dist, thr) {
  const pools = new Map();
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const glyphs = patches[i];
    if (!code || !glyphs || glyphs.length !== code.length) continue;
    glyphs.forEach((g, j) => {
      if (!pools.has(code[j])) pools.set(code[j], []);
      pools.get(code[j]).push(g);
    });
  }
  const templates = new Map();
  const intra = [];
  for (const [ch, arr] of pools) {
    let bestGroup = null;
    for (let s = 0; s < arr.length; s++) {
      const group = [];
      for (let t = 0; t < arr.length; t++) if (dist(arr[s], arr[t]) <= thr) group.push(arr[t]);
      if (!bestGroup || group.length > bestGroup.length) bestGroup = group;
    }
    if (bestGroup && bestGroup.length >= 2) {
      templates.set(ch, bestGroup);
      // 组内距离统计（除自身）
      for (let s = 0; s < bestGroup.length; s++) {
        for (let t = s + 1; t < bestGroup.length; t++) intra.push(dist(bestGroup[s], bestGroup[t]));
      }
    } else if (bestGroup && bestGroup.length === 1 && arr.length <= 2) templates.set(ch, bestGroup);
  }
  return { templates, pools, intra };
}

// 条目级字典 1-NN 分类：全字典等长码打分，报告 argmax 命中 + 分离度
function evalDict(patches, truthSeq, templates, dist) {
  let hit = 0, total = 0, haveAll = 0;
  const margins = [];
  const details = [];
  for (let i = 0; i < truthSeq.length; i++) {
    const t = truthSeq[i];
    const glyphs = patches[i];
    if (!glyphs || glyphs.length !== t.length) continue;
    const len = t.length;
    total += 1;
    let miss = false;
    const scored = [];
    for (const code of paletteList) {
      if (code.length !== len) continue;
      let sum = 0;
      let ok = true;
      for (let j = 0; j < len; j++) {
        const group = templates.get(code[j]);
        if (!group) { ok = false; break; }
        let best = 1;
        for (const bmp of group) best = Math.min(best, dist(glyphs[j], bmp));
        sum += 1 - best;
      }
      if (!ok) continue;
      scored.push({ code, score: sum / len });
    }
    if (!scored.length) continue;
    haveAll += 1;
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    const truthScore = scored.find(s => s.code === t);
    if (top.code === t) hit += 1;
    const margin = truthScore ? top.score - truthScore.score : null;
    if (margin !== null && top.code !== t) margins.push(margin);
    if (top.code !== t) details.push(`#${i} ${t}→${top.code}(sep ${(margin ?? 0).toFixed(3)})`);
  }
  return { hit, total, haveAll, margins, details };
}

const INK_SCALE = Number(process.env.INK_SCALE ?? 160);
console.log(`INK_SCALE=${INK_SCALE}`);

for (const card of ['card1', 'card3']) {
  const { data, info } = await sharp(`benchmark/images/${card}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
  const collected = m.collectCardEntries(source);
  if (!collected) { console.log(card, 'collect null'); continue; }
  const { splits, digitW } = collected;
  // oracle 种子 = 真值码（测纯 patch 区分度，排除毒种子干扰）
  const truthEntries = truth[card].entries ?? truth[card];
  const truthSeq = truthEntries.map(e => e[0]);

  // 硬二值 bitmap
  const hardPatches = splits.map(s => s ? s.codeGlyphs.map(g => g.bitmap) : null);
  // 软灰度 patch（从双线性 color 缓冲按 bbox 提取）
  const bgNative = m.cardPageBg(source);
  const colorBuf = m.upscalePixelsBilinear(source, 4);
  const softPatches = splits.map(s => s ? s.codeGlyphs.map(g => softPatch(colorBuf, bgNative, g.x0, g.y0, g.x1, g.y1, INK_SCALE)) : null);

  console.log(`\n===== ${card}（真值 ${truthSeq.length} 条，oracle 种子） =====`);
  for (const [name, dist, thr] of [['硬二值', hardDist, 0.24], ['软灰度', softDist, 0.24], ['软灰度-t30', softDist, 0.30], ['软灰度-t35', softDist, 0.35]]) {
    const { templates, pools, intra } = buildTemplates(name.startsWith('软') ? softPatches : hardPatches, truthSeq, dist, thr);
    intra.sort((a, b) => a - b);
    const med = intra.length ? intra[Math.floor(intra.length / 2)] : NaN;
    const p90 = intra.length ? intra[Math.floor(intra.length * 0.9)] : NaN;
    const { hit, total, haveAll, margins, details } = evalDict(name.startsWith('软') ? softPatches : hardPatches, truthSeq, templates, dist);
    margins.sort((a, b) => a - b);
    const medMargin = margins.length ? margins[Math.floor(margins.length / 2)] : NaN;
    console.log(`[${name}] 模板字符 ${templates.size} 池[${[...pools.entries()].map(([c, a]) => c + ':' + a.length).join(' ')}] 组内中位 ${med.toFixed(3)} p90 ${p90.toFixed(3)} | 1-NN 命中 ${hit}/${total}（可评 ${haveAll}）冒名中位分离 ${medMargin.toFixed(3)}`);
    if (details.length && details.length <= 12) console.log('  误判: ' + details.join(' '));
  }
}
await vite.close();
