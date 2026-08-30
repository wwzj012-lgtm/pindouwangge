export type AssemblyViewId = 'front' | 'side' | 'back' | 'top';

/**
 * `true` means an occupied cell with no reliable colour. A non-empty string
 * means an occupied cell whose colour was observed in the supplied view.
 */
export type AssemblyViewCell = boolean | string | null | undefined;
export type AssemblyViewGrid = ReadonlyArray<ReadonlyArray<AssemblyViewCell>>;

export interface AssemblyViewInput {
  grid: AssemblyViewGrid;
}

export interface AssemblyViewCalibration {
  /** Mirror after the view has been normalised to its target orthographic plane. */
  mirrorX?: boolean;
  mirrorY?: boolean;
  /** Target-cell offsets. Positive values move the source right/down. */
  offsetX?: number;
  offsetY?: number;
}

export interface AssemblyStructureDimensions {
  width: number;
  height: number;
  depth: number;
}

export interface AssemblyStructureLimits {
  maxDimension?: number;
  maxVoxels?: number;
}

export interface AssemblyStructureCalibration {
  /**
   * Optional canonical dimensions. Views are nearest-neighbour normalised to
   * these dimensions after their offset/mirroring calibration is applied.
   */
  targetDimensions?: Partial<AssemblyStructureDimensions>;
  views?: Partial<Record<AssemblyViewId, AssemblyViewCalibration>>;
  limits?: AssemblyStructureLimits;
}

export interface AssemblyStructureInput {
  front?: AssemblyViewInput;
  side?: AssemblyViewInput;
  back?: AssemblyViewInput;
  top?: AssemblyViewInput;
}

export type AssemblyStructureMode = 'orthographic-structure' | 'inferred-draft';
export type AssemblyConfidenceLevel = 'high' | 'medium' | 'low' | 'none';
export type AssemblyConflictSeverity = 'warning' | 'error';

export interface AssemblyStructureConflict {
  code: 'insufficient-views' | 'empty-view' | 'empty-intersection' | 'disconnected-geometry' | 'normalised-view';
  severity: AssemblyConflictSeverity;
  message: string;
  views?: AssemblyViewId[];
}

export interface AssemblyVoxelColour {
  /** Null deliberately means that no uploaded view observed a colour for this exposed voxel. */
  color: string | null;
  sourceView: AssemblyViewId | null;
  status: 'observed-surface' | 'unknown';
  observedFaces: Partial<Record<AssemblyViewId, string | null>>;
}

export interface AssemblyStructureConfidence {
  score: number;
  level: AssemblyConfidenceLevel;
  mode: AssemblyStructureMode;
  /** Front + side are the minimum required to create a connected structural proposal. */
  structureReady: boolean;
}

export interface AssemblyStructureDiagnostics {
  suppliedViews: AssemblyViewId[];
  candidateVoxels: number;
  occupiedBeforeCleanup: number;
  occupiedAfterCleanup: number;
  removedIsolatedVoxels: number;
  connectedComponentCount: number;
  normalisedViews: Partial<Record<AssemblyViewId, { width: number; height: number; occupiedCells: number }>>;
}

export interface VoxelModel {
  dimensions: AssemblyStructureDimensions;
  /** Indexed as occupancy[z][y][x]. */
  occupancy: boolean[][][];
  /** Indexed exactly like occupancy. Empty voxels are null. */
  surfaceColors: Array<Array<Array<AssemblyVoxelColour | null>>>;
  sourceViews: AssemblyViewId[];
  confidence: AssemblyStructureConfidence;
  conflicts: AssemblyStructureConflict[];
  diagnostics: AssemblyStructureDiagnostics;
}

const DEFAULT_MAX_DIMENSION = 64;
const DEFAULT_MAX_VOXELS = 128_000;
const VIEW_ORDER: AssemblyViewId[] = ['front', 'side', 'back', 'top'];
const COLOR_PRIORITY: AssemblyViewId[] = ['front', 'top', 'side', 'back'];

interface NormalisedView {
  id: AssemblyViewId;
  width: number;
  height: number;
  cells: Array<Array<AssemblyViewCell>>;
  occupiedCells: number;
}

interface ComponentResult {
  componentCount: number;
  retained: boolean[][][];
  removed: number;
}

export class AssemblyStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssemblyStructureError';
  }
}

function isOccupied(cell: AssemblyViewCell): boolean {
  return cell === true || (typeof cell === 'string' && cell.trim().length > 0);
}

function gridDimensions(grid: AssemblyViewGrid): { width: number; height: number } {
  const height = grid.length;
  const width = grid.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  return { width, height };
}

function readGridCell(grid: AssemblyViewGrid, x: number, y: number): AssemblyViewCell {
  return grid[y]?.[x] ?? null;
}

