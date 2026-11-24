import { createServer } from 'vite';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { preparePaletteLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const pal = preparePaletteLab(BRAND_PALETTES.MARD);
console.log('MARD 蓝灰区色号（b*<-2, 按L*排序）:');
for (const p of pal.filter(p => p.lab[2] < -2).sort((a,b)=>a.lab[0]-b.lab[0])) {
  if (p.lab[0] > 15 && p.lab[0] < 75) console.log(`  ${p.color.id.replace('MARD_','')} ${p.color.hex} L*=${p.lab[0].toFixed(1)} a=${p.lab[1].toFixed(1)} b=${p.lab[2].toFixed(1)}`);
}
await vite.close();
