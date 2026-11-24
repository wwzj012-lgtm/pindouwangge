// card2 校对切片 v1：规则网格 3 行 × 8 列 = 24 槽（761x105，每槽约 95x35）。
// card1 的 bands[].tokenXs 在 card2 dbg.bands=[] 不存在，但 card2 是规则网格，
// 直接按网格切即可；8x nearest 放大导出 + 每行一张对照长图（供 D 源目读）。
// 用法：node scripts/gen-card2-crops.mjs
process.chdir('D:/Build_Apps/pindouwangge');
const sharp = (await import('sharp')).default;
const fs = (await import('fs')).default;

const img = sharp('benchmark/images/card2.png').removeAlpha();
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height; // 761 x 105
const ROWS = 3, COLS = 8;
const cw = W / COLS, ch = H / ROWS;
const SCALE = 8;

fs.mkdirSync('benchmark/results/card2-crops', { recursive: true });
const manifest = { slots: [] };
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c;
    const x0 = Math.round(c * cw), y0 = Math.round(r * ch);
    const w = Math.min(W - x0, Math.round(cw)), h = Math.min(H - y0, Math.round(ch));
    const name = `slot-${String(i).padStart(2, '0')}_r${r + 1}c${c + 1}.jpg`;
    await sharp(data.buffer, { raw: { width: W, height: H, channels: 3 } })
      .extract({ left: x0, top: y0, width: w, height: h })
      .resize(w * SCALE, h * SCALE, { kernel: 'nearest' })
      .jpeg({ quality: 90 })
      .toFile(`benchmark/results/card2-crops/${name}`);
    manifest.slots.push({ i, row: r + 1, col: c + 1, x0, y0, w, h });
  }
}
fs.writeFileSync('benchmark/results/card2-slots.json', JSON.stringify(manifest, null, 1));

// 每行一张 8x 对照长图（槽号标注），供目读
for (let r = 0; r < ROWS; r++) {
  const y0 = Math.round(r * ch), h = Math.min(H - y0, Math.round(ch));
  const big = await sharp(data.buffer, { raw: { width: W, height: H, channels: 3 } })
    .extract({ left: 0, top: y0, width: W, height: h })
    .resize(W * SCALE, h * SCALE, { kernel: 'nearest' })
    .png().toBuffer();
  const meta = await sharp(big).metadata();
  const labels = [];
  for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c;
    labels.push(`<rect x="${c * W / COLS * SCALE + 4}" y="4" width="120" height="52" fill="#000" opacity="0.65"/>` +
      `<text x="${c * W / COLS * SCALE + 14}" y="40" font-size="34" fill="#0f0" font-family="monospace" font-weight="bold">#${i}</text>`);
  }
  await sharp(big).composite([{ input: Buffer.from(`<svg width="${meta.width}" height="${meta.height}">${labels.join('')}</svg>`), top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toFile(`benchmark/results/card2-crops/row${r + 1}-sheet.jpg`);
}
console.log('written card2-crops/ 24 slots + 3 row sheets');
