// 找出手部/衣服区域的位置：渲染整图识别结果+原图对照，并把各处理阶段改写情况可视化
import { createServer } from 'vite';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
const root = process.cwd();
const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp('C:/Users/Plout/Pictures/12.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const CELL = 8.8, OX = -0.375, OY = -0.125;
const cal = { originX: OX * CELL, originY: OY * CELL, cellWidth: CELL, cellHeight: CELL, columns: Math.floor((source.width - OX*CELL)/CELL), rows: Math.floor((source.height - OY*CELL)/CELL) };
const base = { mode: 'precision', beadPhoto: true, autoColorBalance: true, autoAlign: true, unifyTwins: true, smooth: true, edgeInsetRatio: 0.1 };

// 分别跑"只有采样"和"全开"，diff 出每个阶段的影响
const r0 = recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { ...base, smooth: false, unifyTwins: false, shadingReference: false });
const r1 = recognizeImportImage(source, cal, BRAND_PALETTES.MARD, 'precision', undefined, { ...base });
console.log(`采样only: distinct=${r0.summary.distinctColors} lowConf=${r0.summary.lowConfidence} meanConf=${r0.summary.meanConfidence?.toFixed(3)}`);
console.log(`全开:     distinct=${r1.summary.distinctColors} lowConf=${r1.summary.lowConfidence} meanConf=${r1.summary.meanConfidence?.toFixed(3)} smooth=${JSON.stringify(r1.smoothing)} twin=${JSON.stringify(r1.twinUnification)}`);

// 色号使用频次对比（top 15）
const freq = (cells) => { const m = new Map(); for (const row of cells) for (const c of row) if (c.colorId) m.set(c.colorId, (m.get(c.colorId) ?? 0) + 1); return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15); };
console.log('\n采样only top15:', freq(r0.cells).map(([id,n])=>`${id.replace('MARD_','')}:${n}`).join(' '));
console.log('全开    top15:', freq(r1.cells).map(([id,n])=>`${id.replace('MARD_','')}:${n}`).join(' '));

// diff：全开 vs 采样only 中色号变化的格子的"变化方向"统计
let changed = 0; const intoBg = new Map(), outBg = new Map();
const BG = new Set(['MARD_H5','MARD_H6','MARD_H7']);
for (let row = 0; row < cal.rows; row++) for (let col = 0; col < cal.columns; col++) {
  const a = r0.cells[row][col], b = r1.cells[row][col];
  if (a.colorId !== b.colorId) {
    changed++;
    if (BG.has(b.colorId) && !BG.has(a.colorId)) intoBg.set(a.colorId, (intoBg.get(a.colorId) ?? 0) + 1);
    if (!BG.has(b.colorId) && BG.has(a.colorId)) outBg.set(a.colorId, (outBg.get(a.colorId) ?? 0) + 1);
  }
}
console.log(`\n色号变化 ${changed} 格 | 变入背景色:`, [...intoBg.entries()].map(([id,n])=>`${id.replace('MARD_','')}:${n}`).join(' '), '| 变出背景色:', [...outBg.entries()].map(([id,n])=>`${id.replace('MARD_','')}:${n}`).join(' '));
await vite.close();
