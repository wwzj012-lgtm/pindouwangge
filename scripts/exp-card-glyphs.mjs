// 色卡字形可视化：debugColorCardParse 的 glyphDump 渲染成对照长图 + items 表
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';

const card = process.argv[2] ?? 'card1';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { debugColorCardParse } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp(`benchmark/images/${card}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const dbg = debugColorCardParse(source, BRAND_PALETTES.MARD);
if (!dbg) { console.log('debugColorCardParse: null'); await vite.close(); process.exit(1); }

console.log('gates:', JSON.stringify(dbg.gates));
for (let i = 0; i < dbg.items.length; i += 1) {
  const it = dbg.items[i];
  console.log(`#${String(i).padStart(2)} swatch=${it.swatch ? 1 : 0} dot=${(it.dotHex ?? '-').padEnd(9)} code[${it.codeGlyphs}|${it.codeWs.join(',')}] count[${it.countGlyphs}|${it.countWs.join(',')}] prior=${(it.prior ?? '-').padEnd(4)} resolved=${it.resolved ?? '-'}`);
}

// ---- 渲染 glyphDump 成长图 ----
const S = 5; // 位图放大倍数
const ROW_H = 46;
const W = 1100;
const byItem = new Map();
for (const g of dbg.glyphDump) {
  if (!byItem.has(g.i)) byItem.set(g.i, { code: [], count: [] });
  byItem.get(g.i)[g.kind].push(g);
}
const rows = [];
for (const [i, entry] of [...byItem.entries()].sort((a, b) => a[0] - b[0])) {
  const it = dbg.items[i];
  const label = `#${i} prior=${it.prior ?? '-'} res=${it.resolved ?? '-'} dot=${it.dotHex ?? '-'}`;
  let x = 8;
  const parts = [`<text x="${x}" y="24" font-size="15" fill="#333" font-family="monospace">${label}</text>`];
  x = 300;
  for (const kind of ['code', 'count']) {
    for (const g of entry[kind]) {
      const s = Math.max(1, Math.min(4, 22 / g.h));
      for (let py = 0; py < g.h; py += 1) {
        for (let px = 0; px < g.w; px += 1) {
          if (g.rows[py][px] === '1') {
            parts.push(`<rect x="${(x + px * s).toFixed(1)}" y="${(6 + py * s).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" fill="#111"/>`);
          }
        }
      }
      parts.push(`<rect x="${x - 1}" y="5" width="${(g.w * s + 2).toFixed(1)}" height="${(g.h * s + 2).toFixed(1)}" fill="none" stroke="${kind === 'code' ? '#4a7' : '#c66'}" stroke-width="1"/>`);
      x += g.w * s + 6;
    }
    x += 18;
  }
  rows.push(`<g transform="translate(0,${i * ROW_H})">${parts.join('')}</g>`);
}
const H = (byItem.size + 1) * ROW_H;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><text x="8" y="24" font-size="15" fill="#999" font-family="monospace">${card} green=code red=count ${dbg.gates.digitW} ${dbg.gates.pitch}</text>${rows.join('')}</svg>`;
const full = sharp(Buffer.from(svg));
const half = Math.ceil(H / 2);
await full.clone().png().toFile(`benchmark/out/${card}-glyphs.png`);
await sharp(Buffer.from(svg)).extract({ left: 0, top: 0, width: W, height: Math.min(half, H) }).png().toFile(`benchmark/out/${card}-glyphs-top.png`);
await sharp(Buffer.from(svg)).extract({ left: 0, top: Math.min(half, H - 1), width: W, height: H - Math.min(half, H - 1) }).png().toFile(`benchmark/out/${card}-glyphs-bottom.png`);
console.log(`written benchmark/out/${card}-glyphs{,-top,-bottom}.png rows=${byItem.size}`);
await vite.close();
