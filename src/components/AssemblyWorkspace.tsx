import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, Download, Eraser, FileBox, FileDown, FileImage, FileUp, Grid3X3, Layers3, ListChecks, Paintbrush, Pipette, Printer, Redo2, RotateCcw, Ruler, Trash2, Undo2, Upload, WandSparkles, X } from 'lucide-react';
import { createAssemblyProjectDraft, DEFAULT_ASSEMBLY_PREPROCESSING, deserializeAssemblyProject, fileToAssemblyMetadata, saveAssemblyGenerationResult, serializeAssemblyProject, updateAssemblyProjectInputs, updateAssemblyProjectSettings, updateAssemblyProjectStructure, type AssemblyPreprocessingSettings, type AssemblyProject, type AssemblyStructureSnapshot } from '../utils/assemblyProject';
import { isLatestAssemblyGeneration, mapAssemblyPreprocessing, MAX_ASSEMBLY_IMAGE_PIXELS, modelFileToAssemblyViews, validateAssemblyImageFile, validateAssemblyModelFile } from '../utils/assemblyGeneration';
import { AssemblyGridEditor } from './AssemblyGridEditor';
import { clearAssemblyGrid, commitAssemblyGridHistory, createAssemblyGridHistory, paintAssemblyGridCell, redoAssemblyGridHistory, replaceAssemblyGridColor, restoreAssemblyGridBaseline, undoAssemblyGridHistory, type AssemblyEditableGrid, type AssemblyGridHistory } from '../utils/assemblyGridEditor';
import { createAssemblyBlueprintSvg, createAssemblyOrthographicViewsSvg, createAssemblyPlanPngBlob, createAssemblyPlanSvg, createAssemblyPngBlob, downloadAssemblyBlob, openAssemblyOrthographicViewsPrintView, openAssemblyPlanPrintView, openAssemblyPrintView, type AssemblyOrthographicViewsExportOptions, type AssemblyPlanExportOptions } from '../utils/assemblyExport';
import { clearAssemblyProjectDraft, loadAssemblyProjectDraft, saveAssemblyProjectDraft } from '../utils/assemblyDraftStorage';
import { requireAssemblyConversionResult, toAssemblyConverterPalette } from '../utils/assemblyConversionContract';
import { imageToGridWithDiagnostics } from '../utils/colorUtils';
import { createAssemblyExampleCase, createAssemblyPartsFromViews, getAssemblyExampleColorStats, summarizeAssemblyParts, type AssemblyExampleCase, type AssemblyExamplePart } from '../utils/assemblyExampleCase';
import { generateAssemblyStructure, type AssemblyStructureInput, type VoxelModel } from '../utils/assemblyStructure';
import { planAssemblyParts, type AssemblyPartPlan } from '../utils/assemblyPartPlanner';
import { AssemblyStructurePreview } from './AssemblyStructurePreview';

type PaletteEntry = { hex: string; code?: string; name?: string };
type DiagramType = 'assembly' | 'instruction';
type DiagramSize = 'small' | 'medium' | 'large';
type TemplateId = 'tower' | 'arch' | 'wall';
type ViewId = 'front' | 'side' | 'back' | 'top';
type GridCell = string | null;
type BlueprintDiagnostics = { pipeline: string | null; confidence: number | null; effectiveColorCount: number | null; backgroundPixelsRemoved: number | null };
type GeneratedBlueprint = { width: number; height: number; cells: GridCell[][]; source: 'image' | 'template'; templateId: TemplateId; diagramType: DiagramType; size: DiagramSize; diagnostics: BlueprintDiagnostics };
type ImageFiles = Record<ViewId, File | null>;

interface AssemblyWorkspaceProps {
  paletteMap: Map<string, PaletteEntry>;
  brandName: string;
}

const VIEWS: Array<{ id: ViewId; label: string; required?: boolean }> = [
  { id: 'front', label: '正面', required: true },
  { id: 'side', label: '侧面' },
  { id: 'back', label: '背面' },
  { id: 'top', label: '顶部' },
];
const TEMPLATE_OPTIONS: Array<{ id: TemplateId; label: string; description: string }> = [
  { id: 'tower', label: '叠层塔', description: '上下叠放的二维结构轮廓。' },
  { id: 'arch', label: '拱门', description: '两侧支撑与顶部横梁轮廓。' },
  { id: 'wall', label: '组合墙', description: '边框与中线组成的平面轮廓。' },
];
const SIZE_LABELS: Record<DiagramSize, string> = { small: '小型 · 16 × 16', medium: '中型 · 24 × 18', large: '大型 · 32 × 24' };
const SIZE_DIMENSIONS: Record<DiagramSize, { width: number; height: number }> = { small: { width: 16, height: 16 }, medium: { width: 24, height: 18 }, large: { width: 32, height: 24 } };

function createBlankGrid(width: number, height: number): GridCell[][] { return Array.from({ length: height }, () => Array<GridCell>(width).fill(null)); }
function setGridCell(grid: GridCell[][], x: number, y: number, colorId: string): void { if (grid[y]?.[x] !== undefined) grid[y][x] = colorId; }
function drawRectangle(grid: GridCell[][], left: number, top: number, right: number, bottom: number, colorId: string): void {
  for (let x = left; x <= right; x += 1) { setGridCell(grid, x, top, colorId); setGridCell(grid, x, bottom, colorId); }
  for (let y = top; y <= bottom; y += 1) { setGridCell(grid, left, y, colorId); setGridCell(grid, right, y, colorId); }
}
function createTemplateGrid(size: DiagramSize, templateId: TemplateId, diagramType: DiagramType, primary: string, accent: string): GridCell[][] {
  const { width, height } = SIZE_DIMENSIONS[size];
  const grid = createBlankGrid(width, height);
  const left = Math.max(1, Math.floor(width * 0.2));
  const right = Math.min(width - 2, Math.ceil(width * 0.8) - 1);
  const top = Math.max(1, Math.floor(height * 0.15));
  const bottom = Math.min(height - 2, Math.ceil(height * 0.85) - 1);
  if (templateId === 'tower') { const middle = Math.floor((top + bottom) / 2); drawRectangle(grid, left, top, right, middle, primary); drawRectangle(grid, left + 2, middle + 2, right - 2, bottom, accent); }
  else if (templateId === 'arch') { const archTop = Math.max(top + 1, Math.floor(height * 0.35)); drawRectangle(grid, left, archTop, left + 2, bottom, primary); drawRectangle(grid, right - 2, archTop, right, bottom, primary); for (let x = left; x <= right; x += 1) setGridCell(grid, x, archTop, accent); }
  else { drawRectangle(grid, left, top, right, bottom, primary); const centerX = Math.floor((left + right) / 2); for (let y = top + 1; y < bottom; y += 1) setGridCell(grid, centerX, y, accent); }
  if (diagramType === 'instruction') for (let x = left; x <= right; x += 3) setGridCell(grid, x, bottom, accent);
  return grid;
}
function colorStats(grid: GridCell[][], paletteMap: Map<string, PaletteEntry>): Array<{ id: string; count: number; label: string; hex: string }> {
  const counts = new Map<string, number>();
  for (const row of grid) for (const colorId of row) if (colorId) counts.set(colorId, (counts.get(colorId) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => { const color = paletteMap.get(id); return { id, count, label: color?.code ?? color?.name ?? id, hex: color?.hex ?? '#CBD5E1' }; });
}
function loadImage(file: File): Promise<HTMLImageElement> { return new Promise((resolve, reject) => { const url = URL.createObjectURL(file); const image = new Image(); image.onload = () => { URL.revokeObjectURL(url); const pixels = image.naturalWidth * image.naturalHeight; if (!image.naturalWidth || !image.naturalHeight || !Number.isFinite(pixels) || pixels > MAX_ASSEMBLY_IMAGE_PIXELS) { reject(new Error('图片像素不能超过 2400 万')); return; } resolve(image); }; image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('正面图片读取失败')); }; image.src = url; }); }
function createPreparedCanvas(image: HTMLImageElement, gridWidth: number, gridHeight: number, fit: AssemblyPreprocessingSettings['fit']): HTMLCanvasElement {
  const baseScale = Math.min(1, 1200 / Math.max(gridWidth * 32, gridHeight * 32));
  const width = Math.max(1, Math.round(gridWidth * 32 * baseScale));
  const height = Math.max(1, Math.round(gridHeight * 32 * baseScale));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('图片预处理不可用');
  const scale = fit === 'cover' ? Math.max(width / image.naturalWidth, height / image.naturalHeight) : Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale; const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  return canvas;
}
function toAssemblyStructureSnapshot(model: VoxelModel): AssemblyStructureSnapshot {
  return {
    dimensions: { ...model.dimensions },
    occupancy: model.occupancy.map(depth => depth.map(row => [...row])),
    sourceViews: [...model.sourceViews],
    confidence: { ...model.confidence },
    conflicts: model.conflicts.map(conflict => ({ ...conflict, ...(conflict.views ? { views: [...conflict.views] } : {}) })),
    diagnostics: {
      ...model.diagnostics,
      suppliedViews: [...model.diagnostics.suppliedViews],
      normalisedViews: Object.fromEntries(Object.entries(model.diagnostics.normalisedViews).map(([view, value]) => [view, { ...value }])) as AssemblyStructureSnapshot['diagnostics']['normalisedViews'],
    },
  };
}
function countStructureVoxels(structure: AssemblyStructureSnapshot | null): number {
  return structure?.diagnostics.occupiedAfterCleanup ?? 0;
}
function snapshotToPlannerModel(snapshot: AssemblyStructureSnapshot): VoxelModel {
  const surfaceColors = snapshot.occupancy.map(depth => depth.map(row => row.map(() => null)));
  return { ...snapshot, surfaceColors } as unknown as VoxelModel;
}

