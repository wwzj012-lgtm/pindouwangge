// 三方交叉：手动 vs OCR vs 纯颜色识别（模拟）——评估「颜色否决 OCR」的收益
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync } from 'fs';

const ORIG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
const ROOT = 'D:/Build_Apps/pindouwangge';
const { manual, recCodes } = JSON.parse(readFileSync(`${OUT}/manual_vs_rec.json`, 'utf8'));

const vite = await createServer({ root: ROOT, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: ROOT + '/vite.config.ts' });
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { extractBeadSymbols } = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
const P = BRAND_PALETTES.MARD;

const { data, info } = await sharp(ORIG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const cal = { originX: 0, originY: 0, cellWidth: 29.6, cellHeight: 29.54, columns: 52, rows: 52 };
const sym = extractBeadSymbols(source, cal, P);
const ocrCode = new Map();
for (const [key, s] of sym.codes) { const sep = key.indexOf(':'); ocrCode.set(`${Number(key.slice(0, sep))}:${Number(key.slice(sep + 1))}`, s.code); }

// 纯颜色识别（直方图 + 合并 + 均值重分类，同 sim-text-trim 的 A 路径）
const labOf = (rgb) => {
  let [r, g, b] = rgb.map(v => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; });
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = t => t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const dE = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
const labTable = P.map(c => ({ code: c.code, lab: labOf(c.rgb) }));
const nearest = rgb => {
  const l = labOf(rgb);
  let bc = null, bd = Infinity;
  for (const e of labTable) { const d = dE(e.lab, l); if (d < bd) { bd = d; bc = e.code; } }
  return bc;
};
const W = info.width, CW = 29.6, CH = 29.54, INSET = 0.1;
const colorCode = [];
for (let r = 0; r < manual.length; r++) {
  colorCode.push([]);
  for (let c = 0; c < manual[0].length; c++) {
    const left = (c + INSET) * CW, top = (r + INSET) * CH, right = (c + 1 - INSET) * CW, bottom = (r + 1 - INSET) * CH;
    const hist = new Map();
    for (let y = Math.floor(top); y < Math.ceil(bottom); y++) {
      const h = Math.min(bottom, y + 1) - Math.max(top, y);
      if (h <= 0) continue;
      for (let x = Math.floor(left); x < Math.ceil(right); x++) {
        const w = Math.min(right, x + 1) - Math.max(left, x);
        if (w <= 0) continue;
        const o = (y * W + x) * 4;
        const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
        hist.set(key, (hist.get(key) || 0) + w * h);
      }
    }
    // 分类→合并→均值重分类
    const groups = new Map();
    for (const [key, area] of hist) {
      const rgb = [(key >> 16) & 255, (key >> 8) & 255, key & 255];
      const code = nearest(rgb);
      const g = groups.get(code) || { area: 0, rgb: [0, 0, 0] };
      g.area += area; g.rgb[0] += rgb[0] * area; g.rgb[1] += rgb[1] * area; g.rgb[2] += rgb[2] * area;
      groups.set(code, g);
    }
    const arr = [...groups.entries()].map(([code, g]) => ({ code, area: g.area, mean: g.rgb.map(v => v / g.area), lab: labOf(g.rgb.map(v => v / g.area)) }));
    const parent = arr.map((_, i) => i);
    const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++)
      if (dE(arr[i].lab, arr[j].lab) < 5) parent[find(j)] = find(i);
    const buckets = new Map();
    for (let i = 0; i < arr.length; i++) {
      const root = find(i);
      const b = buckets.get(root) || { area: 0, rgb: [0, 0, 0] };
      b.area += arr[i].area;
      for (let k = 0; k < 3; k++) b.rgb[k] += arr[i].mean[k] * arr[i].area;
      buckets.set(root, b);
    }
    const dom = [...buckets.values()].sort((a, b) => b.area - a.area)[0];
    colorCode[r].push(nearest(dom.rgb.map(v => v / dom.area)));
  }
}

// 三方统计（限制在双方非空、非 '?' 格）
let n = 0, ocrOk = 0, colorOk = 0;
let bothOk = 0, ocrOnly = 0, colorOnly = 0, bothBad = 0;
// 颜色否决模拟：OCR resolved 且颜色最近邻 != OCR 且颜色置信（dominant 占比？简化：直接用颜色最近邻）→ 用颜色
let voteColor = 0, voteOcr = 0;
for (let r = 0; r < manual.length; r++) for (let c = 0; c < manual[0].length; c++) {
  const mc = manual[r][c]?.code;
  if (!mc || mc === '?') continue;
  const oc = ocrCode.get(`${r}:${c}`);
  const cc = colorCode[r][c];
  n++;
  if (oc != null) {
    if (oc === mc) ocrOk++;
    // 颜色投票只在 OCR 与颜色一致时可信，否则看谁对
    if (cc === mc) colorOk++;
    if (oc === mc && cc === mc) bothOk++;
    else if (oc === mc) ocrOnly++;
    else if (cc === mc) colorOnly++;
    else bothBad++;
    // 投票模拟：OCR 与颜色一致 → 用之；不一致 → 用颜色（颜色先验更稳？）
    const pick = (oc != null && oc === cc) ? oc : cc;
    if (pick === mc) voteColor++;
  } else {
    if (cc === mc) { colorOk++; voteColor++; }
  }
}
console.log(`双方非空格 ${n}`);
console.log(`OCR 命中格中: OCR对 ${ocrOk}, 颜色对 ${colorOk}`);
console.log(`(OCR有值时) 都对 ${bothOk}, 仅OCR对 ${ocrOnly}, 仅颜色对 ${colorOnly}, 都错 ${bothBad}`);
console.log(`\n投票策略「OCR=颜色→采信, 冲突→信颜色, 无OCR→颜色」: ${voteColor} (${(100 * voteColor / n).toFixed(2)}%)`);
// 当前管线: OCR 覆写优先
let current = 0;
for (let r = 0; r < manual.length; r++) for (let c = 0; c < manual[0].length; c++) {
  const mc = manual[r][c]?.code;
  if (!mc || mc === '?') continue;
  const oc = ocrCode.get(`${r}:${c}`);
  const pick = oc ?? colorCode[r][c];
  if (pick === mc) current++;
}
console.log(`当前策略「OCR优先, 否则颜色」: ${current} (${(100 * current / n).toFixed(2)}%)`);
await vite.close();
