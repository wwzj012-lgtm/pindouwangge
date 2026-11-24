import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { extractBeadSymbols } = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const rgbOf = (code) => BRAND_PALETTES.MARD.find(c => c.code === code).rgb;
const CELL = 30;
const cells = [
  { row: 0, column: 3, rgb: rgbOf('F24'), code: 'F24' },
  { row: 0, column: 4, rgb: rgbOf('H2'), code: 'H2' },
  { row: 0, column: 5, rgb: rgbOf('G16'), code: 'G16' },
  { row: 1, column: 2, rgb: rgbOf('M13'), code: 'M13' },
  { row: 1, column: 3, rgb: rgbOf('C13'), code: 'C13' },
  { row: 0, column: 0, rgb: rgbOf('F24'), code: 'F24' },
  { row: 0, column: 1, rgb: rgbOf('H2'), code: 'H2' },
  { row: 0, column: 2, rgb: rgbOf('G16'), code: 'G16' },
  { row: 1, column: 0, rgb: rgbOf('M13'), code: 'M13' },
  { row: 1, column: 1, rgb: rgbOf('C13'), code: 'C13' },
];
const W = 6 * CELL, H = 3 * CELL;
const parts = [];
for (const c of cells) {
  parts.push(`<rect x="${c.column * CELL}" y="${c.row * CELL}" width="${CELL}" height="${CELL}" fill="rgb(${c.rgb.join(',')})"/>`);
  parts.push(`<text x="${c.column * CELL + CELL / 2}" y="${c.row * CELL + CELL / 2 + 4}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#222">${c.code}</text>`);
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
