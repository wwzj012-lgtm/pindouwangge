// cardRefineCodes 调试：簇投票/重组明细
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';

const card = process.argv[2] ?? 'card1';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { parseColorCard, setCardDebugSink } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp(`benchmark/images/${card}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
setCardDebugSink(msg => console.log(msg));
const r = parseColorCard(source, BRAND_PALETTES.MARD);
setCardDebugSink(null);
console.log(`ok=${r.ok} entries=${r.entries.length}`);
await vite.close();
