import sharp from 'sharp';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
const [a, b] = await Promise.all([
  sharp(`${OUT}/${process.argv[2]}.png`).raw().toBuffer({ resolveWithObject: true }),
  sharp(`${OUT}/${process.argv[3]}.png`).raw().toBuffer({ resolveWithObject: true }),
]);
if (a.info.width !== b.info.width || a.info.height !== b.info.height) { console.log('尺寸不同:', a.info.width, a.info.height, 'vs', b.info.width, b.info.height); process.exit(0); }
let diff = 0;
const n = Math.min(a.data.length, b.data.length);
for (let i = 0; i < n; i++) if (a.data[i] !== b.data[i]) diff++;
console.log(`逐像素差异字节: ${diff} / ${n} (${(diff/n*100).toFixed(4)}%)`);
