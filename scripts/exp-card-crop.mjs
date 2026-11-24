// 批量裁剪问题条目原图区域 → 竖向拼图（带标签）
process.chdir('D:/Build_Apps/pindouwangge');
import sharp from 'sharp';

// [entryIdx, bandNativeY0, nativeX0]  band native y: b0=5, b1=22, b2=38, b3=55
const targets = [
  ['e08-F13', 5, 355], ['e18-F16', 5, 797], ['e19-A12', 22, 0], ['e20-G3', 22, 45],
  ['e23-G8', 22, 178], ['e35-E20', 38, 708], ['e38-M14', 38, 0], ['e48-C28', 38, 531],
];
const W = 60, H = 22, S = 10; // 原图裁剪尺寸与放大倍数
const rows = [];
for (const [label, y, x] of targets) {
  const buf = await sharp('benchmark/images/card1.png')
    .extract({ left: Math.max(0, x), top: Math.max(0, y - 1), width: W, height: H })
    .resize(W * S, H * S, { kernel: 'lanczos3' })
    .toBuffer();
  rows.push({ label, buf });
}
const labelH = 34;
const totalH = rows.length * (H * S + labelH);
const composites = [];
let yOff = 0;
for (const r of rows) {
  const labelSvg = Buffer.from(`<svg width="${W * S}" height="${labelH}"><rect width="100%" height="100%" fill="#fff"/><text x="6" y="24" font-size="22" font-family="monospace" fill="#c00">${r.label}</text></svg>`);
  composites.push({ input: labelSvg, top: yOff, left: 0 });
  composites.push({ input: r.buf, top: yOff + labelH, left: 0 });
  yOff += H * S + labelH;
}
await sharp({ create: { width: W * S, height: totalH, channels: 3, background: '#fff' } })
  .composite(composites).png().toFile('benchmark/out/c1-problems.png');
console.log('written benchmark/out/c1-problems.png');