function viewPlaneDimensions(view: AssemblyViewId, grid: AssemblyViewGrid): Partial<AssemblyStructureDimensions> {
  const { width, height } = gridDimensions(grid);
  if (view === 'front' || view === 'back') return { width, height };
  if (view === 'side') return { depth: width, height };
  return { width, depth: height };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value! : fallback;
}

function resolveDimensions(input: AssemblyStructureInput, calibration: AssemblyStructureCalibration): AssemblyStructureDimensions {
  const inferred: AssemblyStructureDimensions = { width: 1, height: 1, depth: 1 };
  for (const view of VIEW_ORDER) {
    const supplied = input[view];
    if (!supplied) continue;
    const dimensions = viewPlaneDimensions(view, supplied.grid);
    if (dimensions.width) inferred.width = Math.max(inferred.width, dimensions.width);
    if (dimensions.height) inferred.height = Math.max(inferred.height, dimensions.height);
    if (dimensions.depth) inferred.depth = Math.max(inferred.depth, dimensions.depth);
  }
  const target = calibration.targetDimensions;
  return {
    width: positiveInteger(target?.width, inferred.width),
    height: positiveInteger(target?.height, inferred.height),
    depth: positiveInteger(target?.depth, inferred.depth),
  };
}

function verifyLimits(dimensions: AssemblyStructureDimensions, limits: AssemblyStructureLimits | undefined): void {
  const maxDimension = positiveInteger(limits?.maxDimension, DEFAULT_MAX_DIMENSION);
  const maxVoxels = positiveInteger(limits?.maxVoxels, DEFAULT_MAX_VOXELS);
  if (dimensions.width > maxDimension || dimensions.height > maxDimension || dimensions.depth > maxDimension) {
    throw new AssemblyStructureError(`结构尺寸超过单轴上限 ${maxDimension}`);
  }
  const volume = dimensions.width * dimensions.height * dimensions.depth;
  if (!Number.isSafeInteger(volume) || volume > maxVoxels) {
    throw new AssemblyStructureError(`结构体素数量超过上限 ${maxVoxels}`);
  }
}

function targetPlaneDimensions(view: AssemblyViewId, dimensions: AssemblyStructureDimensions): { width: number; height: number } {
  if (view === 'front' || view === 'back') return { width: dimensions.width, height: dimensions.height };
  if (view === 'side') return { width: dimensions.depth, height: dimensions.height };
  return { width: dimensions.width, height: dimensions.depth };
}

function normaliseView(id: AssemblyViewId, input: AssemblyViewInput, dimensions: AssemblyStructureDimensions, calibration: AssemblyViewCalibration | undefined): NormalisedView {
  const source = input.grid;
  const sourceDimensions = gridDimensions(source);
  const target = targetPlaneDimensions(id, dimensions);
  const cells: Array<Array<AssemblyViewCell>> = Array.from({ length: target.height }, () => Array<AssemblyViewCell>(target.width).fill(null));
  const offsetX = Math.trunc(calibration?.offsetX ?? 0);
  const offsetY = Math.trunc(calibration?.offsetY ?? 0);

  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const adjustedX = x - offsetX;
      const adjustedY = y - offsetY;
      if (adjustedX < 0 || adjustedY < 0 || adjustedX >= target.width || adjustedY >= target.height || sourceDimensions.width === 0 || sourceDimensions.height === 0) continue;
      let sourceX = Math.min(sourceDimensions.width - 1, Math.floor((adjustedX * sourceDimensions.width) / target.width));
      let sourceY = Math.min(sourceDimensions.height - 1, Math.floor((adjustedY * sourceDimensions.height) / target.height));
      if (calibration?.mirrorX) sourceX = sourceDimensions.width - 1 - sourceX;
      if (calibration?.mirrorY) sourceY = sourceDimensions.height - 1 - sourceY;
      cells[y][x] = readGridCell(source, sourceX, sourceY);
    }
  }
  const occupiedCells = cells.reduce((total, row) => total + row.filter(isOccupied).length, 0);
  return { id, width: target.width, height: target.height, cells, occupiedCells };
}

function createEmptyVoxelGrid(dimensions: AssemblyStructureDimensions): boolean[][][] {
  return Array.from({ length: dimensions.depth }, () => Array.from({ length: dimensions.height }, () => Array<boolean>(dimensions.width).fill(false)));
}

function cloneVoxelGrid(grid: boolean[][][]): boolean[][][] {
  return grid.map(depth => depth.map(row => [...row]));
}

function viewCell(view: NormalisedView | undefined, x: number, y: number): AssemblyViewCell {
  return view?.cells[y]?.[x] ?? null;
}

function hasCell(view: NormalisedView | undefined, x: number, y: number): boolean {
  return view ? isOccupied(viewCell(view, x, y)) : true;
}

