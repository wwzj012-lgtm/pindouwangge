// 导出漏槽的原生坐标 bbox 供实验 B（Swin2SR 超分）使用。
// 用法：node scripts/tmp-slot-bbox.mjs  → 写 benchmark/results/miss-slots.json
process.chdir('D:/Build_Apps/pindouwangge');
const { createServer } = await import('vite');
const sharp = (await import('sharp')).default;
const fs = (await import('fs')).default;
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const IL = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp('benchmark/images/card1.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const native = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const dbg = IL.debugColorCardParse(native, BRAND_PALETTES.MARD);
const UP = 4;
// 实验后仍 miss 的槽位（实验 C 未命中，含 H8 错槽对照）
const SLOTS = [2, 21, 23, 35, 36, 38, 45, 55, 57, 58, 59];
const spans = dbg.items.map(it => {
  const parts = [];
  for (const sp of [it.codeSpan, it.countSpan]) if (sp && sp !== '-') { const [a, b] = sp.split('-').map(Number); if (b > a) parts.push([a, b]); }
  return parts.length ? [Math.min(...parts.map(p => p[0])), Math.max(...parts.map(p => p[1]))] : null;
});
function slotRange(i) {
  if (spans[i]) return spans[i];
  let lo = i - 1, hi = i + 1;
  while (lo >= 0 && !spans[lo]) lo--;
  while (hi < 62 && !spans[hi]) hi++;
  return [spans[lo][1], spans[hi][0]];
}
const out = {};
for (const i of SLOTS) {
  const band = dbg.bands[Math.min(3, Math.floor(i / 16))];
  let [a, b] = slotRange(i);
  if (b - a < 40) b = a + 40;
  // 4x 坐标 → native，向左扩 60px native 容纳票体
  const nx0 = Math.max(0, Math.floor(a / UP) - 60), nx1 = Math.min(native.width - 1, Math.ceil(b / UP) + 4);
  const ny0 = Math.max(0, Math.floor(band.y0 / UP) - 2), ny1 = Math.min(native.height - 1, Math.ceil(band.y1 / UP) + 2);
  out[i] = { x0: nx0, y0: ny0, x1: nx1, y1: ny1 };
}
fs.writeFileSync('benchmark/results/miss-slots.json', JSON.stringify(out, null, 2));
console.log('written', JSON.stringify(out));
await vite.close();
