import { createServer } from 'vite';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true } });
const { MARD_PALETTE } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { rgbToLab, deltaE2000 } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
for (const target of [[209,154,168], [208,118,132], [255,220,200]]) {
  const ranked = MARD_PALETTE.map((c) => ({ id: c.id, rgb: c.rgb, de: deltaE2000(rgbToLab(...target), rgbToLab(...c.rgb)) }))
    .sort((a, b) => a.de - b.de).slice(0, 6);
  console.log(`目标 rgb(${target}):`);
  for (const r of ranked) console.log(`   ${r.id} rgb(${r.rgb}) ΔE ${r.de.toFixed(2)}`);
}
await vite.close();
