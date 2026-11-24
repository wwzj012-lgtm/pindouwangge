import sharp from 'sharp';
const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const meta = await sharp(SRC).metadata();
// 估计网格周期：先裁左上 200x200 放大目检
const tiles = [
  { left: 0, top: 0, width: 240, height: 240, tag: '左上角' },
  { left: 640, top: 300, width: 240, height: 240, tag: '中部' },
  { left: 1250, top: 250, width: 240, height: 240, tag: '右上紫区' },
];
const parts = [];
for (const t of tiles) {
  const buf = await sharp(SRC).extract(t).resize(480, 480, { kernel: 'nearest' }).png().toBuffer();
  parts.push({ buf, tag: t.tag });
}
const comp = [];
parts.forEach((p, i) => {
  comp.push({ input: Buffer.from(`<svg width="480" height="30"><rect width="100%" height="100%" fill="#1e293b"/><text x="240" y="21" text-anchor="middle" font-size="15" fill="#fff" font-family="Microsoft YaHei">${p.tag}（4x放大）</text></svg>`), left: i * 488, top: 0 });
  comp.push({ input: p.buf, left: i * 488, top: 30 });
});
await sharp({ create: { width: 488 * 3, height: 510, channels: 3, background: { r: 40, g: 44, b: 52 } } })
  .composite(comp).png().toFile('C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import/daji_zoom.png');
console.log('-> daji_zoom.png');
