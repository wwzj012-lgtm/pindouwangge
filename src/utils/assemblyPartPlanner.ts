import type { AssemblyViewId, VoxelModel } from './assemblyStructure';

export type AssemblyPartOrientation = 'xy' | 'zy';
export type AssemblySlotSide = 'top' | 'bottom';

export interface AssemblyPartPlannerOptions {
  maxParts?: number;
  minSliceBeans?: number;
  minIntersectionLength?: number;
  slotWidth?: number;
  /** Additional cells on both sides of the slot path. Keep at zero for standard fuse-bead tolerances. */
  slotClearance?: number;
  minRemainingBeans?: number;
}

export interface AssemblyPartGridCell {
  occupied: boolean;
  color: string | null;
  isSlot: boolean;
}

export interface AssemblyPartBoundingBox {
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
}

export interface AssemblyPartSlot {
  id: string;
  connectionId: string;
  partnerPartId: string;
  side: AssemblySlotSide;
  start: { u: number; v: number };
  end: { u: number; v: number };
  width: number;
  clearance: number;
  removedCells: Array<{ u: number; v: number }>;
}

export interface AssemblyPlannedPart {
  id: string;
  number: string;
  name: string;
  orientation: AssemblyPartOrientation;
  sliceIndex: number;
  width: number;
  height: number;
  grid: AssemblyPartGridCell[][];
  beanCount: number;
  bbox: AssemblyPartBoundingBox;
  slots: AssemblyPartSlot[];
}

export interface AssemblyConnection {
  id: string;
  xyPartId: string;
  zyPartId: string;
  x: number;
  z: number;
  yStart: number;
  yEnd: number;
  slotLength: number;
  slotWidth: number;
  slotClearance: number;
}

export interface AssemblyStep {
  number: number;
  kind: 'skeleton' | 'cross-insert';
  title: string;
  description: string;
  partIds: string[];
  connectionIds: string[];
}

export interface AssemblyColorStat {
  color: string | null;
  count: number;
}

export interface AssemblyPlanConfidence {
  score: number;
  level: 'high' | 'medium' | 'low' | 'none';
  manufacturable: boolean;
  reason: string | null;
}

export interface AssemblyPartPlan {
  parts: AssemblyPlannedPart[];
  connections: AssemblyConnection[];
  assemblySteps: AssemblyStep[];
  totalBeans: number;
  colorStats: AssemblyColorStat[];
  warnings: string[];
  confidence: AssemblyPlanConfidence;
}

type StructureInput = Pick<VoxelModel, 'dimensions' | 'occupancy' | 'surfaceColors' | 'sourceViews' | 'confidence'>;

interface ResolvedOptions {
  maxParts: number;
  minSliceBeans: number;
  minIntersectionLength: number;
  slotWidth: number;
  slotClearance: number;
  minRemainingBeans: number;
}

interface SliceCandidate {
  orientation: AssemblyPartOrientation;
  sliceIndex: number;
  grid: AssemblyPartGridCell[][];
  signature: string;
  beanCount: number;
}

const MAX_EDGE = 64;
const MAX_VOLUME = 128_000;
const DEFAULT_OPTIONS: ResolvedOptions = {
  maxParts: 12,
  minSliceBeans: 3,
  minIntersectionLength: 2,
  slotWidth: 1,
  slotClearance: 0,
  minRemainingBeans: 4,
};

export class AssemblyPartPlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssemblyPartPlannerError';
  }
}

function safePositiveInteger(value: number | undefined, fallback: number, name: string, minimum = 1): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum) throw new AssemblyPartPlannerError(`${name} 必须是不小于 ${minimum} 的整数`);
  return value;
}

