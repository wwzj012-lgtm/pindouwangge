export interface CoordinateLabelPosition {
  index: number;
  label: string;
  center: number;
  size: number;
}

interface AxisLabelLayoutOptions {
  count: number;
  cellSize: number;
  boardSize: number;
  origin: number;
  viewportSize: number;
  getLabel: (index: number) => string;
  measureLabel: (label: string) => number;
  minGap?: number;
}

interface ColumnLabelLayoutOptions {
  columns: number;
  cellSize: number;
  boardSize: number;
  originX: number;
  viewportWidth: number;
  getLabel: (index: number) => string;
  measureLabel: (label: string) => number;
  minGap?: number;
}

interface RowLabelLayoutOptions {
  rows: number;
  cellSize: number;
  boardSize: number;
  originY: number;
  viewportHeight: number;
  measureLabel: (label: string) => number;
  minGap?: number;
}

const DEFAULT_LABEL_GAP = 3;

function hasRoomForLabel(
  candidate: CoordinateLabelPosition,
  placed: CoordinateLabelPosition[],
  viewportSize: number,
  minGap: number,
): boolean {
  const candidateStart = candidate.center - candidate.size / 2;
  const candidateEnd = candidate.center + candidate.size / 2;

  if (candidateStart < 0 || candidateEnd > viewportSize) return false;

  return placed.every(label => {
    const labelStart = label.center - label.size / 2;
    const labelEnd = label.center + label.size / 2;
    return candidateEnd + minGap <= labelStart || labelEnd + minGap <= candidateStart;
  });
}

export function getAxisLabelPositions({
  count,
  cellSize,
  boardSize,
  origin,
  viewportSize,
  getLabel,
  measureLabel,
  minGap = DEFAULT_LABEL_GAP,
}: AxisLabelLayoutOptions): CoordinateLabelPosition[] {
  if (count <= 0 || cellSize <= 0 || viewportSize <= 0) return [];

  const labels = Array.from({ length: count }, (_, index) => {
    const label = getLabel(index);
    return {
      index,
      label,
      center: origin + index * cellSize + cellSize / 2,
      size: measureLabel(label),
    };
  });
  const largestLabel = Math.max(...labels.map(label => label.size));
  const step = Math.max(1, Math.ceil((largestLabel + minGap) / cellSize));
  const specialIndices = new Set<number>([0, count - 1]);

  const normalizedBoardSize = Math.max(1, boardSize);
  for (let index = 0; index < count; index += normalizedBoardSize) {
    specialIndices.add(index);
  }

  const placed: CoordinateLabelPosition[] = [];
  const specialPriority = [0, count - 1, ...Array.from(specialIndices)]
    .filter((index, position, values) => values.indexOf(index) === position)
    .map(index => labels[index]);

  for (const label of specialPriority) {
    if (hasRoomForLabel(label, placed, viewportSize, minGap)) placed.push(label);
  }

  for (let index = 0; index < count; index += step) {
    if (specialIndices.has(index)) continue;
    const label = labels[index];
    if (hasRoomForLabel(label, placed, viewportSize, minGap)) placed.push(label);
  }

  return placed.sort((left, right) => left.index - right.index);
}

export function getColumnLabelPositions(options: ColumnLabelLayoutOptions): CoordinateLabelPosition[] {
  return getAxisLabelPositions({
    count: options.columns,
    cellSize: options.cellSize,
    boardSize: options.boardSize,
    origin: options.originX,
    viewportSize: options.viewportWidth,
    getLabel: options.getLabel,
    measureLabel: options.measureLabel,
    minGap: options.minGap,
  });
}

export function getRowLabelPositions(options: RowLabelLayoutOptions): CoordinateLabelPosition[] {
  return getAxisLabelPositions({
    count: options.rows,
    cellSize: options.cellSize,
    boardSize: options.boardSize,
    origin: options.originY,
    viewportSize: options.viewportHeight,
    getLabel: index => (index + 1).toString(),
    measureLabel: options.measureLabel,
    minGap: options.minGap,
  });
}
