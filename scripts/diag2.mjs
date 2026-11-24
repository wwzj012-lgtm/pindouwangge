// 联合分布：先验code(长度) × 切分域数
import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { deltaE2000, rgbToLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const { data, info } = await sharp('C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, C = info.channels;
const CW = 29.6, CH = 29.54;
const joint = new Map();
for (let row = 0; row < 51; row++) for (let col = 0; col < 52; col++) {
  const x0 = Math.round(col * CW), y0 = Math.round(row * CH);
  const rx0 = x0 + Math.round(CW * 0.14), ry0 = y0 + Math.round(CH * 0.14);
  const rx1 = x0 + Math.round(CW * 0.86), ry1 = y0 + Math.round(CH * 0.86);
  const rw = rx1 - rx0, rh = ry1 - ry0;
  const counts = new Map();
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
    const i = (y * W + x) * C;
    const key = ((data[i] >> 4) << 8) | ((data[i+1] >> 4) << 4) | (data[i+2] >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bk = -1, bc = -1;
  for (const [k, c] of counts) if (c > bc) { bc = c; bk = k; }
  const base = [((bk >> 8) & 15) * 16 + 8, ((bk >> 4) & 15) * 16 + 8, (bk & 15) * 16 + 8];
  const mask = new Uint8Array(rw * rh);
  let on = 0;
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
    const i = (y * W + x) * C;
    const d2 = (data[i]-base[0])**2 + (data[i+1]-base[1])**2 + (data[i+2]-base[2])**2;
    if (d2 > 3600) { mask[(y-ry0)*rw + (x-rx0)] = 1; on++; }
  }
  const ratio = on / (rw * rh);
  if (ratio < 0.02 || ratio > 0.5) continue;
  // 连通域
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
    comps.push({ n, w: mxx-mnx+1, h: mxy-mny+1, mnx, mxx });
  }
  const kept = comps.filter(c => c.n >= 6 && c.n <= rw*rh*0.55 && c.h >= rh*0.12 && c.w <= rw*0.8);
  if (!kept.length || kept.length > 3) continue;
  const bl = rgbToLab(...base);
  let best = null;
  const prepared = BRAND_PALETTES.MARD.map(c => ({ code: c.code, lab: rgbToLab(...c.rgb) }));
  for (const p of prepared) { const d = deltaE2000(bl, p.lab); if (!best || d < best.d) best = { code: p.code, d }; }
  if (best.d > 10) continue;
  const key = `${best.code}(${best.code.length})字 × ${kept.length}域`;
  joint.set(key, (joint.get(key) ?? 0) + 1);
}
console.log('联合分布 top20:');
for (const [k, n] of [...joint.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 20)) console.log(`  ${k}: ${n}`);
await vite.close();
