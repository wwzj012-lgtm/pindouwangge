/**
 * 库存/色卡 Excel 导入导出（基于零依赖 xlsx 引擎，见 ./xlsx）。
 * 不引入 exceljs/sheetjs：本机 npm 源长期超时，且 xlsx=ZIP+XML 手写引擎体积更小。
 */

import { buildXlsx, downloadXlsx, parseXlsx, type XlsxCell } from './xlsx';

export interface InventoryExportRow { code: string; name: string; count: number; alertThreshold: number }
export interface InventoryImportRow { code: string; count: number }
export interface PaletteExportColor { code: string; name: string; hex: string }

/** 豆仓导出：一个工作表，色号/名称/数量/提醒线。 */
export async function exportInventoryExcel(brandName: string, rows: InventoryExportRow[]): Promise<void> {
  const data: XlsxCell[][] = [
    ['色号', '名称', '数量', '低库存提醒线'].map(value => ({ value, style: 1 })),
    ...rows.map(row => [
      { value: row.code } as XlsxCell,
      { value: row.name } as XlsxCell,
      { value: row.count } as XlsxCell,
      { value: row.alertThreshold } as XlsxCell,
    ]),
  ];
  downloadXlsx(buildXlsx([{ name: '库存', rows: data, columnWidths: [14, 24, 10, 16] }]), `${brandName}-豆仓库存.xlsx`);
}

/** 色板亮度：>=150 用深色字，否则白字。 */
const luminance = (hex: string) => {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) || 0;
  const g = parseInt(value.slice(2, 4), 16) || 0;
  const b = parseInt(value.slice(4, 6), 16) || 0;
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

/** 管理端色卡导出：按系列字母分列的网格（A1..An 纵向），单元格填色+色号，边框+自适应字色。 */
export async function exportPaletteExcel(brandName: string, colors: PaletteExportColor[]): Promise<void> {
  // 系列分列：按色号前缀字母分组，保持目录顺序首次出现列序。
  const seriesOrder: string[] = [];
  const bySeries = new Map<string, Array<{ code: string; hex: string }>>();
  for (const color of colors) {
    const series = color.code.match(/^[A-Za-z]+/)?.[0].toUpperCase() ?? '#';
    if (!bySeries.has(series)) { bySeries.set(series, []); seriesOrder.push(series); }
    bySeries.get(series)!.push({ code: color.code, hex: color.hex });
  }
  const maxLen = Math.max(...[...bySeries.values()].map(list => list.length), 1);
  const fills: string[] = [];
  const fillIndexByHex = new Map<string, number>();
  const styleOf = (hex: string): number => {
    const key = hex.replace('#', '').toUpperCase().padStart(6, '0');
    let fillIndex = fillIndexByHex.get(key);
    if (fillIndex === undefined) {
      fillIndex = fills.push(key) + 1; // styles.xml 里 fills[0]=none, fills[1]=gray125，自定义从 2 起
      fillIndexByHex.set(key, fillIndex);
    }
    // 每个填充有两个 xf：深字 / 白字（构建顺序：深字 xf 在前）
    const base = 2 + (fillIndex - 2) * 2;
    return luminance(hex) >= 150 ? base : base + 1;
  };
  const rows: XlsxCell[][] = [
    seriesOrder.map(series => ({ value: `${series}系列`, style: 1 }) as XlsxCell),
  ];
  for (let rowIndex = 0; rowIndex < maxLen; rowIndex += 1) {
    rows.push(seriesOrder.map(series => {
      const item = bySeries.get(series)![rowIndex];
      if (!item) return null;
      return { value: item.code, style: styleOf(item.hex) };
    }));
  }
  downloadXlsx(
    buildXlsx([{ name: '色卡', rows, columnWidths: seriesOrder.map(() => 10) }], fills),
    `${brandName}-色卡.xlsx`,
  );
}

/** 豆仓导入：解析 [色号, 数量]（表头行自动跳过；「色号」列后第一个数字列视作数量）。 */
export async function parseInventoryExcel(file: File): Promise<InventoryImportRow[]> {
  const grid = await parseXlsx(new Uint8Array(await file.arrayBuffer()));
  const rows: InventoryImportRow[] = [];
  grid.forEach((cells, rowIndex) => {
    const values = cells.map(cell => String(cell ?? '').trim());
    if (!values.some(value => value)) return;
    if (rowIndex === 0 && values.some(value => value === '色号' || value === '名称')) return; // 表头
    let code = '';
    let count = NaN;
    for (const value of values) {
      if (!value) continue;
      if (value === '色号' || value === '名称' || value === '低库存提醒线' || value === '数量') continue;
      if (!code) { code = value.toUpperCase(); continue; }
      if (/^\d+$/.test(value)) { count = Number(value); break; }
    }
    if (code && Number.isFinite(count)) rows.push({ code, count });
  });
  if (!rows.length) throw new Error('没有解析到「色号 + 数量」数据；请使用导出的表格格式修改数量后导入');
  return rows;
}
