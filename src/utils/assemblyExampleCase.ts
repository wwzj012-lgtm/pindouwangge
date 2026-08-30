export type AssemblyExampleCell = string | null;

export interface AssemblyExamplePaletteEntry {
  hex: string;
  code?: string;
  name?: string;
}

export interface AssemblyExampleColorStat {
  colorId: string;
  count: number;
}

export interface AssemblyExamplePart {
  id: string;
  partNumber: string;
  name: string;
  sourceView: AssemblyPartSource;
  width: number;
  height: number;
  cells: AssemblyExampleCell[][];
  colorStats: AssemblyExampleColorStat[];
  quantity: number;
  assemblyTip: string;
}

export type AssemblyPartSource = 'front' | 'side' | 'back' | 'top' | 'demo' | 'template';

export interface AssemblyExampleStep {
  number: number;
  title: string;
  description: string;
  partNumbers: string[];
}

export interface AssemblyExampleCase {
  id: 'fluorescent-green-camera';
  title: string;
  subtitle: string;
  description: string;
  parts: AssemblyExamplePart[];
  steps: AssemblyExampleStep[];
  colorStats: AssemblyExampleColorStat[];
  totalBeads: number;
  totalPartCount: number;
}

type PaletteMap = Map<string, AssemblyExamplePaletteEntry>;
type Colors = { fluorescent: string; darkGreen: string; white: string };

const PREFERRED_COLORS = {
  fluorescent: ['B2', 'B4', 'B13'],
  darkGreen: ['B9', 'B12', 'B15'],
  white: ['H1', 'H2', 'MH1', 'P01'],
} as const;

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

function resolvePaletteColor(paletteMap: PaletteMap, preferredCodes: readonly string[]): string {
  const entries = [...paletteMap.entries()];
  for (const preferred of preferredCodes) {
    const directId = entries.find(([id]) => normalise(id) === normalise(preferred));
    if (directId) return directId[0];
    const match = entries.find(([id, color]) => [id, color.code, color.name].some(value => value && normalise(value) === normalise(preferred)));
    if (match) return match[0];
  }
  return entries[0]?.[0] ?? preferredCodes[0];
}

function setCell(grid: AssemblyExampleCell[][], x: number, y: number, colorId: string): void {
  if (grid[y]?.[x] !== undefined) grid[y][x] = colorId;
}

function fillRect(grid: AssemblyExampleCell[][], left: number, top: number, right: number, bottom: number, colorId: string): void {
  for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) setCell(grid, x, y, colorId);
}

function frame(grid: AssemblyExampleCell[][], left: number, top: number, right: number, bottom: number, colorId: string): void {
  for (let x = left; x <= right; x += 1) { setCell(grid, x, top, colorId); setCell(grid, x, bottom, colorId); }
  for (let y = top; y <= bottom; y += 1) { setCell(grid, left, y, colorId); setCell(grid, right, y, colorId); }
}

function blankGrid(width: number, height: number): AssemblyExampleCell[][] {
  return Array.from({ length: height }, () => Array<AssemblyExampleCell>(width).fill(null));
}

function createBodyFront(colors: Colors): AssemblyExampleCell[][] {
  const grid = blankGrid(18, 14);
  frame(grid, 0, 0, 17, 13, colors.darkGreen);
  fillRect(grid, 1, 1, 16, 12, colors.fluorescent);
  frame(grid, 3, 2, 14, 8, colors.darkGreen);
  fillRect(grid, 4, 3, 13, 7, colors.white);
  frame(grid, 5, 9, 12, 12, colors.darkGreen);
  fillRect(grid, 6, 10, 11, 11, colors.white);
  return grid;
}

