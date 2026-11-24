// 离线模拟：验证「图纸模式剔除印刷文字像素」的收益
// A = 现状（分类+ΔE合并+均值重分类）  B = 先剔文字再分类
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync } from 'fs';

const ORIG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
const ROOT = 'D:/Build_Apps/pindouwangge';
const { manual } = JSON.parse(readFileSync(`${OUT}/manual_vs_rec.json`, 'utf8'));

const vite = await createServer({ root: ROOT, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: ROOT + '/vite.config.ts' });
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const P = BRAND_PALETTES.MARD;

const labTable = P.map(c => ({ code: c.code, lab: labOf(c.rgb) }));
function labOf(rgb) {
  let [r, g, b] = rgb.map(v => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; });
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = t => t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const dE = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
const nearest = rgb => {
  const l = labOf(rgb);
  let bc = null, bd = Infinity;
  for (const e of labTable) { const d = dE(e.lab, l); if (d < bd) { bd = d; bc = e.code; } }
  return { code: bc, dist: bd, lab: l };
};

const { data, info } = await sharp(ORIG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const CW = 29.6, CH = 29.54, INSET = 0.1;

// 每格直方图（RGB key -> area），一次采样复用于 A/B
const hists = [];
for (let r = 0; r < manual.length; r++) {
  for (let c = 0; c < manual[0].length; c++) {
    if (!manual[r][c]) { hists.push(null); continue; }
    const left = (c + INSET) * CW, top = (r + INSET) * CH, right = (c + 1 - INSET) * CW, bottom = (r + 1 - INSET) * CH;
    const hist = new Map();
    for (let y = Math.floor(top); y < Math.ceil(bottom); y++) {
      const h = Math.min(bottom, y + 1) - Math.max(top, y);
      if (h <= 0) continue;
      for (let x = Math.floor(left); x < Math.ceil(right); x++) {
        const w = Math.min(right, x + 1) - Math.max(left, x);
        if (w <= 0) continue;
        const o = (y * W + x) * 4;
        if (data[o + 3] === 0) continue;
        const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
        hist.set(key, (hist.get(key) || 0) + w * h);
      }
    }
    hists.push(hist);
  }
}

// 分组辅助：entries -> dominant 组均值色 -> 重分类
function runPipeline(hist, trimText) {
  let entries = [...hist.entries()].map(([key, area]) => ({ rgb: [(key >> 16) & 255, (key >> 8) & 255, key & 255], area }));
  const classifyEntries = es => {
    const groups = new Map();
    for (const e of es) {
      const m = nearest(e.rgb);
      const g = groups.get(m.code) || { area: 0, r: 0, g: 0, b: 0 };
      g.area += e.area; g.r += e.rgb[0] * e.area; g.g += e.rgb[1] * e.area; g.b += e.rgb[2] * e.area;
      groups.set(m.code, g);
    }
    // ΔE2000 近似为 ΔE76/1.2 合并（GROUP_MERGE_RADIUS=4 → 约 ΔE76 5）
    const arr = [...groups.entries()].map(([code, g]) => ({ code, area: g.area, rgb: [g.r / g.area, g.g / g.area, g.b / g.area], lab: labOf([g.r / g.area, g.g / g.area, g.b / g.area]) }));
    const parent = arr.map((_, i) => i);
    const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++)
      if (dE(arr[i].lab, arr[j].lab) < 5) { parent[find(j)] = find(i); }
    const buckets = new Map();
    for (let i = 0; i < arr.length; i++) {
      const root = find(i);
      const b = buckets.get(root) || { area: 0, rgb: [0, 0, 0] };
      b.area += arr[i].area; b.rgb[0] += arr[i].rgb[0] * arr[i].area; b.rgb[1] += arr[i].rgb[1] * arr[i].area; b.rgb[2] += arr[i].rgb[2] * arr[i].area;
      buckets.set(root, b);
    }
    return [...buckets.values()].sort((a, b) => b.area - a.area);
  };
  let groups = classifyEntries(entries);
  if (trimText && groups.length) {
    const base = labOf(groups[0].rgb.map(v => v / groups[0].area));
    const kept = entries.filter(e => dE(labOf(e.rgb), base) < 25);
    if (kept.length && kept.reduce((s, e) => s + e.area, 0) > 0.2) groups = classifyEntries(kept);
  }
  if (!groups.length) return null;
  const mean = groups[0].rgb.map(v => Math.round(v / groups[0].area));
  return nearest(mean).code;
}

let aSame = 0, bSame = 0, tot = 0;
const bFix = [], bBreak = [];
for (let r = 0; r < manual.length; r++) for (let c = 0; c < manual[0].length; c++) {
  const mc = manual[r][c]?.code;
  const hist = hists[r * manual[0].length + c];
  if (!mc || !hist) continue;
  const a = runPipeline(hist, false);
  const b = runPipeline(hist, true);
  tot++;
  if (a === mc) aSame++; 
  if (b === mc) bSame++;
  if (a !== mc && b === mc) bFix.push([r, c, mc, a]);
  if (a === mc && b !== mc) bBreak.push([r, c, mc, b]);
}
console.log(`可测 ${tot}`);
console.log(`A 现状模拟:   ${aSame} (${(100 * aSame / tot).toFixed(2)}%)`);
console.log(`B 剔文字模拟: ${bSame} (${(100 * bSame / tot).toFixed(2)}%)`);
console.log(`B 修复 ${bFix.length} 格, B 损坏 ${bBreak.length} 格`);
console.log('损坏样例:', bBreak.slice(0, 15).map(d => `r${d[0] + 1}c${d[1] + 1}:${d[2]}->${d[3]}`).join(' '));
console.log('修复样例:', bFix.slice(0, 10).map(d => `r${d[0] + 1}c${d[1] + 1}:${d[2]}<-${d[3]}`).join(' '));
await vite.close();
