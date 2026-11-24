// 未解析原因分解：缺模板字符 / 分数低 / 领先差距不足
import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { extractBeadSymbols } = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const { data, info } = await sharp('C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const cal = { originX: 0, originY: 0, cellWidth: 29.6, cellHeight: 29.54, columns: 52, rows: 51 };
const r = extractBeadSymbols(source, cal, BRAND_PALETTES.MARD);
console.log(`文字格 ${r.textCellCount} | 成功 ${r.resolvedCount} | 未解析 ${r.unresolvedCount} | 模板 ${r.templateLabels}`);
// 先验分布 vs 识别分布对照（按格计算先验）
const { deltaE2000, rgbToLab } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');
const prepared = BRAND_PALETTES.MARD.map(c => ({ code: c.code, lab: rgbToLab(...c.rgb) }));
// 简化：用识别结果里每个成功格的 prior 与 code 的一致率
let agree = 0, total = 0;
for (const [, v] of r.codes) { total++; if (v.prior === v.code) agree++; }
console.log(`识别与先验一致: ${agree}/${total} (${(agree/total*100).toFixed(0)}%)`);
await vite.close();
