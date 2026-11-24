/** Excel 导入导出端到端验证：浏览器里走生产代码路径（导出→捕获 blob→回读解析）。 */
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const vite = await createServer({ root: process.cwd(), server: { port: 46211, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto('http://localhost:46211', { waitUntil: 'load' });

const result = await page.evaluate(async () => {
  const { exportInventoryExcel, exportPaletteExcel, parseInventoryExcel } = await import('/src/utils/excelExport.ts');
  const { parseXlsx } = await import('/src/utils/xlsx.ts');
  const downloads = [];
  const originalCreate = URL.createObjectURL;
  URL.createObjectURL = blob => { downloads.push(blob); return originalCreate.call(URL, blob); };
  const anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { void this.download; }; // 捕获但不真下载

  // 1) 豆仓导出
  await exportInventoryExcel('Mard-291', [
    { code: 'A1', name: '奶白', count: 0, alertThreshold: 100 },
    { code: 'H7', name: '深灰', count: 433, alertThreshold: 100 },
    { code: 'C13', name: '淡蓝', count: 215, alertThreshold: 100 },
  ]);
  // 2) 色卡导出（系列分列 + 填色）
  await exportPaletteExcel('Mard-291', [
    { code: 'A1', name: '奶白', hex: '#FAF4C8' }, { code: 'A2', name: 'A2', hex: '#FFFFD5' },
    { code: 'B1', name: 'B1', hex: '#9BE34A' }, { code: 'H7', name: 'H7', hex: '#050505' },
    { code: 'M14', name: 'M14', hex: '#C77362' },
  ]);
  HTMLAnchorElement.prototype.click = anchorClick;
  URL.createObjectURL = originalCreate;

  const out = {};
  // 库存表回读
  {
    const buffer = new Uint8Array(await downloads[0].arrayBuffer());
    out.inventorySize = buffer.length;
    const grid = (await parseInventoryExcel(new File([buffer], 't.xlsx'))).map(row => `${row.code}=${row.count}`);
    out.inventoryRows = grid;
  }
  // 色卡表回读（值网格：A1/A2 一列、B1 一列、H7/M14 一列）
  {
    const buffer = new Uint8Array(await downloads[1].arrayBuffer());
    out.paletteSize = buffer.length;
    out.paletteGrid = await parseXlsx(buffer);
  }
  return out;
});
console.log('库存表回读:', result.inventoryRows.join(' '), `(${result.inventorySize}B)`);
console.log('色卡网格:', JSON.stringify(result.paletteGrid));
console.log('JS错误:', errors.length ? errors.join('; ') : '无');
await browser.close();
await vite.close();