function createBodyBack(colors: Colors): AssemblyExampleCell[][] {
  const grid = blankGrid(18, 14);
  frame(grid, 0, 0, 17, 13, colors.darkGreen);
  fillRect(grid, 1, 1, 16, 12, colors.fluorescent);
  frame(grid, 3, 3, 14, 10, colors.darkGreen);
  fillRect(grid, 4, 4, 13, 9, colors.white);
  for (let x = 5; x <= 12; x += 2) setCell(grid, x, 5, colors.darkGreen);
  return grid;
}

function createTop(colors: Colors): AssemblyExampleCell[][] {
  const grid = blankGrid(18, 6);
  frame(grid, 0, 0, 17, 5, colors.darkGreen);
  fillRect(grid, 1, 1, 16, 4, colors.fluorescent);
  frame(grid, 7, 1, 10, 4, colors.darkGreen);
  fillRect(grid, 8, 2, 9, 3, colors.white);
  return grid;
}

function createSide(colors: Colors): AssemblyExampleCell[][] {
  const grid = blankGrid(7, 14);
  frame(grid, 0, 0, 6, 13, colors.darkGreen);
  fillRect(grid, 1, 1, 5, 12, colors.fluorescent);
  for (let y = 3; y <= 10; y += 2) setCell(grid, 3, y, colors.white);
  return grid;
}

function createLensRing(colors: Colors): AssemblyExampleCell[][] {
  const grid = blankGrid(9, 9);
  frame(grid, 2, 0, 6, 8, colors.darkGreen);
  frame(grid, 0, 2, 8, 6, colors.darkGreen);
  fillRect(grid, 3, 2, 5, 6, colors.white);
  fillRect(grid, 2, 3, 6, 5, colors.white);
  fillRect(grid, 3, 3, 5, 5, colors.darkGreen);
  return grid;
}

function createButton(colors: Colors): AssemblyExampleCell[][] {
  const grid = blankGrid(5, 4);
  frame(grid, 0, 0, 4, 3, colors.darkGreen);
  fillRect(grid, 1, 1, 3, 2, colors.fluorescent);
  return grid;
}

function createViewfinder(colors: Colors): AssemblyExampleCell[][] {
  const grid = blankGrid(6, 5);
  frame(grid, 0, 0, 5, 4, colors.darkGreen);
  fillRect(grid, 1, 1, 4, 3, colors.white);
  return grid;
}

