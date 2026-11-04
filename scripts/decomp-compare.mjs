// 对比两份逐格误差数据：定位 v2 相对旧版 哪些格变好 / 哪些格变坏。
// 用法: node scripts/decomp-compare.mjs <old.json> <new.json>
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const [oldPath, newPath] = process.argv.slice(2);
const old = JSON.parse(await readFile(oldPath, 'utf8'));
const neu = JSON.parse(await readFile(newPath, 'utf8'));

const { cols, rows } = old;
const diffs = []; // {gx, gy, old, new, d}  d = new - old，负=变好
for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
  const a = old.cellErr[gy][gx], b = neu.cellErr[gy][gx];
  if (a === null || b === null) continue;
  diffs.push({ gx, gy, old: a, new: b, d: b - a });
}
const meanOld = diffs.reduce((s, x) => s + x.old, 0) / diffs.length;
const meanNew = diffs.reduce((s, x) => s + x.new, 0) / diffs.length;
const better = diffs.filter((x) => x.d < -0.5);
const worse = diffs.filter((x) => x.d > 0.5);
const same = diffs.length - better.length - worse.length;
console.log(`cells ${diffs.length} | mean ${meanOld.toFixed(3)} -> ${meanNew.toFixed(3)} (Δ${(meanNew - meanOld).toFixed(3)})`);
console.log(`better(>0.5) ${better.length} | worse(>0.5) ${worse.length} | ~same ${same}`);
const sumD = (list) => list.reduce((s, x) => s + x.d, 0);
console.log(`误差量收支: 变好合计 ${sumD(better).toFixed(1)} | 变坏合计 ${sumD(worse).toFixed(1)}`);

const top = (list, n, asc) => list.sort((a, b) => asc ? a.d - b.d : b.d - a.d).slice(0, n);
const show = (list, tag) => {
  console.log(`\n${tag}:`);
  for (const x of list) {
    const idO = old.grid[x.gy][x.gx], idN = neu.grid[x.gy][x.gx];
    console.log(`  (${String(x.gx).padStart(3)},${String(x.gy).padStart(3)}) ${x.old.toFixed(1)} -> ${x.new.toFixed(1)} (${x.d > 0 ? '+' : ''}${x.d.toFixed(1)})  豆 ${idO ?? '空'} -> ${idN ?? '空'}`);
  }
};
show(top(worse, 15, false), '变坏最狠 15 格');
show(top(better, 10, false), '变好最多 10 格');

// 变坏格的空间分布：按 10x10 大区统计
console.log('\n变坏格空间分布（每大区计数）:');
const zones = new Map();
for (const x of worse) {
  const k = `${Math.floor(x.gx / 10)},${Math.floor(x.gy / 10)}`;
  zones.set(k, (zones.get(k) ?? 0) + 1);
}
console.log([...zones.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  .map(([k, v]) => `区(${k}): ${v}`).join(' | '));

// 热力图：红=变坏 绿=变好 灰=持平 白=无数据
const CELL = 8;
const W = cols * CELL, H = rows * CELL;
const img = Buffer.alloc(W * H * 3, 255);
for (const x of diffs) {
  const t = Math.max(-6, Math.min(6, x.d)) / 6; // -1..1
  const r = t > 0 ? 255 : Math.round(200 + 55 * -t * 0);
  let rgb;
  if (Math.abs(x.d) <= 0.5) rgb = [225, 225, 225];
  else if (x.d > 0) rgb = [255, Math.round(80 - 40 * t), 80];
  else rgb = [80, Math.round(160 + 40 * t), 80];
  for (let dy = 0; dy < CELL; dy++) for (let dx = 0; dx < CELL; dx++) {
    const i = ((x.gy * CELL + dy) * W + x.gx * CELL + dx) * 3;
    img[i] = rgb[0]; img[i + 1] = rgb[1]; img[i + 2] = rgb[2];
  }
}
await sharp(img, { raw: { width: W, height: H, channels: 3 } })
  .resize(W * 2, H * 2, { kernel: 'nearest' }).png()
  .toFile('C:/Users/Plout/Desktop/pindouwangge/pattern_compare/detail/_decomp_heat.png');
console.log('\nheat -> pattern_compare/detail/_decomp_heat.png');
