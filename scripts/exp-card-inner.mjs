// 复现票面内提码：对指定条目的色块区域测不同对比度下的提取结果
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const m = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { data, info } = await sharp('benchmark/images/card1.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

// native → 4× 缓冲：条目8 F13 band0 y5-18 native；色块≈x357-378 native
const crop = m.cropPixels(source, 350, 2, 400, 20);
const buffers = m.buildCardBuffers(crop, [255, 255, 255], 4);
const color = buffers.color;
const bin = buffers.bin;
// bin 里找色块：整个 token 区域的实心部分
const bg = m.dominantBaseColor(color.data, color.width, 0, 0, color.width, color.height);
console.log('bg', bg);
// 色块 box（4× 坐标，相对 crop）：crop x0=350 → 色块 357-378 → rel 7-28 → ×4 = 28-112
const box = { x0: 28, y0: 12, x1: 80, y1: 62 };
const swatchColor = m.dominantBaseColor(color.data, color.width, box.x0 + 1, box.y0 + 1, box.x1, box.y1 - 1);
console.log('swatchColor', swatchColor);
for (const c of [40, 60, 80, 100, 130]) {
  const glyphs = m.analyzeLineWithContrast(color, swatchColor, { y0: box.y0 + 2, y1: box.y1 - 2, minX: box.x0 + 2, maxX: box.x1 - 1 }, c);
  console.log(`contrast=${c} n=${glyphs.length} ws=${glyphs.map(g => g.x1 - g.x0 + 1).join(',')} fills=${glyphs.map(g => (g.area / ((g.x1 - g.x0 + 1) * (g.y1 - g.y0 + 1))).toFixed(2)).join(',')}`);
}
// 对照：bin 缓冲 vs 白 bg 的 comps（token 分类看到的）
const binGlyphs = m.analyzeLineWithContrast(bin, [255, 255, 255], { y0: 8, y1: 68, minX: 0, maxX: 240 }, 60);
console.log('bin comps n=' + binGlyphs.length, binGlyphs.map(g => `${g.x0}-${g.x1}w${g.x1 - g.x0 + 1}h${g.y1 - g.y0 + 1}`).join(' '));
await vite.close();
