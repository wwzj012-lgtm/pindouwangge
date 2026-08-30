import type { AssemblyPartPlan, AssemblyPlannedPart } from './assemblyPartPlanner';

export interface AssemblyExportPaletteColor {
  id: string;
  hex: string;
  code?: string;
  name?: string;
}

export interface AssemblyExportOptions {
  title: string;
  brandName: string;
  cells: (string | null)[][];
  palette: AssemblyExportPaletteColor[];
  showColorCodes?: boolean;
}

/** A source orthographic view. This deliberately contains no assembly-plan data. */
export interface AssemblyOrthographicView {
  id: string;
  label: string;
  cells: (string | null)[][];
}

export interface AssemblyOrthographicViewsExportOptions {
  title: string;
  brandName: string;
  views: AssemblyOrthographicView[];
  palette: AssemblyExportPaletteColor[];
  showColorCodes?: boolean;
}

export interface AssemblyExportColorStat {
  id: string;
  label: string;
  hex: string;
  count: number;
}

export interface AssemblyPlanExportOptions {
  title: string;
  brandName: string;
  plan: AssemblyPartPlan;
  palette: AssemblyExportPaletteColor[];
}

export interface AssemblyPlanPngExportResult {
  blob: Blob;
  scale: number;
  warning: string | null;
}

export function escapeAssemblyXml(value: string): string {
  return value.replace(/[<>&'\"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] ?? character);
}

export function getAssemblyExportStats(cells: (string | null)[][], palette: AssemblyExportPaletteColor[]): AssemblyExportColorStat[] {
  const paletteById = new Map(palette.map(color => [color.id, color]));
  const counts = new Map<string, number>();
  for (const row of cells) for (const cell of row) if (cell) counts.set(cell, (counts.get(cell) ?? 0) + 1);
  return [...counts.entries()].sort((first, second) => second[1] - first[1]).map(([id, count]) => {
    const color = paletteById.get(id);
    return { id, count, hex: color?.hex ?? '#CBD5E1', label: color?.code ?? color?.name ?? id };
  });
}

type BlueprintPage = { width: number; height: number; inner: string };

function createAssemblyBlueprintPage(options: AssemblyExportOptions): BlueprintPage {
  const width = options.cells[0]?.length ?? 0;
  const height = options.cells.length;
  const cellSize = 32;
  const left = 52;
  const top = 72;
  const gridWidth = Math.max(1, width) * cellSize;
  const gridHeight = Math.max(1, height) * cellSize;
  const stats = getAssemblyExportStats(options.cells, options.palette);
  const legendTop = top + gridHeight + 56;
  const canvasWidth = Math.max(640, left + gridWidth + 52);
  const canvasHeight = legendTop + Math.max(90, Math.ceil(Math.max(1, stats.length) / 2) * 34) + 38;
  const paletteById = new Map(options.palette.map(color => [color.id, color]));
  const grid = options.cells.flatMap((row, y) => row.map((id, x) => {
    const color = id ? paletteById.get(id) : undefined;
    const fill = color?.hex ?? (id ?? '#FFFFFF');
    const code = options.showColorCodes && id ? escapeAssemblyXml(color?.code ?? id) : '';
    const text = code ? `<text x="${left + x * cellSize + cellSize / 2}" y="${top + y * cellSize + 20}" text-anchor="middle" font-family="Arial, sans-serif" font-size="8" fill="#1F1638">${code}</text>` : '';
    return `<rect x="${left + x * cellSize}" y="${top + y * cellSize}" width="${cellSize}" height="${cellSize}" fill="${escapeAssemblyXml(fill)}" stroke="#C4B5FD"/>${text}`;
  })).join('');
  const columns = Array.from({ length: width }, (_, x) => `<text x="${left + x * cellSize + cellSize / 2}" y="${top - 12}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#6D28D9">${x + 1}</text>`).join('');
  const rows = Array.from({ length: height }, (_, y) => `<text x="${left - 12}" y="${top + y * cellSize + 21}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#6D28D9">${y + 1}</text>`).join('');
  const legend = stats.length ? stats.map((stat, index) => {
    const column = index % 2; const row = Math.floor(index / 2); const x = left + column * Math.max(240, Math.floor(gridWidth / 2)); const y = legendTop + row * 34;
    return `<rect x="${x}" y="${y}" width="18" height="18" rx="3" fill="${escapeAssemblyXml(stat.hex)}" stroke="#A78BFA"/><text x="${x + 26}" y="${y + 13}" font-family="Arial, sans-serif" font-size="12" fill="#2E1065">${escapeAssemblyXml(stat.label)} · ${stat.count} 颗</text>`;
  }).join('') : `<text x="${left}" y="${legendTop + 14}" font-family="Arial, sans-serif" font-size="12" fill="#6B7280">空白网格 · 总计 0 颗</text>`;
  const total = stats.reduce((sum, stat) => sum + stat.count, 0);
  return {
    width: canvasWidth,
    height: canvasHeight,
    inner: `<rect width="100%" height="100%" fill="#FFFFFF"/><text x="${left}" y="30" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#2E1065">${escapeAssemblyXml(options.title)}</text><text x="${left}" y="50" font-family="Arial, sans-serif" font-size="11" fill="#7C3AED">${escapeAssemblyXml(options.brandName)} · ${width} × ${height} · 总计 ${total} 颗</text>${columns}${rows}<g>${grid}</g><text x="${left}" y="${legendTop - 18}" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#2E1065">颜色图例与数量</text>${legend}`,
  };
}

function createBlueprintSvgDocument(page: BlueprintPage): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}">${page.inner}</svg>`;
}

