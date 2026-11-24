import sharp from 'sharp';
const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
// 从预览图定位：左中 M19/M17 密集区、中下黑格(J7/K4/M1)区
const tiles = [
  { left: 0, top: 380, width: 260, height: 260, tag: '左侧M系区' },
  { left: 620, top: 700, width: 300, height: 180, tag: '中下黑格区(J7/K4?)' },
  { left: 850, top: 700, width: 300, height: 180, tag: '中下右(K4/M1?)' },
];
const parts = [];
for (const t of tiles) {
  const buf = await sharp(SRC).extract(t).resize(560, Math.round(t.height * 560 / t.width), { kernel: 'nearest' }).png().toBuffer();
  parts.push({ buf, tag: t.tag });
}
const comp = [];
let y = 0;
for (const p of parts) {
  comp.push({ input: Buffer.from(`<svg width="560" height="28"><rect width="100%" height="100%" fill="#1e293b"/><text x="280" y="20" text-anchor="middle" font-size="15" fill="#fff" font-family="Microsoft YaHei">${p.tag}</text></svg>`), left: 0, top: y });
  comp.push({ input: p.buf, left: 0, top: y + 28 });
  y += 28 + p.buf.length ? 0 : 0; // placeholder
}
// 简化：竖排
const comp2 = [];
let yy = 0;
for (const p of parts) {
  const h = Math.round(560 * 180 / 300);
  comp2.push({ input: Buffer.from(`<svg width="560" height="28"><rect width="100%" height="100%" fill="#1e293b"/><text x="280" y="20" text-anchor="middle" font-size="15" fill="#fff" font-family="Microsoft YaHei">${p.tag}</text></svg>`), left: 0, top: yy });
  comp2.push({ input: p.buf, left: 0, top: yy + 28 });
  yy += 28 + Math.round(560 * 180 / 300);
}
await sharp({ create: { width: 560, height: yy, channels: 3, background: { r: 40, g: 44, b: 52 } } })
  .composite(comp2).png().toFile('C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import/daji_zoom2.png');
console.log('-> daji_zoom2.png');
