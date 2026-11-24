// 实验 D：导出 card1 全部漏项槽位的 8 倍放大裁剪图（带标注条）+ 联览图
process.chdir('D:/Build_Apps/pindouwangge');
const { createServer } = await import('vite');
const sharp = (await import('sharp')).default;
const fs = (await import('fs')).default;

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const IL = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp('benchmark/images/card1.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const native = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
// debug 的 span/band 是 4 倍放大坐标（CARD_UPSCALE=4）——先把原生图放大 4 倍再裁
const UP4 = 4;
const data4 = new Uint8ClampedArray(native.width * UP4 * native.height * UP4 * 4);
await sharp(native.data.buffer, { raw: { width: native.width, height: native.height, channels: 4 } })
  .resize(native.width * UP4, native.height * UP4, { kernel: 'nearest' })
  .raw().toBuffer().then(buf => data4.set(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length)));
const source = { data: data4, width: native.width * UP4, height: native.height * UP4 };
const dbg = IL.debugColorCardParse(native, BRAND_PALETTES.MARD);
// debugColorCardParse 需要原生图（内部自己放大 4 倍）——dbg 的 span/band 是放大坐标，
// 裁剪用上面的 4x 缓冲 source。管线输出也用原生图算。
const r = IL.parseColorCard(native, BRAND_PALETTES.MARD);

const truth = ['H2','G9','H16','A18','F18','G20','G6','E16','F13','G1','A14','F6','F23','G2','A9','G5','G13','H7','F16','A12','G3','F11','F10','G8','G18','E11','F17','H6','F12','G19','E14','F1','E15','H17','G16','E20','M13','H5','M14','A19','A7','D19','C12','F19','H4','H9','H22','C20','C28','D1','D11','D17','G4','C29','E1','E8','F22','H8','H10','H11','H19','M10'];
const counts = [1770,469,429,411,387,271,255,243,197,194,177,141,132,127,126,119,97,54,45,44,39,38,31,24,23,22,22,22,21,14,13,13,12,12,11,9,8,7,6,5,4,4,3,3,3,3,3,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1];

// 管线当前输出
const out = r.entries.map(e => e.code || '-');

// 漏项（含错槽命中标注）
const misses = [];
for (let i = 0; i < 62; i++) {
  if (out[i] === truth[i]) continue;
  misses.push(i);
}

// 条目槽位 x 范围：codeSpan∪countSpan；缺失则用相邻条目插值
function spanOf(i) {
  const it = dbg.items[i];
  const parts = [];
  for (const sp of [it.codeSpan, it.countSpan]) {
    if (sp && sp !== '-') { const [a, b] = sp.split('-').map(Number); parts.push([a, b]); }
  }
  if (parts.length) return [Math.min(...parts.map(p => p[0])), Math.max(...parts.map(p => p[1]))];
  return null;
}
const spans = [];
for (let i = 0; i < 62; i++) spans.push(spanOf(i));
function slotRange(i) {
  if (spans[i]) return spans[i];
  // 找相邻有效条目
  let lo = i - 1, hi = i + 1;
  while (lo >= 0 && !spans[lo]) lo--;
  while (hi < 62 && !spans[hi]) hi++;
  const left = lo >= 0 ? spans[lo][1] : spans[hi][0] - 120;
  const right = hi < 62 ? spans[hi][0] : spans[lo][1] + 120;
  return [Math.min(left, right), Math.max(left, right)];
}

fs.mkdirSync('benchmark/results/miss-crops', { recursive: true });
const SCALE = 8;
const crops = [];
for (const i of misses) {
  const band = dbg.bands[Math.min(3, Math.floor(i / 16))];
  let [rx0, rx1] = slotRange(i);
  rx0 = Math.min(rx0, rx1); rx1 = Math.max(rx0, rx1);
  if (rx1 - rx0 < 40) rx1 = rx0 + 40;
  const x0 = Math.max(0, rx0 - 36), x1 = Math.min(source.width - 1, rx1 + 12);
  const y0 = Math.max(0, band.y0 - 6), y1 = Math.min(source.height - 1, band.y1 + 6);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w <= 0 || h <= 0) { console.log('SKIP bad box', i, { x0, x1, y0, y1, rx0, rx1 }); continue; }
  const upW = w * SCALE, upH = h * SCALE;
  const label = `#${i}  真值=${truth[i]}(${counts[i]})  管线=${out[i]}  glyphN=${dbg.items[i].codeGlyphs}`;
  const labelH = 40;
  const svg = Buffer.from(`<svg width="${upW}" height="${labelH}"><rect width="100%" height="100%" fill="#111"/><text x="10" y="29" font-size="24" font-family="monospace" fill="#fff" font-weight="bold">${label.replace(/&/g, '&amp;')}</text></svg>`);
  const png = await sharp(source.data.buffer, { raw: { width: source.width, height: source.height, channels: 4 } })
    .extract({ left: x0, top: y0, width: w, height: h })
    .resize(upW, upH, { kernel: 'nearest' })
    .composite([{ input: await sharp(svg).png().toBuffer(), top: 0, left: 0 }])
    .png().toBuffer();
  const file = `benchmark/results/miss-crops/miss-${String(i).padStart(2, '0')}_${truth[i]}.png`;
  fs.writeFileSync(file, png);
  crops.push({ i, file, upW, upH: upH + labelH });
  console.log(file, `${upW}x${upH}`);
}
// 联览图：每 3 张竖排一张 sheet
const per = 3;
for (let s = 0; s * per < crops.length; s++) {
  const group = crops.slice(s * per, s * per + per);
  const W = Math.max(...group.map(c => c.upW)) + 20;
  const H = group.reduce((m, c) => m + c.upH + 16, 16);
  let top = 16;
  const comps = [];
  for (const c of group) {
    comps.push({ input: c.file, top, left: 10 });
    top += c.upH + 16;
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: { r: 60, g: 60, b: 60 } } })
    .composite(comps).jpeg({ quality: 92 }).toFile(`benchmark/results/miss-crops/sheet-${s + 1}.jpg`);
  console.log('sheet', s + 1, group.map(c => '#' + c.i).join(' '));
}
await vite.close();
