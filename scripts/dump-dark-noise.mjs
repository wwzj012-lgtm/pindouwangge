// 假暗格分析：识别为深色、但格内环带里亮像素占比很高的格子 = 疑似被暗缝污染。
// 输出它们的特征与像素亮度分位数，判断噪点来源。
// 运行: node scripts/dump-dark-noise.mjs <imagePath> <cellPx> <ox> <oy>
import { createServer } from 'vite';
import sharp from 'sharp';

const root = process.cwd();
const IMG = process.argv[2] ?? 'C:/Users/Plout/Pictures/12.jpg';
const CELL = Number(process.argv[3]) || 8.8;
const OX = Number(process.argv[4] ?? -0.375);
const OY = Number(process.argv[5] ?? -0.125);

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const columns = Math.floor((source.width - OX * CELL) / CELL);
const rows = Math.floor((source.height - OY * CELL) / CELL);
const cal = { originX: OX * CELL, originY: OY * CELL, cellWidth: CELL, cellHeight: CELL, columns, rows };
const opts = { mode: 'precision', beadPhoto: true, autoColorBalance: true, autoAlign: true, unifyTwins: true, smooth: true, edgeInsetRatio: 0.1 };
const result = recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, opts);

const lumaOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// 每格环带内像素亮度统计（与识别同口径：r∈[0.224,0.922]）
const stats = (row, col) => {
  const cx = cal.originX + (col + 0.5) * CELL, cy = cal.originY + (row + 0.5) * CELL;
  const lumas = [];
  let sumR = 0, sumG = 0, sumB = 0;
  for (let py = Math.floor(cy - CELL / 2); py < cy + CELL / 2; py++) {
    for (let px = Math.floor(cx - CELL / 2); px < cx + CELL / 2; px++) {
      if (px < 0 || py < 0 || px >= source.width || py >= source.height) continue;
      const nx = (px + 0.5 - cx) / (CELL / 2), ny = (py + 0.5 - cy) / (CELL / 2);
      const r2 = nx * nx + ny * ny;
      if (r2 > 0.85 || r2 < 0.05) continue;
      const i = (py * source.width + px) * 4;
      const [r, g, b] = [source.data[i], source.data[i + 1], source.data[i + 2]];
      lumas.push(lumaOf(r, g, b));
      sumR += r; sumG += g; sumB += b;
    }
  }
  lumas.sort((a, b) => a - b);
  const q = p => lumas.length ? Math.round(lumas[Math.floor(p * (lumas.length - 1))]) : -1;
  const brightShare = lumas.length ? lumas.filter(l => l > 130).length / lumas.length : 0;
  const n = Math.max(1, lumas.length);
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9), brightShare, meanRgb: [Math.round(sumR / n), Math.round(sumG / n), Math.round(sumB / n)] };
};

// 全图色号亮度表
const lumaById = {};
for (const c of BRAND_PALETTES.MARD) lumaById[c.id] = lumaOf(c.rgb[0], c.rgb[1], c.rgb[2]);

// 找疑似假暗格：识别色 luma<85 且环带亮像素占比 >0.35
const suspects = [];
let darkTotal = 0;
for (let row = 0; row < rows; row++) {
  for (let col = 0; col < columns; col++) {
    const cell = result.cells[row][col];
    if (cell.status !== 'mapped' || !cell.colorId) continue;
    const cl = lumaById[cell.colorId] ?? 255;
    if (cl < 85) darkTotal++;
    else continue;
    const st = stats(row, col);
    if (st.brightShare > 0.35) suspects.push({ row, col, colorId: cell.colorId, dom: cell.dominantRatio, run: cell.runnerUpRatio, runId: cell.runnerUpColorId, dist: cell.distance, ...st });
  }
}
console.log(`全图 ${rows * columns} 格 | 识别为深色(luma<85) ${darkTotal} 格 | 其中环带亮像素占比>35% 的疑似假暗格 ${suspects.length} 格 (${(100 * suspects.length / Math.max(1, darkTotal)).toFixed(1)}% of 深色格)`);
console.log('\n样本 20 个：');
for (const s of suspects.slice(0, 20)) {
  console.log(`  (${String(s.row).padStart(3)},${String(s.col).padStart(3)}) 判=${s.colorId} dom=${s.dom?.toFixed(2)} run=${s.run?.toFixed(2)}(${s.runId}) dist=${s.dist?.toFixed(1)} | 像素 p10=${s.p10} p50=${s.p50} p90=${s.p90} 亮占比=${(s.brightShare * 100).toFixed(0)}% mean=rgb(${s.meanRgb.join(',')})`);
}
// 疑似假暗格的 dom 分布
const buckets = [0, 0, 0, 0, 0];
for (const s of suspects) {
  const d = s.dom ?? 0;
  buckets[d < 0.3 ? 0 : d < 0.45 ? 1 : d < 0.6 ? 2 : d < 0.75 ? 3 : 4]++;
}
console.log(`\n疑似假暗格 dominantRatio 分布: <0.3=${buckets[0]} 0.3-0.45=${buckets[1]} 0.45-0.6=${buckets[2]} 0.6-0.75=${buckets[3]} >=0.75=${buckets[4]}`);
await vite.close();