function resolveOptions(options: AssemblyPartPlannerOptions): ResolvedOptions {
  const maxParts = safePositiveInteger(options.maxParts, DEFAULT_OPTIONS.maxParts, 'maxParts', 2);
  const minSliceBeans = safePositiveInteger(options.minSliceBeans, DEFAULT_OPTIONS.minSliceBeans, 'minSliceBeans');
  const minIntersectionLength = safePositiveInteger(options.minIntersectionLength, DEFAULT_OPTIONS.minIntersectionLength, 'minIntersectionLength');
  const slotWidth = safePositiveInteger(options.slotWidth, DEFAULT_OPTIONS.slotWidth, 'slotWidth');
  const slotClearance = options.slotClearance === undefined ? DEFAULT_OPTIONS.slotClearance : safePositiveInteger(options.slotClearance, DEFAULT_OPTIONS.slotClearance, 'slotClearance', 0);
  const minRemainingBeans = safePositiveInteger(options.minRemainingBeans, DEFAULT_OPTIONS.minRemainingBeans, 'minRemainingBeans');
  if (slotWidth + slotClearance * 2 > MAX_EDGE) throw new AssemblyPartPlannerError('卡槽宽度超过结构上限');
  return { maxParts, minSliceBeans, minIntersectionLength, slotWidth, slotClearance, minRemainingBeans };
}

function validateStructure(model: StructureInput): void {
  const { width, height, depth } = model.dimensions;
  if (![width, height, depth].every(value => Number.isSafeInteger(value) && value > 0 && value <= MAX_EDGE)) throw new AssemblyPartPlannerError('体素结构尺寸无效');
  const volume = width * height * depth;
  if (!Number.isSafeInteger(volume) || volume > MAX_VOLUME || model.occupancy.length !== depth) throw new AssemblyPartPlannerError('体素结构超过安全范围');
  for (const plane of model.occupancy) {
    if (!Array.isArray(plane) || plane.length !== height) throw new AssemblyPartPlannerError('体素结构高度与数据不一致');
    for (const row of plane) if (!Array.isArray(row) || row.length !== width || row.some(cell => typeof cell !== 'boolean')) throw new AssemblyPartPlannerError('体素结构网格无效');
  }
}

function isOccupied(model: StructureInput, x: number, y: number, z: number): boolean {
  return model.occupancy[z]?.[y]?.[x] === true;
}

function surfaceColor(model: StructureInput, x: number, y: number, z: number): string | null {
  const color = model.surfaceColors?.[z]?.[y]?.[x]?.color;
  return typeof color === 'string' && color.trim().length > 0 ? color : null;
}

function countBeans(grid: AssemblyPartGridCell[][]): number {
  return grid.reduce((total, row) => total + row.filter(cell => cell.occupied).length, 0);
}

function computeBoundingBox(grid: AssemblyPartGridCell[][]): AssemblyPartBoundingBox {
  let minU = Number.POSITIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (let v = 0; v < grid.length; v += 1) for (let u = 0; u < grid[v].length; u += 1) {
    if (!grid[v][u].occupied) continue;
    minU = Math.min(minU, u); minV = Math.min(minV, v); maxU = Math.max(maxU, u); maxV = Math.max(maxV, v);
  }
  if (!Number.isFinite(minU)) throw new AssemblyPartPlannerError('零件切片为空');
  return { minU, minV, maxU, maxV };
}

function sliceSignature(grid: AssemblyPartGridCell[][]): string {
  return grid.map(row => row.map(cell => cell.occupied ? '1' : '0').join('')).join('/');
}

function createSlice(model: StructureInput, orientation: AssemblyPartOrientation, sliceIndex: number): SliceCandidate {
  const { width, height, depth } = model.dimensions;
  const horizontal = orientation === 'xy' ? width : depth;
  const grid = Array.from({ length: height }, (_, y) => Array.from({ length: horizontal }, (_, u) => {
    const x = orientation === 'xy' ? u : sliceIndex;
    const z = orientation === 'xy' ? sliceIndex : u;
    const occupied = isOccupied(model, x, y, z);
    return { occupied, color: occupied ? surfaceColor(model, x, y, z) : null, isSlot: false };
  }));
  return { orientation, sliceIndex, grid, signature: sliceSignature(grid), beanCount: countBeans(grid) };
}

