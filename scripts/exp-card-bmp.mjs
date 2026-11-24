// 打印指定条目的字形位图 ASCII（诊断粘连/碎片）
process.chdir('D:/Build_Apps/pindouwangge');
import { createServer } from 'vite';
import sharp from 'sharp';

const card = process.argv[2] ?? 'card1';
const idx = (process.argv[3] ?? '0,3,9').split(',').map(Number);
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { debugColorCardParse } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { data, info } = await sharp(`benchmark/images/${card}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const dbg = debugColorCardParse(source);
for (const i of idx) {
  console.log('=== item', i, '===');
  for (const g of dbg.glyphDump.filter(x => x.i === i && x.kind === 'code')) {
    console.log('-- code', g.w + 'x' + g.h, g.rgb);
    for (const r of g.rows) console.log('  ' + r.replaceAll('0', '.').replaceAll('1', '#'));
  }
}
await vite.close();
