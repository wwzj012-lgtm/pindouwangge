import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { extractBeadSymbols } = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp('C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const CELL = 29.6;
const cal = { originX: 0, originY: 0, cellWidth: 29.6, cellHeight: 29.54, columns: Math.floor(source.width / CELL), rows: Math.floor(source.height / CELL) };
console.log(`grid: ${cal.columns}x${cal.rows} cell=${CELL}`);
const r = extractBeadSymbols(source, cal, BRAND_PALETTES.MARD);
console.log('模板字符:', r.labelChars, '| 未解析原因:', JSON.stringify(r.unresolvedReasons));
console.log(`文字格 ${r.textCellCount} | 解析成功 ${r.resolvedCount} | 未解析 ${r.unresolvedCount} | 模板字符 ${r.templateLabels} 种`);
// 识别色号分布
const freq = new Map();
for (const [, v] of r.codes) freq.set(v.code, (freq.get(v.code) ?? 0) + 1);
console.log('色号分布:', [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => `${k}:${n}`).join(' '));
// 低分样本
const low = [...r.codes.entries()].filter(([, v]) => v.score < 0.75).slice(0, 10);
console.log('低分样本:', low.map(([k, v]) => `${k}=${v.code}(${v.score.toFixed(2)})`).join(' ') || '无');
await vite.close();
