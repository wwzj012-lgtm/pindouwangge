// card3 竖排装配逐 band 诊断：复刻 collectCardItems vertical 分支，打印淘汰点
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const m = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { data, info } = await sharp('benchmark/images/card3.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const dbg = m.debugColorCardParse(source);
const { CARD_TEXT_CONTRAST, CONTRAST } = await vite.ssrLoadModule('/src/utils/importLegend.ts').then(mod => ({ CARD_TEXT_CONTRAST: 100, CONTRAST: mod.CONTRAST ?? 60 }));
// 从 dbg 拿不到内部 bandData，只能用 bands + tokenXs 重建 tokens
const cropped = source; // collectCardItems 无 region 时 crop=全图
const bgNative = m.cardPageBg(cropped);
const k = 4;
const binHi = m.buildCardBuffers(cropped, bgNative, k, 100).bin;
const color = m.upscalePixelsBilinear(cropped, k);
const wOf = c => c.x1 - c.x0 + 1;
for (const b of dbg.bands) {
  const tokens = b.tokenXs.map(([x0, x1, isSw]) => ({ x0: x0 * k, x1: (x1 + 1) * k - 1, isSw }));
  // 色块仲裁
  let swatchToken = null, bestDist = 25, swatchColor = null;
  for (const t of tokens) {
    const mode = m.dominantBaseColor(color.data, color.width, t.x0, b.y0 * k, t.x1 + 1, (b.y1 + 1) * k);
    const d = Math.sqrt((mode[0] - bgNative[0]) ** 2 + (mode[1] - bgNative[1]) ** 2 + (mode[2] - bgNative[2]) ** 2);
    if (d > bestDist) { bestDist = d; swatchToken = t; swatchColor = mode; }
  }
  const texts = tokens.filter(t => t !== swatchToken).sort((a, b2) => a.x0 - b2.x0);
  let step = `tokens=${tokens.length} sw=${swatchToken ? 'Y' + bestDist.toFixed(0) : 'N'}`;
  if (!texts.length) { console.log(`band y=${b.y0}-${b.y1} ${step} → 无文本token`); continue; }
  for (const t of texts) {
    t.comps = m.analyzeLineWithContrast(binHi, [255, 255, 255], { y0: b.y0 - 1, y1: b.y1 + 1, minX: t.x0 - 1, maxX: t.x1 + 1 }, 100)
      .filter(c => c.x0 >= t.x0 - 1 && c.x1 <= t.x1 + 1);
  }
  const widths = [];
  for (const t of texts) for (const c of t.comps) { const w = wOf(c); if (w >= 6 && w <= 34) widths.push(w); }
  const digitWv = widths.length ? widths.sort((a, b2) => a - b2)[Math.floor(widths.length / 2)] : 20;
  const comps0 = texts[0].comps;
  let codeInfo = `codeComps=${comps0.length}`;
  const codeGlyphs = m.cardDropSlivers(comps0.flatMap(g => m.cardSplitWideGlyph(g, digitWv)), digitWv);
  codeInfo += `→glyphs=${codeGlyphs.length}`;
  const status = codeGlyphs.length ? 'OK' : '丢弃';
  console.log(`band y=${b.y0}-${b.y1} h=${b.y1 - b.y0 + 1} ${step} ${codeInfo} digitW=${digitWv} → ${status}`);
}
await vite.close();
