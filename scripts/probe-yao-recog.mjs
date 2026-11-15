// 对照实验：金黄糊的根源 = 错网格采样 or 图例色板白名单毒化？
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({
  root: process.cwd(), appType: 'custom',
  server: { middlewareMode: true }, logLevel: 'error',
  optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts',
});
const { parseLegend } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { recognizeImportImageAsync } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const { data, info } = await sharp('benchmark/images/yao-waterbox.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const palette = BRAND_PALETTES.MARD;

// 1) 解析图例 → 模拟向导的 legendOptions（enabled 行的 code 白名单）
const truthCal = { originX: 276, originY: 116, cellWidth: 8.79, cellHeight: 8.79, columns: 132, rows: 150 };
const parsed = parseLegend(source, truthCal, palette, { gridRows: 150, gridCols: 132 });
const rows = parsed.ok ? parsed.entries.map(e => ({
  code: e.code,
  count: e.count,
  countLocked: false,
  enabled: palette.some(c => c.code === e.code),
})) : [];
console.log('parse ok:', parsed.ok, 'rows:', rows.length, 'enabled:', rows.filter(r => r.enabled).length);
console.log('codes:', rows.map(r => r.code + (r.enabled ? '' : '(不在色板)')).join(' '));
const enabled = rows.filter(r => r.enabled && r.code);
const legendOptions = enabled.length ? { paletteLock: [...new Set(enabled.map(r => r.code))] } : {};
console.log('legendOptions:', JSON.stringify(legendOptions));

// 2) 三种标定 × 有无锁定，跑识别统计颜色数
const variants = [
  { name: 'A 真值标定+无锁定', cal: truthCal, options: {} },
  { name: 'B 用户标定(270,110/8.933)+无锁定', cal: { originX: 270, originY: 110, cellWidth: 8.933, cellHeight: 8.933, columns: 100, rows: 131 }, options: {} },
  { name: 'C 用户标定+图例锁定', cal: { originX: 270, originY: 110, cellWidth: 8.933, cellHeight: 8.933, columns: 100, rows: 131 }, options: legendOptions },
  { name: 'D 真值标定+图例锁定', cal: truthCal, options: legendOptions },
];
for (const v of variants) {
  const result = await recognizeImportImageAsync(source, v.cal, palette, 'precision', undefined, { batchSize: 256, ...v.options });
  const colors = new Map();
  for (const row of result.cells) {
    for (const cell of row) {
      const code = cell.status === 'mapped' ? cell.color?.code ?? '?' : cell.status === 'blank' ? 'BLANK' : 'INVALID';
      colors.set(code, (colors.get(code) ?? 0) + 1);
    }
  }
  const top = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`\n== ${v.name}: distinct=${colors.size} mapped=${result.summary.mapped} lowConf=${result.summary.lowConfidence}`);
  console.log('   top:', top.map(([c, n]) => `${c}:${n}`).join(' '));
}
await vite.close();
