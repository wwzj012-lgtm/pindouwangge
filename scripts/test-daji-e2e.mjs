import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp('C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const cal = { originX: 0, originY: 0, cellWidth: 29.6, cellHeight: 29.54, columns: 52, rows: 51 };
const run = (opts, tag) => {
  const r = recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, opts);
  console.log(`${tag}: symbolAssist=${JSON.stringify(r.symbolAssist)} lowConf=${r.summary.lowConfidence} meanConf=${r.summary.meanConfidence?.toFixed(3)} distinct=${r.summary.distinctColors}`);
  return r;
};
const base = { mode: 'precision', edgeInsetRatio: 0.1 };
const r0 = run(base, '纯颜色   ');
const r1 = run({ ...base, symbolAssist: true }, '色号辅助 ');
// 渲染两张对比
const S = 16;
const render = (cells, tag) => {
  const W = cal.columns * S, H = cal.rows * S;
  const rects = [];
  for (let row = 0; row < cal.rows; row++) for (let col = 0; col < cal.columns; col++) {
    const c = cells[row][col];
    const fill = c.color ? `rgb(${c.color.rgb.join(',')})` : '#ffffff';
    rects.push(`<rect x="${col*S}" y="${row*S}" width="${S}" height="${S}" fill="${fill}" stroke="#eee" stroke-width="0.4"/>`);
  }
  return sharp({ create: { width: W, height: H, channels: 3, background: {r:255,g:255,b:255} } })
    .composite([{ input: Buffer.from(`<svg width="${W}" height="${H}">${rects.join('')}</svg>`), left: 0, top: 0 }]).png().toBuffer();
};
const [b0, b1] = await Promise.all([render(r0.cells), render(r1.cells)]);
await sharp({ create: { width: 52*16*2+8, height: 51*16+30, channels: 3, background: { r: 40, g: 44, b: 52 } } })
  .composite([
    { input: Buffer.from(`<svg width="${52*16}" height="30"><rect width="100%" fill="#1e293b"/><text x="${52*16/2}" y="21" text-anchor="middle" font-size="15" fill="#fff" font-family="Microsoft YaHei">纯颜色识别</text></svg>`), left: 0, top: 0 },
    { input: b0, left: 0, top: 30 },
    { input: Buffer.from(`<svg width="${52*16}" height="30"><rect width="100%" fill="#1e293b"/><text x="${52*16/2}" y="21" text-anchor="middle" font-size="15" fill="#fff" font-family="Microsoft YaHei">色号辅助识别（空白格=不放豆）</text></svg>`), left: 52*16+8, top: 0 },
    { input: b1, left: 52*16+8, top: 30 },
  ]).png().toFile('C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import/daji_pipeline_compare.png');
console.log('-> daji_pipeline_compare.png');
await vite.close();
