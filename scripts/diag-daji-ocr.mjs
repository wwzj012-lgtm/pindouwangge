import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { deltaE2000, rgbToLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
// 复制 analyzeCells 的关键逻辑做白盒诊断
const { data, info } = await sharp('C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const CELL = 29.7;
const pal = BRAND_PALETTES.MARD;
const prepared = pal.map(c => ({ c, lab: rgbToLab(...c.rgb) }));
const codeSet = new Set(pal.map(c => c.code));
let noText = 0, compCounts = {}, priorFail = {}, lenMatch = 0, lenMismatch = 0, priorOk = 0;
const priorCodes = new Map();
for (let row = 0; row < Math.floor(info.height / CELL); row++) {
  for (let col = 0; col < Math.floor(W / CELL); col++) {
    const x0 = Math.round(col * CELL), y0 = Math.round(row * CELL);
    const rx0 = x0 + Math.round(CELL * 0.14), ry0 = y0 + Math.round(CELL * 0.14);
    const rx1 = x0 + Math.round(CELL * 0.86), ry1 = y0 + Math.round(CELL * 0.86);
    const rw = rx1 - rx0, rh = ry1 - ry0;
    // 底色众数
    const counts = new Map();
    for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
      const i = (y * W + x) * 4;
      const key = ((data[i] >> 4) << 8) | ((data[i+1] >> 4) << 4) | (data[i+2] >> 4);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let bk = -1, bc = -1;
    for (const [k, c] of counts) if (c > bc) { bc = c; bk = k; }
    const base = [((bk >> 8) & 15) * 16 + 8, ((bk >> 4) & 15) * 16 + 8, (bk & 15) * 16 + 8];
    // 掩码
    const mask = new Uint8Array(rw * rh);
    let on = 0;
    for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
      const i = (y * W + x) * 4;
      const d2 = (data[i]-base[0])**2 + (data[i+1]-base[1])**2 + (data[i+2]-base[2])**2;
      if (d2 > 3600) { mask[(y-ry0)*rw + (x-rx0)] = 1; on++; }
    }
    const ratio = on / (rw * rh);
    if (ratio < 0.02 || ratio > 0.5) { noText++; continue; }
    // 连通域
    const seen = new Uint8Array(mask.length);
    const comps = [];
    for (let s = 0; s < mask.length; s++) {
      if (!mask[s] || seen[s]) continue;
      seen[s] = 1; const q = [s]; const px = [];
      let mnx = 99, mxx = -1, mny = 99, mxy = -1;
      while (q.length) {
        const idx = q.pop(); const y = Math.floor(idx / rw), x = idx % rw; px.push([x, y]);
        if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y;
        if (x > 0 && mask[idx-1] && !seen[idx-1]) { seen[idx-1]=1; q.push(idx-1); }
        if (x < rw-1 && mask[idx+1] && !seen[idx+1]) { seen[idx+1]=1; q.push(idx+1); }
        if (y > 0 && mask[idx-rw] && !seen[idx-rw]) { seen[idx-rw]=1; q.push(idx-rw); }
        if (y < rh-1 && mask[idx+rw] && !seen[idx+rw]) { seen[idx+rw]=1; q.push(idx+rw); }
      }
      comps.push({ n: px.length, w: mxx-mnx+1, h: mxy-mny+1 });
    }
    const kept = comps.filter(c => c.n >= 6 && c.n <= rw*rh*0.55 && c.h >= rh*0.12 && c.w <= rw*0.8);
    compCounts[kept.length] = (compCounts[kept.length] ?? 0) + 1;
    if (kept.length < 1 || kept.length > 3) continue;
    // 底色先验
    const bl = rgbToLab(...base);
    let best = null;
    for (const p of prepared) { const d = deltaE2000(bl, p.lab); if (!best || d < best.d) best = { code: p.c.code, d }; }
    if (best.d > 10) { priorFail['dE>10'] = (priorFail['dE>10'] ?? 0) + 1; continue; }
    priorOk++;
    if (best.code.length === kept.length) { lenMatch++; priorCodes.set(best.code, (priorCodes.get(best.code) ?? 0) + 1); }
    else lenMismatch++;
  }
}
console.log(`无文字格 ${noText} | 连通域数分布:`, JSON.stringify(compCounts));
console.log(`先验通过 ${priorOk} | dE>10 弃 ${priorFail['dE>10'] ?? 0} | 长度匹配 ${lenMatch} | 长度不匹配 ${lenMismatch}`);
console.log('先验色号分布 top20:', [...priorCodes.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([k,n])=>`${k}:${n}`).join(' '));
await vite.close();