export function AssemblyWorkspace({ paletteMap, brandName }: AssemblyWorkspaceProps) {
  const paletteIds = useMemo(() => [...paletteMap.keys()], [paletteMap]);
  const paletteValues = useMemo(() => [...paletteMap.entries()].map(([id, color]) => ({ id, hex: color.hex, code: color.code ?? id, name: color.name ?? id })), [paletteMap]);
  const conversionPalette = useMemo(() => toAssemblyConverterPalette(paletteValues), [paletteValues]);
  const [diagramType, setDiagramType] = useState<DiagramType>('assembly');
  const [diagramSize, setDiagramSize] = useState<DiagramSize>('medium');
  const [templateId, setTemplateId] = useState<TemplateId>('tower');
  const [imageFiles, setImageFiles] = useState<ImageFiles>({ front: null, side: null, back: null, top: null });
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [manualNotes, setManualNotes] = useState('');
  const [generatedBlueprint, setGeneratedBlueprint] = useState<GeneratedBlueprint | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Partial<Record<ViewId, string>>>({});
  const [preprocessing, setPreprocessing] = useState<AssemblyPreprocessingSettings>(() => ({ ...DEFAULT_ASSEMBLY_PREPROCESSING }));
  const [gridHistory, setGridHistory] = useState<AssemblyGridHistory | null>(null);
  const [editorTool, setEditorTool] = useState<'paint' | 'erase' | 'picker'>('paint');
  const [selectedColor, setSelectedColor] = useState<string | null>(() => paletteIds[0] ?? null);
  const [paletteSearch, setPaletteSearch] = useState('');
  const [replaceSource, setReplaceSource] = useState<string>('');
  const [assemblyProject, setAssemblyProject] = useState(() => createAssemblyProjectDraft());
  const [structureSnapshot, setStructureSnapshot] = useState<AssemblyStructureSnapshot | null>(null);
  const [liveStructureModel, setLiveStructureModel] = useState<VoxelModel | null>(null);
  const [selectedAssemblyPartId, setSelectedAssemblyPartId] = useState<string | null>(null);
  const [exampleCase, setExampleCase] = useState<AssemblyExampleCase | null>(null);
  const [generatedParts, setGeneratedParts] = useState<AssemblyExamplePart[]>([]);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const generationRequestRef = useRef(0);
  const isMountedRef = useRef(true);
  const projectImportRef = useRef<HTMLInputElement>(null);
  const exportBusyRef = useRef(false);

  useEffect(() => { const next: Partial<Record<ViewId, string>> = {}; for (const view of VIEWS) if (imageFiles[view.id]) next[view.id] = URL.createObjectURL(imageFiles[view.id]!); setPreviewUrls(next); return () => Object.values(next).forEach(url => URL.revokeObjectURL(url)); }, [imageFiles]);
  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; generationRequestRef.current += 1; }; }, []);
  useEffect(() => { if (!selectedColor && paletteIds[0]) setSelectedColor(paletteIds[0]); }, [paletteIds, selectedColor]);
  useEffect(() => {
    const restored = typeof window === 'undefined' ? null : loadAssemblyProjectDraft(window.localStorage);
    if (restored) {
      setAssemblyProject(restored); setStructureSnapshot(restored.structure); setLiveStructureModel(null); setDiagramType(restored.settings.diagramType); setDiagramSize(restored.settings.diagramSize); setTemplateId(restored.settings.templateId); setPreprocessing(restored.settings.preprocessing); setManualNotes(restored.inputs.manualNotes); setImageFiles({ front: null, side: null, back: null, top: null }); setModelFile(null);
      if (restored.result) { const blueprint: GeneratedBlueprint = { width: restored.result.width, height: restored.result.height, cells: restored.result.cells, source: restored.settings.source, templateId: restored.settings.templateId, diagramType: restored.settings.diagramType, size: restored.settings.diagramSize, diagnostics: restored.result.diagnostics }; setGeneratedBlueprint(blueprint); setGridHistory(createAssemblyGridHistory(blueprint.cells)); }
      setDraftMessage('已恢复本地草稿；源图片和模型需重新选择后才能重新预处理。');
    }
    setDraftReady(true);
  }, []);
  useEffect(() => {
    if (!draftReady) return;
    setAssemblyProject(current => updateAssemblyProjectInputs(current, {
      views: { front: fileToAssemblyMetadata(imageFiles.front), side: fileToAssemblyMetadata(imageFiles.side), back: fileToAssemblyMetadata(imageFiles.back), top: fileToAssemblyMetadata(imageFiles.top) },
      model: fileToAssemblyMetadata(modelFile),
      manualNotes,
    }));
  }, [draftReady, imageFiles, modelFile, manualNotes]);
  useEffect(() => {
    if (!draftReady || typeof window === 'undefined') return;
    const timer = window.setTimeout(() => { if (!saveAssemblyProjectDraft(window.localStorage, assemblyProject)) setDraftMessage('本地草稿未保存：浏览器存储不可用或空间不足。'); }, 600);
    return () => window.clearTimeout(timer);
  }, [assemblyProject, draftReady]);
  const activeTemplate = TEMPLATE_OPTIONS.find(template => template.id === templateId) ?? TEMPLATE_OPTIONS[0];
  const displayedCells = gridHistory?.present ?? generatedBlueprint?.cells ?? [];
  const generatedStats = useMemo(() => generatedBlueprint ? colorStats(displayedCells, paletteMap) : [], [displayedCells, generatedBlueprint, paletteMap]);
  const generatedTotal = useMemo(() => generatedStats.reduce((total, stat) => total + stat.count, 0), [generatedStats]);
  const uploadedOrthographicParts = useMemo(() => VIEWS.flatMap(view => generatedParts.filter(part => part.sourceView === view.id)), [generatedParts]);
  const visibleParts = uploadedOrthographicParts.length ? uploadedOrthographicParts : exampleCase?.parts ?? [];
  const activeExamplePart = useMemo(() => visibleParts.find(part => part.id === selectedPartId) ?? visibleParts[0] ?? null, [selectedPartId, visibleParts]);
  const generatedPartsSummary = useMemo(() => summarizeAssemblyParts(uploadedOrthographicParts), [uploadedOrthographicParts]);
  const isUploadedPartsMode = uploadedOrthographicParts.length > 0;
  const structureVoxelCount = useMemo(() => countStructureVoxels(structureSnapshot), [structureSnapshot]);
  const missingStructureViews = useMemo(() => VIEWS.filter(view => !structureSnapshot?.sourceViews.includes(view.id)).map(view => view.label), [structureSnapshot]);
  const hasConfirmedStructure = Boolean(structureSnapshot && structureSnapshot.confidence.mode === 'orthographic-structure' && structureSnapshot.confidence.structureReady);
  const assemblyPlanning = useMemo(() => {
    if (!hasConfirmedStructure || !structureSnapshot) return { plan: null as AssemblyPartPlan | null, error: null as string | null };
    try { return { plan: planAssemblyParts(liveStructureModel ?? snapshotToPlannerModel(structureSnapshot)), error: null as string | null }; }
    catch (error) { return { plan: null as AssemblyPartPlan | null, error: error instanceof Error ? error.message : '组合零件规划失败' }; }
  }, [hasConfirmedStructure, liveStructureModel, structureSnapshot]);
  const assemblyPlan = assemblyPlanning.plan;
  const filteredPaletteValues = useMemo(() => {
    const query = paletteSearch.trim().toLowerCase();
    return query ? paletteValues.filter(color => `${color.code} ${color.name} ${color.id}`.toLowerCase().includes(query)) : paletteValues;
  }, [paletteSearch, paletteValues]);

  useEffect(() => {
    if (!generatedBlueprint || !gridHistory || generatedBlueprint.cells === gridHistory.present) return;
    const next = { ...generatedBlueprint, cells: gridHistory.present };
    setGeneratedBlueprint(next);
    setAssemblyProject(current => saveAssemblyGenerationResult(current, { width: next.width, height: next.height, cells: next.cells, diagnostics: next.diagnostics }, { diagramType: next.diagramType, diagramSize: next.size, templateId: next.templateId, source: next.source, preprocessing }));
  }, [generatedBlueprint, gridHistory, preprocessing]);
  useEffect(() => {
    const partId = selectedPartId;
    const cells = gridHistory?.present;
    if (!partId || !cells) return;
    setGeneratedParts(current => {
      const index = current.findIndex(part => part.id === partId);
      if (index < 0 || current[index].cells === cells) return current;
      return current.map(part => part.id === partId ? { ...part, cells, colorStats: getAssemblyExampleColorStats(cells) } : part);
    });
  }, [gridHistory, selectedPartId]);
  useEffect(() => {
    if (!assemblyPlan?.parts.length) { setSelectedAssemblyPartId(null); return; }
    setSelectedAssemblyPartId(current => assemblyPlan.parts.some(part => part.id === current) ? current : assemblyPlan.parts[0].id);
  }, [assemblyPlan]);

  const invalidateGeneration = () => { generationRequestRef.current += 1; if (isMountedRef.current) setIsGenerating(false); };
  const clearStructureSnapshot = () => { setStructureSnapshot(null); setLiveStructureModel(null); setSelectedAssemblyPartId(null); setAssemblyProject(current => updateAssemblyProjectStructure(current, null)); };
  const resetGeneratedAfterInputChange = (message: string) => {
    invalidateGeneration();
    setExampleCase(null);
    setGeneratedParts([]);
    setSelectedPartId(null);
    setGeneratedBlueprint(null);
    setGridHistory(null);
    clearStructureSnapshot();
    setGenerationError(null);
    setDraftMessage(message);
  };
  const loadExampleCase = () => {
    if (VIEWS.some(view => imageFiles[view.id])) { setDraftMessage('已保留上传资料；请点击“生成图纸”生成真实多视角零件，演示案例不会覆盖它们。'); return; }
    const next = createAssemblyExampleCase(paletteMap);
    const firstPart = next.parts[0];
    setExampleCase(next);
    clearStructureSnapshot();
    setGeneratedParts([]);
    setSelectedPartId(firstPart?.id ?? null);
    if (firstPart) {
      setGeneratedBlueprint({ width: firstPart.width, height: firstPart.height, cells: firstPart.cells, source: 'template', templateId: 'tower', diagramType: 'assembly', size: 'medium', diagnostics: { pipeline: 'manual-example', confidence: null, effectiveColorCount: firstPart.colorStats.length, backgroundPixelsRemoved: null } });
      setGridHistory(createAssemblyGridHistory(firstPart.cells));
    }
    setReplaceSource('');
    setGenerationError(null);
    setDraftMessage('已载入手动结构示例：拼豆相机。');
  };
  const clearExampleCase = () => {
    setExampleCase(null);
    clearStructureSnapshot();
    setSelectedPartId(null);
    setGeneratedBlueprint(null);
    setGridHistory(null);
    setReplaceSource('');
    setGenerationError(null);
    setDraftMessage('已退出拼豆相机示例，可继续使用普通图纸流程。');
  };
  const selectExamplePart = (part: AssemblyExamplePart) => {
    setSelectedPartId(part.id);
    setGeneratedBlueprint({ width: part.width, height: part.height, cells: part.cells, source: 'template', templateId: 'tower', diagramType: 'assembly', size: 'medium', diagnostics: { pipeline: 'manual-example', confidence: null, effectiveColorCount: part.colorStats.length, backgroundPixelsRemoved: null } });
    setGridHistory(createAssemblyGridHistory(part.cells));
    setReplaceSource('');
  };
  const updatePreprocessing = (patch: Partial<AssemblyPreprocessingSettings>) => { const next = { ...preprocessing, ...patch }; setPreprocessing(next); setAssemblyProject(current => updateAssemblyProjectSettings(current, { preprocessing: next })); invalidateGeneration(); };
  const handleImageChange = (view: ViewId, file: File | undefined) => { if (!file) return; const error = validateAssemblyImageFile(file); invalidateGeneration(); if (error) { setGenerationError(error); return; } setImageFiles(current => ({ ...current, [view]: file })); resetGeneratedAfterInputChange('已更新上传资料；请重新生成以融合多视角结构。'); };
  const handleImageRemove = (view: ViewId) => {
    if (!imageFiles[view]) return;
    setImageFiles(current => ({ ...current, [view]: null }));
    resetGeneratedAfterInputChange(`已移除${VIEWS.find(item => item.id === view)?.label ?? '视图'}资料；请重新生成图纸。`);
  };
  const handleModelChange = (file: File | undefined) => {
    if (!file) return;
    const error = validateAssemblyModelFile(file);
    if (error) { setGenerationError(error); return; }
    invalidateGeneration();
    setModelFile(file);
    setGenerationError(null);
    setDraftMessage('3D 模型已加载；点击“生成图纸”将自动生成正面、侧面、背面和顶部投影。FBX/BLEND 暂不支持，请先转换为 OBJ、GLB 或 STL。');
  };
  const handleModelRemove = () => {
    if (!modelFile) return;
    setModelFile(null);
    resetGeneratedAfterInputChange('已移除 3D 模型资料；请重新选择文件或上传正交图片。');
  };
  const saveGeneratedBlueprint = (blueprint: Omit<GeneratedBlueprint, 'diagnostics'>, diagnostics: BlueprintDiagnostics, structure: AssemblyStructureSnapshot | null | undefined = undefined) => {
    const next = { ...blueprint, diagnostics };
    startTransition(() => { setGeneratedBlueprint(next); setGridHistory(createAssemblyGridHistory(next.cells)); setReplaceSource(''); setAssemblyProject(current => { const withGrid = saveAssemblyGenerationResult(current, { width: next.width, height: next.height, cells: next.cells, diagnostics }, { diagramType: next.diagramType, diagramSize: next.size, templateId: next.templateId, source: next.source, preprocessing }); return structure === undefined ? withGrid : updateAssemblyProjectStructure(withGrid, structure); }); });
  };
  const applyGridOperation = (operation: (grid: AssemblyEditableGrid) => AssemblyEditableGrid) => setGridHistory(current => current ? commitAssemblyGridHistory(current, operation(current.present)) : current);
  const buildCurrentProject = (): AssemblyProject => {
    let next = updateAssemblyProjectInputs(assemblyProject, {
      views: { front: fileToAssemblyMetadata(imageFiles.front), side: fileToAssemblyMetadata(imageFiles.side), back: fileToAssemblyMetadata(imageFiles.back), top: fileToAssemblyMetadata(imageFiles.top) },
      model: fileToAssemblyMetadata(modelFile), manualNotes,
    });
    if (!generatedBlueprint) return updateAssemblyProjectStructure(updateAssemblyProjectSettings(next, { diagramType, diagramSize, templateId, preprocessing }), structureSnapshot);
    return updateAssemblyProjectStructure(saveAssemblyGenerationResult(next, { width: generatedBlueprint.width, height: generatedBlueprint.height, cells: displayedCells, diagnostics: generatedBlueprint.diagnostics }, { diagramType, diagramSize, templateId, source: generatedBlueprint.source, preprocessing }), structureSnapshot);
  };
  const createReferenceExportSvg = () => {
    if (!generatedBlueprint) throw new Error('请先生成图纸');
    const activeViewLabel = VIEWS.find(view => view.id === activeExamplePart?.sourceView)?.label;
    return createAssemblyBlueprintSvg({ title: activeViewLabel ? `正交图纸 · ${activeViewLabel}` : '二维编辑参考图纸（非组合方案）', brandName, cells: displayedCells, palette: paletteValues, showColorCodes: true });
  };
  const createOrthographicViewsExportOptions = (): AssemblyOrthographicViewsExportOptions => {
    if (!isUploadedPartsMode) throw new Error('请先上传并生成至少一张正交图纸');
    return {
      title: '上传正交图纸集',
      brandName,
      palette: paletteValues,
      showColorCodes: true,
      views: uploadedOrthographicParts.map(part => ({
        id: part.sourceView ?? part.id,
        label: VIEWS.find(view => view.id === part.sourceView)?.label ?? '上传视图',
        cells: part.id === selectedPartId ? displayedCells : part.cells,
      })),
    };
  };
  const createPlanExportOptions = (): AssemblyPlanExportOptions => {
    if (!hasConfirmedStructure || !assemblyPlan?.confidence.manufacturable) throw new Error(assemblyPlan?.confidence.reason ?? '请先补充正面和侧面图，确认多视角结构后再导出组合方案');
    return { title: '立体拼豆组合方案', brandName, plan: assemblyPlan, palette: paletteValues };
  };
  const runExport = async (action: () => void | Promise<void>, fallbackError: string) => { if (exportBusyRef.current) return; exportBusyRef.current = true; setIsExporting(true); try { await action(); } catch (error) { setGenerationError(error instanceof Error ? error.message : fallbackError); } finally { exportBusyRef.current = false; if (isMountedRef.current) setIsExporting(false); } };
  const handlePlanSvgExport = () => void runExport(() => downloadAssemblyBlob(new Blob([createAssemblyPlanSvg(createPlanExportOptions())], { type: 'image/svg+xml;charset=utf-8' }), 'assembly-plan.svg'), '组合方案 SVG 导出失败');
  const handlePlanPngExport = () => runExport(async () => { const png = await createAssemblyPlanPngBlob(createPlanExportOptions(), 2); downloadAssemblyBlob(png.blob, 'assembly-plan.png'); if (png.warning) setDraftMessage(png.warning); }, '组合方案 PNG 导出失败');
  const handlePlanPrintExport = () => void runExport(() => openAssemblyPlanPrintView(createPlanExportOptions()), '组合方案打印输出失败');
  const handleReferenceSvgExport = () => void runExport(() => downloadAssemblyBlob(new Blob([createReferenceExportSvg()], { type: 'image/svg+xml;charset=utf-8' }), 'assembly-view-reference.svg'), '参考 SVG 导出失败');
  const handleReferencePngExport = () => runExport(async () => downloadAssemblyBlob(await createAssemblyPngBlob(createReferenceExportSvg(), 2), 'assembly-view-reference.png'), '参考 PNG 导出失败');
  const handleReferencePrintExport = () => void runExport(() => openAssemblyPrintView(createReferenceExportSvg(), '二维编辑参考图纸（非组合方案）'), '参考打印输出失败');
  const handleOrthographicViewsSvgExport = () => void runExport(() => downloadAssemblyBlob(new Blob([createAssemblyOrthographicViewsSvg(createOrthographicViewsExportOptions())], { type: 'image/svg+xml;charset=utf-8' }), 'assembly-orthographic-views.svg'), '正交图纸集 SVG 导出失败');
  const handleOrthographicViewsPngExport = () => runExport(async () => downloadAssemblyBlob(await createAssemblyPngBlob(createAssemblyOrthographicViewsSvg(createOrthographicViewsExportOptions()), 2), 'assembly-orthographic-views.png'), '正交图纸集 PNG 导出失败');
  const handleOrthographicViewsPrintExport = () => void runExport(() => openAssemblyOrthographicViewsPrintView(createOrthographicViewsExportOptions()), '正交图纸集打印输出失败');
  const handleProjectDownload = () => void runExport(() => { const next = buildCurrentProject(); setAssemblyProject(next); downloadAssemblyBlob(new Blob([serializeAssemblyProject(next)], { type: 'application/json;charset=utf-8' }), 'assembly-project.json'); }, '项目导出失败');
  const handleClearDraft = () => { const cleared = typeof window !== 'undefined' && clearAssemblyProjectDraft(window.localStorage); setDraftMessage(cleared ? '已清除本地草稿。' : '本地草稿清除失败。'); };
  const handleProjectImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('项目文件不能超过 5 MB');
      const project = deserializeAssemblyProject(await file.text());
      if (!project) throw new Error('项目文件无效或版本不受支持');
      setAssemblyProject(project); setStructureSnapshot(project.structure); setLiveStructureModel(null); setDiagramType(project.settings.diagramType); setDiagramSize(project.settings.diagramSize); setTemplateId(project.settings.templateId); setPreprocessing(project.settings.preprocessing); setManualNotes(project.inputs.manualNotes); setImageFiles({ front: null, side: null, back: null, top: null }); setModelFile(null); setExampleCase(null); setGeneratedParts([]); setSelectedPartId(null); setReplaceSource('');
      if (project.result) {
        const restored: GeneratedBlueprint = { width: project.result.width, height: project.result.height, cells: project.result.cells, source: project.settings.source, templateId: project.settings.templateId, diagramType: project.settings.diagramType, size: project.settings.diagramSize, diagnostics: project.result.diagnostics };
        setGeneratedBlueprint(restored); setGridHistory(createAssemblyGridHistory(restored.cells));
      } else { setGeneratedBlueprint(null); setGridHistory(null); }
      setGenerationError(null);
    } catch (error) { setGenerationError(error instanceof Error ? error.message : '项目导入失败'); }
  };
  const generateBlueprint = async () => {
    const requestId = generationRequestRef.current + 1;
    generationRequestRef.current = requestId;
    setIsGenerating(true); setGenerationError(null);
    try {
      const { width, height } = SIZE_DIMENSIONS[diagramSize];
      const uploadedViews = VIEWS.filter(view => imageFiles[view.id]);
      // A model-only project is a first-class generation path. Parse the mesh
      // locally and rasterise four orthographic masks; never fall back to the
      // template when the user supplied a model.
      if (modelFile && uploadedViews.length === 0) {
        if (conversionPalette.length === 0) throw new Error('当前色卡没有可用于模型投影的有效颜色');
        const primary = paletteIds[0] ?? '#7C3AED';
        const modelViews = await modelFileToAssemblyViews(modelFile, width, height, primary);
        if (!isMountedRef.current || !isLatestAssemblyGeneration(requestId, generationRequestRef.current)) return;
        const convertedViews: Partial<Record<ViewId, GridCell[][]>> = {};
        for (const view of VIEWS) {
          const source = modelViews[view.id];
          convertedViews[view.id] = source.map(row => row.map(cell => cell || null));
        }
        const parts = createAssemblyPartsFromViews(convertedViews);
        if (!parts.length) throw new Error('3D 模型未生成有效投影；请检查模型是否包含可见网格和三角面。');
        const structureInput: AssemblyStructureInput = {};
        for (const view of VIEWS) if (convertedViews[view.id]) structureInput[view.id] = { grid: convertedViews[view.id]! };
        let structure: ReturnType<typeof generateAssemblyStructure> | null = null;
        try { structure = generateAssemblyStructure(structureInput); } catch { structure = null; }
        const orderedParts = VIEWS.flatMap(view => parts.filter(part => part.sourceView === view.id));
        const orthographicParts = orderedParts.length ? orderedParts : parts;
        const firstPart = orthographicParts.find(part => part.sourceView === 'front') ?? orthographicParts[0];
        setExampleCase(null); setGeneratedParts(orthographicParts); setSelectedPartId(firstPart.id); setReplaceSource('');
        const diagnostics: BlueprintDiagnostics = { pipeline: `model-${modelViews.format}-orthographic`, confidence: 1, effectiveColorCount: 1, backgroundPixelsRemoved: null };
        saveGeneratedBlueprint({ width: firstPart.width, height: firstPart.height, cells: firstPart.cells, source: 'image', templateId, diagramType, size: diagramSize }, diagnostics, structure ? toAssemblyStructureSnapshot(structure) : null);
        setStructureSnapshot(structure ? toAssemblyStructureSnapshot(structure) : null);
        setLiveStructureModel(structure);
        setDraftMessage(`已解析 ${modelViews.format.toUpperCase()} 模型（${modelViews.vertexCount.toLocaleString()} 个顶点，${modelViews.triangleCount.toLocaleString()} 个三角面），生成正面、侧面、背面和顶部投影。`);
        return;
      }
      if (uploadedViews.length) {
        if (conversionPalette.length === 0) throw new Error('当前色卡没有可用于图片转换的有效 RGB 颜色');
        const settings = { width, height, brand: 'MARD', dither: 'none', brightness: 0, contrast: 0, saturation: 0, transparentCutoff: 128, boardSize: 29, sharpening: 30, outlineBoost: true, colorMatchAlgo: 'ciede2000', kmeansClustering: true, pipelineOverride: 'cartoon', ...mapAssemblyPreprocessing(preprocessing) } as Parameters<typeof imageToGridWithDiagnostics>[1];
        const convertedViews: Partial<Record<ViewId, GridCell[][]>> = {};
        const diagnosticsByView = new Map<ViewId, BlueprintDiagnostics>();
        for (const view of uploadedViews) {
          const image = await loadImage(imageFiles[view.id]!);
          if (!isMountedRef.current || !isLatestAssemblyGeneration(requestId, generationRequestRef.current)) return;
          const preparedImage = createPreparedCanvas(image, width, height, preprocessing.fit);
          const rawConversion = imageToGridWithDiagnostics(preparedImage, settings, conversionPalette as Parameters<typeof imageToGridWithDiagnostics>[2]);
          const conversion = requireAssemblyConversionResult(rawConversion, width, height);
          convertedViews[view.id] = conversion.grid;
          diagnosticsByView.set(view.id, { pipeline: conversion.diagnostics.pipeline ?? null, confidence: conversion.diagnostics.confidence ?? null, effectiveColorCount: conversion.diagnostics.effectiveColorCount ?? null, backgroundPixelsRemoved: conversion.diagnostics.backgroundPixelsRemoved ?? null });
        }
        if (!isMountedRef.current || !isLatestAssemblyGeneration(requestId, generationRequestRef.current)) return;
        const structureInput: AssemblyStructureInput = {};
        for (const view of VIEWS) if (convertedViews[view.id]) structureInput[view.id] = { grid: convertedViews[view.id]! };
        const structure = generateAssemblyStructure(structureInput);
        const structureSnapshot = toAssemblyStructureSnapshot(structure);
        const structureError = structure.conflicts.find(conflict => conflict.severity === 'error');
        if (structureError || structure.diagnostics.occupiedAfterCleanup === 0) throw new Error(structureError?.message ?? '多个视图未形成可用结构；请检查主体轮廓、镜像或预处理设置。');
        const parts = createAssemblyPartsFromViews(convertedViews);
        if (!parts.length) throw new Error('已上传图片未转换出非空拼豆网格；请检查图片内容或预处理设置。');
        const orderedParts = VIEWS.flatMap(view => parts.filter(part => part.sourceView === view.id));
        const orthographicParts = orderedParts.length ? orderedParts : parts;
        const firstPart = orthographicParts.find(part => part.sourceView === 'front') ?? orthographicParts[0];
        setExampleCase(null); setGeneratedParts(orthographicParts); setSelectedPartId(firstPart.id); setStructureSnapshot(structureSnapshot); setLiveStructureModel(structure); setReplaceSource('');
        saveGeneratedBlueprint({ width: firstPart.width, height: firstPart.height, cells: firstPart.cells, source: 'image', templateId, diagramType, size: diagramSize }, diagnosticsByView.get(firstPart.sourceView as ViewId) ?? { pipeline: 'image', confidence: null, effectiveColorCount: firstPart.colorStats.length, backgroundPixelsRemoved: null }, structureSnapshot);
        const missingViews = VIEWS.filter(view => !imageFiles[view.id]).map(view => view.label);
        setDraftMessage(`${structure.confidence.mode === 'inferred-draft' ? `当前仅为推断草案：请补充侧面图后再生成可制作的立体组合；未提供：${missingViews.join('、') || '无'}。` : `已融合 ${structure.sourceViews.map(view => VIEWS.find(item => item.id === view)?.label ?? view).join('、')}，得到 ${structure.dimensions.width} × ${structure.dimensions.height} × ${structure.dimensions.depth} 的连贯结构。二维视图仅保留为编辑参考；未提供：${missingViews.join('、') || '无'}。`}${modelFile ? ' 已上传的 3D 模型仅作为资料保存，当前未参与解析。' : ''}`);
      } else {
        const primary = paletteIds[0] ?? '#7C3AED'; const accent = paletteIds[1] ?? primary;
        if (!isMountedRef.current || !isLatestAssemblyGeneration(requestId, generationRequestRef.current)) return;
        setExampleCase(null); setGeneratedParts([]); setSelectedPartId(null); setStructureSnapshot(null); setLiveStructureModel(null); setSelectedAssemblyPartId(null);
        saveGeneratedBlueprint({ width, height, cells: createTemplateGrid(diagramSize, templateId, diagramType, primary, accent), source: 'template', templateId, diagramType, size: diagramSize }, { pipeline: 'template', confidence: null, effectiveColorCount: null, backgroundPixelsRemoved: null }, null);
      }
    } catch (error) { if (isMountedRef.current && isLatestAssemblyGeneration(requestId, generationRequestRef.current)) setGenerationError(error instanceof Error ? error.message : '图纸生成失败'); }
    finally { if (isMountedRef.current && isLatestAssemblyGeneration(requestId, generationRequestRef.current)) setIsGenerating(false); }
  };

  return (
    <main data-assembly-workspace className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-purple-50/30 p-2 sm:p-3">
      <style>{`@media (max-width: 1023px) {
        [data-assembly-workspace] button { min-height: 2.75rem; flex-wrap: wrap; }
        [data-assembly-workspace] input[type='search'],
        [data-assembly-workspace] input[type='range'],
        [data-assembly-workspace] select { min-height: 2.75rem; }
        [data-assembly-workspace] details > summary { min-height: 2.75rem; }
        [data-assembly-workspace] section[aria-label='操作与导出'] .grid-cols-3,
        [data-assembly-workspace] [aria-label='组合方案导出'] .grid-cols-3,
        [data-assembly-workspace] [aria-label='正交图纸导出'] .grid-cols-3,
        [data-assembly-workspace] [aria-label='二维参考导出'] .grid-cols-3 { grid-template-columns: minmax(0, 1fr); }
      }`}</style>
      <div className="mx-auto flex min-w-0 w-full max-w-[1400px] flex-col gap-3 lg:min-h-full">
       <header className="rounded-xl border border-purple-200/80 bg-white/95 px-3 py-2.5 shadow-2xs sm:px-4"><h1 className="text-lg font-black tracking-tight text-purple-950 sm:text-xl">立体组合图纸</h1><p className="mt-0.5 text-[11px] leading-4 text-purple-400">多视角结构推断工作区 · 当前品牌：{brandName}</p></header>

        <section className="rounded-xl border border-purple-200/80 bg-white p-3 shadow-2xs sm:p-4" aria-label="资料来源">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-xs font-black text-purple-950"><Upload className="h-3.5 w-3.5 text-purple-600" />资料来源</h2>
              <p className="mt-1 text-[10px] leading-4 text-purple-500">正、侧、背、顶部图片会共同约束结构；OBJ、GLB、GLTF、STL 模型可直接生成四向投影，FBX/BLEND 请先转换格式。</p>
            </div>
            <span className="text-[10px] font-bold text-purple-400">支持重新选择文件</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(15rem,1.1fr)]">
            {VIEWS.map(view => <div key={view.id} className="group flex min-h-20 min-w-0 flex-col justify-between overflow-hidden rounded-lg border border-purple-200 bg-purple-50/50 p-2.5 hover:bg-purple-50">
              <div className="flex min-w-0 items-center justify-between gap-1.5 text-[11px] font-black text-purple-900"><div className="flex min-w-0 items-center gap-1.5"><FileImage className="h-3.5 w-3.5 shrink-0 text-purple-600" /><span className="truncate">{view.label}</span>{view.required && <span className="shrink-0 text-[9px] text-purple-500">必选</span>}</div>{imageFiles[view.id] && <button type="button" onClick={() => handleImageRemove(view.id)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-600 hover:bg-rose-50" aria-label={`移除${view.label}图片`} title={`移除${view.label}图片`}><X className="h-4 w-4" /></button>}</div>
              <label className="mt-1 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md p-0.5">
                <input type="file" accept="image/*" className="sr-only" onChange={event => { handleImageChange(view.id, event.target.files?.[0]); event.currentTarget.value = ''; }} />
                {previewUrls[view.id] ? <div className="flex min-w-0 items-center gap-1.5"><img src={previewUrls[view.id]} alt={`${view.label}预览`} className="h-9 w-12 shrink-0 rounded border border-purple-100 object-cover" /><span className="min-w-0 truncate text-[9px] font-bold text-purple-600" title={imageFiles[view.id]!.name}>{imageFiles[view.id]!.name}</span></div> : <div className="flex min-h-10 items-center gap-1 text-[10px] font-bold text-purple-400"><Upload className="h-3.5 w-3.5 shrink-0" />点击上传</div>}
              </label>
            </div>)}
            <details className="min-w-0 rounded-lg border border-purple-200 bg-white sm:col-span-2 lg:col-span-1">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-2.5 text-[11px] font-black text-purple-900"><FileBox className="h-3.5 w-3.5 text-purple-600" />3D 模型（高级资料）</summary>
              <div className="border-t border-purple-100 p-2.5">
                <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-purple-200 bg-purple-50 px-2.5 text-[10px] font-bold text-purple-700 hover:bg-purple-100"><FileBox className="mr-1.5 h-3.5 w-3.5" />选择模型文件<input type="file" accept=".glb,.gltf,.obj,.fbx,.blend,.stl" className="sr-only" onChange={event => { handleModelChange(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
                {modelFile && <div className="mt-2 flex min-w-0 items-center gap-1.5"><span className="min-w-0 flex-1 truncate text-[9px] font-bold text-purple-500" title={modelFile.name}>{modelFile.name}</span><button type="button" onClick={handleModelRemove} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-600 hover:bg-rose-50" aria-label="移除3D模型文件" title="移除3D模型文件"><X className="h-4 w-4" /></button></div>}
              </div>
            </details>
          </div>
        </section>

        {hasConfirmedStructure && structureSnapshot && <AssemblyStructurePreview structure={structureSnapshot} plan={assemblyPlan} selectedPartId={selectedAssemblyPartId} onSelectPart={setSelectedAssemblyPartId} />}
       <section className="grid min-w-0 gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
        <section className="order-2 min-w-0 rounded-xl border border-purple-200/80 bg-white p-2.5 shadow-2xs sm:p-3.5 lg:order-1 lg:flex lg:min-h-0 lg:flex-col">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-purple-100 pb-2.5">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-black text-purple-950"><Grid3X3 className="h-4 w-4 text-purple-600" />{isUploadedPartsMode ? `正交图纸 · ${VIEWS.find(view => view.id === activeExamplePart?.sourceView)?.label ?? '正面'}` : (exampleCase ? `零件图纸 · ${activeExamplePart?.partNumber ?? ''} ${activeExamplePart?.name ?? ''}` : '二维编辑参考')}</h2>
              <p className="mt-0.5 text-[11px] text-purple-400">{isUploadedPartsMode ? `上传${VIEWS.find(view => view.id === activeExamplePart?.sourceView)?.label ?? '正面'}图的网格图纸；不包含组合方案、卡槽或零件边界。` : exampleCase ? `演示模板 · ${activeExamplePart?.assemblyTip ?? ''}` : generatedBlueprint ? `来源：${generatedBlueprint.source === 'image' ? '图片转换' : `模板 · ${activeTemplate.label}`}` : '上传至少一张视角图片，或选择模板后生成。'}</p>
            </div>
            {generatedBlueprint && <span className="rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1.5 text-[11px] font-bold text-purple-800">{isUploadedPartsMode ? `${activeExamplePart?.width ?? generatedBlueprint.width} × ${activeExamplePart?.height ?? generatedBlueprint.height} · ${activeExamplePart?.colorStats.reduce((total, stat) => total + stat.count, 0) ?? 0} 颗` : exampleCase ? `${activeExamplePart?.width ?? generatedBlueprint.width} × ${activeExamplePart?.height ?? generatedBlueprint.height} · ${activeExamplePart?.quantity ?? 1} 件` : `已生成 ${generatedBlueprint.width} × ${generatedBlueprint.height} 图纸`}</span>}
          </div>
          {generatedBlueprint ? <><section className="mt-3 shrink-0 rounded-xl border border-purple-100 bg-purple-50/50 p-2.5" aria-label="图纸编辑工具"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] font-black text-purple-950">网格编辑</span><div className="flex flex-wrap gap-1"><button type="button" onClick={() => setEditorTool('paint')} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold ${editorTool === 'paint' ? 'border-purple-300 bg-purple-100 text-purple-900' : 'border-purple-200 bg-white text-purple-600'}`}><Paintbrush className="h-3 w-3" />绘制</button><button type="button" onClick={() => setEditorTool('erase')} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold ${editorTool === 'erase' ? 'border-purple-300 bg-purple-100 text-purple-900' : 'border-purple-200 bg-white text-purple-600'}`}><Eraser className="h-3 w-3" />擦除</button><button type="button" onClick={() => setEditorTool('picker')} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold ${editorTool === 'picker' ? 'border-purple-300 bg-purple-100 text-purple-900' : 'border-purple-200 bg-white text-purple-600'}`}><Pipette className="h-3 w-3" />吸色</button><button type="button" onClick={() => setGridHistory(current => current ? undoAssemblyGridHistory(current) : current)} disabled={!gridHistory?.past.length} className="rounded-md border border-purple-200 bg-white p-1 text-purple-600 disabled:opacity-35" aria-label="撤销"><Undo2 className="h-3.5 w-3.5" /></button><button type="button" onClick={() => setGridHistory(current => current ? redoAssemblyGridHistory(current) : current)} disabled={!gridHistory?.future.length} className="rounded-md border border-purple-200 bg-white p-1 text-purple-600 disabled:opacity-35" aria-label="重做"><Redo2 className="h-3.5 w-3.5" /></button></div></div><div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5"><input type="search" value={paletteSearch} onChange={event => setPaletteSearch(event.target.value)} placeholder="搜索色号" className="min-w-0 flex-1 rounded-md border border-purple-200 bg-white px-2 py-1 text-[10px] font-bold text-purple-800 outline-none placeholder:text-purple-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-100" /><select aria-label="选择颜色" value={selectedColor ?? ''} onChange={event => { setSelectedColor(event.target.value || null); setEditorTool('paint'); }} className="min-w-0 max-w-full flex-1 rounded-md border border-purple-200 bg-white px-2 py-1 text-[10px] font-bold text-purple-800"><option value="">选择颜色</option>{filteredPaletteValues.map(color => <option key={color.id} value={color.id}>{color.code ?? color.name ?? color.id}</option>)}</select>{selectedColor && <span className="h-5 w-5 shrink-0 rounded border border-purple-300" style={{ backgroundColor: paletteMap.get(selectedColor)?.hex ?? '#CBD5E1' }} title="当前颜色" />}</div><div className="mt-2 flex flex-wrap items-center gap-1.5"><select value={replaceSource} onChange={event => setReplaceSource(event.target.value)} className="min-w-28 rounded-md border border-purple-200 bg-white px-2 py-1 text-[10px] font-bold text-purple-800"><option value="">选择要替换的颜色</option>{generatedStats.map(stat => <option key={stat.id} value={stat.id}>{stat.label}</option>)}</select><button type="button" onClick={() => { if (replaceSource && selectedColor) applyGridOperation(grid => replaceAssemblyGridColor(grid, replaceSource, selectedColor)); }} disabled={!replaceSource || !selectedColor} className="rounded-md border border-purple-200 bg-white px-2 py-1 text-[10px] font-bold text-purple-700 disabled:opacity-35">替换为当前色</button><button type="button" onClick={() => applyGridOperation(clearAssemblyGrid)} className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-white px-2 py-1 text-[10px] font-bold text-purple-700"><Trash2 className="h-3 w-3" />清空</button><button type="button" onClick={() => setGridHistory(current => current ? restoreAssemblyGridBaseline(current) : current)} className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-white px-2 py-1 text-[10px] font-bold text-purple-700"><RotateCcw className="h-3 w-3" />恢复生成结果</button></div></section><AssemblyGridEditor cells={displayedCells} paletteMap={paletteMap} tool={editorTool} selectedColor={selectedColor} onEdit={(x, y, color) => applyGridOperation(grid => paintAssemblyGridCell(grid, x, y, color))} onPick={color => { if (color) setSelectedColor(color); setEditorTool('paint'); }} /><section className="mt-3 shrink-0 rounded-xl border border-purple-100 bg-purple-50/50 p-2.5" aria-label="颜色编号与数量统计"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-xs font-black text-purple-950">颜色统计</h3><p className="text-[10px] font-bold text-purple-500">总颗数 <span className="text-purple-800">{generatedTotal}</span> · 使用色数 <span className="text-purple-800">{generatedStats.length}</span></p></div><div className="flex gap-1"><span className="rounded-md bg-purple-100 px-1.5 py-1 text-[10px] font-black text-purple-800">{generatedTotal} 颗</span><span className="rounded-md bg-purple-100 px-1.5 py-1 text-[10px] font-black text-purple-800">{generatedStats.length} 色</span></div></div>{generatedStats.length ? <div className="mt-2 grid max-h-40 gap-1.5 overflow-y-auto sm:grid-cols-2">{generatedStats.map(stat => <div key={stat.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-purple-100 bg-white px-2 py-1.5"><span className="h-4 w-4 shrink-0 rounded border border-purple-200" style={{ backgroundColor: stat.hex }} /><span className="min-w-0 flex-1 truncate text-[10px] font-bold text-purple-900">{stat.label}</span><span className="shrink-0 text-[10px] font-black text-purple-600">{stat.count}</span></div>)}</div> : <p className="mt-2 text-xs text-purple-500">当前图纸为空白网格，没有颜色编号。</p>}</section></> : <div className="mt-3 grid min-h-40 place-items-center rounded-xl border border-dashed border-purple-200 bg-purple-50/40 px-6 text-center lg:min-h-0 lg:flex-1"><div><Grid3X3 className="mx-auto h-8 w-8 text-purple-300" /><p className="mt-2 text-sm font-black text-purple-800">尚未生成图纸</p><p className="mt-1 text-xs text-purple-500">生成后将在这里显示二维网格。</p></div></div>}
        </section>

        <aside className="order-1 grid min-w-0 content-start gap-3 lg:order-2 lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-y-auto" aria-label="图纸控制侧栏">
          {structureSnapshot && !hasConfirmedStructure && <details className="rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 shadow-2xs" aria-label="推断草案详情"><summary className="cursor-pointer list-none text-xs font-black text-amber-950"><span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1"><span>推断草案</span><span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-800">可信度 {Math.round(structureSnapshot.confidence.score * 100)}%</span><span className="text-[9px] text-amber-800">已上传 {structureSnapshot.sourceViews.map(view => VIEWS.find(item => item.id === view)?.label ?? view).join('、')}</span></span><span className="mt-1 block text-[9px] font-bold text-amber-800">补充侧面图后可确认立体结构；当前仅保留二维网格编辑和参考导出。</span></summary><div className="mt-2 border-t border-amber-200 pt-2 text-[9px] text-amber-900"><div className="grid grid-cols-2 gap-1"><span className="rounded bg-white/80 px-1.5 py-1">尺寸 {structureSnapshot.dimensions.width} × {structureSnapshot.dimensions.height} × {structureSnapshot.dimensions.depth}</span><span className="rounded bg-white/80 px-1.5 py-1">缺少 {missingStructureViews.join('、') || '无'}</span></div>{structureSnapshot.conflicts.length > 0 && <div className="mt-1.5 grid gap-1">{structureSnapshot.conflicts.map((conflict, index) => <p key={`${conflict.code}-${index}`} className={`rounded px-1.5 py-1 font-bold ${conflict.severity === 'error' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100/70 text-amber-800'}`}>{conflict.message}</p>)}</div>}<p className="mt-1.5 leading-3.5">这是基于有限视图的推断，不显示体素预览、零件、卡槽、组装或组合方案。</p></div></details>}
          {hasConfirmedStructure && structureSnapshot && <section className="rounded-xl border p-2.5 shadow-2xs border-emerald-200 bg-emerald-50/60" aria-label="多视角结构摘要"><div className="flex items-start justify-between gap-2"><div><h2 className="flex items-center gap-1.5 text-xs font-black text-purple-950"><Layers3 className="h-3.5 w-3.5 text-purple-600" />多视角结构摘要</h2><p className="mt-0.5 text-[9px] leading-3.5 text-purple-700">已由正交视图共同约束结构；当前二维图仅用于编辑参考。</p></div><span className="shrink-0 rounded bg-emerald-100 px-1.5 py-1 text-[9px] font-black text-emerald-800">{structureSnapshot.confidence.level} · {Math.round(structureSnapshot.confidence.score * 100)}%</span></div><div className="mt-2 grid grid-cols-2 gap-1 text-[9px] font-bold text-purple-900"><span className="rounded bg-white/80 px-1.5 py-1">尺寸 {structureSnapshot.dimensions.width} × {structureSnapshot.dimensions.height} × {structureSnapshot.dimensions.depth}</span><span className="rounded bg-white/80 px-1.5 py-1">体素 {structureVoxelCount}</span><span className="rounded bg-white/80 px-1.5 py-1">视图 {structureSnapshot.sourceViews.map(view => VIEWS.find(item => item.id === view)?.label ?? view).join('、')}</span><span className="rounded bg-white/80 px-1.5 py-1">缺少 {missingStructureViews.join('、') || '无'}</span></div>{structureSnapshot.conflicts.length > 0 && <div className="mt-1.5 grid gap-1">{structureSnapshot.conflicts.map((conflict, index) => <p key={`${conflict.code}-${index}`} className={`rounded px-1.5 py-1 text-[9px] font-bold ${conflict.severity === 'error' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100/70 text-amber-800'}`}>{conflict.message}</p>)}</div>}<p className="mt-1.5 text-[9px] leading-3.5 text-purple-600">结构已进入组合零件规划：下方显示真实截面、卡槽和组装关系；旧二维图仅用于编辑参考。</p></section>}
          {hasConfirmedStructure && structureSnapshot && <section className={`rounded-xl border p-2.5 shadow-2xs ${assemblyPlan?.confidence.manufacturable ? 'border-emerald-200 bg-white' : 'border-amber-200 bg-amber-50/60'}`} aria-label="可制作组合方案">{assemblyPlanning.error ? <p className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] font-bold text-rose-700">组合方案生成失败：{assemblyPlanning.error}</p> : assemblyPlan ? <><div className="flex items-start justify-between gap-2"><div><h2 className="flex items-center gap-1.5 text-xs font-black text-purple-950"><ListChecks className="h-3.5 w-3.5 text-purple-600" />可制作组合方案</h2><p className="mt-0.5 text-[9px] leading-3.5 text-purple-600">{assemblyPlan.confidence.manufacturable ? '已生成可互锁的正交截面、卡槽与组装顺序。' : assemblyPlan.confidence.reason ?? '当前结构尚不可制作。'}</p></div><span className={`rounded px-1.5 py-1 text-[9px] font-black ${assemblyPlan.confidence.manufacturable ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{assemblyPlan.confidence.manufacturable ? '可制作' : '待补充'}</span></div>{assemblyPlan.confidence.manufacturable ? <><div className="mt-2 grid grid-cols-2 gap-1 text-[9px] font-bold text-purple-900"><span className="rounded bg-purple-50 px-1.5 py-1">零件 {assemblyPlan.parts.length}</span><span className="rounded bg-purple-50 px-1.5 py-1">连接 {assemblyPlan.connections.length}</span><span className="rounded bg-purple-50 px-1.5 py-1">总豆数 {assemblyPlan.totalBeans}</span><span className="rounded bg-purple-50 px-1.5 py-1">置信度 {Math.round(assemblyPlan.confidence.score * 100)}%</span></div><div className="mt-2"><p className="text-[10px] font-black text-purple-900">零件列表</p><div className="mt-1 grid max-h-44 gap-1 overflow-y-auto">{assemblyPlan.parts.map(part => <button key={part.id} type="button" onClick={() => setSelectedAssemblyPartId(part.id)} className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-[9px] font-bold ${selectedAssemblyPartId === part.id ? 'border-purple-400 bg-purple-100 text-purple-950' : 'border-purple-100 bg-white text-purple-700 hover:bg-purple-50'}`}><span className="min-w-0 truncate">{part.number} · {part.orientation.toUpperCase()} · {part.width}×{part.height}</span><span className="shrink-0">{part.beanCount} 颗 · {part.slots.length} 槽</span></button>)}</div></div><div className="mt-2"><p className="text-[10px] font-black text-purple-900">连接关系</p><div className="mt-1 grid max-h-36 gap-1 overflow-y-auto">{assemblyPlan.connections.map(connection => <div key={connection.id} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-900">{assemblyPlan.parts.find(part => part.id === connection.xyPartId)?.number} ↔ {assemblyPlan.parts.find(part => part.id === connection.zyPartId)?.number} · Y{connection.yStart + 1}–{connection.yEnd + 1} · 顶/底交叉插入</div>)}</div></div><div className="mt-2"><p className="text-[10px] font-black text-purple-900">组装步骤</p><ol className="mt-1 grid gap-1">{assemblyPlan.assemblySteps.map(step => <li key={step.number} className="rounded-md border border-emerald-100 bg-emerald-50/60 px-2 py-1 text-[9px] text-emerald-900"><b>{step.number}. {step.title}</b><span className="block text-emerald-700">{step.description}</span></li>)}</ol></div></> : <p className="mt-2 rounded-md border border-amber-200 bg-white/80 px-2 py-1.5 text-[9px] leading-3.5 text-amber-900">需要正面与侧面共同形成非空结构；请补充缺失视图或调整背景移除、裁剪和比例后重新生成。</p>}{assemblyPlan.warnings.length > 0 && <div className="mt-2 grid gap-1">{assemblyPlan.warnings.map(warning => <p key={warning} className="rounded-md bg-amber-100/70 px-2 py-1 text-[9px] font-bold text-amber-800">{warning}</p>)}</div>}<p className="mt-2 text-[9px] leading-3.5 text-purple-500">当前 SVG / PNG / 打印导出仍是二维编辑参考图，不是组合零件导出。</p></> : null}</section>}
          {isUploadedPartsMode && <section className="rounded-xl border border-sky-200/80 bg-sky-50/60 p-2 shadow-2xs" aria-label="视图二维编辑参考"><h2 className="flex items-center gap-1.5 text-xs font-black text-sky-950"><ListChecks className="h-3.5 w-3.5 text-sky-700" />视图二维编辑参考</h2><p className="mt-0.5 text-[9px] leading-3.5 text-sky-800/70">每项来自对应上传图片，可单独编辑；它们不是最终的立体组合零件。</p><div className="mt-1.5 grid max-h-56 gap-1 overflow-y-auto pr-0.5">{generatedParts.map(part => <button key={part.id} type="button" onClick={() => selectExamplePart(part)} className={`max-h-14 overflow-hidden rounded-md border p-1.5 text-left transition ${activeExamplePart?.id === part.id ? 'border-sky-400 bg-white shadow-sm' : 'border-sky-100 bg-white/60 hover:bg-white'}`}><div className="flex items-center gap-1.5"><div className="grid h-10 w-14 shrink-0 gap-px overflow-hidden rounded border border-sky-100 bg-sky-100 p-0.5" style={{ gridTemplateColumns: `repeat(${Math.min(part.width, 12)}, minmax(0, 1fr))` }}>{part.cells.flatMap((row, y) => row.map((colorId, x) => <span key={`${y}-${x}`} className="h-0.5 w-0.5" style={{ backgroundColor: colorId ? paletteMap.get(colorId)?.hex ?? '#E0F2FE' : '#FFFFFF' }} />))}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-1"><span className="truncate text-[10px] font-black text-sky-950">{part.partNumber} · {part.name}</span><span className="shrink-0 rounded bg-sky-100 px-1 py-0.5 text-[9px] font-black text-sky-800">{VIEWS.find(view => view.id === part.sourceView)?.label ?? '上传'}</span></div><p className="mt-0.5 text-[9px] font-bold text-sky-700">{part.width} × {part.height} · {part.colorStats.reduce((total, stat) => total + stat.count, 0)} 颗</p></div></div></button>)}</div><div className="mt-1.5 rounded-md border border-sky-100 bg-white/80 p-1.5"><p className="text-[10px] font-black text-sky-950">参考图总计 · {generatedPartsSummary.totalPartCount} 张 · {generatedPartsSummary.totalBeads} 颗</p><div className="mt-1 grid max-h-32 grid-cols-2 gap-1 overflow-y-auto">{generatedPartsSummary.colorStats.map(stat => <div key={stat.colorId} className="flex items-center justify-between gap-1 rounded bg-sky-50 px-1.5 py-1 text-[9px] font-bold text-sky-900"><span className="flex min-w-0 items-center gap-1 truncate"><span className="h-3 w-3 shrink-0 rounded border border-sky-200" style={{ backgroundColor: paletteMap.get(stat.colorId)?.hex ?? '#E0F2FE' }} />{paletteMap.get(stat.colorId)?.code ?? paletteMap.get(stat.colorId)?.name ?? stat.colorId}</span><span>{stat.count}</span></div>)}</div></div></section>}
          {exampleCase && <section className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-3 shadow-2xs" aria-label="拼豆相机零件清单"><h2 className="flex items-center gap-2 text-xs font-black text-emerald-950"><ListChecks className="h-3.5 w-3.5 text-emerald-700" />零件清单与分解图纸</h2><div className="mt-2 grid gap-1.5">{exampleCase.parts.map(part => <button key={part.id} type="button" onClick={() => selectExamplePart(part)} className={`rounded-lg border p-2 text-left transition ${activeExamplePart?.id === part.id ? 'border-emerald-400 bg-white shadow-sm' : 'border-emerald-100 bg-white/60 hover:bg-white'}`}><div className="flex items-start gap-2"><div className="grid shrink-0 gap-px rounded border border-emerald-100 bg-emerald-100 p-1" style={{ gridTemplateColumns: `repeat(${Math.min(part.width, 12)}, minmax(0, 1fr))` }}>{part.cells.flatMap((row, y) => row.map((colorId, x) => <span key={`${y}-${x}`} className="h-1 w-1" style={{ backgroundColor: colorId ? paletteMap.get(colorId)?.hex ?? '#D1FAE5' : '#FFFFFF' }} />))}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-1"><span className="truncate text-[10px] font-black text-emerald-950">{part.partNumber} · {part.name}</span><span className="shrink-0 rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-black text-emerald-800">×{part.quantity}</span></div><p className="mt-0.5 text-[9px] font-bold text-emerald-700">{part.width} × {part.height} · {part.colorStats.reduce((total, stat) => total + stat.count, 0)} 颗/件</p></div></div></button>)}</div><div className="mt-2 rounded-lg border border-emerald-100 bg-white/80 p-2"><p className="text-[10px] font-black text-emerald-950">总颜色统计 · {exampleCase.totalBeads} 颗</p><div className="mt-1.5 grid grid-cols-2 gap-1">{exampleCase.colorStats.map(stat => <div key={stat.colorId} className="flex items-center justify-between gap-1 rounded bg-emerald-50 px-1.5 py-1 text-[9px] font-bold text-emerald-900"><span className="flex min-w-0 items-center gap-1 truncate"><span className="h-3 w-3 shrink-0 rounded border border-emerald-200" style={{ backgroundColor: paletteMap.get(stat.colorId)?.hex ?? '#D1FAE5' }} />{paletteMap.get(stat.colorId)?.code ?? paletteMap.get(stat.colorId)?.name ?? stat.colorId}</span><span>{stat.count}</span></div>)}</div></div></section>}
          {exampleCase && <section className="rounded-xl border border-emerald-200/80 bg-white p-3 shadow-2xs" aria-label="拼豆相机组装步骤"><h2 className="flex items-center gap-2 text-xs font-black text-emerald-950"><ListChecks className="h-3.5 w-3.5 text-emerald-700" />组装步骤</h2><ol className="mt-2 grid gap-1.5">{exampleCase.steps.map(step => <li key={step.number} className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-2"><div className="flex gap-1.5"><span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-700 text-[9px] font-black text-white">{step.number}</span><div><p className="text-[10px] font-black text-emerald-950">{step.title}</p><p className="mt-0.5 text-[9px] leading-3.5 text-emerald-800/70">{step.description}</p></div></div></li>)}</ol><p className="mt-2 text-[9px] leading-3.5 text-emerald-700/70">{exampleCase.description}</p></section>}
          <section className="rounded-xl border border-purple-200/80 bg-white p-3 shadow-2xs"><h2 className="flex items-center gap-2 text-xs font-black text-purple-950"><Ruler className="h-3.5 w-3.5 text-purple-600" />图纸规格</h2><div className="mt-2 grid grid-cols-2 gap-1.5">{([['assembly', '立体组合'], ['instruction', '装配说明']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => { setDiagramType(id); setAssemblyProject(current => updateAssemblyProjectSettings(current, { diagramType: id })); invalidateGeneration(); }} className={`rounded-lg border px-2 py-1.5 text-[11px] font-bold ${diagramType === id ? 'border-purple-300 bg-purple-100/80 text-purple-900' : 'border-purple-200 text-purple-700 hover:bg-purple-50'}`}>{label}</button>)}</div><div className="mt-2 grid gap-1.5">{(Object.keys(SIZE_LABELS) as DiagramSize[]).map(size => <button key={size} type="button" onClick={() => { setDiagramSize(size); setAssemblyProject(current => updateAssemblyProjectSettings(current, { diagramSize: size })); invalidateGeneration(); }} className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-bold ${diagramSize === size ? 'border-purple-300 bg-purple-100/80 text-purple-900' : 'border-purple-200 text-purple-700 hover:bg-purple-50'}`}><span>{SIZE_LABELS[size]}</span>{diagramSize === size && <Check className="h-3 w-3" />}</button>)}</div></section>
          <section className="rounded-xl border border-purple-200/80 bg-white p-3 shadow-2xs" aria-label="生成图纸">
            <button type="button" onClick={() => void generateBlueprint()} disabled={isGenerating} className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-md bg-purple-600 px-3 py-2 text-[11px] font-black text-white shadow-sm hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"><WandSparkles className="h-3.5 w-3.5" />{isGenerating ? '生成中…' : generatedBlueprint ? '重新生成图纸' : '生成图纸'}</button>
          </section>
          <details className="rounded-xl border border-purple-200/80 bg-white p-3 shadow-2xs" aria-label="图片预处理">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-black text-purple-950"><WandSparkles className="h-3.5 w-3.5 text-purple-600" />图片预处理</summary>
            <div className="mt-2 rounded-lg border border-purple-100 bg-purple-50/50 p-2">
              <div className="grid gap-1.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center"><span className="text-[10px] font-black text-purple-900">适配方式</span><div className="grid grid-cols-2 gap-1 rounded-md border border-purple-200 bg-white p-0.5"><button type="button" onClick={() => updatePreprocessing({ fit: 'contain' })} className={`rounded px-1.5 py-1 text-[10px] font-bold ${preprocessing.fit === 'contain' ? 'bg-purple-100 text-purple-900' : 'text-purple-500'}`}>完整适配</button><button type="button" onClick={() => updatePreprocessing({ fit: 'cover' })} className={`rounded px-1.5 py-1 text-[10px] font-bold ${preprocessing.fit === 'cover' ? 'bg-purple-100 text-purple-900' : 'text-purple-500'}`}>铺满裁剪</button></div></div>
              <label className="mt-1.5 flex min-h-11 items-center justify-between gap-2 text-[10px] font-bold text-purple-700"><span>移除白色背景</span><input type="checkbox" checked={preprocessing.removeWhiteBackground} onChange={event => updatePreprocessing({ removeWhiteBackground: event.target.checked })} className="h-5 w-5 accent-purple-600" /></label>
              <label className="mt-1.5 flex items-center gap-2 text-[10px] font-bold text-purple-700"><span className="w-16 shrink-0">背景容差 {preprocessing.backgroundTolerance}</span><input type="range" min="0" max="80" value={preprocessing.backgroundTolerance} onChange={event => updatePreprocessing({ backgroundTolerance: Number(event.target.value) })} disabled={!preprocessing.removeWhiteBackground} className="min-w-0 flex-1 accent-purple-600 disabled:opacity-40" /></label>
              <label className="mt-1.5 flex items-center gap-2 text-[10px] font-bold text-purple-700"><span className="w-16 shrink-0">颜色数量</span><select value={preprocessing.colorLimit} onChange={event => updatePreprocessing({ colorLimit: Number(event.target.value) })} className="min-w-0 flex-1 rounded border border-purple-200 bg-white px-1.5 py-1 text-[10px] text-purple-900"><option value={0}>自动</option><option value={8}>8 色</option><option value={16}>16 色</option><option value={24}>24 色</option><option value={32}>32 色</option></select></label>
              <label className="mt-1.5 flex items-center gap-2 text-[10px] font-bold text-purple-700"><span className="w-16 shrink-0">量化强度 {preprocessing.quantizationStrength}</span><input type="range" min="0" max="100" value={preprocessing.quantizationStrength} onChange={event => updatePreprocessing({ quantizationStrength: Number(event.target.value) })} className="min-w-0 flex-1 accent-purple-600" /></label>
            </div>
          </details>
          <section className="rounded-xl border border-purple-200/80 bg-white p-3 shadow-2xs"><h2 className="flex items-center gap-2 text-xs font-black text-purple-950"><Layers3 className="h-3.5 w-3.5 text-purple-600" />结构资料</h2><div className="mt-2 grid gap-1.5">{TEMPLATE_OPTIONS.map(template => <button key={template.id} type="button" onClick={() => { setTemplateId(template.id); setAssemblyProject(current => updateAssemblyProjectSettings(current, { templateId: template.id })); invalidateGeneration(); }} className={`w-full rounded-lg border px-2.5 py-1.5 text-left ${templateId === template.id ? 'border-purple-300 bg-purple-100/80' : 'border-purple-200 hover:bg-purple-50'}`}><span className="block text-[11px] font-black text-purple-950">{template.label}</span><span className="mt-0.5 block text-[10px] leading-3.5 text-purple-500">{template.description}</span></button>)}</div><label className="mt-2 block"><span className="text-[11px] font-black text-purple-900">手动结构资料</span><textarea value={manualNotes} onChange={event => setManualNotes(event.target.value)} maxLength={500} rows={2} placeholder="层数、方向、备注…" className="mt-1 w-full resize-none rounded-lg border border-purple-200 px-2.5 py-1.5 text-[11px] text-purple-950 outline-none placeholder:text-purple-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200" /></label></section>
          <section className="rounded-xl border border-purple-200/80 bg-white p-3 shadow-2xs">
            <h2 className="flex items-center gap-2 text-xs font-black text-purple-950"><FileDown className="h-3.5 w-3.5 text-purple-600" />操作与导出</h2>
            <input ref={projectImportRef} type="file" accept="application/json,.json" className="sr-only" onChange={event => { void handleProjectImport(event.target.files?.[0]); event.currentTarget.value = ''; }} />
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button type="button" onClick={handleProjectDownload} disabled={isExporting} className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-md border border-purple-200 bg-white px-2 py-1 text-[10px] font-black text-purple-700 shadow-sm hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-45"><FileDown className="h-3.5 w-3.5" />项目 JSON</button>
              <button type="button" onClick={() => projectImportRef.current?.click()} disabled={isExporting} className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-md border border-purple-200 bg-white px-2 py-1 text-[10px] font-black text-purple-700 shadow-sm hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-45"><FileUp className="h-3.5 w-3.5" />导入项目</button>
              <button type="button" onClick={handleClearDraft} className="col-span-2 inline-flex h-8 w-full items-center justify-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-700 hover:bg-rose-100"><Trash2 className="h-3.5 w-3.5" />清除草稿</button>
            </div>
            {hasConfirmedStructure && <div className="mt-2.5 rounded-lg border border-emerald-200 bg-emerald-50/70 p-2" aria-label="组合方案导出">
              <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-black text-emerald-950">组合方案导出</p><span className={`text-[9px] font-bold ${assemblyPlan?.confidence.manufacturable ? 'text-emerald-700' : 'text-amber-700'}`}>{assemblyPlan?.confidence.manufacturable ? '可制作' : '需先生成可制作方案'}</span></div>
              <div className="mt-1.5 grid grid-cols-3 gap-1">
                <button type="button" onClick={handlePlanSvgExport} disabled={isExporting || !assemblyPlan?.confidence.manufacturable} className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-emerald-700 px-1 text-[9px] font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-3.5 w-3.5" />方案 SVG</button>
                <button type="button" onClick={handlePlanPngExport} disabled={isExporting || !assemblyPlan?.confidence.manufacturable} className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-emerald-700 px-1 text-[9px] font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-3.5 w-3.5" />{isExporting ? '处理中' : '方案 PNG'}</button>
                <button type="button" onClick={handlePlanPrintExport} disabled={isExporting || !assemblyPlan?.confidence.manufacturable} className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-emerald-700 px-1 text-[9px] font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"><Printer className="h-3.5 w-3.5" />打印 / PDF</button>
              </div>
            </div>}
            {isUploadedPartsMode ? <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50/70 p-2" aria-label="正交图纸导出">
              <p className="text-[9px] font-black text-sky-800">当前正交视图 · {VIEWS.find(view => view.id === activeExamplePart?.sourceView)?.label ?? '正面'}</p>
              <p className="mt-0.5 text-[9px] leading-3.5 text-sky-700">仅导出当前上传视图的网格与色号；不包含组合方案、卡槽或零件边界。</p>
              <div className="mt-1 grid grid-cols-3 gap-1">
                <button type="button" onClick={handleReferenceSvgExport} disabled={isExporting} className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-sky-200 bg-white px-1 text-[9px] font-bold text-sky-700 disabled:opacity-45"><Download className="h-3 w-3" />SVG</button>
                <button type="button" onClick={handleReferencePngExport} disabled={isExporting} className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-sky-200 bg-white px-1 text-[9px] font-bold text-sky-700 disabled:opacity-45"><Download className="h-3 w-3" />PNG</button>
                <button type="button" onClick={handleReferencePrintExport} disabled={isExporting} className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-sky-200 bg-white px-1 text-[9px] font-bold text-sky-700 disabled:opacity-45"><Printer className="h-3 w-3" />打印</button>
              </div>
              <p className="mt-2 text-[9px] font-black text-sky-800">全部视图图集 · {uploadedOrthographicParts.length} 张</p>
              <div className="mt-1 grid grid-cols-3 gap-1">
                <button type="button" onClick={handleOrthographicViewsSvgExport} disabled={isExporting} className="inline-flex h-7 items-center justify-center gap-1 rounded-md bg-sky-700 px-1 text-[9px] font-black text-white hover:bg-sky-800 disabled:opacity-45"><Download className="h-3 w-3" />SVG</button>
                <button type="button" onClick={handleOrthographicViewsPngExport} disabled={isExporting} className="inline-flex h-7 items-center justify-center gap-1 rounded-md bg-sky-700 px-1 text-[9px] font-black text-white hover:bg-sky-800 disabled:opacity-45"><Download className="h-3 w-3" />PNG</button>
                <button type="button" onClick={handleOrthographicViewsPrintExport} disabled={isExporting} className="inline-flex h-7 items-center justify-center gap-1 rounded-md bg-sky-700 px-1 text-[9px] font-black text-white hover:bg-sky-800 disabled:opacity-45"><Printer className="h-3 w-3" />打印</button>
              </div>
            </div> : generatedBlueprint && <div className="mt-2 rounded-lg border border-purple-100 bg-purple-50/50 p-2" aria-label="二维参考导出">
              <p className="text-[9px] font-black text-purple-700">二维参考导出（非组合方案）</p>
              <div className="mt-1 grid grid-cols-3 gap-1">
                <button type="button" onClick={handleReferenceSvgExport} disabled={isExporting} className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-purple-200 bg-white px-1 text-[9px] font-bold text-purple-700 disabled:opacity-45"><Download className="h-3 w-3" />SVG</button>
                <button type="button" onClick={handleReferencePngExport} disabled={isExporting} className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-purple-200 bg-white px-1 text-[9px] font-bold text-purple-700 disabled:opacity-45"><Download className="h-3 w-3" />PNG</button>
                <button type="button" onClick={handleReferencePrintExport} disabled={isExporting} className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-purple-200 bg-white px-1 text-[9px] font-bold text-purple-700 disabled:opacity-45"><Printer className="h-3 w-3" />打印</button>
              </div>
            </div>}
            {generationError && <p role="alert" className="mt-1.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] font-bold text-rose-700">{generationError}</p>}
          </section>
        </aside>
      </section>
      <p className="px-1 text-[10px] leading-4 text-purple-500">已上传的正面、侧面、背面和顶部会先转换为网格，再共同融合为保守的体素结构。正面加侧面可生成整体等轴结构；补充顶部或背面可进一步约束形状。单一视图仅生成推断草案，不会伪造可制作零件。二维网格仅保留为编辑参考，满足结构条件时会从体素模型生成可拆分截面、卡槽和组装关系。OBJ / GLB / GLTF / STL 可直接生成四向投影；FBX / BLEND 请先转换格式。项目导入可恢复结构快照、网格和设置，源图片和模型需重新选择后才能重新预处理。{draftMessage ? ` ${draftMessage}` : ''}</p>
    </div></main>
  );
}
