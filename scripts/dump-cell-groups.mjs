// 单格组分布 dump：复现 sampleCellGen 的分票过程，输出每个格子的色号面积分布。
// 运行: node scripts/dump-cell-groups.mjs <row> <col> [...]
import { createServer } from 'vite';
import sharp from 'sharp';

const root = process.cwd();
const IMG = 'C:/Users/Plout/Pictures/12.jpg';
const CELL = 8.8, OX = -0.375, OY = -0.125;
const ROWS = process.argv[2] ? process.argv.slice(2).map(Number) : [[5, 81], [9, 78], [2, 57]];

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { deltaE2000, preparePaletteLab, rgbToLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
await vite.close();

const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const src = { data, width: info.width, height: info.height };
const palette = preparePaletteLab(BRAND_PALETTES.MARD);

// 简化识别流程：precision + beadPhoto（trim 15%/10% + 环带 + 明度打折选色）
const BEAD_LIGHTNESS_WEIGHT = 0.55, BEAD_DARK_TRIM = 0.15, BEAD_BRIGHT_TRIM = 0.1;
const classify = (rgb) => {
  const lab = rgbToLab(...rgb);
  let best = 0, bestScore = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i];
    const dL = (lab[0] - c.lab[0]) * BEAD_LIGHTNESS_WEIGHT;
    const s = dL * dL + (lab[1] - c.lab[1]) ** 2 + (lab[2] - c.lab[2]) ** 2;
    if (s < bestScore) { bestScore = s; best = i; }
  }
  return { id: palette[best].color.id, hex: palette[best].color.hex, lab: palette[best].lab, dist: deltaE2000(lab, palette[best].lab) };
};

for (const [row, col] of ROWS) {
  const cx = OX * CELL + (col + 0.5) * CELL, cy = OY * CELL + (row + 0.5) * CELL;
  const raw = [];
  for (let py = Math.floor(cy - CELL / 2); py < cy + CELL / 2; py++) {
    for (let px = Math.floor(cx - CELL / 2); px < cx + CELL / 2; px++) {
      if (px < 0 || py < 0 || px >= src.width || py >= src.height) continue;
      const nx = (px + 0.5 - cx) / (CELL / 2), ny = (py + 0.5 - cy) / (CELL / 2);
      const r2 = nx * nx + ny * ny;
      if (r2 > 0.85 || r2 < 0.05) continue;
      const i = (py * src.width + px) * 4;
      raw.push([src.data[i], src.data[i + 1], src.data[i + 2]]);
    }
  }
  const lumas = raw.map(p => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]).sort((a, b) => a - b);
  const low = lumas[Math.floor(lumas.length * BEAD_DARK_TRIM)];
  const high = lumas[Math.floor(lumas.length * (1 - BEAD_BRIGHT_TRIM))];
  const kept = raw.filter((_, i) => {
    const L = 0.2126 * raw[i][0] + 0.7152 * raw[i][1] + 0.0722 * raw[i][2];
    return L >= low && L <= high;
  });
  const groups = new Map();
  for (const p of kept) {
    const m = classify(p);
    const g = groups.get(m.id) ?? { id: m.id, hex: m.hex, area: 0, dist: 0, rgb: [0, 0, 0] };
    g.area++; g.dist += m.dist; g.rgb[0] += p[0]; g.rgb[1] += p[1]; g.rgb[2] += p[2];
    groups.set(m.id, g);
  }
  const ordered = [...groups.values()].sort((a, b) => b.area - a.area);
  console.log(`\n=== 格 (${row},${col}) 像素 ${raw.length} -> trim 后 ${kept.length} ===`);
  for (const g of ordered.slice(0, 8)) {
    const rgb = g.rgb.map(v => Math.round(v / g.area));
    console.log(`  ${g.id} ${g.hex}  面积 ${(100 * g.area / kept.length).toFixed(1)}%  mean rgb(${rgb.join(',')})  ΔE ${(g.dist / g.area).toFixed(1)}`);
  }
}
