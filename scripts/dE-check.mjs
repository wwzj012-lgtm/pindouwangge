import { createServer } from 'vite';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { deltaE2000, preparePaletteLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const pal = preparePaletteLab(BRAND_PALETTES.MARD);
const byId = new Map(pal.map(p => [p.color.id.replace('MARD_',''), p]));
for (const [a, b] of [['H4','H5'],['M3','H5'],['C18','H5'],['E23','H5'],['C18','C12'],['H4','H20'],['H4','M3'],['H5','H6'],['H5','H7'],['H4','H9']]) {
  const A = byId.get(a), B = byId.get(b);
  console.log(`${a}(${A.color.hex}) ↔ ${b}(${B.color.hex}): ΔE=${deltaE2000(A.lab, B.lab).toFixed(2)}`);
}
await vite.close();