function collapseRepeatedCandidates(candidates: SliceCandidate[]): SliceCandidate[] {
  const retained: SliceCandidate[] = [];
  for (let index = 0; index < candidates.length;) {
    const start = index;
    const signature = candidates[index].signature;
    while (index + 1 < candidates.length && candidates[index + 1].signature === signature) index += 1;
    const end = index;
    retained.push(candidates[start]);
    if (end > start) retained.push(candidates[end]);
    index += 1;
  }
  return retained.filter((candidate, index, list) => index === 0 || candidate.sliceIndex !== list[index - 1].sliceIndex);
}

function selectEvenly(candidates: SliceCandidate[], limit: number): SliceCandidate[] {
  if (candidates.length <= limit) return candidates;
  if (limit === 1) return [candidates[0]];
  const selectedIndexes = new Set<number>();
  for (let step = 0; step < limit; step += 1) selectedIndexes.add(Math.round((step * (candidates.length - 1)) / (limit - 1)));
  return [...selectedIndexes].sort((a, b) => a - b).map(index => candidates[index]);
}

function buildCandidates(model: StructureInput, orientation: AssemblyPartOrientation, minSliceBeans: number): SliceCandidate[] {
  const count = orientation === 'xy' ? model.dimensions.depth : model.dimensions.width;
  const effective = Array.from({ length: count }, (_, index) => createSlice(model, orientation, index)).filter(candidate => candidate.beanCount >= minSliceBeans);
  return collapseRepeatedCandidates(effective);
}

function createPart(candidate: SliceCandidate, ordinal: number): AssemblyPlannedPart {
  const prefix = candidate.orientation === 'xy' ? 'XY' : 'ZY';
  return {
    id: `part-${candidate.orientation}-${String(candidate.sliceIndex).padStart(3, '0')}`,
    number: `P-${prefix}-${String(ordinal).padStart(2, '0')}`,
    name: candidate.orientation === 'xy' ? `横向截面 Z${candidate.sliceIndex + 1}` : `纵向截面 X${candidate.sliceIndex + 1}`,
    orientation: candidate.orientation,
    sliceIndex: candidate.sliceIndex,
    width: candidate.grid[0]?.length ?? 0,
    height: candidate.grid.length,
    grid: candidate.grid.map(row => row.map(cell => ({ ...cell }))),
    beanCount: candidate.beanCount,
    bbox: computeBoundingBox(candidate.grid),
    slots: [],
  };
}

function makeSlotCells(part: AssemblyPlannedPart, coordinate: number, yStart: number, yEnd: number, side: AssemblySlotSide, options: ResolvedOptions): Array<{ u: number; v: number }> {
  const depth = Math.max(1, Math.floor((yEnd - yStart + 1) / 2));
  const from = side === 'top' ? yStart : yEnd - depth + 1;
  const to = side === 'top' ? yStart + depth - 1 : yEnd;
  const effectiveWidth = options.slotWidth + options.slotClearance * 2;
  const left = coordinate - Math.floor(effectiveWidth / 2);
  const cells: Array<{ u: number; v: number }> = [];
  for (let v = from; v <= to; v += 1) for (let u = left; u < left + effectiveWidth; u += 1) {
    if (u < 0 || v < 0 || u >= part.width || v >= part.height || !part.grid[v][u].occupied) return [];
    cells.push({ u, v });
  }
  return cells;
}

function canCutSlot(part: AssemblyPlannedPart, cells: Array<{ u: number; v: number }>, options: ResolvedOptions): boolean {
  if (!cells.length) return false;
  const uniqueCells = new Set(cells.map(cell => `${cell.u}:${cell.v}`));
  return part.beanCount - uniqueCells.size >= options.minRemainingBeans;
}

function applySlot(part: AssemblyPlannedPart, slot: AssemblyPartSlot): void {
  for (const { u, v } of slot.removedCells) {
    part.grid[v][u] = { occupied: false, color: null, isSlot: true };
  }
  part.slots.push(slot);
  part.beanCount = countBeans(part.grid);
  part.bbox = computeBoundingBox(part.grid);
}

