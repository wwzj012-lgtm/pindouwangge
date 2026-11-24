import sharp from 'sharp';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><rect width="100%" height="100%" fill="#fff"/>
<text x="20" y="60" font-family="sans-serif" font-size="48" fill="#000">F24 H2</text>
<text x="20" y="110" font-family="Arial" font-size="48" fill="#000">F24 H2</text></svg>`;
const { data, info } = await sharp(Buffer.from(svg)).raw().toBuffer({ resolveWithObject: true });
for (let y = 0; y < 120; y += 3) {
  let line = '';
  for (let x = 0; x < 300; x += 3) line += data[(y * info.width + x) * 4] < 128 ? '#' : '.';
  console.log(line);
}
