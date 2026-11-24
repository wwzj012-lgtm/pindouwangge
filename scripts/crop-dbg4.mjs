import sharp from 'sharp';
// 格(1,0) 和 (1,1)：y 80-160, x 0-160 → 放大 4x
await sharp('D:/Build_Apps/pindouwangge/scripts/dbg-ocr4.png')
  .extract({ left: 0, top: 80, width: 160, height: 80 })
  .resize(640, 320, { kernel: 'nearest' })
  .png().toFile('D:/Build_Apps/pindouwangge/scripts/dbg-ocr4-crop.png');
console.log('ok');