export function createAssemblyBlueprintSvg(options: AssemblyExportOptions): string {
  return createBlueprintSvgDocument(createAssemblyBlueprintPage(options));
}

function createOrthographicPages(options: AssemblyOrthographicViewsExportOptions): BlueprintPage[] {
  const views = options.views.filter(view => view.cells.length > 0 && view.cells[0]?.length > 0);
  if (views.length === 0) throw new Error('请先生成至少一张正交图纸');
  return views.map(view => createAssemblyBlueprintPage({
    title: `${options.title} · ${view.label}`,
    brandName: options.brandName,
    cells: view.cells,
    palette: options.palette,
    showColorCodes: options.showColorCodes,
  }));
}

/** Vertically paginated SVG for uploaded front/side/back/top source-view drawings only. */
export function createAssemblyOrthographicViewsSvg(options: AssemblyOrthographicViewsExportOptions): string {
  const pages = createOrthographicPages(options);
  const gap = 32;
  const width = Math.max(...pages.map(page => page.width));
  const height = pages.reduce((total, page) => total + page.height, gap * (pages.length - 1));
  let offsetY = 0;
  const content = pages.map(page => {
    const current = `<g transform="translate(0 ${offsetY})">${page.inner}</g>`;
    offsetY += page.height + gap;
    return current;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
}

export function createAssemblyOrthographicViewsPrintHtml(options: AssemblyOrthographicViewsExportOptions): string {
  const pages = createOrthographicPages(options);
  return `<!doctype html><html><head><title>${escapeAssemblyXml(options.title)}</title><style>body{margin:0;background:#f3f4f6;font-family:Arial,sans-serif}.assembly-orthographic-page{width:210mm;min-height:297mm;margin:0 auto 8mm;background:#fff;break-after:page;page-break-after:always}.assembly-orthographic-page:last-child{break-after:auto;page-break-after:auto}.assembly-orthographic-page svg{display:block;width:100%;height:auto}@page{size:A4 portrait;margin:8mm}@media print{body{background:#fff}.assembly-orthographic-page{margin:0;width:100%;min-height:0}}</style></head><body>${pages.map((page, index) => `<section class="assembly-orthographic-page" data-page="${index + 1}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${page.width} ${page.height}">${page.inner}</svg></section>`).join('')}<script>window.onload=()=>window.print()</script></body></html>`;
}

export function openAssemblyOrthographicViewsPrintView(options: AssemblyOrthographicViewsExportOptions): void {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) throw new Error('打印窗口被浏览器拦截，请允许弹窗后重试');
  printWindow.document.write(createAssemblyOrthographicViewsPrintHtml(options));
  printWindow.document.close();
}

export function downloadAssemblyBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.style.display = 'none';
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function createAssemblyPngBlob(svg: string, scale = 2): Promise<Blob> {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const next = new Image(); next.onload = () => resolve(next); next.onerror = () => reject(new Error('PNG 导出失败')); next.src = url; });
    const canvas = document.createElement('canvas'); canvas.width = image.width * scale; canvas.height = image.height * scale;
    const context = canvas.getContext('2d'); if (!context) throw new Error('PNG 导出不可用');
    context.fillStyle = '#FFFFFF'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('PNG 导出失败');
    return png;
  } finally { URL.revokeObjectURL(url); }
}

