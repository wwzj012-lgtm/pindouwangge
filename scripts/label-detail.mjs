// 给 pattern_compare/detail 下的 A/B 对比图加版本标签，并生成带标注的三联对比。
// 运行: node scripts/label-detail.mjs
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/detail';

// 版本 -> 文件前缀 + 中文标签
const VERSIONS = [
  { prefix: 'avg', label: 'A. 旧版·面积平均' },
  { prefix: 'dom2', label: 'B. 主色采样 v2' },
  { prefix: 'dom6', label: 'C. 邻居裁决·当前版' },
];

const labelSvg = (text, w) => Buffer.from(
  `<svg width="${w}" height="56"><rect width="100%" height="100%" fill="#111"/><text x="12" y="38" font-family="Microsoft YaHei, sans-serif" font-size="30" font-weight="bold" fill="#fff">${text}</text></svg>`
);

async function labeled(pngBuf, label, outName) {
  const meta = await sharp(pngBuf).metadata();
  const bar = labelSvg(label, meta.width);
  await sharp(pngBuf)
    .composite([{ input: bar, top: 0, left: 0 }])
    .png().toFile(`${OUT}/${outName}`);
  return { pngBuf, meta };
}

// 1) 给每个版本的 full 图加标签
for (const v of VERSIONS) {
  try {
    await labeled(`${OUT}/${v.prefix}_full.png`, v.label, `${v.prefix}_full_labeled.png`);
  } catch { /* 该版本文件不存在则跳过 */ }
}

// 2) 三联对比：脸特写（源图 + 三个版本），横向拼接，每张上方有标签
const FACE = { name: 'face', title: '脸部特写' };
const crops = [];
const srcMeta = await sharp(`${OUT}/avg_${FACE.name}_src.png`).metadata();

// 源图标签
const srcLabel = '0. 原图';
const srcPng = await sharp(`${OUT}/avg_${FACE.name}_src.png`)
  .composite([{ input: labelSvg(srcLabel, srcMeta.width), top: 0, left: 0 }])
  .png().toBuffer();
crops.push({ buf: srcPng, w: srcMeta.width, h: srcMeta.height });

for (const v of ['avg', 'dom2', 'dom6']) {
  const p = `${OUT}/${v}_${FACE.name}.png`;
  try {
    const meta = await sharp(p).metadata();
    const v0 = VERSIONS.find(x => x.prefix === v);
    const buf = await sharp(p)
      .composite([{ input: labelSvg(v0.label, meta.width), top: 0, left: 0 }])
      .png().toBuffer();
    crops.push({ buf, w: meta.width, h: meta.height });
  } catch { /* skip */ }
}

const GAP = 8, PAD = 16;
const rowH = Math.max(...crops.map(c => c.h));
const totalW = crops.reduce((s, c) => s + c.w, 0) + GAP * (crops.length - 1) + PAD * 2;
const totalH = rowH + PAD * 2 + 50;
// 标题
const titleSvg = Buffer.from(
  `<svg width="${totalW}" height="50"><rect width="100%" height="100%" fill="#333"/><text x="${PAD}" y="35" font-family="Microsoft YaHei, sans-serif" font-size="28" font-weight="bold" fill="#ffd54a">street-boy 脸部特写对比（左→右：原图 / 旧版 / 主色v2 / 邻居裁决）</text></svg>`
);
const comp = sharp({ create: { width: totalW, height: totalH, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite([
    { input: titleSvg, top: 0, left: 0 },
    ...crops.map((c, i) => ({
      input: c.buf, top: PAD + 50 + Math.round((rowH - c.h) / 2), left: PAD + crops.slice(0, i).reduce((s, x) => s + x.w + GAP, 0),
    })),
  ]);
await comp.png().toFile(`${OUT}/_final_face.png`);

console.log('labeled ->', VERSIONS.map(v => `${v.prefix}_full_labeled.png`).join(', '), '+ _final_face.png');
