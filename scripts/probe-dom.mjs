// 对比两份 decomp 网格在指定格的选豆差异
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
const [aPath, bPath] = process.argv.slice(2);
const cells = process.env.CELLS ? JSON.parse(process.env.CELLS) : [[50,45],[52,45],[54,45],[51,46],[53,46],[46,16],[52,50],[53,50]];
const a = JSON.parse(await readFile(aPath, 'utf8'));
const b = JSON.parse(await readFile(bPath, 'utf8'));
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true } });
const { MARD_PALETTE } = await vite.ssrLoadModule('/src/data/palettes.ts');
const byId = new Map(MARD_PALETTE.map((c) => [c.id, c.rgb]));
for (const [gx, gy] of cells) {
  const ia = a.grid[gy][gx], ib = b.grid[gy][gx];
  if (ia === ib) { console.log(`(${gx},${gy}) 同: ${ia}`); continue; }
  console.log(`(${gx},${gy}) ${ia} rgb(${byId.get(ia)}) -> ${ib} rgb(${byId.get(ib)})`);
}
await vite.close();
