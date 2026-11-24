// 原图噪点位置放大：看是深色豆还是亮豆+暗缝
import sharp from 'sharp';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
const spots = [[679,433,'格49,77'],[767,574,'格65,87'],[864,794,'格90,98']];
const tiles = [];
for (const [cx, cy, tag] of spots) {
  const buf = await sharp('C:/Users/Plout/Pictures/12.jpg').extract({ left: cx-22, top: cy-22, width: 44, height: 44 }).resize(200, 200, { kernel: 'nearest' }).png().toBuffer();
  tiles.push({ buf, tag });
}
const comp = tiles.map((t, i) => [
  { input: Buffer.from(`<svg width="200" height="26"><rect width="100%" height="100%" fill="#1e293b"/><text x="100" y="18" text-anchor="middle" font-size="14" fill="#fff" font-family="Microsoft YaHei">${t.tag} 5x格</text></svg>`), left: i * 208, top: 0 },
  { input: t.buf, left: i * 208, top: 26 },
]);
await sharp({ create: { width: 208 * 3, height: 226, channels: 3, background: { r: 40, g: 44, b: 52 } } })
  .composite(comp.flat()).png().toFile(`${OUT}/bead_zoom.png`);
console.log(`-> ${OUT}/bead_zoom.png`);
