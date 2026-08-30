export const ASSEMBLY_PROJECT_SCHEMA_VERSION = 1 as const;

export type AssemblyViewId = 'front' | 'side' | 'back' | 'top';
export type AssemblyDiagramType = 'assembly' | 'instruction';
export type AssemblyDiagramSize = 'small' | 'medium' | 'large';
export type AssemblyTemplateId = 'tower' | 'arch' | 'wall';
export type AssemblyGridCell = string | null;

export interface AssemblyPreprocessingSettings {
  fit: 'contain' | 'cover';
  removeWhiteBackground: boolean;
  backgroundTolerance: number;
  colorLimit: number;
  quantizationStrength: number;
}

export const DEFAULT_ASSEMBLY_PREPROCESSING: AssemblyPreprocessingSettings = {
  fit: 'contain',
  removeWhiteBackground: false,
  backgroundTolerance: 20,
  colorLimit: 0,
  quantizationStrength: 28,
};

export interface AssemblyFileMetadata {
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
}

export interface AssemblyProjectInputs {
  views: Record<AssemblyViewId, AssemblyFileMetadata | null>;
  model: AssemblyFileMetadata | null;
  manualNotes: string;
}

export interface AssemblyGenerationSettings {
  diagramType: AssemblyDiagramType;
  diagramSize: AssemblyDiagramSize;
  templateId: AssemblyTemplateId;
  source: 'image' | 'template';
  preprocessing: AssemblyPreprocessingSettings;
}

export interface AssemblyGenerationDiagnostics {
  pipeline: string | null;
  confidence: number | null;
  effectiveColorCount: number | null;
  backgroundPixelsRemoved: number | null;
}

export interface AssemblyGridResult {
  width: number;
  height: number;
  cells: AssemblyGridCell[][];
  diagnostics: AssemblyGenerationDiagnostics;
}

export interface AssemblyStructureDimensions {
  width: number;
  height: number;
  depth: number;
}

export interface AssemblyStructureConflictSnapshot {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  views?: AssemblyViewId[];
}

export interface AssemblyStructureSnapshot {
  dimensions: AssemblyStructureDimensions;
  /** Indexed as occupancy[z][y][x]. This is the persisted structural core. */
  occupancy: boolean[][][];
  sourceViews: AssemblyViewId[];
  confidence: {
    score: number;
    level: 'high' | 'medium' | 'low' | 'none';
    mode: 'orthographic-structure' | 'inferred-draft';
    structureReady: boolean;
  };
  conflicts: AssemblyStructureConflictSnapshot[];
  diagnostics: {
    suppliedViews: AssemblyViewId[];
    candidateVoxels: number;
    occupiedBeforeCleanup: number;
    occupiedAfterCleanup: number;
    removedIsolatedVoxels: number;
    connectedComponentCount: number;
    normalisedViews: Partial<Record<AssemblyViewId, { width: number; height: number; occupiedCells: number }>>;
  };
}

export interface AssemblyProjectVersionMetadata {
  revision: number;
  createdAt: string;
  updatedAt: string;
  lastGeneratedAt: string | null;
}

export interface AssemblyProject {
  schemaVersion: typeof ASSEMBLY_PROJECT_SCHEMA_VERSION;
  id: string;
  inputs: AssemblyProjectInputs;
  settings: AssemblyGenerationSettings;
  result: AssemblyGridResult | null;
  /** Optional for backwards compatibility with schema-v1 drafts created before structural fusion. */
  structure: AssemblyStructureSnapshot | null;
  version: AssemblyProjectVersionMetadata;
}

type FileLike = Pick<File, 'name' | 'type' | 'size' | 'lastModified'>;
type DraftOptions = { id?: string; now?: string };
type InputMetadataPatch = Partial<AssemblyProjectInputs>;

