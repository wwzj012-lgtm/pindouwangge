// 白盒：每文字格的 base/prior/partCount
import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { deltaE2000, rgbToLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const rgbOf = (code) => BRAND_PALETTES.MARD.find(c => c.code === code).rgb;
const FONT = {
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  '2': ['#####', '....#', '....#', '#####', '#....', '#....', '#####'],
  '4': ['#...#', '#...#', '#...#', '#####', '....#', '....#', '....#'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  G: ['#####', '#....', '#....', '#..##', '#...#', '#...#', '#####'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  '6': ['#####', '#....', '####.', '#...#', '#...#', '#...#', '#####'],
  M: ['#...#', '##.##', '#####', '#.#.#', '#...#', '#...#', '#...#'],
  '3': ['#####', '....#', '....#', '.###.', '....#', '....#', '#####'],
  C: ['#####', '#....', '#....', '#....', '#....', '#....', '#####'],
};
const CELL = 80;
function drawCode(parts, x, y, code, darkText) {
  const px = 3;
  const totalW = code.length * 5 * px + (code.length - 1) * 4;
  let cursor = Math.round(x + (CELL - totalW) / 2);
  const top = Math.round(y + (CELL - 7 * px) / 2);
  for (const ch of code) {
    const glyph = FONT[ch];
    for (let gy = 0; gy < glyph.length; gy++) for (let gx = 0; gx < glyph[gy].length; gx++) {
      if (glyph[gy][gx] === '#') parts.push(`<rect x="${Math.round(cursor + gx * px)}" y="${Math.round(top + gy * px)}" width="${px}" height="${px}" fill="${darkText ? '#222' : '#ddd'}"/>`);
    }
    cursor += 5 * px + 4;
  }
}
const cells = [
  { row: 0, column: 0, rgb: rgbOf('F24'), code: 'F24' },
  { row: 0, column: 1, rgb: rgbOf('H2'), code: 'H2' },
  { row: 0, column: 2, rgb: rgbOf('G16'), code: 'G16' },
  { row: 1, column: 0, rgb: rgbOf('M13'), code: 'M13' },
  { row: 1, column: 1, rgb: rgbOf('C13'), code: 'C13' },
  { row: 2, column: 3, rgb: rgbOf('F24'), code: 'F24' },
  { row: 2, column: 4, rgb: rgbOf('H2'), code: 'H2' },
  { row: 2, column: 5, rgb: rgbOf('G16'), code: 'G16' },
  { row: 2, column: 0, rgb: rgbOf('M13'), code: 'M13' },
  { row: 2, column: 1, rgb: rgbOf('C13'), code: 'C13' },
];
const W = 6 * CELL, H = 3 * CELL;
const parts = [];
for (const c of cells) {
  parts.push(`<rect x="${c.column * CELL}" y="${c.row * CELL}" width="${CELL}" height="${CELL}" fill="rgb(${c.rgb.join(',')})"/>`);
  drawCode(parts, c.column * CELL, c.row * CELL, c.code, (c.rgb[0] + c.rgb[1] + c.rgb[2]) >= 380);
}
for (let i = 0; i <= 6; i++) parts.push(`<line x1="${i * CELL}" y1="0" x2="${i * CELL}" y2="${H}" stroke="#999" stroke-width="1"/>`);
for (let i = 0; i <= 3; i++) parts.push(`<line x1="0" y1="${i * CELL}" x2="${W}" y2="${i * CELL}" stroke="#999" stroke-width="1"/>`);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>`;
await sharp(Buffer.from(svg)).png().toFile("D:/Build_Apps/pindouwangge/scripts/dbg-ocr4.png");
const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const img = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const prepared = BRAND_PALETTES.MARD.map(c => ({ code: c.code, lab: rgbToLab(...c.rgb) }));
// 只看 M13 格 (1,0)
for (const [row, col, expect] of [[1, 0, 'M13'], [1, 1, 'C13']]) {
  const x0 = Math.round(col * CELL), y0 = Math.round(row * CELL);
  const rx0 = x0 + Math.round(CELL * 0.14), ry0 = y0 + Math.round(CELL * 0.14);
  const rx1 = x0 + Math.round(CELL * 0.86), ry1 = y0 + Math.round(CELL * 0.86);
  const rw = rx1 - rx0, rh = ry1 - ry0;
  const counts = new Map();
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
    const i = (y * img.width + x) * 4;
    const k = ((img.data[i] >> 4) << 8) | ((img.data[i+1] >> 4) << 4) | (img.data[i+2] >> 4);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let bk = -1, bc = -1;
  for (const [k, c] of counts) if (c > bc) { bc = c; bk = k; }
  const base = [((bk >> 8) & 15) * 16 + 8, ((bk >> 4) & 15) * 16 + 8, (bk & 15) * 16 + 8];
  const bl = rgbToLab(...base);
  let best = null;
  for (const p of prepared) { const d = deltaE2000(bl, p.lab); if (!best || d < best.d) best = { code: p.code, d }; }
  // 域数
  const mask = new Uint8Array(rw * rh);
  let on = 0;
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
    const i = (y * img.width + x) * 4;
    const d2 = (img.data[i]-base[0])**2 + (img.data[i+1]-base[1])**2 + (img.data[i+2]-base[2])**2;
    if (d2 > 3600) { mask[(y-ry0)*rw + (x-rx0)] = 1; on++; }
  }
  const ratio = on / (rw * rh);
  const seen = new Uint8Array(mask.length); const comps = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    seen[s] = 1; const q = [s];
    let n = 0, mnx = 99, mxx = -1, mny = 99, mxy = -1;
    while (q.length) {
      const idx = q.pop(); const y = Math.floor(idx / rw), x = idx % rw; n++;
      if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y;
      if (x > 0 && mask[idx-1] && !seen[idx-1]) { seen[idx-1]=1; q.push(idx-1); }
      if (x < rw-1 && mask[idx+1] && !seen[idx+1]) { seen[idx+1]=1; q.push(idx+1); }
      if (y > 0 && mask[idx-rw] && !seen[idx-rw]) { seen[idx-rw]=1; q.push(idx-rw); }
      if (y < rh-1 && mask[idx+rw] && !seen[idx+rw]) { seen[idx+rw]=1; q.push(idx+rw); }
    }
    comps.push({ n, w: mxx-mnx+1, h: mxy-mny+1 });
  }
  const kept = comps.filter(c => c.n >= 6 && c.n <= rw*rh*0.55 && c.h >= rh*0.12 && c.w <= rw*0.8);
  console.log(`格(${row},${col}) 期望${expect}: base=${base.join(',')} prior=${best.code}(ΔE${best.d.toFixed(1)}) ratio=${ratio.toFixed(3)} kept=${kept.length} comps=[${comps.map(c=>`n${c.n}/w${c.w}/h${c.h}`).join(' ')}]`);
}
await vite.close();
// dump 格(1,0) '3' 区域（绝对 x 52-67, y 110-131）白字形态
{
  console.log("格(1,0) 3槽位 ASCII(黑字=#):");
  for (let y = 108; y < 134; y++) {
    let line = '';
    for (let x = 10; x < 75; x++) {
      const i = (y * img.width + x) * 4;
      line += (img.data[i] > 200 && img.data[i+1] > 200 && img.data[i+2] > 200) ? '#' : '.';
    }
    console.log(line);
  }
}