function retainLargestComponent(occupancy: boolean[][][], dimensions: AssemblyStructureDimensions): ComponentResult {
  const visited = createEmptyVoxelGrid(dimensions);
  const components: Array<Array<[number, number, number]>> = [];
  const directions: Array<[number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let z = 0; z < dimensions.depth; z += 1) {
    for (let y = 0; y < dimensions.height; y += 1) {
      for (let x = 0; x < dimensions.width; x += 1) {
        if (!occupancy[z][y][x] || visited[z][y][x]) continue;
        const component: Array<[number, number, number]> = [];
        const queue: Array<[number, number, number]> = [[x, y, z]];
        visited[z][y][x] = true;
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
          const [currentX, currentY, currentZ] = queue[cursor];
          component.push([currentX, currentY, currentZ]);
          for (const [deltaX, deltaY, deltaZ] of directions) {
            const nextX = currentX + deltaX;
            const nextY = currentY + deltaY;
            const nextZ = currentZ + deltaZ;
            if (nextX < 0 || nextY < 0 || nextZ < 0 || nextX >= dimensions.width || nextY >= dimensions.height || nextZ >= dimensions.depth) continue;
            if (!occupancy[nextZ][nextY][nextX] || visited[nextZ][nextY][nextX]) continue;
            visited[nextZ][nextY][nextX] = true;
            queue.push([nextX, nextY, nextZ]);
          }
        }
        components.push(component);
      }
    }
  }

  if (!components.length) return { componentCount: 0, retained: createEmptyVoxelGrid(dimensions), removed: 0 };
  let largest = components[0];
  for (const component of components) if (component.length > largest.length) largest = component;
  const retained = createEmptyVoxelGrid(dimensions);
  for (const [x, y, z] of largest) retained[z][y][x] = true;
  const occupiedCount = components.reduce((total, component) => total + component.length, 0);
  return { componentCount: components.length, retained, removed: occupiedCount - largest.length };
}

function isExposed(occupancy: boolean[][][], dimensions: AssemblyStructureDimensions, x: number, y: number, z: number, deltaX: number, deltaY: number, deltaZ: number): boolean {
  const nextX = x + deltaX;
  const nextY = y + deltaY;
  const nextZ = z + deltaZ;
  return nextX < 0 || nextY < 0 || nextZ < 0 || nextX >= dimensions.width || nextY >= dimensions.height || nextZ >= dimensions.depth || !occupancy[nextZ][nextY][nextX];
}

function createSurfaceColors(occupancy: boolean[][][], dimensions: AssemblyStructureDimensions, views: Partial<Record<AssemblyViewId, NormalisedView>>): Array<Array<Array<AssemblyVoxelColour | null>>> {
  return occupancy.map((depth, z) => depth.map((row, y) => row.map((occupied, x) => {
    if (!occupied) return null;
    const observedFaces: Partial<Record<AssemblyViewId, string | null>> = {};
    if (views.front && isExposed(occupancy, dimensions, x, y, z, 0, 0, -1)) observedFaces.front = typeof viewCell(views.front, x, y) === 'string' ? viewCell(views.front, x, y) as string : null;
    if (views.back && isExposed(occupancy, dimensions, x, y, z, 0, 0, 1)) observedFaces.back = typeof viewCell(views.back, dimensions.width - 1 - x, y) === 'string' ? viewCell(views.back, dimensions.width - 1 - x, y) as string : null;
    if (views.side && isExposed(occupancy, dimensions, x, y, z, 1, 0, 0)) observedFaces.side = typeof viewCell(views.side, z, y) === 'string' ? viewCell(views.side, z, y) as string : null;
    if (views.top && isExposed(occupancy, dimensions, x, y, z, 0, -1, 0)) observedFaces.top = typeof viewCell(views.top, x, z) === 'string' ? viewCell(views.top, x, z) as string : null;
    for (const view of COLOR_PRIORITY) {
      const colour = observedFaces[view];
      if (typeof colour === 'string' && colour.trim()) return { color: colour, sourceView: view, status: 'observed-surface', observedFaces };
    }
    return { color: null, sourceView: null, status: 'unknown', observedFaces };
  })));
}

function confidenceLevel(score: number): AssemblyConfidenceLevel {
  if (score <= 0) return 'none';
  if (score >= 0.8) return 'high';
  if (score >= 0.55) return 'medium';
  return 'low';
}