export function getAssemblyExampleColorStats(cells: AssemblyExampleCell[][]): AssemblyExampleColorStat[] {
  const counts = new Map<string, number>();
  for (const row of cells) for (const colorId of row) if (colorId) counts.set(colorId, (counts.get(colorId) ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([colorId, count]) => ({ colorId, count }));
}

function createPart(partNumber: string, name: string, cells: AssemblyExampleCell[][], quantity: number, assemblyTip: string, sourceView: AssemblyPartSource = 'demo'): AssemblyExamplePart {
  return { id: `camera-${partNumber.toLowerCase()}`, partNumber, name, sourceView, width: cells[0]?.length ?? 0, height: cells.length, cells, colorStats: getAssemblyExampleColorStats(cells), quantity, assemblyTip };
}

const VIEW_PART_DETAILS: Record<Exclude<AssemblyPartSource, 'demo' | 'template'>, { partNumber: string; name: string; tip: string }> = {
  front: { partNumber: 'VIEW-01', name: '正面零件图纸', tip: '来自用户上传的正面图片；可作为主零件继续编辑与导出。' },
  side: { partNumber: 'VIEW-02', name: '侧面零件图纸', tip: '来自用户上传的侧面图片；请与正面图手动对齐组装。' },
  back: { partNumber: 'VIEW-03', name: '背面零件图纸', tip: '来自用户上传的背面图片；请与侧面图手动对齐组装。' },
  top: { partNumber: 'VIEW-04', name: '顶部零件图纸', tip: '来自用户上传的顶部图片；请与机身上沿手动对齐组装。' },
};

function hasBeads(cells: AssemblyExampleCell[][]): boolean {
  return cells.some(row => row.some(Boolean));
}

export function createAssemblyPartsFromViews(views: Partial<Record<Exclude<AssemblyPartSource, 'demo' | 'template'>, AssemblyExampleCell[][]>>): AssemblyExamplePart[] {
  return (Object.keys(VIEW_PART_DETAILS) as Array<Exclude<AssemblyPartSource, 'demo' | 'template'>>).flatMap(view => {
    const cells = views[view];
    if (!cells || !hasBeads(cells)) return [];
    const detail = VIEW_PART_DETAILS[view];
    const part = createPart(detail.partNumber, detail.name, cells, 1, detail.tip, view);
    return [{ ...part, id: `uploaded-${view}` }];
  });
}

export function summarizeAssemblyParts(parts: readonly AssemblyExamplePart[]): Pick<AssemblyExampleCase, 'colorStats' | 'totalBeads' | 'totalPartCount'> {
  const colorCounts = new Map<string, number>();
  let totalPartCount = 0;
  for (const part of parts) {
    totalPartCount += part.quantity;
    for (const stat of part.colorStats) colorCounts.set(stat.colorId, (colorCounts.get(stat.colorId) ?? 0) + stat.count * part.quantity);
  }
  const colorStats = [...colorCounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([colorId, count]) => ({ colorId, count }));
  return { colorStats, totalBeads: colorStats.reduce((total, stat) => total + stat.count, 0), totalPartCount };
}

export function createAssemblyExampleCase(paletteMap: PaletteMap): AssemblyExampleCase {
  const colors: Colors = {
    fluorescent: resolvePaletteColor(paletteMap, PREFERRED_COLORS.fluorescent),
    darkGreen: resolvePaletteColor(paletteMap, PREFERRED_COLORS.darkGreen),
    white: resolvePaletteColor(paletteMap, PREFERRED_COLORS.white),
  };
  const parts = [
    createPart('CAM-01', '机身前面板', createBodyFront(colors), 1, '先完成外框，再嵌入白色屏幕与镜头开口。'),
    createPart('CAM-02', '机身背面板', createBodyBack(colors), 1, '背板白色区域朝外，与前面板保持同一方向。'),
    createPart('CAM-03', '顶部面板', createTop(colors), 1, '顶部面板压在前后面板上沿，白色按键孔居中。'),
    createPart('CAM-04', '机身侧板（左右各一）', createSide(colors), 2, '同一侧板复制两份，分别连接机身左右边缘。'),
    createPart('CAM-05', '镜头环', createLensRing(colors), 1, '镜头环的深绿色内圈朝向机身前面板。'),
    createPart('CAM-06', '快门按键', createButton(colors), 1, '按键放置在顶部面板中心孔，保持荧光绿面朝上。'),
    createPart('CAM-07', '取景器窗', createViewfinder(colors), 1, '取景器窗嵌入顶部靠后位置，白色区域保持可见。'),
  ];
  const summary = summarizeAssemblyParts(parts);
  return {
    id: 'fluorescent-green-camera',
    title: '示例案例：荧光绿拼豆相机',
    subtitle: '手动结构示例模板 · 零件分解图纸',
    description: '这是可编辑的二维手动结构示例，不会自动进行 3D 重建；可按零件逐步拼装并导出当前主零件或项目 JSON。',
    parts,
    steps: [
      { number: 1, title: '准备机身板件', description: '分别完成 CAM-01、CAM-02、CAM-03 与两份 CAM-04。', partNumbers: ['CAM-01', 'CAM-02', 'CAM-03', 'CAM-04'] },
      { number: 2, title: '安装镜头与取景器', description: '将 CAM-05 镜头环与 CAM-07 取景器窗对齐到对应开口。', partNumbers: ['CAM-05', 'CAM-07'] },
      { number: 3, title: '固定顶部按键', description: '把 CAM-06 放入顶部中心孔，完成相机外观。', partNumbers: ['CAM-06'] },
    ],
    ...summary,
  };
}
