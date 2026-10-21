import type { ImportGridCalibration, ImportImageDimensions } from './importGridCalibration';
import { MAX_GRID_DIMENSION } from './patternGridCodec';

export const MIN_ALIGNMENT_CELL_SIZE = 5;
export const MAX_ALIGNMENT_CELL_SIZE = 512;

/** A periodic square lattice, independent of image bounds and recognition selection. */
export interface ImportGridAlignment {
  originX: number;
  originY: number;
  cellSize: number;
}

export interface ImportRecognitionRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const extent = (value: number) => Math.max(0, finite(value, 0));

export function normalizeGridAlignment(value: ImportGridAlignment): ImportGridAlignment {
  return {
    originX: finite(value.originX, 0),
    originY: finite(value.originY, 0),
    cellSize: Math.min(MAX_ALIGNMENT_CELL_SIZE, Math.max(MIN_ALIGNMENT_CELL_SIZE, finite(value.cellSize, MIN_ALIGNMENT_CELL_SIZE))),
  };
}

export function createDefaultGridAlignment(image: ImportImageDimensions): ImportGridAlignment {
  // Keep an easily reachable three-cell handle block near the image center,
  // while initial lattice lines still fall at exact multiples of five pixels.
  return {
    originX: Math.floor(Math.max(0, extent(image.width) / 2 - 7.5) / 5) * 5,
    originY: Math.floor(Math.max(0, extent(image.height) / 2 - 7.5) / 5) * 5,
    cellSize: MIN_ALIGNMENT_CELL_SIZE,
  };
}

export function moveGridAlignment(current: ImportGridAlignment, delta: { x: number; y: number }): ImportGridAlignment {
  const base = normalizeGridAlignment(current);
  return normalizeGridAlignment({ ...base, originX: base.originX + finite(delta.x, 0), originY: base.originY + finite(delta.y, 0) });
}

/** Blue handle is span cells from the red anchor. Projection keeps cells square. */
export function resizeGridAlignment(current: ImportGridAlignment, point: { x: number; y: number }, span = 3): ImportGridAlignment {
  const base = normalizeGridAlignment(current);
  const safeSpan = Number.isFinite(span) && span > 0 ? span : 3;
  const dx = finite(point.x, base.originX + base.cellSize * safeSpan) - base.originX;
  const dy = finite(point.y, base.originY + base.cellSize * safeSpan) - base.originY;
  return normalizeGridAlignment({ ...base, cellSize: (dx + dy) / (2 * safeSpan) });
}

export function scaleGridAlignment(current: ImportGridAlignment, factor: number): ImportGridAlignment {
  const base = normalizeGridAlignment(current);
  return normalizeGridAlignment({ ...base, cellSize: base.cellSize * (Number.isFinite(factor) && factor > 0 ? factor : 1) });
}

/** Accepts reverse-drag rectangles, clips the selection rather than the lattice. */
export function clipRecognitionRegion(region: ImportRecognitionRegion, image: ImportImageDimensions): ImportRecognitionRegion {
  const width = extent(image.width);
  const height = extent(image.height);
  const x = finite(region.x, 0);
  const y = finite(region.y, 0);
  const endX = x + finite(region.width, 0);
  const endY = y + finite(region.height, 0);
  const left = Math.max(0, Math.min(width, Math.min(x, endX)));
  const top = Math.max(0, Math.min(height, Math.min(y, endY)));
  const right = Math.max(0, Math.min(width, Math.max(x, endX)));
  const bottom = Math.max(0, Math.min(height, Math.max(y, endY)));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Counts only complete cells in both ROI and image; never stretches or pads edges. */
export function deriveAlignedCalibration(
  alignment: ImportGridAlignment,
  region: ImportRecognitionRegion,
  image: ImportImageDimensions,
): { calibration: ImportGridCalibration | null; region: ImportRecognitionRegion; error: string | null } {
  const lattice = normalizeGridAlignment(alignment);
  const clipped = clipRecognitionRegion(region, image);
  const invalid = (error: string) => ({ calibration: null, region: clipped, error });
  const { cellSize, originX, originY } = lattice;
  if (clipped.width < cellSize - 1e-8 || clipped.height < cellSize - 1e-8) {
    return invalid('请框选至少包含一个完整网格的识别区域。');
  }
  // A tolerance in grid-index units avoids losing an exact line to float noise.
  const firstColumn = Math.ceil((clipped.x - originX) / cellSize - 1e-9);
  const firstRow = Math.ceil((clipped.y - originY) / cellSize - 1e-9);
  const lastColumn = Math.floor((clipped.x + clipped.width - originX) / cellSize + 1e-9);
  const lastRow = Math.floor((clipped.y + clipped.height - originY) / cellSize + 1e-9);
  const columns = lastColumn - firstColumn;
  const rows = lastRow - firstRow;
  if (columns < 1 || rows < 1) return invalid('框选区域没有完整网格，请调整网格位置或扩大识别区域。');
  if (columns > MAX_GRID_DIMENSION || rows > MAX_GRID_DIMENSION) {
    return invalid(`识别区域为 ${columns} 列 × ${rows} 行，超过 ${MAX_GRID_DIMENSION} 格上限。请增大格距或缩小框选范围。`);
  }
  return {
    calibration: {
      originX: originX + firstColumn * cellSize,
      originY: originY + firstRow * cellSize,
      cellWidth: cellSize,
      cellHeight: cellSize,
      columns, rows,
    },
    region: clipped,
    error: null,
  };
}
