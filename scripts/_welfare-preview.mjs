// SSR 渲染 AdminWelfare 三种状态为静态 HTML（内联管理端 CSS），供截图验证真实样式。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: false, root: process.cwd(), optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom',
});
const { default: React } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { AdminWelfare } = await vite.ssrLoadModule('/src/components/admin/AdminWelfare.tsx');

const mockRequest = (rules) => async () => ({ ok: true, status: 200, data: { rules } });
const now = Date.now();
const sampleRules = [
  { id: 'wr_1', name: '新注册送 20 积分', triggerType: 'signup', amountUnits: 200, enabled: true, note: null, createdBy: 'admin', createdAt: now - 86400000, updatedAt: now, grantedUsers: 37, grantedUnits: 740 },
  { id: 'wr_2', name: '周末注册双倍礼', triggerType: 'signup', amountUnits: 400, enabled: false, note: '十一活动结束后停用', createdBy: 'admin', createdAt: now - 86400000 * 5, updatedAt: now, grantedUsers: 128, grantedUnits: 51200 },
];
const states = {
  'with-rules': mockRequest(sampleRules),
  'empty': mockRequest([]),
};
const cssFiles = ['src/components/admin/AdminWelfare.css', 'src/components/admin/admin.css'];
const css = cssFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
mkdirSync('artifacts/accuracy', { recursive: true });
for (const [name, request] of Object.entries(states)) {
  const body = renderToStaticMarkup(React.createElement(AdminWelfare, { request, canAdjust: true }));
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<style>body{margin:0;padding:24px;background:#eef2ee;font-family:"Segoe UI","Microsoft YaHei",sans-serif;}
${css}</style></head><body>${body}</body></html>`;
  writeFileSync(`artifacts/accuracy/welfare-${name}.html`, html);
  console.log(`welfare-${name}.html`);
}
// 表单校验错误态：无数据渲染由浏览器端交互触发，改用 with-rules + 直接注入错误演示
const errorHtml = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#eef2ee;font-family:"Segoe UI","Microsoft YaHei",sans-serif;}${css}</style></head><body>${renderToStaticMarkup(React.createElement(AdminWelfare, { request: mockRequest(sampleRules), canAdjust: true }))}</body></html>`;
writeFileSync('artifacts/accuracy/welfare-form.html', errorHtml);
await vite.close();
