// 测量 card 字形 bitmapJaccard 距离分布：同字符 vs 异字符（以 truth 为参照）
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync } from 'fs';

const card = process.argv[2] ?? 'card1';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { debugColorCardParse } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { data, info } = await sharp(`benchmark/images/${card}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const dbg = debugColorCardParse(source);
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'))[card];
if (!dbg || !truth) { console.log('missing dbg/truth'); await vite.close(); process.exit(1); }

// 每条目的 code 字形序列（glyphDump 内 code kind 按出现顺序）
const codeGlyphs = new Map();
for (const g of dbg.glyphDump) {
  if (g.kind !== 'code') continue;
  if (!codeGlyphs.has(g.i)) codeGlyphs.set(g.i, []);
  codeGlyphs.get(g.i).push(g);
}
// jaccard（与 src 版同口径：拉伸 + ±2 平移搜索）
const jaccard = (a, b) => {
  const w = Math.max(a.w, b.w), h = Math.max(a.h, b.h);
  const stretch = (g) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) {
      const sy = Math.min(g.h - 1, Math.floor(y * g.h / h));
      for (let x = 0; x < w; x += 1) {
        const sx = Math.min(g.w - 1, Math.floor(x * g.w / w));
        out[y * w + x] = g.rows[sy][sx] === '1' ? 1 : 0;
      }
    }
    return out;
  };
  const sa = stretch(a), sb = stretch(b);
  let best = 1;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      let inter = 0, union = 0;
      for (let y = 0; y < h; y += 1) {
        const ay = y + dy;
        if (ay < 0 || ay >= h) continue;
        for (let x = 0; x < w; x += 1) {
          const ax = x + dx;
          const av = ax >= 0 && ax < w ? sa[ay * w + ax] : 0;
          const bv = sb[y * w + x];
          if (av && bv) inter += 1;
          if (av || bv) union += 1;
        }
      }
      if (union) best = Math.min(best, 1 - inter / union);
    }
  }
  return best;
};

// 真值对齐：truth.entries 按行序（62 slots）
const entries = dbg.items.map((it, i) => {
  const t = truth.entries[i];
  return { glyphs: codeGlyphs.get(i) ?? [], truthCode: t ? t[0] : null };
});
const same = [], diff = [];
const pairs = new Map();
for (let a = 0; a < entries.length; a += 1) {
  const ea = entries[a];
  if (!ea.truthCode || ea.glyphs.length !== ea.truthCode.length) continue;
  for (let b = a + 1; b < entries.length; b += 1) {
    const eb = entries[b];
    if (!eb.truthCode || eb.glyphs.length !== eb.truthCode.length) continue;
    for (let ja = 0; ja < ea.truthCode.length; ja += 1) {
      for (let jb = 0; jb < eb.truthCode.length; jb += 1) {
        const ga = ea.glyphs[ja], gb = eb.glyphs[jb];
        if (Math.abs(ga.w - gb.w) > 4) continue;
        const d = jaccard(ga, gb);
        const key = `${ea.truthCode[ja]}${ea.truthCode[ja] === eb.truthCode[jb] ? '=' : '!'}${eb.truthCode[jb]}`;
        const bucket = pairs.get(key) ?? [];
        bucket.push(d);
        pairs.set(key, bucket);
        if (ea.truthCode[ja] === eb.truthCode[jb]) same.push(d); else diff.push(d);
      }
    }
  }
}
const hist = (arr) => {
  const bins = new Array(11).fill(0);
  for (const d of arr) bins[Math.min(10, Math.floor(d * 10))] += 1;
  return bins.map((c, i) => `${(i * 0.1).toFixed(1)}:${c}`).join(' ');
};
console.log(`same-char pairs: ${same.length}  median ${(same.sort((a, b) => a - b)[Math.floor(same.length / 2)] ?? 0).toFixed(3)}`);
console.log(`  ${hist(same)}`);
console.log(`diff-char pairs: ${diff.length}  median ${(diff.sort((a, b) => a - b)[Math.floor(diff.length / 2)] ?? 0).toFixed(3)}`);
console.log(`  ${hist(diff)}`);
console.log('--- 最易混淆的异字符对（平均距离最小 top20）---');
for (const [k, arr] of [...pairs.entries()].filter(([k]) => k.includes('!')).sort((x, y) => x[1].reduce((s, v) => s + v, 0) / x[1].length - y[1].reduce((s, v) => s + v, 0) / y[1].length).slice(0, 20)) {
  const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
  console.log(`  ${k} n=${arr.length} avg=${avg.toFixed(3)} min=${Math.min(...arr).toFixed(3)}`);
}
await vite.close();
