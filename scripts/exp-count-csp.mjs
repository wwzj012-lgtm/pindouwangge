// 实验 v2：count 簇 + 代码数字模板距离排序 + 单调性剪枝 DFS
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync } from 'fs';

const card = process.argv[2] ?? 'card3';
const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'));
const truthEntries = new Map(truth[card].entries);

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const m = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp(`benchmark/images/${card}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const dbg = m.debugColorCardParse(source, BRAND_PALETTES.MARD);
await vite.close();
if (!dbg) { console.log('dbg null'); process.exit(0); }

const toBitmap = (g) => {
  const d = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) d[y * g.w + x] = g.rows[y][x] === '1' ? 1 : 0;
  return { data: d, w: g.w, h: g.h };
};

// ---- code 字形标签（来自 resolved 码，长度匹配才标） ----
const codeByItem = new Map();
for (const g of dbg.glyphDump) {
  if (g.kind !== 'code') continue;
  if (!codeByItem.has(g.i)) codeByItem.set(g.i, []);
  codeByItem.get(g.i).push(g);
}
const digitBitmaps = new Map(); // char -> Bitmap[]
for (const [i, gs] of codeByItem) {
  const code = dbg.items[i]?.resolved;
  if (!code || code.length !== gs.length) continue;
  gs.forEach((g, j) => {
    const ch = code[j];
    if (ch < '0' || ch > '9') return;
    if (!digitBitmaps.has(ch)) digitBitmaps.set(ch, []);
    digitBitmaps.get(ch).push(toBitmap(g));
  });
}
console.log('代码数字锚:', [...digitBitmaps.entries()].map(([c, a]) => c + 'x' + a.length).join(' '));

// ---- count 字形 ----
const byItem = new Map();
for (const g of dbg.glyphDump) {
  if (g.kind !== 'count') continue;
  if (!byItem.has(g.i)) byItem.set(g.i, []);
  byItem.get(g.i).push(g);
}
const items = [...byItem.keys()].sort((a, b) => a - b);
const glyphs = [];
for (const i of items) byItem.get(i).forEach((g, j) => glyphs.push({ i, j, g, bm: toBitmap(g) }));

// ---- 聚类（宽差≤3、高差≤5、Jaccard<0.18 平均连接） ----
const n = glyphs.length;
const D = [];
for (let a = 0; a < n; a++) {
  D.push(new Float32Array(n));
  for (let b = 0; b < n; b++) {
    if (a === b) continue;
    if (Math.abs(glyphs[a].g.w - glyphs[b].g.w) > 3 || Math.abs(glyphs[a].g.h - glyphs[b].g.h) > 5) { D[a][b] = 1; continue; }
    D[a][b] = m.bitmapJaccard(glyphs[a].bm, glyphs[b].bm);
  }
}
const members = glyphs.map((_, k) => [k]);
const active = glyphs.map(() => true);
for (;;) {
  let ba = -1, bb = -1, bv = 0.18;
  for (let a = 0; a < n; a++) { if (!active[a]) continue; for (let b = a + 1; b < n; b++) { if (!active[b]) continue; if (D[a][b] < bv) { bv = D[a][b]; ba = a; bb = b; } } }
  if (ba < 0) break;
  const na = members[ba].length, nb = members[bb].length;
  for (let x = 0; x < n; x++) {
    if (!active[x] || x === ba || x === bb) continue;
    D[ba][x] = D[x][ba] = (na * D[ba][x] + nb * D[bb][x]) / (na + nb);
  }
  members[ba] = [...members[ba], ...members[bb]];
  active[bb] = false;
}
const rootOf = new Map();
const clusterBitmaps = [];
for (let k = 0; k < n; k++) {
  if (!active[k]) continue;
  const id = clusterBitmaps.length;
  clusterBitmaps.push(members[k].map(idx => glyphs[idx].bm));
  for (const idx of members[k]) rootOf.set(`${glyphs[idx].i}:${glyphs[idx].j}`, id);
}
console.log('clusters:', clusterBitmaps.length, 'sizes:', clusterBitmaps.map(c => c.length).sort((a, b) => b - a).slice(0, 12).join(','));

const entriesSeq = items.map(i => ({ i, seq: byItem.get(i).map((_, j) => rootOf.get(`${i}:${j}`)) }));

// ---- 模板距离：簇 → 各数字的最小距离排序 ----
const clusterDigitOrder = clusterBitmaps.map(bms => {
  const dists = [];
  for (const [ch, list] of digitBitmaps) {
    let best = 1;
    for (const a of bms) for (const b of list) best = Math.min(best, m.bitmapJaccard(a, b));
    dists.push({ ch, d: best });
  }
  dists.sort((x, y) => x.d - y.d);
  return dists.map(x => x.ch);
});

// ---- DFS：单调降序 + 首位非 0 + 模板序优先 ----
const order = [];
const seenC = new Set();
for (const e of entriesSeq) for (const c of e.seq) if (!seenC.has(c)) { seenC.add(c); order.push(c); }
const values = new Map();
let nodes = 0, solution = null;
const valueOf = (k) => {
  if (k < 0 || k >= entriesSeq.length) return null;
  let v = 0;
  for (const c of entriesSeq[k].seq) { const d = values.get(c); if (d === undefined) return null; v = v * 10 + d; }
  return v;
};
const dfs = (oi) => {
  if (solution || nodes > 2000000) return;
  if (oi >= order.length) {
    for (let k = 0; k + 1 < entriesSeq.length; k++) if (valueOf(k) < valueOf(k + 1)) return;
    solution = new Map(values);
    return;
  }
  const c = order[oi];
  const firstOfSome = entriesSeq.some(e => e.seq[0] === c);
  for (const d of clusterDigitOrder[c]) {
    if (firstOfSome && (d === 0 || d === '0')) continue;
    nodes++;
    values.set(c, d);
    let ok = true;
    for (let k = 0; k < entriesSeq.length && ok; k++) {
      if (!entriesSeq[k].seq.includes(c)) continue;
      const v = valueOf(k);
      if (v === null) continue;
      const prev = valueOf(k - 1);
      if (prev !== null && prev < v) ok = false;
      const next = valueOf(k + 1);
      if (ok && next !== null && v < next) ok = false;
    }
    if (ok) dfs(oi + 1);
    values.delete(c);
    if (solution) return;
  }
};
dfs(0);
if (!solution) { console.log('CSP 无解 (nodes=' + nodes + ')'); process.exit(0); }
console.log('CSP 解:', order.map(c => `c${c}=${solution.get(c)}`).join(' '));
let hit = 0, total = 0;
const misses = [];
for (const e of entriesSeq) {
  const v = e.seq.reduce((acc, c) => acc * 10 + solution.get(c), 0);
  const t = truthEntries.get(dbg.items[e.i]?.prior);
  if (t === undefined) continue;
  total++;
  if (v === t) hit++; else misses.push(`#${e.i}:${v}≠${t}`);
}
console.log(`数量命中 ${hit}/${total}`, misses.slice(0, 10).join(' '));