export function openAssemblyPrintView(svg: string, title: string): void {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) throw new Error('打印窗口被浏览器拦截，请允许弹窗后重试');
  printWindow.document.write(`<!doctype html><html><head><title>${escapeAssemblyXml(title)}</title><style>body{margin:24px;background:#fff}svg{width:100%;height:auto}@page{size:auto;margin:12mm}</style></head><body>${svg}<script>window.onload=()=>window.print()</script></body></html>`);
  printWindow.document.close();
}

const PLAN_PAGE_WIDTH = 1120;
const PLAN_PAGE_HEIGHT = 1040;
const MAX_PLAN_PARTS = 32;
const MAX_PLAN_CONNECTIONS = 256;
const MAX_PART_EDGE = 96;
const MAX_PART_CELLS = 8192;
const MAX_PLAN_CANVAS_PIXELS = 28_000_000;
const MAX_PLAN_CANVAS_EDGE = 16_384;

type PlanPage = { title: string; inner: string };
type SummaryRow = { title: string; detail: string; color?: string };

function planColor(colorId: string | null, paletteById: Map<string, AssemblyExportPaletteColor>): { fill: string; label: string } {
  if (!colorId) return { fill: '#EDE9FE', label: '未观察色' };
  const paletteColor = paletteById.get(colorId);
  if (paletteColor) return { fill: paletteColor.hex, label: paletteColor.code ?? paletteColor.name ?? paletteColor.id };
  if (/^#[0-9a-f]{3,8}$/i.test(colorId)) return { fill: colorId, label: colorId };
  return { fill: '#C4B5FD', label: colorId };
}

function assertPlanExportable(plan: AssemblyPartPlan): void {
  if (!plan.confidence.manufacturable) throw new Error(plan.confidence.reason ?? '当前组合方案不可制作，无法导出');
  if (!Array.isArray(plan.parts) || plan.parts.length === 0 || plan.parts.length > MAX_PLAN_PARTS) throw new Error('组合零件数量无效或超过导出上限');
  if (!Array.isArray(plan.connections) || plan.connections.length > MAX_PLAN_CONNECTIONS) throw new Error('组合连接数量超过导出上限');
  for (const part of plan.parts) {
    if (!part.id.trim() || !part.number.trim() || !part.name.trim() || part.width < 1 || part.height < 1 || part.width > MAX_PART_EDGE || part.height > MAX_PART_EDGE || part.width * part.height > MAX_PART_CELLS || part.grid.length !== part.height || part.grid.some(row => row.length !== part.width)) throw new Error('组合零件数据无效，无法导出');
  }
}

function partPageInner(options: AssemblyPlanExportOptions, part: AssemblyPlannedPart, index: number, total: number): string {
  const paletteById = new Map(options.palette.map(color => [color.id, color]));
  const gridLeft = 58;
  const gridTop = 122;
  const maxGridWidth = 690;
  const maxGridHeight = 720;
  const cellSize = Math.max(8, Math.min(24, Math.floor(Math.min(maxGridWidth / part.width, maxGridHeight / part.height))));
  const gridWidth = part.width * cellSize;
  const gridHeight = part.height * cellSize;
  const sideLeft = gridLeft + gridWidth + 34;
  const cells = part.grid.flatMap((row, v) => row.map((cell, u) => {
    const x = gridLeft + u * cellSize;
    const y = gridTop + v * cellSize;
    const visual = planColor(cell.color, paletteById);
    const fill = cell.isSlot ? '#FBBF24' : cell.occupied ? visual.fill : '#FFFFFF';
    const code = cell.occupied && cellSize >= 15 ? `<text x="${x + cellSize / 2}" y="${y + cellSize * 0.63}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.max(5, Math.floor(cellSize * 0.31))}" fill="#1F1638">${escapeAssemblyXml(visual.label)}</text>` : '';
    const slotMark = cell.isSlot ? `<path d="M${x + 2} ${y + 2} L${x + cellSize - 2} ${y + cellSize - 2} M${x + cellSize - 2} ${y + 2} L${x + 2} ${y + cellSize - 2}" stroke="#92400E" stroke-width="${Math.max(1, Math.floor(cellSize / 9))}"/>` : '';
    return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${escapeAssemblyXml(fill)}" stroke="${cell.isSlot ? '#B45309' : '#C4B5FD'}"/>${slotMark}${code}`;
  })).join('');
  const columns = Array.from({ length: part.width }, (_, u) => `<text x="${gridLeft + u * cellSize + cellSize / 2}" y="${gridTop - 10}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" fill="#6D28D9">${u + 1}</text>`).join('');
  const rows = Array.from({ length: part.height }, (_, v) => `<text x="${gridLeft - 13}" y="${gridTop + v * cellSize + cellSize * 0.64}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" fill="#6D28D9">${v + 1}</text>`).join('');
  const slotRows = part.slots.length ? part.slots.slice(0, 18).map((slot, slotIndex) => `<text x="${sideLeft}" y="${214 + slotIndex * 24}" font-family="Arial, sans-serif" font-size="11" fill="#92400E">槽 ${slotIndex + 1} · ${escapeAssemblyXml(slot.side === 'top' ? '从顶边插入' : '从底边插入')} · 配对 ${escapeAssemblyXml(slot.partnerPartId)}</text>`).join('') : `<text x="${sideLeft}" y="214" font-family="Arial, sans-serif" font-size="11" fill="#6B7280">该零件没有自动卡槽</text>`;
  const moreSlots = part.slots.length > 18 ? `<text x="${sideLeft}" y="${214 + 18 * 24}" font-family="Arial, sans-serif" font-size="10" fill="#92400E">其余 ${part.slots.length - 18} 个槽位见组合连接清单</text>` : '';
  return `<rect width="${PLAN_PAGE_WIDTH}" height="${PLAN_PAGE_HEIGHT}" fill="#FFFFFF"/><text x="58" y="48" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#2E1065">${escapeAssemblyXml(options.title)} · ${escapeAssemblyXml(part.number)}</text><text x="58" y="72" font-family="Arial, sans-serif" font-size="12" fill="#7C3AED">${escapeAssemblyXml(options.brandName)} · ${escapeAssemblyXml(part.name)} · ${part.orientation.toUpperCase()} · 切片 ${part.sliceIndex + 1} · ${part.width} × ${part.height} · ${part.beanCount} 颗</text><text x="${PLAN_PAGE_WIDTH - 58}" y="48" text-anchor="end" font-family="Arial, sans-serif" font-size="11" fill="#6B7280">零件页 ${index + 1}/${total}</text><text x="58" y="102" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#2E1065">网格坐标与色号</text>${columns}${rows}${cells}<rect x="${sideLeft - 14}" y="122" width="${Math.max(220, PLAN_PAGE_WIDTH - sideLeft - 44)}" height="${Math.max(260, gridHeight)}" rx="10" fill="#FFFBEB" stroke="#FCD34D"/><text x="${sideLeft}" y="150" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#92400E">卡槽与配对关系</text><text x="${sideLeft}" y="176" font-family="Arial, sans-serif" font-size="11" fill="#78350F">黄色 X 缺口 = 自动开槽；请按标示方向交叉插入。</text>${slotRows}${moreSlots}<text x="58" y="${Math.min(PLAN_PAGE_HEIGHT - 44, gridTop + gridHeight + 34)}" font-family="Arial, sans-serif" font-size="10" fill="#6B7280">边界框：U${part.bbox.minU + 1}–${part.bbox.maxU + 1}，V${part.bbox.minV + 1}–${part.bbox.maxV + 1}。空白格不放豆；黄色缺口不放豆。</text>`;
}

function planSummaryRows(options: AssemblyPlanExportOptions): SummaryRow[] {
  const paletteById = new Map(options.palette.map(color => [color.id, color]));
  const rows: SummaryRow[] = [
    { title: '方案总览', detail: `${options.plan.parts.length} 个零件 · ${options.plan.connections.length} 个连接 · 总计 ${options.plan.totalBeans} 颗 · 置信度 ${Math.round(options.plan.confidence.score * 100)}%` },
    { title: '颜色统计', detail: '颜色/色号与用量' },
    ...options.plan.colorStats.map(stat => { const visual = planColor(stat.color, paletteById); return { title: visual.label, detail: `${stat.count} 颗`, color: visual.fill }; }),
    { title: '连接清单', detail: '所有卡槽连接与插入位置' },
    ...options.plan.connections.map(connection => {
      const xy = options.plan.parts.find(part => part.id === connection.xyPartId)?.number ?? connection.xyPartId;
      const zy = options.plan.parts.find(part => part.id === connection.zyPartId)?.number ?? connection.zyPartId;
      return { title: `${xy} ↔ ${zy}`, detail: `Y${connection.yStart + 1}–${connection.yEnd + 1} · 顶/底交叉插入 · 槽宽 ${connection.slotWidth}` };
    }),
    { title: '组装步骤', detail: '按序完成' },
    ...options.plan.assemblySteps.map(step => ({ title: `${step.number}. ${step.title}`, detail: step.description })),
    ...(options.plan.warnings.length ? [{ title: '注意事项', detail: '生成器提示' }, ...options.plan.warnings.map(warning => ({ title: '提示', detail: warning }))] : []),
  ];
  return rows;
}

function summaryPageInner(options: AssemblyPlanExportOptions, rows: SummaryRow[], index: number, total: number): string {
  const items = rows.map((row, rowIndex) => {
    const y = 132 + rowIndex * 27;
    const swatch = row.color ? `<rect x="58" y="${y - 12}" width="14" height="14" rx="3" fill="${escapeAssemblyXml(row.color)}" stroke="#A78BFA"/>` : '';
    const x = row.color ? 80 : 58;
    const isSection = ['颜色统计', '连接清单', '组装步骤', '注意事项'].includes(row.title);
    return `${swatch}<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${isSection ? 14 : 11}" font-weight="${isSection ? '700' : '400'}" fill="${isSection ? '#2E1065' : '#3B2A61'}">${escapeAssemblyXml(row.title)}</text><text x="${Math.max(250, x + 180)}" y="${y}" font-family="Arial, sans-serif" font-size="10" fill="#6B7280">${escapeAssemblyXml(row.detail)}</text>`;
  }).join('');
  return `<rect width="${PLAN_PAGE_WIDTH}" height="${PLAN_PAGE_HEIGHT}" fill="#FFFFFF"/><text x="58" y="48" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#2E1065">${escapeAssemblyXml(options.title)} · 汇总与组装说明</text><text x="58" y="72" font-family="Arial, sans-serif" font-size="12" fill="#7C3AED">${escapeAssemblyXml(options.brandName)} · 仅在“可制作组合方案”状态下导出</text><text x="${PLAN_PAGE_WIDTH - 58}" y="48" text-anchor="end" font-family="Arial, sans-serif" font-size="11" fill="#6B7280">说明页 ${index + 1}/${total}</text>${items}`;
}

function buildPlanPages(options: AssemblyPlanExportOptions): PlanPage[] {
  assertPlanExportable(options.plan);
  const partPages = options.plan.parts.map((part, index) => ({ title: part.number, inner: partPageInner(options, part, index, options.plan.parts.length) }));
  const rows = planSummaryRows(options);
  const summaryPages: PlanPage[] = [];
  const perPage = 30;
  const totalSummaryPages = Math.max(1, Math.ceil(rows.length / perPage));
  for (let index = 0; index < totalSummaryPages; index += 1) summaryPages.push({ title: `说明 ${index + 1}`, inner: summaryPageInner(options, rows.slice(index * perPage, (index + 1) * perPage), index, totalSummaryPages) });
  return [...partPages, ...summaryPages];
}

/** A vertically paginated SVG; each white region is a print-sized plan page. */
export function createAssemblyPlanSvg(options: AssemblyPlanExportOptions): string {
  const pages = buildPlanPages(options);
  const totalHeight = pages.length * PLAN_PAGE_HEIGHT;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PLAN_PAGE_WIDTH}" height="${totalHeight}" viewBox="0 0 ${PLAN_PAGE_WIDTH} ${totalHeight}">${pages.map((page, index) => `<g id="assembly-plan-page-${index + 1}" transform="translate(0 ${index * PLAN_PAGE_HEIGHT})">${page.inner}</g>`).join('')}</svg>`;
}

