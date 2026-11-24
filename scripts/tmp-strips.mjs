// card1 全图切条：4 行 × 左右半，6x 放大，目检定位
process.chdir('D:/Build_Apps/pindouwangge');
import sharp from 'sharp';

const rows = [[0, 20], [19, 38], [37, 55], [54, 68]];
for (let r = 0; r < 4; r += 1) {
  const [y0, y1] = rows[r];
  for (const [tag, x0, x1] of [['L', 0, 440], ['R', 420, 863]]) {
    await sharp('benchmark/images/card1.png')
      .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
      .resize({ width: (x1 - x0) * 6, kernel: 'nearest' })
      .png().toFile(`scripts/tmp-strip-r${r + 1}${tag}.png`);
  }
}
console.log('done');
