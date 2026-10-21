export const IMPORT_GRID_LIMITS = {
  minColumns: 1,
  maxColumns: 312,
  minRows: 1,
  maxRows: 312,
  minCellSize: 0.001,
  maxCellSize: 512,
} as const;

export interface ImportImageDimensions {
  width: number;
  height: number;
}

/**
 * All calibration coordinates are expressed in source-image pixels.
 * View zoom/pan is deliberately not part of this contract.
 */
export interface ImportGridCalibration {
  originX: number;
  originY: number;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
}

export interface ImportCalibrationSnapshot {
  calibration: Readonly<ImportGridCalibration>;
}

export interface ImportGridBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ImportGridCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Resize from a source-space corner while keeping the opposite corner fixed. */
export function dragImportGridCorner(
  current: ImportGridCalibration,
  corner: ImportGridCorner,
  point: { x: number; y: number },
  image: ImportImageDimensions,
  squareLocked = false,
): ImportGridCalibration {
  const bounds = getImportGridBounds(current);
  const fromLeft = corner.endsWith('left');
  const fromTop = corner.startsWith('top');
  const anchorX = fromLeft ? bounds.x + bounds.width : bounds.x;
  const anchorY = fromTop ? bounds.y + bounds.height : bounds.y;
  const maxWidth = Math.min(fromLeft ? anchorX : image.width - anchorX, current.columns * IMPORT_GRID_LIMITS.maxCellSize);
  const maxHeight = Math.min(fromTop ? anchorY : image.height - anchorY, current.rows * IMPORT_GRID_LIMITS.maxCellSize);
  const minWidth = Math.min(maxWidth, current.columns * IMPORT_GRID_LIMITS.minCellSize);
  const minHeight = Math.min(maxHeight, current.rows * IMPORT_GRID_LIMITS.minCellSize);
  let width = clamp(fromLeft ? anchorX - finiteOr(point.x, bounds.x) : finiteOr(point.x, anchorX + bounds.width) - anchorX, minWidth, maxWidth);
  let height = clamp(fromTop ? anchorY - finiteOr(point.y, bounds.y) : finiteOr(point.y, anchorY + bounds.height) - anchorY, minHeight, maxHeight);
  if (squareLocked) {
    const useWidth = Math.abs(width - bounds.width) / current.columns >= Math.abs(height - bounds.height) / current.rows;
    const cellSize = clamp(useWidth ? width / current.columns : height / current.rows,
      IMPORT_GRID_LIMITS.minCellSize, Math.min(maxWidth / current.columns, maxHeight / current.rows));
    width = cellSize * current.columns;
    height = cellSize * current.rows;
  }
  return {
    ...current,
    originX: fromLeft ? anchorX - width : anchorX,
    originY: fromTop ? anchorY - height : anchorY,
    cellWidth: width / current.columns,
    cellHeight: height / current.rows,
  };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function integerOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function safeDimension(value: number): number {
  return Math.max(1, finiteOr(value, 1));
}

export function getImportGridBounds(calibration: ImportGridCalibration): ImportGridBounds {
  return {
    x: calibration.originX,
    y: calibration.originY,
    width: calibration.columns * calibration.cellWidth,
    height: calibration.rows * calibration.cellHeight,
  };
}

export function normalizeImportGridCalibration(
  value: Partial<ImportGridCalibration>,
  image: ImportImageDimensions,
  fallback: ImportGridCalibration,
): ImportGridCalibration {
  const width = safeDimension(image.width);
  const height = safeDimension(image.height);
  const columns = clamp(
    integerOr(value.columns ?? fallback.columns, fallback.columns),
    IMPORT_GRID_LIMITS.minColumns,
    IMPORT_GRID_LIMITS.maxColumns,
  );
  const rows = clamp(
    integerOr(value.rows ?? fallback.rows, fallback.rows),
    IMPORT_GRID_LIMITS.minRows,
    IMPORT_GRID_LIMITS.maxRows,
  );
  const cellWidth = clamp(
    finiteOr(value.cellWidth ?? fallback.cellWidth, fallback.cellWidth),
    IMPORT_GRID_LIMITS.minCellSize,
    Math.min(IMPORT_GRID_LIMITS.maxCellSize, width / columns),
  );
  const cellHeight = clamp(
    finiteOr(value.cellHeight ?? fallback.cellHeight, fallback.cellHeight),
    IMPORT_GRID_LIMITS.minCellSize,
    Math.min(IMPORT_GRID_LIMITS.maxCellSize, height / rows),
  );
  const gridWidth = columns * cellWidth;
  const gridHeight = rows * cellHeight;

  return {
    columns,
    rows,
    cellWidth,
    cellHeight,
    originX: clamp(finiteOr(value.originX ?? fallback.originX, fallback.originX), 0, Math.max(0, width - gridWidth)),
    originY: clamp(finiteOr(value.originY ?? fallback.originY, fallback.originY), 0, Math.max(0, height - gridHeight)),
  };
}

export function createDefaultImportGridCalibration(image: ImportImageDimensions): ImportGridCalibration {
  const width = safeDimension(image.width);
  const height = safeDimension(image.height);
  const columns = 20;
  const rows = 20;
  const cellWidth = clamp(width / columns, IMPORT_GRID_LIMITS.minCellSize, IMPORT_GRID_LIMITS.maxCellSize);
  const cellHeight = clamp(height / rows, IMPORT_GRID_LIMITS.minCellSize, IMPORT_GRID_LIMITS.maxCellSize);
  const gridWidth = columns * cellWidth;
  const gridHeight = rows * cellHeight;
  const calibration = {
    columns,
    rows,
    cellWidth,
    cellHeight,
    originX: Math.max(0, (width - gridWidth) / 2),
    originY: Math.max(0, (height - gridHeight) / 2),
  };

  return normalizeImportGridCalibration(calibration, { width, height }, calibration);
}

export function updateImportGridCalibration(
  current: ImportGridCalibration,
  patch: Partial<ImportGridCalibration>,
  image: ImportImageDimensions,
): ImportGridCalibration {
  return normalizeImportGridCalibration({ ...current, ...patch }, image, current);
}

/** Change grid density without moving or resizing the calibrated source rectangle. */
export function resizeImportGridCalibration(
  current: ImportGridCalibration,
  columns: number,
  rows: number,
  image: ImportImageDimensions,
): ImportGridCalibration {
  const bounds = getImportGridBounds(current);
  const safeColumns = clamp(integerOr(columns, current.columns), IMPORT_GRID_LIMITS.minColumns, IMPORT_GRID_LIMITS.maxColumns);
  const safeRows = clamp(integerOr(rows, current.rows), IMPORT_GRID_LIMITS.minRows, IMPORT_GRID_LIMITS.maxRows);
  return normalizeImportGridCalibration({
    ...current,
    columns: safeColumns,
    rows: safeRows,
    cellWidth: bounds.width / safeColumns,
    cellHeight: bounds.height / safeRows,
  }, image, current);
}

export function moveImportGrid(
  current: ImportGridCalibration,
  delta: { x: number; y: number },
  image: ImportImageDimensions,
): ImportGridCalibration {
  return updateImportGridCalibration(
    current,
    { originX: current.originX + finiteOr(delta.x, 0), originY: current.originY + finiteOr(delta.y, 0) },
    image,
  );
}

export function cloneImportGridCalibration(calibration: ImportGridCalibration): ImportGridCalibration {
  return { ...calibration };
}

export function freezeImportCalibrationSnapshot(calibration: ImportGridCalibration): ImportCalibrationSnapshot {
  const frozenCalibration = Object.freeze(cloneImportGridCalibration(calibration));
  return Object.freeze({ calibration: frozenCalibration });
}
