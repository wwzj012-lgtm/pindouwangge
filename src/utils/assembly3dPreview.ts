import {
  getAssemblyOccupiedCells,
  type AssemblyFace,
  type AssemblyPart,
  type AssemblyProject,
} from './assembly3d';

/** Parameters for the small, deterministic isometric projection used by previews. */
export interface AssemblyPreviewOptions<T = unknown> {
  readonly originX?: number;
  readonly originY?: number;
  readonly tileWidth?: number;
  readonly tileHeight?: number;
  readonly verticalScale?: number;
  readonly colorIndex?: (value: T) => number | null;
}

export interface RenderCell<T = unknown> {
  readonly partId: string;
  readonly gridX: number;
  readonly gridY: number;
  /** Projected screen coordinates. `z` is the painter's depth coordinate. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly screenZ: number;
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  readonly depth: number;
  readonly depthKey: number;
  readonly depthSortKey: number;
  readonly face: AssemblyFace;
  readonly faceOrientation: AssemblyFace;
  readonly colorIndex: number | null;
  readonly colorValue: T;
  readonly value: T;
}

export interface RenderPart<T = unknown> {
  readonly partId: string;
  readonly id: string;
  readonly face: AssemblyFace;
  readonly rotation: AssemblyPart<T>['rotation'];
  readonly cells: readonly RenderCell<T>[];
  readonly depth: number;
  readonly depthKey: number;
  readonly depthSortKey: number;
}

export interface AssemblyPreview<T = unknown> {
  readonly parts: readonly RenderPart<T>[];
  readonly cells: readonly RenderCell<T>[];
}

const DEFAULTS = Object.freeze({
  originX: 0,
  originY: 0,
  tileWidth: 1,
  tileHeight: 1,
  verticalScale: 1,
});

function finiteOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved)) throw new TypeError(`${name} must be finite`);
  return resolved;
}

function colorIndexOf<T>(value: T, resolver: ((value: T) => number | null) | undefined): number | null {
  if (resolver) {
    const index = resolver(value);
    if (index !== null && (!Number.isSafeInteger(index) || index < 0)) {
      throw new TypeError('colorIndex must return a non-negative integer or null');
    }
    return index;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (value && typeof value === 'object') {
    const candidate = value as { readonly colorIndex?: unknown; readonly index?: unknown };
    const index = candidate.colorIndex ?? candidate.index;
    if (typeof index === 'number' && Number.isSafeInteger(index) && index >= 0) return index;
  }
  return null;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function compareCells<T>(a: RenderCell<T>, b: RenderCell<T>): number {
  return a.depthSortKey - b.depthSortKey
    || a.worldY - b.worldY
    || a.worldX - b.worldX
    || a.worldZ - b.worldZ
    || a.partId.localeCompare(b.partId)
    || a.gridY - b.gridY
    || a.gridX - b.gridX;
}

function projectPart<T>(part: AssemblyPart<T>, options: Required<Pick<AssemblyPreviewOptions, 'originX' | 'originY' | 'tileWidth' | 'tileHeight' | 'verticalScale'>> & AssemblyPreviewOptions<T>): RenderPart<T> {
  const cells = getAssemblyOccupiedCells(part).map((cell) => {
    // Equal tile dimensions keep the projection useful at any scale while
    // retaining exact values for deterministic snapshots and JSON output.
    const screenX = options.originX + (cell.x - cell.z) * options.tileWidth / 2;
    const screenY = options.originY + (cell.x + cell.z) * options.tileHeight / 2 - cell.y * options.verticalScale;
    const screenZ = cell.x + cell.y + cell.z;
    const colorIndex = colorIndexOf(cell.value, options.colorIndex);
    return freeze({
      partId: cell.partId,
      gridX: cell.gridX,
      gridY: cell.gridY,
      x: screenX,
      y: screenY,
      z: screenZ,
      screenX,
      screenY,
      screenZ,
      worldX: cell.x,
      worldY: cell.y,
      worldZ: cell.z,
      depth: screenZ,
      depthKey: screenZ,
      depthSortKey: screenZ,
      face: part.face,
      faceOrientation: part.face,
      colorIndex,
      colorValue: cell.value,
      value: cell.value,
    });
  }).sort(compareCells);
  const depth = cells.length === 0 ? 0 : cells[cells.length - 1]!.depthSortKey;
  return freeze({
    partId: part.id,
    id: part.id,
    face: part.face,
    rotation: part.rotation,
    cells: freeze(cells),
    depth,
    depthKey: depth,
    depthSortKey: depth,
  });
}

/**
 * Build serializable render descriptions from an assembly's occupied cells.
 * The input project and all nested values are left untouched.
 */
export function createAssemblyPreview<T>(project: AssemblyProject<T>, inputOptions: AssemblyPreviewOptions<T> = {}): AssemblyPreview<T> {
  if (!project || !Array.isArray(project.parts)) throw new TypeError('project must contain a parts array');
  const options = {
    ...inputOptions,
    originX: finiteOption(inputOptions.originX, DEFAULTS.originX, 'originX'),
    originY: finiteOption(inputOptions.originY, DEFAULTS.originY, 'originY'),
    tileWidth: finiteOption(inputOptions.tileWidth, DEFAULTS.tileWidth, 'tileWidth'),
    tileHeight: finiteOption(inputOptions.tileHeight, DEFAULTS.tileHeight, 'tileHeight'),
    verticalScale: finiteOption(inputOptions.verticalScale, DEFAULTS.verticalScale, 'verticalScale'),
  } as Required<Pick<AssemblyPreviewOptions, 'originX' | 'originY' | 'tileWidth' | 'tileHeight' | 'verticalScale'>> & AssemblyPreviewOptions<T>;
  const parts = project.parts.map((part) => projectPart(part, options)).sort((a, b) => a.depthSortKey - b.depthSortKey || a.partId.localeCompare(b.partId));
  const cells = freeze(parts.flatMap((part) => part.cells).sort(compareCells));
  return freeze({ parts: freeze(parts), cells });
}

export const projectAssemblyToIsometric = createAssemblyPreview;
export const renderAssemblyPreview = createAssemblyPreview;
export const getAssemblyRenderParts = createAssemblyPreview;