async function svgToPngBlob(svg: string, requestedScale: number, safe: boolean): Promise<AssemblyPlanPngExportResult> {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const next = new Image(); next.onload = () => resolve(next); next.onerror = () => reject(new Error('PNG 导出失败')); next.src = url; });
    const requested = Math.max(0.25, requestedScale);
    const maxByPixels = Math.sqrt(MAX_PLAN_CANVAS_PIXELS / Math.max(1, image.width * image.height));
    const maxByEdge = MAX_PLAN_CANVAS_EDGE / Math.max(image.width, image.height);
    const scale = safe ? Math.min(requested, maxByPixels, maxByEdge) : requested;
    if (!Number.isFinite(scale) || scale < 0.1) throw new Error('组合方案过大，无法安全生成 PNG；请减少零件数量或改用 SVG / PDF。');
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.floor(image.width * scale)); canvas.height = Math.max(1, Math.floor(image.height * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('PNG 导出不可用');
    context.fillStyle = '#FFFFFF'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG 导出失败');
    const warning = scale < requested ? `为避免浏览器内存不足，PNG 已从 ${requested.toFixed(1)}× 自动缩放到 ${scale.toFixed(2)}×。` : null;
    return { blob, scale, warning };
  } finally { URL.revokeObjectURL(url); }
}

