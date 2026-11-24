// 对候选行 dump 原始 comps（无过滤 + 逐过滤节点判定）× 4 band
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';

const CARD_UPSCALE = 4;

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const IL = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp('benchmark/images/card1.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const cropped = source;

const dbg = IL.debugColorCardParse(source, BRAND_PALETTES.MARD);
const bgNative = IL.cardPageBg(cropped);
const { bin } = IL.buildCardBuffers(cropped, bgNative, CARD_UPSCALE);
const bg = [255, 255, 255];

function rawComps(pix, background, y0, y1, minX, maxX, contrast, maxWidthRatio = 0.6) {
  const { data: d, width: w } = pix;
  const yy0 = Math.max(0, y0 - 1), yy1 = Math.min(pix.height - 1, y1 + 1);
  const xx0 = Math.max(0, minX - 2), xx1 = Math.min(w - 1, maxX + 2);
  const ww = xx1 - xx0 + 1, hh = yy1 - yy0 + 1;
  const c2 = contrast * contrast;
  const mask = new Uint8Array(ww * hh);
  let on = 0;
  for (let y = yy0; y <= yy1; y += 1) for (let x = xx0; x <= xx1; x += 1) {
    const i = (y * w + x) * 4;
    const dr = d[i] - background[0], dg = d[i + 1] - background[1], db = d[i + 2] - background[2];
    if (dr * dr + dg * dg + db * db > c2) { mask[(y - yy0) * ww + (x - xx0)] = 1; on += 1; }
  }
  if (!on) return [];
  const seen = new Uint8Array(ww * hh);
  const comps = [];
  for (let p = 0; p < ww * hh; p += 1) {
    if (!mask[p] || seen[p]) continue;
    const stack = [p]; seen[p] = 1;
    let minXc = ww, maxXc = -1, minYc = hh, maxYc = -1, area = 0;
    while (stack.length) {
      const q = stack.pop();
      const qx = q % ww, qy = (q - qx) / ww;
      if (qx < minXc) minXc = qx; if (qx > maxXc) maxXc = qx;
      if (qy < minYc) minYc = qy; if (qy > maxYc) maxYc = qy;
      area += 1;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= ww || ny >= hh) continue;
        const np = ny * ww + nx;
        if (mask[np] && !seen[np]) { seen[np] = 1; stack.push(np); }
      }
    }
    const c = { x0: xx0 + minXc, x1: xx0 + maxXc, y0: yy0 + minYc, y1: yy0 + maxYc, area, w: maxXc - minXc + 1, h: maxYc - minYc + 1 };
    c.fMinArea = c.area < 5;
    c.fWide = c.w > ww * maxWidthRatio;
    c.fEdge = c.w <= 2 || c.h <= 2;
    c.fSliver = c.w <= 3 && c.area <= 10;
    c.dropped = c.fMinArea || c.fWide || c.fEdge || c.fSliver;
    comps.push(c);
  }
  comps.sort((a, b) => a.x0 - b.x0);
  return comps;
}

const CANDS = JSON.parse(process.env.CANDS ?? '[9,13,41,42,44,46,48,51,54,55,57,58,59,60]');
for (const idx of CANDS) {
  const it = dbg.items[idx];
  console.log(`\n===== item[${idx}] prior=${it.prior} resolved=${it.resolved} codeG=${it.codeGlyphs} ws=[${it.codeWs.join(',')}] countG=${it.countGlyphs} cws=[${it.countWs.join(',')}] codeSpan=${it.codeSpan} dot=${it.dotHex} =====`);
  if (it.codeSpan === '-') continue;
  const [cx0, cx1] = it.codeSpan.split('-').map(Number);
  dbg.bands.forEach((band, bi) => {
    const wx0 = Math.max(0, cx0 - 90), wx1 = cx1 + 10;
    const comps = rawComps(bin, bg, band.y0, band.y1, wx0, wx1, 60);
    if (!comps.length) return;
    console.log(`  band${bi} y=${band.y0}-${band.y1}:`);
    for (const c of comps) {
      const tag = c.dropped ? `DROP(${[c.fMinArea && 'area', c.fWide && 'wide', c.fEdge && 'edge', c.fSliver && 'sliver'].filter(Boolean).join('+')})` : 'KEEP';
      console.log(`    x=${c.x0}-${c.x1} w=${c.w} h=${c.h} area=${c.area} ${tag}`);
    }
  });
}
await vite.close();
