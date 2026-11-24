// 裁剪原图中指定错色格的 3x3 邻域放大图，供目检色号文字
import sharp from 'sharp';
import { readFileSync } from 'fs';

const ORIG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
const { diffs } = JSON.parse(readFileSync(`${OUT}/manual_vs_rec.json`, 'utf8'));

// 选取目标错格：G16<->M4、H2<->H9、D9<->D8、F24<->F14 各取前几个
const targets = [];
const seen = new Map();
for (const [r, c, mc, rc] of diffs) {
  const key = [mc, rc].sort().join('<->');
  if (!['G16<->M4', 'H2<->H9', 'D9<->D8', 'F24<->F14'].includes(key)) continue;
  if ((seen.get(key) || 0) >= 4) continue;
  seen.set(key, (seen.get(key) || 0) + 1);
  targets.push([r, c, mc, rc]);
}
console.log('targets:', targets.map(t => `r${t[0] + 1}c${t[1] + 1}:${t[2]}vs${t[3]}`).join(' '));

const CW = 29.6, CH = 29.54;
const cellCenter = (r, c) => [Math.round((c + 0.5) * CW), Math.round((r + 0.5) * CH)];
const S = 3; // 3x3 邻域
const Z = 3; // 放大倍数
const tiles = [];
for (const [r, c, mc, rc] of targets) {
  const [cx, cy] = cellCenter(r, c);
  const half = Math.floor(S / 2) * CW;
  const left = Math.max(0, Math.round(cx - half)), top = Math.max(0, Math.round(cy - half));
  const buf = await sharp(ORIG).extract({ left, top, width: Math.round(S * CW), height: Math.round(S * CH) }).resize(Math.round(S * CW * Z), Math.round(S * CH * Z), { kernel: 'nearest' }).png().toBuffer();
  tiles.push({ buf, label: `r${r + 1}c${c + 1} ${mc}vs${rc}` });
}
// 拼接：每行 4 个，带标签
const perRow = 4, TW = Math.round(S * CW) * Z, TH = Math.round(S * CH) * Z + 26;
const rowsN = Math.ceil(tiles.length / perRow);
const parts = [];
for (let i = 0; i < tiles.length; i++) {
  const x = (i % perRow) * (TW + 8), y = Math.floor(i / perRow) * TH;
  parts.push(`<rect x="${x}" y="${y}" width="${TW}" height="24" fill="#1e293b"/><text x="${x + TW / 2}" y="${y + 17}" text-anchor="middle" font-size="14" fill="#fff" font-family="Consolas">${tiles[i].label}</text>`);
}
const W = perRow * (TW + 8), H = rowsN * TH;
const comps = tiles.map((t, i) => ({ input: t.buf, left: (i % perRow) * (TW + 8), top: Math.floor(i / perRow) * TH + 26 }));
comps.push({ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`), left: 0, top: 0 });
await sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite(comps).png().toFile(`${OUT}/diff_cell_zoom.png`);
console.log('->', `${OUT}/diff_cell_zoom.png`, W, 'x', H);