export async function createAssemblyPlanPngBlob(options: AssemblyPlanExportOptions, scale = 2): Promise<AssemblyPlanPngExportResult> {
  return svgToPngBlob(createAssemblyPlanSvg(options), scale, true);
}

export function createAssemblyPlanPrintHtml(options: AssemblyPlanExportOptions): string {
  const pages = buildPlanPages(options);
  return `<!doctype html><html><head><title>${escapeAssemblyXml(options.title)}</title><style>body{margin:0;background:#f3f4f6;font-family:Arial,sans-serif}.assembly-plan-page{width:210mm;min-height:297mm;margin:0 auto 8mm;background:#fff;break-after:page;page-break-after:always}.assembly-plan-page:last-child{break-after:auto;page-break-after:auto}.assembly-plan-page svg{display:block;width:100%;height:auto}@page{size:A4 portrait;margin:8mm}@media print{body{background:#fff}.assembly-plan-page{margin:0;width:100%;min-height:0}}</style></head><body>${pages.map((page, index) => `<section class="assembly-plan-page" data-page="${index + 1}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PLAN_PAGE_WIDTH} ${PLAN_PAGE_HEIGHT}">${page.inner}</svg></section>`).join('')}<script>window.onload=()=>window.print()</script></body></html>`;
}

export function openAssemblyPlanPrintView(options: AssemblyPlanExportOptions): void {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) throw new Error('打印窗口被浏览器拦截，请允许弹窗后重试');
  printWindow.document.write(createAssemblyPlanPrintHtml(options));
  printWindow.document.close();
}
