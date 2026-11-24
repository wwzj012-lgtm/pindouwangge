import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { extractBeadSymbols } = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const rgbOf = (code) => BRAND_PALETTES.MARD.find(c => c.code === code).rgb;
const FONT = {
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  '2': ['#####', '....#', '....#', '#####', '#....', '#....', '#####'],
  '4': ['#...#', '#...#', '#...#', '#####', '....#', '....#', '....#'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  G: ['#####', '#....', '#....', '#..##', '#...#', '#...#', '#####'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  '6': ['#####', '#....', '####.', '#...#', '#...#', '#...#', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  '3': ['#####', '....#', '....#', '.####', '....#', '....#', '#####'],
  C: ['#####', '#....', '#....', '#....', '#....', '#....', '#####'],
};
const CELL = 50;
function drawCode(parts, x, y, code, darkText) {
  const px = 2;
  const totalW = code.length * 5 * px + (code.length - 1) * px;
  let cursor = x + (CELL - totalW) / 2;
  const top = y + (CELL - 7 * px) / 2;
  for (const ch of code) {
    const glyph = FONT[ch];
    for (let gy = 0; gy < glyph.length; gy++) for (let gx = 0; gx < glyph[gy].length; gx++) {
      if (glyph[gy][gx] === '#') parts.push(`<rect x="${Math.round(cursor + gx * px)}" y="${Math.round(top + gy * px)}" width="${px}" height="${px}" fill="${darkText ? "#222" : "#ddd"}"/>`);
    }
    cursor += 5 * px + 2;
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
const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

const cal = { originX: 0, originY: 0, cellWidth: CELL, cellHeight: CELL, columns: 6, rows: 3 };
const r = extractBeadSymbols(source, cal, BRAND_PALETTES.MARD);
console.log(JSON.stringify({ textCellCount: r.textCellCount, resolved: r.resolvedCount, labels: r.labelChars, reasons: r.unresolvedReasons, blanks: r.blankCells.size, codes: [...r.codes.entries()].map(([k, v]) => `${k}=${v.code}(${v.score.toFixed(2)})`) }, null, 1));
await vite.close();
// dump 格(1,0) M13 的掩码
{
  const x0 = 0 * CELL, y0 = 1 * CELL;
  const rx0 = x0 + Math.round(CELL * 0.14), ry0 = y0 + Math.round(CELL * 0.14);
  const rx1 = x0 + Math.round(CELL * 0.86), ry1 = y0 + Math.round(CELL * 0.86);
  const counts = new Map();
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
    const i = (y * info.width + x) * 4;
    const k = ((data[i] >> 4) << 8) | ((data[i+1] >> 4) << 4) | (data[i+2] >> 4);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let bk = -1, bc = -1;
  for (const [k, c] of counts) if (c > bc) { bc = c; bk = k; }
  const base = [((bk >> 8) & 15) * 16 + 8, ((bk >> 4) & 15) * 16 + 8, (bk & 15) * 16 + 8];
  console.log(`格(1,0) M13 底色=${base.join(',')} rgbOf(M13)=${rgbOf('M13').join(',')}`);
  for (let y = ry0; y < ry1; y++) {
    let line = '';
    for (let x = rx0; x < rx1; x++) {
      const i = (y * info.width + x) * 4;
      const d2 = (data[i]-base[0])**2 + (data[i+1]-base[1])**2 + (data[i+2]-base[2])**2;
      line += d2 > 3600 ? '#' : '.';
    }
    console.log(line);
  }
}