function buildConfidence(sourceViews: AssemblyViewId[], occupied: number, removed: number, conflicts: AssemblyStructureConflict[]): AssemblyStructureConfidence {
  const structureReady = sourceViews.includes('front') && sourceViews.includes('side') && occupied > 0;
  const mode: AssemblyStructureMode = structureReady ? 'orthographic-structure' : 'inferred-draft';
  let score = structureReady ? 0.68 : 0.3;
  if (sourceViews.includes('top')) score += 0.16;
  if (sourceViews.includes('back')) score += 0.08;
  if (sourceViews.length === 1) score = 0.28;
  if (occupied === 0) score = 0;
  if (removed > 0) score -= Math.min(0.18, removed / Math.max(occupied + removed, 1));
  score -= conflicts.filter(conflict => conflict.severity === 'error').length * 0.2;
  score = Math.max(0, Math.min(0.95, Math.round(score * 100) / 100));
  return { score, level: confidenceLevel(score), mode, structureReady };
}

/**
 * Fuses orthographic silhouettes into a conservative visual-hull voxel model.
 * This intentionally never invents a colour for hidden/internal voxels.
 */
export function generateAssemblyStructure(input: AssemblyStructureInput, calibration: AssemblyStructureCalibration = {}): VoxelModel {
  const sourceViews = VIEW_ORDER.filter(view => Boolean(input[view]));
  if (!sourceViews.length) throw new AssemblyStructureError('请至少提供一个正交视图');
  const dimensions = resolveDimensions(input, calibration);
  verifyLimits(dimensions, calibration.limits);

  const views: Partial<Record<AssemblyViewId, NormalisedView>> = {};
  const conflicts: AssemblyStructureConflict[] = [];
  for (const id of sourceViews) {
    const normalised = normaliseView(id, input[id]!, dimensions, calibration.views?.[id]);
    views[id] = normalised;
    if (!normalised.occupiedCells) conflicts.push({ code: 'empty-view', severity: 'error', views: [id], message: `${id} 视图没有可用的主体轮廓。` });
    const suppliedDimensions = gridDimensions(input[id]!.grid);
    if (suppliedDimensions.width !== normalised.width || suppliedDimensions.height !== normalised.height) {
      conflicts.push({ code: 'normalised-view', severity: 'warning', views: [id], message: `${id} 视图已归一化到结构尺寸，请确认各视图比例一致。` });
    }
  }
  if (!(sourceViews.includes('front') && sourceViews.includes('side'))) {
    conflicts.push({ code: 'insufficient-views', severity: 'warning', views: sourceViews, message: '缺少正面或侧面，结果仅为推断草案，不能视为可直接制作的精准结构。' });
  }

  const occupancy = createEmptyVoxelGrid(dimensions);
  let candidateVoxels = 0;
  for (let z = 0; z < dimensions.depth; z += 1) {
    for (let y = 0; y < dimensions.height; y += 1) {
      for (let x = 0; x < dimensions.width; x += 1) {
        candidateVoxels += 1;
        const matchesFront = hasCell(views.front, x, y);
        const matchesBack = hasCell(views.back, dimensions.width - 1 - x, y);
        const matchesSide = hasCell(views.side, z, y);
        const matchesTop = hasCell(views.top, x, z);
        occupancy[z][y][x] = matchesFront && matchesBack && matchesSide && matchesTop;
      }
    }
  }
  const occupiedBeforeCleanup = occupancy.reduce((total, depth) => total + depth.reduce((depthTotal, row) => depthTotal + row.filter(Boolean).length, 0), 0);
  if (!occupiedBeforeCleanup && sourceViews.length > 1) {
    conflicts.push({ code: 'empty-intersection', severity: 'error', views: sourceViews, message: '各视图的轮廓在同一坐标系中没有交集；请检查上传视角、镜像和偏移校准。' });
  }
  const cleaned = retainLargestComponent(occupancy, dimensions);
  if (cleaned.componentCount > 1) {
    conflicts.push({ code: 'disconnected-geometry', severity: 'warning', message: `检测到 ${cleaned.componentCount} 个断开的结构块，已保留最大主体并移除 ${cleaned.removed} 个孤立体素。` });
  }
  const occupiedAfterCleanup = occupiedBeforeCleanup - cleaned.removed;
  const confidence = buildConfidence(sourceViews, occupiedAfterCleanup, cleaned.removed, conflicts);
  const normalisedViews = Object.fromEntries(sourceViews.map(id => {
    const view = views[id]!;
    return [id, { width: view.width, height: view.height, occupiedCells: view.occupiedCells }];
  })) as AssemblyStructureDiagnostics['normalisedViews'];

  return {
    dimensions,
    occupancy: cloneVoxelGrid(cleaned.retained),
    surfaceColors: createSurfaceColors(cleaned.retained, dimensions, views),
    sourceViews,
    confidence,
    conflicts,
    diagnostics: {
      suppliedViews: sourceViews,
      candidateVoxels,
      occupiedBeforeCleanup,
      occupiedAfterCleanup,
      removedIsolatedVoxels: cleaned.removed,
      connectedComponentCount: cleaned.componentCount,
      normalisedViews,
    },
  };
}
