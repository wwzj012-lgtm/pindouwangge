// 网格线叠加 + 边缘格底色采样：验证网格与图纸真实边界
import sharp from 'sharp';

const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-09T04-29-31-478Z-f7362be0.jpg';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };

// 1) 扫描图纸真实边界：从图像中心向四方向找「白色留白→图纸内容」的过渡
//    白留白: rgb 均值 > 240 且接近中性
const isWhiteBg = ([r, g, b]) => r > 238 && g > 238 && b > 238 && Math.max(r, g, b) - Math.min(r, g, b) < 12;
const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
let left = cx, right = cx, top = cy, bottom = cy;
while (left > 0 && !isWhiteBg(px(left, cy))) left -= 1;
while (right < W - 1 && !isWhiteBg(px(right, cy))) right += 1;
while (top > 0 && !isWhiteBg(px(cx, top))) top -= 1;
while (bottom < H - 1 && !isWhiteBg(px(cx, bottom))) bottom += 1;
console.log(`图纸真实边界(中心外推): x ${left}..${right} (宽${right - left + 1}), y ${top}..${bottom} (高${bottom - top + 1})`);

// 2) 用真值网格反推列数：边界内能容纳几格
const pitch = 14.4, ox = 42, oy = 47;
console.log(`边界宽/pitch = ${(right - left) / pitch}, 边界高/pitch = ${(bottom - top) / pitch}`);
console.log(`origin 相对边界: 左边距 ${left - ox}, 上边距 ${top - oy}`);

// 3) 最右列/最底行的采样内容：这些格子覆盖的像素到底是什么颜色
for (const [label, c, r] of [['右1列中', 38, 18], ['右2列中', 37, 18], ['底1行中', 19, 36], ['底2行中', 19, 35], ['左1列中', 0, 18], ['顶1行中', 19, 0]]) {
  const x0 = ox + c * pitch, y0 = oy + r * pitch;
  let rs = 0, gs = 0, bs = 0, n = 0;
  for (let y = Math.round(y0 + 2); y < Math.round(y0 + pitch - 2); y += 2)
    for (let x = Math.round(x0 + 2); x < Math.round(x0 + pitch - 2); x += 2) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const [pr, pg, pb] = px(x, y); rs += pr; gs += pg; bs += pb; n += 1;
    }
  if (!n) { console.log(`${label} [c${c},r${r}]: 完全在图外`); continue; }
  console.log(`${label} [c${c},r${r}]: 平均色 #${[rs / n, gs / n, bs / n].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`);
}

// 4) 渲染网格线叠加图
const scale = 2;
const overlay = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) { overlay[i * 3] = data[i * 4]; overlay[i * 3 + 1] = data[i * 4 + 1]; overlay[i * 3 + 2] = data[i * 4 + 2]; }
const drawV = (x) => { const xi = Math.round(x); for (let y = 0; y < H; y++) { const i = (y * W + xi) * 3; overlay[i] = 255; overlay[i + 1] = 0; overlay[i + 2] = 0; } };
const drawH = (y) => { const yi = Math.round(y); for (let x = 0; x < W; x++) { const i = (yi * W + x) * 3; overlay[i] = 255; overlay[i + 1] = 0; overlay[i + 2] = 0; } };
for (let c = 0; c <= 39; c++) drawV(ox + c * pitch);
for (let r = 0; r <= 37; r++) drawH(oy + r * pitch);
// 图纸真实边界（绿色）
const drawVG = (x) => { const xi = Math.round(x); for (let y = Math.max(0, top - 5); y < Math.min(H, bottom + 5); y++) { const i = (y * W + xi) * 3; overlay[i] = 0; overlay[i + 1] = 255; overlay[i + 2] = 0; } };
const drawHG = (y) => { const yi = Math.round(y); for (let x = Math.max(0, left - 5); x < Math.min(W, right + 5); x++) { const i = (yi * W + x) * 3; overlay[i] = 0; overlay[i + 1] = 255; overlay[i + 2] = 0; } };
drawVG(left); drawVG(right); drawHG(top); drawHG(bottom);
const outW = Math.round(W * scale), outH = Math.round(H * scale);
await sharp(overlay, { raw: { width: W, height: H, channels: 3 } }).resize(outW, outH, { kernel: 'nearest' }).png().toFile('C:/Users/Plout/Desktop/pindouwangge/pattern_compare/detail/pony-grid-overlay.png');
console.log('输出: pattern_compare/detail/pony-grid-overlay.png（红=网格线, 绿=检测的图纸边界）');
