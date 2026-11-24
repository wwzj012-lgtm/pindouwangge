// 重新导出漏槽切片 v4：直接用 bands[].tokenXs（每个 token = 一个完整条目
// 「票+码+数量」），窗口=token 边界，结构上不可能包含邻居内容。
// anchor（codeSpan/countSpan）定位 token；跨 band 同 x 区段用「墨水测试」消歧
// （真 band 内有字形墨水）。用法：node scripts/gen-miss-crops2.mjs
process.chdir('D:/Build_Apps/pindouwangge');
const { createServer } = await import('vite');
const sharp = (await import('sharp')).default;
const fs = (await import('fs')).default;
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const IL = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const { data, info } = await sharp('benchmark/images/card1.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const native = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const r = IL.parseColorCard(native, BRAND_PALETTES.MARD);
const dbg = IL.debugColorCardParse(native, BRAND_PALETTES.MARD);
const truth = ['H2','G9','H16','A18','F18','G20','G6','E16','F13','G1','A14','F6','F23','G2','A9','G5','G13','H7','F16','A12','G3','F11','F10','G8','G18','E11','F17','H6','F12','G19','E14','F1','E15','H17','G16','E20','M13','H5','M14','A19','A7','D19','C12','F19','H4','H9','H22','C20','C28','D1','D11','D17','G4','C29','E1','E8','F22','H8','H10','H11','H19','M10'];
const truthCounts = [1770,469,429,411,387,271,255,243,197,194,177,141,132,127,126,119,97,54,45,44,39,38,31,24,23,22,22,22,21,14,13,13,12,12,11,9,8,7,6,5,4,4,3,3,3,3,3,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1];
const misses = [];
const cntSuspects = [];
r.entries.forEach((e, i) => {
  if (e.code !== truth[i]) misses.push(i);
  else if (e.count !== truthCounts[i]) cntSuspects.push(i); // 数量存疑（码对量错）
});
const exportSlots = [...new Set([...misses, ...cntSuspects])];

const UP = 4;
const w4 = native.width * UP, h4 = native.height * UP;
const buf4 = new Uint8ClampedArray(w4 * h4 * 4);
await sharp(native.data.buffer, { raw: { width: native.width, height: native.height, channels: 4 } })
  .resize(w4, h4, { kernel: 'nearest' }).raw().toBuffer()
  .then(buf => buf4.set(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length)));

const span = (it, key) => {
  const v = it[key];
  return v && v !== '-' ? v.split('-').map(Number) : null;
};

// 布局铁律（2026-11-23 深夜定案）：4 行每行 19 个 token 顺序填满（19+19+19+5=62），
// band = floor(i/19)，token = i%19。此前 floor(i/16) 的行定位是错的——
// 实验 D 的 #35/#36/#55「真·印刷缺失」结论因此作废（切到了别的行）。
function locate(i, anchor) {
  const band = dbg.bands[Math.floor(i / 19)];
  const token = band.tokenXs[i % 19];
  return { band, token };
}

const out = { misses, boxes: {} };
const SCALE = 8;
const report = [];
fs.mkdirSync('benchmark/results/miss-crops2', { recursive: true });
for (const i of exportSlots) {
  const it = dbg.items[i];
  const cs = span(it, 'codeSpan'), ns = span(it, 'countSpan');
  const anchor = cs || ns;
  if (!anchor) { report.push(`#${i} SKIP 无锚`); continue; }
  const loc = locate(i, anchor);
  if (!loc) { report.push(`#${i} SKIP 无 token`); continue; }
  const wx0 = Math.max(0, loc.token[0] + 1), wx1 = Math.min(w4 - 1, loc.token[1] - 1);
  const wy0 = Math.max(0, loc.band.y0 - 4), wy1 = Math.min(h4 - 1, loc.band.y1 + 4);
  const cw = wx1 - wx0 + 1, ch = wy1 - wy0 + 1;
  await sharp(buf4.buffer, { raw: { width: w4, height: h4, channels: 4 } })
    .extract({ left: wx0, top: wy0, width: cw, height: ch })
    .resize(cw * SCALE, ch * SCALE, { kernel: 'nearest' })
    .jpeg({ quality: 85 })
    .toFile(`benchmark/results/miss-crops2/slot-${String(i).padStart(2, '0')}_${truth[i]}.jpg`);
  out.boxes[i] = { x0: Math.round(wx0 / UP), y0: Math.round(wy0 / UP), x1: Math.round(wx1 / UP), y1: Math.round(wy1 / UP) };
  report.push(`#${i} ${truth[i]} band_y=${loc.band.y0} token=${loc.token[0]}-${loc.token[1]} ink=${loc.ink} 窗=${wx0}-${wx1}`);
}
fs.writeFileSync('benchmark/results/miss-slots-all2.json', JSON.stringify(out, null, 1));
console.log(report.join('\n'));
console.log('written miss-crops2/ + miss-slots-all2.json');
await vite.close();
