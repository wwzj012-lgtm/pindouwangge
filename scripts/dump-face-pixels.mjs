// dump 脸颊噪点格的原始像素：看格子里到底装的是什么
import sharp from 'sharp';
const { data, info } = await sharp('C:/Users/Plout/Pictures/12.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const px = (x, y) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i+1], data[i+2]]; };
const CELL = 8.8, OX = -0.375, OY = -0.25;
// 噪点格 (row,col) → 原图中心
const cells = [[49,77],[65,87],[90,98],[68,87],[41,79],[37,77]];
for (const [r,c] of cells) {
  const cx = Math.round((c + 0.5) * CELL + OX * CELL), cy = Math.round((r + 0.5) * CELL + OY * CELL);
  // dump 5x5 像素（格子中央区域）
  let min=[255,255,255], max=[0,0,0], sum=[0,0,0], n=0;
  const grid5 = [];
  for (let dy=-4; dy<=4; dy++) {
    const row = [];
    for (let dx=-4; dx<=4; dx++) {
      const p = px(cx+dx, cy+dy);
      row.push(p.map(v=>String(v).padStart(3)).join(','));
      for (let k=0;k<3;k++){ min[k]=Math.min(min[k],p[k]); max[k]=Math.max(max[k],p[k]); sum[k]+=p[k]; }
      n++;
    }
    grid5.push(row.join(' | '));
  }
  console.log(`格(${r},${c}) 中心(${cx},${cy}) avg=(${sum.map(v=>Math.round(v/n)).join(',')}) min=(${min.join(',')}) max=(${max.join(',')})`);
  console.log(grid5.join('\n') + '\n');
}
