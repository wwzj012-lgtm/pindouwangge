// 侦察妲己图纸：尺寸、网格周期、色板覆盖率
import sharp from 'sharp';
import { createServer } from 'vite';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const meta = await sharp('C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg').metadata();
console.log(`图: ${meta.width}x${meta.height} ${meta.format}`);
// MARD 色号集合：前缀分布
const ids = BRAND_PALETTES.MARD.map(c => c.id.replace('MARD_', ''));
const byLetter = {};
for (const id of ids) { const L = id[0]; (byLetter[L] ??= []).push(id); }
console.log('MARD 色号前缀:', Object.entries(byLetter).map(([L, arr]) => `${L}(${arr.length})`).join(' '));
// 图中肉眼看到的色号抽查
const seen = ['F24','F22','F21','F23','F9','D9','D8','D1','D6','D2','H2','H4','H3','H5','H7','H19','E10','E17','E18','E8','E9','E6','E7','M13','M19','M12','M17','M18','M1','C27','C24','C21','C22','C13','C18','C2','B22','G16','G18','G9','G10','A7','J7','K4','I8','H6'];
const set = new Set(ids);
const missing = seen.filter(s => !set.has(s));
console.log(`抽查 ${seen.length} 个色号, 缺失: ${missing.length ? missing.join(' ') : '无——全部在 MARD 色板内'}`);
await vite.close();
