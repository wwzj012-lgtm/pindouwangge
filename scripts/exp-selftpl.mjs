// 自体模板实验 v2：种子 = 管线最终输出（recognizeLegendEntries）中无 warn
// 的可靠码（颜色建议 codeFromSwatch 的码没有字形证据，不进模板池，只做
// 交叉校验）。cardRefineCodes 对 card3 崩坏（1/27），最终输出才是 38 对。
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

const prepared = BRAND_PALETTES.MARD
  .filter(c => c.enabled !== false)
  .map(c => ({ color: c, lab: rgbToLab(...c.rgb) }));
const paletteCodes = new Set(prepared.map(p => p.color.code));
const paletteList = prepared.map(p => p.color.code);

const dist = (a, b) => m.bitmapJaccard(a, b);

function buildTemplates(splits, seedCodes) {
  const pools = new Map();
  for (let i = 0; i < seedCodes.length; i++) {
    const code = seedCodes[i];
    const split = splits[i];
    if (!code || !split || split.codeGlyphs.length !== code.length) continue;
    split.codeGlyphs.forEach((g, j) => {
      if (!pools.has(code[j])) pools.set(code[j], []);
      pools.get(code[j]).push(g.bitmap);
    });
  }
  const templates = new Map();
  for (const [ch, bmps] of pools) {
    let bestGroup = null;
    for (let s = 0; s < bmps.length; s++) {
      const group = [];
      for (let t = 0; t < bmps.length; t++) if (dist(bmps[s], bmps[t]) <= 0.24) group.push(bmps[t]);
      if (!bestGroup || group.length > bestGroup.length) bestGroup = group;
    }
    if (bestGroup && bestGroup.length >= 2) templates.set(ch, bestGroup);
    else if (bestGroup && bestGroup.length === 1 && bmps.length <= 2) templates.set(ch, bestGroup);
  }
  return { templates, pools };
}

function textScore(glyphs, code, templates) {
  if (glyphs.length !== code.length) return null;
  let sum = 0;
  for (let j = 0; j < glyphs.length; j++) {
    const group = templates.get(code[j]);
    if (!group) return null;
    let best = 1;
    for (const bmp of group) best = Math.min(best, dist(glyphs[j].bitmap, bmp));
    sum += 1 - best;
  }
  return sum / glyphs.length;
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

  // 种子 = 最终输出中无 warn 的色板内码（字形证据可信）
  const seedCodes = rawEntries.map((_, i) => {
    const e = entries[i];
    if (!e || !e.code || !paletteCodes.has(e.code)) return null;
    if ((e.warn ?? '').includes('codeFromSwatch')) return null;
    return e.code;
  });
  const truthEntries = truth[card].entries ?? truth[card];
  const truthSeq = truthEntries.map(e => e[0]);
  const seedHit = seedCodes.reduce((s, c, i) => s + (c && c === truthSeq[i] ? 1 : 0), 0);
  console.log(`${card} 种子 ${seedCodes.filter(Boolean).length} 个，命中 ${seedHit}（纯度 ${(seedHit / Math.max(1, seedCodes.filter(Boolean).length) * 100).toFixed(0)}%）`);

  const { templates, pools } = buildTemplates(splits, seedCodes);
  console.log(`模板字符 ${templates.size} 池 [${[...pools.entries()].map(([ch, arr]) => ch + ':' + arr.length).join(' ')}]`);

  // 重裁决：种子保留 + 未解条目全等长词典 text 分裁决
  const resolved = rawEntries.map((_, i) => seedCodes[i] ? { code: seedCodes[i], deltaE: null, unique: false } : null);
  const uncertain = [];
  for (let i = 0; i < rawEntries.length; i++) {
    if (resolved[i]) continue;
    const split = splits[i];
    if (!split || !split.codeGlyphs.length) { uncertain.push(i); continue; }
    const L = split.codeGlyphs.length;
    const scored = paletteList
      .filter(c => c.length === L)
      .map(c => ({ code: c, text: textScore(split.codeGlyphs, c, templates) }))
      .filter(x => x.text !== null)
      .sort((a, b) => b.text - a.text);
    if (!scored.length) { uncertain.push(i); continue; }
    const t1 = scored[0], t2 = scored[1];
    if (t1.text >= 0.62 && (!t2 || t1.text - t2.text >= 0.06)) resolved[i] = { code: t1.code, deltaE: null, unique: false };
    else uncertain.push(i);
  }
  const seen = new Map();
  resolved.forEach((r, i) => { if (r) { const l = seen.get(r.code) ?? []; l.push(i); seen.set(r.code, l); } });
  for (const l of seen.values()) if (l.length > 1) for (const i of l) resolved[i] = null;

  let hit = 0, out = 0;
  const detail = [];
  for (let i = 0; i < truthSeq.length; i++) {
    const r = resolved[i], t = truthSeq[i];
    if (r) out++;
    if (r && r.code === t) hit++;
    detail.push(`#${i} ${t}/${r ? r.code : '—'}${r && r.code === t ? '✓' : ''}`);
  }
  console.log(`${card} 重裁决: 对 ${hit} 输出 ${out} uncertain ${uncertain.length} 真值 ${truthSeq.length} | 精确 ${out ? (hit / out * 100).toFixed(0) : 0}% 召回 ${(hit / truthSeq.length * 100).toFixed(0)}%`);
  console.log(detail.join(' '));
}
await vite.close();
