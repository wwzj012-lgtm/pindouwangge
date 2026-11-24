// 逐格评估 consensus 改写对错（妲己真值）
import { createServer } from 'vite';
import { readFileSync } from 'fs';
import sharp from 'sharp';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
const IMG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImageAsync } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { manual } = JSON.parse(readFileSync(`${OUT}/manual_vs_rec.json`, 'utf8'));
const { data, info } = await sharp(IMG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const cal = { originX: 0, originY: 0, cellWidth: 29.6, cellHeight: 29.54, columns: 52, rows: 51 };
const base = await recognizeImportImageAsync(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { batchSize: 256 });
const full = await recognizeImportImageAsync(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { symbolAssist: true, batchSize: 256 });
const pairs = new Map(); // "a->b" -> {good, bad, dEs:[]}
for (let r = 0; r < 51; r++) for (let c = 0; c < 52; c++) {
  const b = base.cells[r]?.[c], f = full.cells[r]?.[c];
  const mc = manual[r]?.[c]?.code;
  if (!b || !f || b.status !== 'mapped' || f.status !== 'mapped') continue;
  if (b.color.code === f.color.code) continue;
  const truth = mc === f.color.code;
  const key = `${b.color.code}->${f.color.code}`;
  const p = pairs.get(key) ?? { good: 0, bad: 0, dEs: [] };
  if (truth) p.good++; else p.bad++;
  p.dEs.push(f.distance ?? 0);
  pairs.set(key, p);
}
console.log('override pair | good/bad | dE range');
for (const [k, p] of [...pairs.entries()].sort((a, b) => (b.good + b.bad) - (a.good + a.bad))) {
  p.dEs.sort((a, b) => a - b);
  console.log(`${k}: ${p.good}✓/${p.bad}✗ dE ${p.dEs[0].toFixed(1)}~${p.dEs[p.dEs.length - 1].toFixed(1)}`);
}
await vite.close(); process.exit(0);
