// 探查变坏最狠的格子：打印格内源色直方图、新旧豆色、两侧逐像素误差。
// 用法: node scripts/probe-cells.mjs <old.json> <new.json>
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createServer } from 'vite';

const ROOT = process.cwd();
const [oldPath, newPath] = process.argv.slice(2);
const old = JSON.parse(await readFile(oldPath, 'utf8'));
const neu = JSON.parse(await readFile(newPath, 'utf8'));

const vite = await createServer({
  root: ROOT, appType: 'custom', server: { middlewareMode: true },
  logLevel: 'error', optimizeDeps: { noDiscovery: true },
});
const { MARD_PALETTE } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { rgbToLab, deltaE2000 } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const colorById = new Map(MARD_PALETTE.map((c) => [c.id, c]));

const { data, info } = await sharp('benchmark/images/street-boy.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const srcW = info.width, srcH = info.height;
const px = (x, y) => { const i = (y * srcW + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };

const CELLS = [
  [76, 58], [68, 84], [81, 63], [18, 39], [72, 28], [43, 90], [72, 27], [42, 44],
  [37, 73], [19, 34], [36, 18],
];

for (const [gx, gy] of CELLS) {
  const x0 = Math.floor((gx * srcW) / neu.cols);
  const x1 = Math.min(srcW, Math.ceil(((gx + 1) * srcW) / neu.cols));
  const y0 = Math.floor((gy * srcH) / neu.rows);
  const y1 = Math.min(srcH, Math.ceil(((gy + 1) * srcH) / neu.rows));

  // 源色直方图（步长 2，量化到 24/格）
  const hist = new Map();
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const [r, g, b, a] = px(x, y);
    if (a < 128) continue;
    const k = `${Math.round(r / 24)},${Math.round(g / 24)},${Math.round(b / 24)}`;
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  const total = [...hist.values()].reduce((s, v) => s + v, 0);
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([k, v]) => `${k} ${((v / total) * 100).toFixed(0)}%`).join('  ');

  const idO = old.grid[gy][gx], idN = neu.grid[gy][gx];
  const cO = idO ? colorById.get(idO).rgb : null;
  const cN = idN ? colorById.get(idN).rgb : null;

  // 每个源色块到两个豆的误差
  const blockErr = (rgb) => {
    if (!rgb) return '空';
    const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
    return top.split('  ').map((t) => {
      const [r, g, b] = t.split(' ')[0].split(',').map(Number);
      return `${t}→${deltaE2000(rgbToLab(r * 24, g * 24, b * 24), lab).toFixed(0)}`;
    }).join(' ');
  };

  console.log(`(${gx},${gy}) 直方图: ${top}`);
  console.log(`   旧豆 ${idO} rgb(${cO}) 误差: ${blockErr(cO)}`);
  console.log(`   新豆 ${idN} rgb(${cN}) 误差: ${blockErr(cN)}`);
}
await vite.close();
