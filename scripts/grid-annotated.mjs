// 整图网格坐标标注：帮助定位手部等区域
import sharp from 'sharp';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
const W = 412, H = 476; // v4_grid 尺寸
const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
${Array.from({length: 12}, (_, i) => { const y = i * 40 + 40; return `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="rgba(255,255,0,0.4)" stroke-width="1"/><text x="2" y="${y-3}" font-size="11" fill="yellow">r${Math.round((y/4)*8.8/8.8) || y/4}</text>`; }).join('')}
${Array.from({length: 11}, (_, i) => { const x = i * 40 + 40; return `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="rgba(255,255,0,0.4)" stroke-width="1"/><text x="${x+2}" y="12" font-size="11" fill="yellow">c${x/4}</text>`; }).join('')}
</svg>`;
await sharp(`${OUT}/v4_grid.png`).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).png().toFile(`${OUT}/v4_grid_annotated.png`);
console.log('-> v4_grid_annotated.png (黄色数字=格子坐标 row/col)');
