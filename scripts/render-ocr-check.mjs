// 识别色号 → 色板RGB 渲染色块图 vs 原图并排；未解析格用底色先验渲染（标灰点）
import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { extractBeadSymbols } = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { deltaE2000, rgbToLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const cal = { originX: 0, originY: 0, cellWidth: 29.6, cellHeight: 29.54, columns: 52, rows: 51 };
const r = extractBeadSymbols(source, cal, BRAND_PALETTES.MARD);
const byCode = new Map(BRAND_PALETTES.MARD.map(c => [c.code, c.rgb]));
const prepared = BRAND_PALETTES.MARD.map(c => ({ code: c.code, rgb: c.rgb, lab: rgbToLab(...c.rgb) }));
// 渲染色块图：cell = 24px
const S = 24, W = cal.columns * S, H = cal.rows * S;
const out = sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } });
const rects = [];
let ocrCount = 0, priorCount = 0;
for (let row = 0; row < cal.rows; row++) for (let col = 0; col < cal.columns; col++) {
  const key = `${row}:${col}`;
  const sym = r.codes.get(key);
  // 底色先验
  const x0 = Math.round(col * 29.6), y0 = Math.round(row * 29.54);
  const rx0 = x0 + 4, ry0 = y0 + 4, rx1 = x0 + 26, ry1 = y0 + 26;
  const counts = new Map();
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
    const i = (y * info.width + x) * 4;
    const k = ((data[i] >> 4) << 8) | ((data[i+1] >> 4) << 4) | (data[i+2] >> 4);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let bk = -1, bc = -1;
  for (const [k, c] of counts) if (c > bc) { bc = c; bk = k; }
  const base = [((bk >> 8) & 15) * 16 + 8, ((bk >> 4) & 15) * 16 + 8, (bk & 15) * 16 + 8];
  let rgb, isOcr = false;
  if (sym && byCode.has(sym.code)) { rgb = byCode.get(sym.code); isOcr = true; ocrCount++; }
  else {
    // 先验最近色
    const bl = rgbToLab(...base);
    let best = null;
    for (const p of prepared) { const d = deltaE2000(bl, p.lab); if (!best || d < best.d) best = { rgb: p.rgb, d }; }
    rgb = best.rgb; priorCount++;
  }
  rects.push(`<rect x="${col * S}" y="${row * S}" width="${S}" height="${S}" fill="rgb(${rgb.join(',')})" stroke="#ddd" stroke-width="0.5"/>${isOcr ? '' : `<circle cx="${col * S + S - 5}" cy="${row * S + 5}" r="2.5" fill="rgba(255,0,0,0.85)"/>`}`);
}
await out.composite([{ input: Buffer.from(`<svg width="${W}" height="${H}">${rects.join('')}</svg>`), left: 0, top: 0 }]).png().toFile('C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import/daji_ocr_render.png');
console.log(`OCR色 ${ocrCount} | 先验色 ${priorCount} (红点=非OCR格) -> daji_ocr_render.png`);
// 并排对比
const orig = await sharp(SRC).resize(W, H, { fit: 'fill' }).png().toBuffer();
await sharp({ create: { width: W * 2 + 8, height: H + 30, channels: 3, background: { r: 40, g: 44, b: 52 } } })
  .composite([
    { input: Buffer.from(`<svg width="${W}" height="30"><rect width="100%" height="100%" fill="#1e293b"/><text x="${W/2}" y="21" text-anchor="middle" font-size="16" fill="#fff" font-family="Microsoft YaHei">原图（缩放对齐）</text></svg>`), left: 0, top: 0 },
    { input: orig, left: 0, top: 30 },
    { input: Buffer.from(`<svg width="${W}" height="30"><rect width="100%" height="100%" fill="#1e293b"/><text x="${W/2}" y="21" text-anchor="middle" font-size="16" fill="#fff" font-family="Microsoft YaHei">色号识别渲染（红点=退回颜色匹配）</text></svg>`), left: W + 8, top: 0 },
    { input: `${'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import/daji_ocr_render.png'}`, left: W + 8, top: 30 },
  ]).png().toFile('C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import/daji_ocr_compare.png');
console.log('-> daji_ocr_compare.png');
await vite.close();
