// 裁剪目标行原图区域并放大保存，目检几何布局
process.chdir('D:/Build_Apps/pindouwangge');
import sharp from 'sharp';

// native 坐标（upscaled/4）
const crops = [
  ['item9_G2', 370, 0, 445, 20],      // item[9] win 1523-1747 → native 381-437
  ['item13', 565, 0, 625, 20],        // item[13] 2228-2453 → native 557-613
  ['item41', 100, 0, 175, 20],        // item[41] 453-664 → native 113-166
  ['item42', 160, 0, 215, 20],        // item[42] 671-795 → native 168-199
  ['item44', 240, 0, 310, 20],        // item[44] 992-1196 → native 248-299
  ['item46', 325, 0, 385, 20],        // item[46] 1339-1503 → native 335-376
  ['item54', 685, 0, 735, 20],        // item[54] 2766-2960 → native 692-740
  ['row4_full', 0, 55, 220, 68],      // band4 前段 item[57-59]
];
for (const [name, x0, y0, x1, y1] of crops) {
  await sharp('benchmark/images/card1.png')
    .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    .resize({ width: (x1 - x0) * 8, kernel: 'nearest' })
    .png().toFile(`scripts/tmp-crop-${name}.png`);
  console.log('saved', name);
}
