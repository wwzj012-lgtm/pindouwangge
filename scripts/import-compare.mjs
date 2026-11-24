// 识别结果三联对比图（带标注）：原图 | BEFORE grid | AFTER grid
// 运行: node scripts/import-compare.mjs <srcImg> <beforeGrid> <afterGrid> <outPrefix> [labelBefore] [labelAfter]
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
await mkdir(OUT, { recursive: true });
const [srcImg, beforeGrid, afterGrid, outPrefix, labelBefore = 'BEFORE', labelAfter = 'AFTER'] = process.argv.slice(2);

const H = 560;
const LABEL_H = 34;
const GAP = 8;

const meta = await sharp(srcImg).metadata();
const wA = Math.round(meta.width * H / meta.height);
const bufA = await sharp(srcImg).resize(wA, H, { kernel: 'nearest' }).png().toBuffer();

const loadPanel = async (path) => {
  const buf = await sharp(path).png().toBuffer();
  const m = await sharp(buf).metadata();
  // 识别网格与原图同比例（渲染脚本按 keepAspectRatio 推导），等比缩放对齐高度
  const w = Math.round(m.width * H / m.height);
  return { buf: await sharp(buf).resize(w, H, { kernel: 'nearest' }).png().toBuffer(), w };
};

const before = await loadPanel(beforeGrid);
const after = await loadPanel(afterGrid);
const totalW = wA + before.w + after.w + GAP * 2;
const totalH = H + LABEL_H + 12;

const labelBar = (text, width) => Buffer.from(`<svg width="${width}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#1e293b"/>
  <text x="${width / 2}" y="23" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="17" font-weight="bold" fill="#fff">${text}</text>
</svg>`);

let x = 0;
const comps = [
  { input: labelBar('原图（实物照片）', wA), left: 0, top: 0 },
  { input: bufA, left: 0, top: LABEL_H + 6 },
];
x = wA + GAP;
comps.push({ input: labelBar(labelBefore, before.w), left: x, top: 0 });
comps.push({ input: before.buf, left: x, top: LABEL_H + 6 });
x += before.w + GAP;
comps.push({ input: labelBar(labelAfter, after.w), left: x, top: 0 });
comps.push({ input: after.buf, left: x, top: LABEL_H + 6 });

await sharp({ create: { width: totalW, height: totalH, channels: 3, background: { r: 60, g: 65, b: 75 } } })
  .composite(comps).png().toFile(`${OUT}/${outPrefix}_ab.png`);
console.log(`-> ${OUT}/${outPrefix}_ab.png`);
