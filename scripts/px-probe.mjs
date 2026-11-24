import sharp from 'sharp';
const { data, info } = await sharp('D:/Build_Apps/pindouwangge/scripts/dbg-ocr4.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
console.log('size:', info.width, info.height, 'channels:', info.channels);
// M13 字的 M 左竖应在 x≈14-16, y≈110-130
for (const [x, y] of [[15, 120], [20, 120], [40, 125], [60, 120], [15, 112]]) {
  const i = (y * info.width + x) * info.channels;
  console.log(`(${x},${y}):`, [data[i], data[i+1], data[i+2]]);
}
