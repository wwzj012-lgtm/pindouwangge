// 图例解析组件级诊断：行聚类、连通域、色点判定、间隙。
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const mod = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const CAL = { originX: 276, originY: 116, cellWidth: 8.79, cellHeight: 8.79, columns: 101, rows: 132 };
const { data, info } = await sharp('benchmark/images/water-box.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

// Re-implement location here to dump internals (module internals aren't exported).
function dominantBaseColor(d, width, x0, y0, x1, y1) {
  const counts = new Map(); const sums = new Map();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * width + x) * 4;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const s = sums.get(key) ?? [0, 0, 0, 0];
    s[0] += r; s[1] += g; s[2] += b; s[3] += 1; sums.set(key, s);
  }
  let bk = -1, bc = -1; for (const [k, c] of counts) if (c > bc) { bc = c; bk = k; }
  const s = sums.get(bk);
  return s ? [Math.round(s[0] / s[3]), Math.round(s[1] / s[3]), Math.round(s[2] / s[3])] : [255, 255, 255];
}

const bandTop = Math.floor(CAL.originY + CAL.rows * CAL.cellHeight) + 2;
const bg = dominantBaseColor(source.data, source.width, 0, bandTop, source.width, source.height);
console.log('bandTop', bandTop, 'bg', bg);
const darkMin = Math.max(6, Math.round(source.width * 0.004));
for (let y = bandTop; y < source.height; y++) {
  let c = 0;
  for (let x = 0; x < source.width; x++) {
    const i = (y * source.width + x) * 4;
    const dr = source.data[i] - bg[0], dg = source.data[i + 1] - bg[1], db = source.data[i + 2] - bg[2];
    if (dr * dr + dg * dg + db * db > 3600) c++;
  }
  if (c >= darkMin * 0.4) console.log('line y', y, 'dark', c);
}
await vite.close();
