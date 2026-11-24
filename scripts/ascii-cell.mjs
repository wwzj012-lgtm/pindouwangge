import sharp from 'sharp';
const SRC = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, C = info.channels;
const CW = 29.6, CH = 29.54;
const show = (row, col) => {
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
  console.log(`格(${row},${col}) base=${base.join(',')}`);
  for (let y = ry0; y < ry1; y++) {
    let line = '';
    for (let x = rx0; x < rx1; x++) {
      const i = (y * W + x) * C;
      const d2 = (data[i]-base[0])**2 + (data[i+1]-base[1])**2 + (data[i+2]-base[2])**2;
      line += d2 > 3600 ? '#' : '.';
    }
    console.log(line);
  }
};
show(6, 4);   // 左上 F24 区
show(25, 20); // 中部 G16 棕橙区