function commonVerticalRuns(model: StructureInput, x: number, z: number): Array<{ yStart: number; yEnd: number }> {
  const runs: Array<{ yStart: number; yEnd: number }> = [];
  let start: number | null = null;
  for (let y = 0; y < model.dimensions.height; y += 1) {
    if (isOccupied(model, x, y, z)) {
      if (start === null) start = y;
    } else if (start !== null) {
      runs.push({ yStart: start, yEnd: y - 1 });
      start = null;
    }
  }
  if (start !== null) runs.push({ yStart: start, yEnd: model.dimensions.height - 1 });
  return runs;
}

function collectColorStats(parts: AssemblyPlannedPart[]): AssemblyColorStat[] {
  const counts = new Map<string | null, number>();
  for (const part of parts) for (const row of part.grid) for (const cell of row) if (cell.occupied) counts.set(cell.color, (counts.get(cell.color) ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => (left ?? '~').localeCompare(right ?? '~')).map(([color, count]) => ({ color, count }));
}

function emptyPlan(model: StructureInput, reason: string): AssemblyPartPlan {
  return {
    parts: [], connections: [], assemblySteps: [], totalBeans: 0, colorStats: [], warnings: [reason],
    confidence: { score: Math.min(model.confidence.score, 0.35), level: model.confidence.level === 'none' ? 'none' : 'low', manufacturable: false, reason },
  };
}

/**
 * Produces a deterministic, lightweight cross-slot assembly proposal from a
 * fused orthographic voxel model. It deliberately refuses inferred drafts.
 */
export function planAssemblyParts(model: StructureInput, options: AssemblyPartPlannerOptions = {}): AssemblyPartPlan {
  validateStructure(model);
  const resolved = resolveOptions(options);
  const occupied = model.occupancy.flat(2).filter(Boolean).length;
  if (!occupied) return emptyPlan(model, '结构为空，无法生成可制作零件。');
  if (model.confidence.mode !== 'orthographic-structure' || !model.confidence.structureReady || !model.sourceViews.includes('front') || !model.sourceViews.includes('side')) {
    return emptyPlan(model, '当前是单视图或低可信推断草案；请补充正面和侧面后再生成卡槽零件。');
  }

  const warnings: string[] = [];
  const xyCandidates = buildCandidates(model, 'xy', resolved.minSliceBeans);
  const zyCandidates = buildCandidates(model, 'zy', resolved.minSliceBeans);
  if (!xyCandidates.length || !zyCandidates.length) return emptyPlan(model, '有效截面不足，无法形成互锁结构；请提高结构尺寸或降低最小切片颗数。');
  const xyLimit = Math.max(1, Math.floor(resolved.maxParts / 2));
  const zyLimit = Math.max(1, resolved.maxParts - xyLimit);
  const selectedXY = selectEvenly(xyCandidates, xyLimit);
  const selectedZY = selectEvenly(zyCandidates, zyLimit);
  if (xyCandidates.length > selectedXY.length || zyCandidates.length > selectedZY.length) warnings.push(`已根据 maxParts=${resolved.maxParts} 限制并抽样重复截面。`);
  const parts = [
    ...selectedXY.map((candidate, index) => createPart(candidate, index + 1)),
    ...selectedZY.map((candidate, index) => createPart(candidate, index + 1)),
  ];
  const xyParts = parts.filter(part => part.orientation === 'xy');
  const zyParts = parts.filter(part => part.orientation === 'zy');
  const connections: AssemblyConnection[] = [];
  let connectionOrdinal = 1;
  let skippedSmallIntersections = 0;
  let skippedUnsafeSlots = 0;
  for (const xyPart of xyParts) for (const zyPart of zyParts) {
    const x = zyPart.sliceIndex;
    const z = xyPart.sliceIndex;
    for (const run of commonVerticalRuns(model, x, z)) {
      const length = run.yEnd - run.yStart + 1;
      if (length < resolved.minIntersectionLength) { skippedSmallIntersections += 1; continue; }
      const primarySide: AssemblySlotSide = connectionOrdinal % 2 === 1 ? 'top' : 'bottom';
      const partnerSide: AssemblySlotSide = primarySide === 'top' ? 'bottom' : 'top';
      const xyCells = makeSlotCells(xyPart, x, run.yStart, run.yEnd, primarySide, resolved);
      const zyCells = makeSlotCells(zyPart, z, run.yStart, run.yEnd, partnerSide, resolved);
      if (!canCutSlot(xyPart, xyCells, resolved) || !canCutSlot(zyPart, zyCells, resolved)) { skippedUnsafeSlots += 1; continue; }
      const id = `conn-${String(connectionOrdinal).padStart(3, '0')}-${xyPart.id}-${zyPart.id}-y${String(run.yStart).padStart(2, '0')}`;
      const connection: AssemblyConnection = { id, xyPartId: xyPart.id, zyPartId: zyPart.id, x, z, yStart: run.yStart, yEnd: run.yEnd, slotLength: Math.max(1, Math.floor(length / 2)), slotWidth: resolved.slotWidth, slotClearance: resolved.slotClearance };
      const xySlot: AssemblyPartSlot = { id: `${id}-xy`, connectionId: id, partnerPartId: zyPart.id, side: primarySide, start: xyCells[0], end: xyCells[xyCells.length - 1], width: resolved.slotWidth, clearance: resolved.slotClearance, removedCells: xyCells };
      const zySlot: AssemblyPartSlot = { id: `${id}-zy`, connectionId: id, partnerPartId: xyPart.id, side: partnerSide, start: zyCells[0], end: zyCells[zyCells.length - 1], width: resolved.slotWidth, clearance: resolved.slotClearance, removedCells: zyCells };
      applySlot(xyPart, xySlot);
      applySlot(zyPart, zySlot);
      connections.push(connection);
      connectionOrdinal += 1;
    }
  }
  if (skippedSmallIntersections) warnings.push(`跳过 ${skippedSmallIntersections} 个过短交叉区间，避免在细小部位开槽。`);
  if (skippedUnsafeSlots) warnings.push(`跳过 ${skippedUnsafeSlots} 个会削弱小零件的卡槽。`);
  if (!connections.length) warnings.push('未形成安全卡槽连接；可增加结构高度、降低最小交叉长度或手动调整截面。');
  const retainedParts = parts.filter(part => part.beanCount >= resolved.minRemainingBeans);
  const totalBeans = retainedParts.reduce((total, part) => total + part.beanCount, 0);
  const manufacturable = retainedParts.length >= 2 && connections.length > 0;
  const reason = manufacturable ? null : '结构未形成足够的安全互锁连接。';
  const confidenceScore = Math.max(0, Math.min(0.95, model.confidence.score - (manufacturable ? 0 : 0.24)));
  const level = confidenceScore >= 0.8 ? 'high' : confidenceScore >= 0.55 ? 'medium' : confidenceScore > 0 ? 'low' : 'none';
  const assemblySteps: AssemblyStep[] = manufacturable ? [
    { number: 1, kind: 'skeleton', title: '摆放主骨架', description: `先按编号摆放 ${xyParts.length} 张 XY 主截面。`, partIds: xyParts.map(part => part.id), connectionIds: [] },
    ...zyParts.map((part, index) => ({ number: index + 2, kind: 'cross-insert' as const, title: `插入 ${part.number}`, description: `将 ${part.number} 的卡槽与对应主骨架交叉插入至定位。`, partIds: [part.id], connectionIds: part.slots.map(slot => slot.connectionId) })),
  ] : [];
  return { parts: retainedParts, connections, assemblySteps, totalBeans, colorStats: collectColorStats(retainedParts), warnings, confidence: { score: confidenceScore, level, manufacturable, reason } };
}
