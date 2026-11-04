import { createServer } from 'vite';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true } });
const { MARD_PALETTE } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { rgbToLab, deltaE2000 } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');

// 在 ΔE2000 上加色度差惩罚: dist = ΔE2000 + w·|ΔC*|
const cases = [
  { name: '发带灰玫瑰', target: [209, 154, 168] },
  { name: '嘴内玫瑰红', target: [208, 118, 132] },
  { name: '肤色', target: [255, 220, 200] },
  { name: '帽深紫', target: [35, 24, 60] },
];
for (const { name, target } of cases) {
  const lab = rgbToLab(...target);
  const C = Math.hypot(lab[1], lab[2]);
  console.log(`\n${name} rgb(${target})  L*${lab[0].toFixed(1)} a*${lab[1].toFixed(1)} b*${lab[2].toFixed(1)}  C*=${C.toFixed(1)}`);
  const ranked = MARD_PALETTE.map((c) => {
    const labc = rgbToLab(...c.rgb);
    const de = deltaE2000(lab, labc);
    const dc = Math.abs(Math.hypot(labc[1], labc[2]) - C);
    return { id: c.id, rgb: c.rgb, de, dc, C: Math.hypot(labc[1], labc[2]) };
  }).sort((a, b) => a.de - b.de).slice(0, 5);
  for (const r of ranked) {
    console.log(`   ${r.id} rgb(${r.rgb}) ΔE${r.de.toFixed(2)} C*=${r.C.toFixed(1)} |ΔC|=${r.dc.toFixed(1)} | +0.3·ΔC=${(r.de + 0.3 * r.dc).toFixed(2)} +0.5·ΔC=${(r.de + 0.5 * r.dc).toFixed(2)}`);
  }
}
await vite.close();
