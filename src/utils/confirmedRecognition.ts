import type { BeadColor, BrandKey, ConvertSettings } from '../types';
import type { ImportRecognitionResult } from './importRecognition';
import type { EditablePatternProject } from './patternHistory';
import { saveExportedPatternRecord, type ExportedPatternRecord } from './patternHistory';
import { validateStoredProject } from './patternGridCodec';

/** An explicitly accepted copy: later calibration/automatic/manual changes cannot alter it. */
export interface ConfirmedRecognitionDraft {
  id: string;
  title: string;
  width: number;
  height: number;
  boardSize: number;
  brand: BrandKey;
  grid: (string | null)[][];
  palette: BeadColor[];
  createdAt: number;
}

export function confirmRecognitionResult(
  result: ImportRecognitionResult,
  palette: BeadColor[],
  name: string,
  id = `recognition_${crypto.randomUUID()}`,
): ConfirmedRecognitionDraft {
  const title = name.trim();
  if (!title || title.length > 60) throw new Error('请输入 1–60 个字符的作品名称。');
  if (result.cells.some(row => row.some(cell => cell.status === 'invalid'))) {
    throw new Error('仍有无效格，请先修正颜色或明确标为空白。');
  }
  if (palette.length === 0) throw new Error('请选择有效的识别色板。');
  const width = result.calibration.columns;
  const height = result.calibration.rows;
  const paletteIds = new Set(palette.map(color => color.id));
  if (result.cells.length !== height || result.cells.some(row => row.length !== width)) {
    throw new Error('识别结果尺寸不一致，请重新识别。');
  }
  const grid = result.cells.map(row => row.map(cell => {
    if (cell.status === 'blank') return null;
    if (!cell.colorId || !paletteIds.has(cell.colorId)) throw new Error('识别结果包含色板之外的颜色，请重新识别。');
    return cell.colorId;
  }));
  const brands = new Set(palette.map(color => color.brand));
  return {
    id, title, width, height, grid, boardSize: 26,
    brand: brands.size === 1 ? palette[0].brand : 'CUSTOM',
    palette: palette.map(color => ({ ...color, rgb: [...color.rgb] as BeadColor['rgb'] })),
    createdAt: Date.now(),
  };
}

/** New imports always start as drafts; they never inherit the current work's unlocks. */
export function recognitionDraftToProject(
  draft: ConfirmedRecognitionDraft,
  baseSettings: ConvertSettings,
): EditablePatternProject {
  const project: EditablePatternProject = {
    version: 2,
    workId: draft.id,
    name: draft.title,
    width: draft.width,
    height: draft.height,
    boardSize: draft.boardSize,
    brand: draft.brand,
    settings: { ...baseSettings, width: draft.width, height: draft.height, boardSize: draft.boardSize, brand: draft.brand, keepAspectRatio: false },
    grid: draft.grid.map(row => [...row]),
    palette: draft.palette.map(color => ({ ...color, rgb: [...color.rgb] as BeadColor['rgb'] })),
    createdAt: draft.createdAt,
    completionStatus: 'DRAFT',
    paidNonEmptyBeads: null,
  };
  validateStoredProject(project);
  return project;
}

/** Saves a separate draft through the same library storage/sync path as the editor. */
export async function saveConfirmedRecognition(
  draft: ConfirmedRecognitionDraft,
  baseSettings: ConvertSettings,
  userId: string | null,
): Promise<ExportedPatternRecord> {
  if (!userId) throw new Error('请先登录，再保存到图库。识别结果已保留。');
  const project = recognitionDraftToProject(draft, baseSettings);
  return saveExportedPatternRecord({
    id: draft.id, userId, title: project.name,
    width: project.width, height: project.height,
    totalBeads: project.grid.reduce((total, row) => total + row.filter(Boolean).length, 0),
    boardSize: project.boardSize, brand: project.brand,
    settings: project.settings, grid: project.grid, palette: project.palette,
    completionStatus: 'DRAFT', paidNonEmptyBeads: null,
  });
}
