// 豆子物理形貌剖面分析：把格内像素按归一化半径 r∈[0,0.5] 分 bin，
// 统计平均亮度与平均颜色，实测孔洞 dip 位置与边缘暗环宽度。
// 运行: node scripts/bead-profile.mjs <imagePath> <cellPx> <ox> <oy>
import sharp from 'sharp';

const [imgArg, cellArg, oxArg, oyArg] = process.argv.slice(2);
const IMG = imgArg ?? 'C:/Users/Plout/Pictures/12.jpg';
const CELL = Number(cellArg) || 8.8;
const OX = Number(oxArg ?? -0.375);
const OY = Number(oyArg ?? -0.125);

const { data, info } = await sharp(IMG).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, CH = info.channels;
const luma = (x, y) => {
  const i = (y * W + x) * CH;
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
};

const BINS = 20;
const sumLuma = new Float64Array(BINS);
const count = new Float64Array(BINS);
// 按"格子整体中位亮度"分三档，分别看剖面：亮格(浅色豆)/中格/暗格(深色豆)
const cellMid = [];
const columns = Math.floor((W - OX * CELL) / CELL);
const rows = Math.floor((H - OY * CELL) / CELL);
const perCell = new Float64Array(rows * columns);
for (let row = 0; row < rows; row++) {
  for (let col = 0; col < columns; col++) {
    const cx = OX * CELL + (col + 0.5) * CELL;
    const cy = OY * CELL + (row + 0.5) * CELL;
    let acc = 0, n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = Math.round(cx + dx * CELL / 8), y = Math.round(cy + dy * CELL / 8);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      acc += luma(x, y); n++;
    }
    perCell[row * columns + col] = n ? acc / n : 0;
  }
}
const sorted = [...perCell].sort((a, b) => a - b);
const t1 = sorted[Math.floor(sorted.length * 0.33)];
const t2 = sorted[Math.floor(sorted.length * 0.66)];

const sumDark = new Float64Array(BINS), cntDark = new Float64Array(BINS);
const sumMid = new Float64Array(BINS), cntMid = new Float64Array(BINS);
const sumBright = new Float64Array(BINS), cntBright = new Float64Array(BINS);

for (let row = 0; row < rows; row++) {
  for (let col = 0; col < columns; col++) {
    const cx = OX * CELL + (col + 0.5) * CELL;
    const cy = OY * CELL + (row + 0.5) * CELL;
    const mid = perCell[row * columns + col];
    for (let py = Math.floor(cy - CELL / 2); py < cy + CELL / 2; py++) {
      for (let px = Math.floor(cx - CELL / 2); px < cx + CELL / 2; px++) {
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const nx = (px + 0.5 - cx) / (CELL / 2);
        const ny = (py + 0.5 - cy) / (CELL / 2);
        const r = Math.sqrt(nx * nx + ny * ny);
        if (r >= 1) continue;
        const bin = Math.min(BINS - 1, Math.floor(r * BINS));
        const L = luma(px, py);
        sumLuma[bin] += L; count[bin]++;
        if (mid < t1) { sumDark[bin] += L; cntDark[bin]++; }
        else if (mid < t2) { sumMid[bin] += L; cntMid[bin]++; }
        else { sumBright[bin] += L; cntBright[bin]++; }
      }
    }
  }
}

console.log(`image ${W}x${H}, grid ${columns}x${rows}, cell ${CELL}px, origin (${OX},${OY})`);
console.log(`亮度分档: 暗<${t1.toFixed(0)} 中 ${t1.toFixed(0)}~${t2.toFixed(0)} 亮>${t2.toFixed(0)}`);
console.log('\n r     全部     暗格     中格     亮格   (平均亮度, 0-255)');
for (let b = 0; b < BINS; b++) {
  const r = ((b + 0.5) / BINS).toFixed(2);
  const all = (sumLuma[b] / Math.max(1, count[b])).toFixed(1).padStart(6);
  const d = (sumDark[b] / Math.max(1, cntDark[b])).toFixed(1).padStart(6);
  const m = (sumMid[b] / Math.max(1, cntMid[b])).toFixed(1).padStart(6);
  const br = (sumBright[b] / Math.max(1, cntBright[b])).toFixed(1).padStart(6);
  console.log(`${r}  ${all}   ${d}   ${m}   ${br}`);
}
