import sharp from 'sharp';
const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, C = info.channels;
const CW = 29.6, CH = 29.54;
const analyze = (row, col) => {
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
  const mask = [];
  let on = 0;
  for (let y = ry0; y < ry1; y++) {
    const line = [];
    for (let x = rx0; x < rx1; x++) {
      const i = (y * W + x) * C;
      const d2 = (data[i]-base[0])**2 + (data[i+1]-base[1])**2 + (data[i+2]-base[2])**2;
      const v = d2 > 3600 ? 1 : 0;
      line.push(v); on += v;
    }
    mask.push(line);
  }
  return { base, mask, on, rw, rh, ratio: on / (rw * rh) };
};
// 扫描：ratio 合格但 kept=0 的格子
let found = 0;
const bad = [];
for (let row = 0; row < 51 && found < 6; row++) {
  for (let col = 0; col < 52 && found < 6; col++) {
    const a = analyze(row, col);
    if (a.ratio < 0.04 || a.ratio > 0.5) continue;
    // 数连通域（简化：过滤条件同主管线）
    const comps = [];
    const seen = a.mask.map(r => r.map(() => false));
    for (let y = 0; y < a.rh; y++) for (let x = 0; x < a.rw; x++) {
      if (!a.mask[y][x] || seen[y][x]) continue;
      const q = [[x, y]]; seen[y][x] = true;
      let n = 0, mnx = 99, mxx = -1, mny = 99, mxy = -1;
      while (q.length) {
        const [cx, cy] = q.pop(); n++;
        if (cx < mnx) mnx = cx; if (cx > mxx) mxx = cx; if (cy < mny) mny = cy; if (cy > mxy) mxy = cy;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < a.rw && ny >= 0 && ny < a.rh && a.mask[ny][nx] && !seen[ny][nx]) { seen[ny][nx] = true; q.push([nx, ny]); }
        }
      }
      comps.push({ n, w: mxx - mnx + 1, h: mxy - mny + 1 });
    }
    const kept = comps.filter(c => c.n >= 6 && c.h >= a.rh * 0.12 && c.w <= a.rw * 0.8);
    if (comps.length > 0 && kept.length === 0 && found < 6) {
      found++;
      bad.push([row, col, comps.map(c => `n${c.n}/w${c.w}/h${c.h}`).join(' ')]);
      console.log(`\n=== 格(${row},${col}) base=${a.base.join(',')} ratio=${a.ratio.toFixed(3)} comps=[${comps.map(c => `n${c.n}/w${c.w}/h${c.h}`).join(' ')}]`);
      for (const line of a.mask) console.log(line.map(v => v ? '#' : '.').join(''));
    }
  }
}