const VIEW_IDS: AssemblyViewId[] = ['front', 'side', 'back', 'top'];
const DIAGRAM_TYPES: AssemblyDiagramType[] = ['assembly', 'instruction'];
const DIAGRAM_SIZES: AssemblyDiagramSize[] = ['small', 'medium', 'large'];
const TEMPLATE_IDS: AssemblyTemplateId[] = ['tower', 'arch', 'wall'];
const MAX_FILE_NAME_LENGTH = 255;
const MAX_MANUAL_NOTES_LENGTH = 500;
const MAX_GRID_EDGE = 512;
const MAX_STRUCTURE_EDGE = 64;
const MAX_STRUCTURE_VOXELS = 128_000;
const MAX_STRUCTURE_CONFLICTS = 64;

function nowIso(): string { return new Date().toISOString(); }
function newProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `assembly-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isSafeIntegerValue(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value); }
function isStringIn<T extends string>(value: unknown, values: readonly T[]): value is T { return typeof value === 'string' && values.includes(value as T); }
function isSafeIsoDate(value: unknown): value is string { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function cloneCells(cells: AssemblyGridCell[][]): AssemblyGridCell[][] { return cells.map(row => [...row]); }
function nextVersion(project: AssemblyProject, now: string, lastGeneratedAt = project.version.lastGeneratedAt): AssemblyProjectVersionMetadata {
  return { ...project.version, revision: project.version.revision + 1, updatedAt: now, lastGeneratedAt };
}
function normaliseFileMetadata(value: unknown): AssemblyFileMetadata | null {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.mimeType !== 'string' || !isSafeIntegerValue(value.size) || !isSafeIntegerValue(value.lastModified)) return null;
  if (value.name.length > MAX_FILE_NAME_LENGTH || value.size < 0 || value.lastModified < 0) return null;
  return { name: value.name, mimeType: value.mimeType, size: value.size, lastModified: value.lastModified };
}
function normaliseDiagnostics(value: unknown): AssemblyGenerationDiagnostics {
  const source = isRecord(value) ? value : {};
  const numberOrNull = (candidate: unknown) => typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
  return {
    pipeline: typeof source.pipeline === 'string' && source.pipeline.length <= 64 ? source.pipeline : null,
    confidence: numberOrNull(source.confidence),
    effectiveColorCount: numberOrNull(source.effectiveColorCount),
    backgroundPixelsRemoved: numberOrNull(source.backgroundPixelsRemoved),
  };
}
function normalisePreprocessing(value: unknown): AssemblyPreprocessingSettings | null {
  if (value === undefined) return { ...DEFAULT_ASSEMBLY_PREPROCESSING };
  if (!isRecord(value) || !isStringIn(value.fit, ['contain', 'cover'] as const) || typeof value.removeWhiteBackground !== 'boolean' || !isSafeIntegerValue(value.backgroundTolerance) || !isSafeIntegerValue(value.colorLimit) || !isSafeIntegerValue(value.quantizationStrength)) return null;
  if (value.backgroundTolerance < 0 || value.backgroundTolerance > 255 || value.colorLimit < 0 || value.colorLimit > 256 || value.quantizationStrength < 0 || value.quantizationStrength > 100) return null;
  return { fit: value.fit, removeWhiteBackground: value.removeWhiteBackground, backgroundTolerance: value.backgroundTolerance, colorLimit: value.colorLimit, quantizationStrength: value.quantizationStrength };
}
function normaliseGridResult(value: unknown): AssemblyGridResult | null {
  if (!isRecord(value) || !isSafeIntegerValue(value.width) || !isSafeIntegerValue(value.height) || !Array.isArray(value.cells)) return null;
  if (value.width < 1 || value.height < 1 || value.width > MAX_GRID_EDGE || value.height > MAX_GRID_EDGE || value.cells.length !== value.height) return null;
  const cells: AssemblyGridCell[][] = [];
  for (const row of value.cells) {
    if (!Array.isArray(row) || row.length !== value.width) return null;
    const safeRow: AssemblyGridCell[] = [];
    for (const cell of row) {
      if (cell !== null && (typeof cell !== 'string' || cell.length > 128)) return null;
      safeRow.push(cell);
    }
    cells.push(safeRow);
  }
  return { width: value.width, height: value.height, cells, diagnostics: normaliseDiagnostics(value.diagnostics) };
}
function normaliseViewIds(value: unknown, requireAtLeastOne = true): AssemblyViewId[] | null {
  if (!Array.isArray(value) || (requireAtLeastOne && value.length === 0) || value.length > VIEW_IDS.length) return null;
  const ids: AssemblyViewId[] = [];
  for (const candidate of value) {
    if (!isStringIn(candidate, VIEW_IDS) || ids.includes(candidate)) return null;
    ids.push(candidate);
  }
  return ids;
}
function normaliseStructureSnapshot(value: unknown): AssemblyStructureSnapshot | null {
  if (!isRecord(value) || !isRecord(value.dimensions) || !Array.isArray(value.occupancy) || !isRecord(value.confidence) || !Array.isArray(value.conflicts) || !isRecord(value.diagnostics)) return null;
  const dimensions = value.dimensions;
  if (!isSafeIntegerValue(dimensions.width) || !isSafeIntegerValue(dimensions.height) || !isSafeIntegerValue(dimensions.depth) || dimensions.width < 1 || dimensions.height < 1 || dimensions.depth < 1 || dimensions.width > MAX_STRUCTURE_EDGE || dimensions.height > MAX_STRUCTURE_EDGE || dimensions.depth > MAX_STRUCTURE_EDGE) return null;
  const volume = dimensions.width * dimensions.height * dimensions.depth;
  if (!Number.isSafeInteger(volume) || volume > MAX_STRUCTURE_VOXELS || value.occupancy.length !== dimensions.depth) return null;
  const occupancy: boolean[][][] = [];
  for (const depth of value.occupancy) {
    if (!Array.isArray(depth) || depth.length !== dimensions.height) return null;
    const safeDepth: boolean[][] = [];
    for (const row of depth) {
      if (!Array.isArray(row) || row.length !== dimensions.width || row.some(cell => typeof cell !== 'boolean')) return null;
      safeDepth.push([...row] as boolean[]);
    }
    occupancy.push(safeDepth);
  }
  const sourceViews = normaliseViewIds(value.sourceViews);
  const confidence = value.confidence;
  if (!sourceViews || typeof confidence.score !== 'number' || !Number.isFinite(confidence.score) || confidence.score < 0 || confidence.score > 1 || !isStringIn(confidence.level, ['high', 'medium', 'low', 'none'] as const) || !isStringIn(confidence.mode, ['orthographic-structure', 'inferred-draft'] as const) || typeof confidence.structureReady !== 'boolean') return null;
  if (value.conflicts.length > MAX_STRUCTURE_CONFLICTS) return null;
  const conflicts: AssemblyStructureConflictSnapshot[] = [];
  for (const conflict of value.conflicts) {
    if (!isRecord(conflict) || typeof conflict.code !== 'string' || conflict.code.length === 0 || conflict.code.length > 64 || !isStringIn(conflict.severity, ['warning', 'error'] as const) || typeof conflict.message !== 'string' || conflict.message.length > 500) return null;
    const views = conflict.views === undefined ? undefined : normaliseViewIds(conflict.views, false);
    if (conflict.views !== undefined && views === null) return null;
    conflicts.push({ code: conflict.code, severity: conflict.severity, message: conflict.message, ...(views?.length ? { views } : {}) });
  }
  const diagnostics = value.diagnostics;
  const suppliedViews = normaliseViewIds(diagnostics.suppliedViews);
  const diagnosticNumbers = ['candidateVoxels', 'occupiedBeforeCleanup', 'occupiedAfterCleanup', 'removedIsolatedVoxels', 'connectedComponentCount'] as const;
  if (!suppliedViews || !isRecord(diagnostics.normalisedViews)) return null;
  const safeDiagnostics = {} as Pick<AssemblyStructureSnapshot['diagnostics'], typeof diagnosticNumbers[number]>;
  for (const key of diagnosticNumbers) {
    const candidate = diagnostics[key];
    if (!isSafeIntegerValue(candidate) || candidate < 0 || candidate > MAX_STRUCTURE_VOXELS) return null;
    safeDiagnostics[key] = candidate;
  }
  const normalisedViews: AssemblyStructureSnapshot['diagnostics']['normalisedViews'] = {};
  for (const view of VIEW_IDS) {
    const candidate = diagnostics.normalisedViews[view];
    if (candidate === undefined) continue;
    if (!isRecord(candidate) || !isSafeIntegerValue(candidate.width) || !isSafeIntegerValue(candidate.height) || !isSafeIntegerValue(candidate.occupiedCells) || candidate.width < 1 || candidate.height < 1 || candidate.width > MAX_STRUCTURE_EDGE || candidate.height > MAX_STRUCTURE_EDGE || candidate.occupiedCells < 0 || candidate.occupiedCells > MAX_STRUCTURE_VOXELS) return null;
    normalisedViews[view] = { width: candidate.width, height: candidate.height, occupiedCells: candidate.occupiedCells };
  }
  return {
    dimensions: { width: dimensions.width, height: dimensions.height, depth: dimensions.depth },
    occupancy,
    sourceViews,
    confidence: { score: confidence.score, level: confidence.level, mode: confidence.mode, structureReady: confidence.structureReady },
    conflicts,
    diagnostics: { suppliedViews, ...safeDiagnostics, normalisedViews },
  };
}

export function fileToAssemblyMetadata(file: FileLike | null | undefined): AssemblyFileMetadata | null {
  if (!file || file.name.length > MAX_FILE_NAME_LENGTH || !Number.isFinite(file.size) || file.size < 0 || !Number.isFinite(file.lastModified) || file.lastModified < 0) return null;
  return { name: file.name, mimeType: file.type, size: Math.trunc(file.size), lastModified: Math.trunc(file.lastModified) };
}

export function createAssemblyProjectDraft(options: DraftOptions = {}): AssemblyProject {
  const now = options.now ?? nowIso();
  return {
    schemaVersion: ASSEMBLY_PROJECT_SCHEMA_VERSION,
    id: options.id ?? newProjectId(),
    inputs: { views: { front: null, side: null, back: null, top: null }, model: null, manualNotes: '' },
    settings: { diagramType: 'assembly', diagramSize: 'medium', templateId: 'tower', source: 'template', preprocessing: { ...DEFAULT_ASSEMBLY_PREPROCESSING } },
    result: null,
    structure: null,
    version: { revision: 0, createdAt: now, updatedAt: now, lastGeneratedAt: null },
  };
}

export function updateAssemblyProjectInputs(project: AssemblyProject, patch: InputMetadataPatch, now = nowIso()): AssemblyProject {
  const views = { ...project.inputs.views };
  if (patch.views) for (const view of VIEW_IDS) if (view in patch.views) views[view] = patch.views[view] === null ? null : normaliseFileMetadata(patch.views[view]);
  return {
    ...project,
    inputs: { views, model: patch.model === undefined ? project.inputs.model : patch.model === null ? null : normaliseFileMetadata(patch.model), manualNotes: patch.manualNotes === undefined ? project.inputs.manualNotes : patch.manualNotes.slice(0, MAX_MANUAL_NOTES_LENGTH) },
    version: nextVersion(project, now),
  };
}

export function updateAssemblyProjectSettings(project: AssemblyProject, patch: Partial<AssemblyGenerationSettings>, now = nowIso()): AssemblyProject {
  return { ...project, settings: { ...project.settings, ...patch }, version: nextVersion(project, now) };
}

export function saveAssemblyGenerationResult(project: AssemblyProject, result: AssemblyGridResult, settings: AssemblyGenerationSettings, now = nowIso()): AssemblyProject {
  const safeResult = normaliseGridResult(result);
  if (!safeResult) throw new Error('Invalid assembly grid result');
  return { ...project, settings: { ...settings }, result: { ...safeResult, cells: cloneCells(safeResult.cells) }, version: nextVersion(project, now, now) };
}

export function updateAssemblyProjectStructure(project: AssemblyProject, structure: AssemblyStructureSnapshot | null, now = nowIso()): AssemblyProject {
  const safeStructure = structure === null ? null : normaliseStructureSnapshot(structure);
  if (structure !== null && !safeStructure) throw new Error('Invalid assembly structure snapshot');
  return { ...project, structure: safeStructure, version: nextVersion(project, now) };
}

export function serializeAssemblyProject(project: AssemblyProject): string {
  const safeProject = deserializeAssemblyProject(JSON.stringify(project));
  if (!safeProject) throw new Error('Invalid assembly project');
  return JSON.stringify(safeProject);
}

export function deserializeAssemblyProject(serialized: string): AssemblyProject | null {
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { return null; }
  if (!isRecord(value) || value.schemaVersion !== ASSEMBLY_PROJECT_SCHEMA_VERSION || !isRecord(value.inputs) || !isRecord(value.settings) || !isRecord(value.version)) return null;
  const id = value.id;
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) return null;
  const inputViews = isRecord(value.inputs.views) ? value.inputs.views : null;
  const revision = value.version.revision;
  const createdAt = value.version.createdAt;
  const updatedAt = value.version.updatedAt;
  const lastGeneratedAt = value.version.lastGeneratedAt;
  const preprocessing = normalisePreprocessing(value.settings.preprocessing);
  if (!inputViews || !isStringIn(value.settings.diagramType, DIAGRAM_TYPES) || !isStringIn(value.settings.diagramSize, DIAGRAM_SIZES) || !isStringIn(value.settings.templateId, TEMPLATE_IDS) || !isStringIn(value.settings.source, ['image', 'template'] as const) || !preprocessing || !isSafeIntegerValue(revision) || revision < 0 || !isSafeIsoDate(createdAt) || !isSafeIsoDate(updatedAt)) return null;
  let safeLastGeneratedAt: string | null = null;
  if (lastGeneratedAt !== null) {
    if (!isSafeIsoDate(lastGeneratedAt)) return null;
    safeLastGeneratedAt = lastGeneratedAt;
  }
  const views = {} as Record<AssemblyViewId, AssemblyFileMetadata | null>;
  for (const view of VIEW_IDS) {
    const metadata = inputViews[view];
    if (metadata !== null && normaliseFileMetadata(metadata) === null) return null;
    views[view] = metadata === null ? null : normaliseFileMetadata(metadata);
  }
  if (value.inputs.model !== null && normaliseFileMetadata(value.inputs.model) === null) return null;
  if (typeof value.inputs.manualNotes !== 'string' || value.inputs.manualNotes.length > MAX_MANUAL_NOTES_LENGTH) return null;
  const result = value.result === null ? null : normaliseGridResult(value.result);
  if (value.result !== null && result === null) return null;
  const structure = value.structure === undefined || value.structure === null ? null : normaliseStructureSnapshot(value.structure);
  if (value.structure !== undefined && value.structure !== null && structure === null) return null;
  return {
    schemaVersion: ASSEMBLY_PROJECT_SCHEMA_VERSION,
    id,
    inputs: { views, model: value.inputs.model === null ? null : normaliseFileMetadata(value.inputs.model), manualNotes: value.inputs.manualNotes },
    settings: { diagramType: value.settings.diagramType, diagramSize: value.settings.diagramSize, templateId: value.settings.templateId, source: value.settings.source, preprocessing },
    result,
    structure,
    version: { revision, createdAt, updatedAt, lastGeneratedAt: safeLastGeneratedAt },
  };
}
