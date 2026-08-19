import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Circle,
  Download,
  Eye,
  Hand,
  Grid2X2,
  Loader2,
  Minus,
  Paintbrush,
  PaintBucket,
  Pipette,
  RefreshCw,
  Redo2,
  Scissors,
  Square,
  Eraser,
  Plus,
  Trash2,
  Upload,
  X,
  ZoomIn,
  Undo2,
  ZoomOut,
} from 'lucide-react';
import {
  getLargeCanvasGridDimensions,
  getMovedLargeCanvasGridRectCandidate,
  getNewLargeCanvasGridRectCandidate,
  LARGE_CANVAS_MAX_GRID_SIZE,
  LARGE_CANVAS_MAX_SIDES,
  LARGE_CANVAS_MODES,
  snapLargeCanvasGridRect,
  type LargeCanvasConversionMode,
  type LargeCanvasGridRect,
  type LargeCanvasMaxSide,
} from '../utils/largeCanvas';
import type { BeadShape, CanvasBackdrop, ColorMatchAlgo, DitherMode } from '../types';
import { getColumnLetter } from '../utils/exportUtils';
import { useAuth } from '../context/AuthContext';

export interface LargeCanvasFrame {
  id: string;
  title: string;
  rect: LargeCanvasGridRect;
  maxSide: LargeCanvasMaxSide;
  sourceImageDataUrl: string | null;
  mode: LargeCanvasConversionMode;
  beanResult: (string | null)[][] | null;
  loading: boolean;
  error: string | null;
}

export interface LargeCanvasConversionResult {
  grid: (string | null)[][];
  sourceImageDataUrl: string;
}

interface LargeCanvasViewProps {
  paletteMap: Map<string, { hex: string; code?: string; name?: string }>;
  brandName: string;
  paletteOptions: { id: string; label: string }[];
  selectedPaletteId: string;
  onChangePalette: (paletteId: string) => void;
  beadShape: BeadShape;
  onChangeBeadShape: (shape: BeadShape) => void;
  canvasBackdrop: CanvasBackdrop;
  onChangeCanvasBackdrop: (backdrop: CanvasBackdrop) => void;
  showGridLines: boolean;
  onChangeShowGridLines: (visible: boolean) => void;
  showCodeLabels: boolean;
  onChangeShowCodeLabels: (visible: boolean) => void;
  showDataPreview: boolean;
  onChangeShowDataPreview: (visible: boolean) => void;
  conversionSettings: {
    quantizationStrength?: number;
    sharpening: number;
    backgroundRemovalEnabled?: boolean;
    dither: DitherMode;
    colorMatchAlgo: ColorMatchAlgo;
  };
  onChangeConversionSettings: (updates: Partial<LargeCanvasViewProps['conversionSettings']>) => void;
  onConvertImage: (
    file: File,
    mode: LargeCanvasConversionMode,
    gridW: number,
    gridH: number,
  ) => Promise<LargeCanvasConversionResult>;
  onPrepareImage?: (file: File) => Promise<File>;
  onOpenFrame: (frame: LargeCanvasFrame) => void;
}

const IMAGE_PREPROCESSING_CANCELLED = '图片预处理已取消';

function isGuestAccount(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const account = value as Record<string, unknown>;
  return account.authProvider === 'guest' || account.auth_provider === 'guest' || account.provider === 'guest';
}

const LARGE_CANVAS_STORAGE_KEY = 'beadgrid.large-canvas.v3';
const LARGE_CANVAS_VIEW_SCALE_KEY = 'beadgrid.large-canvas.view-scale';
const GRID_CELL_SIZE = 10;
const BOARD_GRID_WIDTH = 320;
const BOARD_GRID_HEIGHT = 220;
const DEFAULT_MAX_SIDE: LargeCanvasMaxSide = 50;
const MIN_VIEW_SCALE = 0.1;
const MAX_VIEW_SCALE = 1.2;
const VIEW_SCALE_STEP = 0.1;
const DEFAULT_VIEW_SCALE = 0.6;

export type LargeCanvasGridPoint = { x: number; y: number };
type GridPoint = LargeCanvasGridPoint;
type LargeCanvasTool = 'pan' | 'pencil' | 'line' | 'rectangle' | 'circle' | 'bucket' | 'eyedropper' | 'eraser' | 'replace' | 'cut';
type LargeCanvasSymmetry = 'none' | 'horizontal' | 'vertical' | 'both';
type GridSnapshot = (string | null)[][];
type FrameHistory = { past: GridSnapshot[]; future: GridSnapshot[] };
type ManualCells = Map<string, string>;
type ManualEntry = [number, number, string];
type ManualHistory = { past: ManualCells[]; future: ManualCells[] };
type ShapePreview = { frameId: string; points: GridPoint[]; selection?: { start: GridPoint; end: GridPoint } };
type ManualShapePreview = { points: GridPoint[]; selection?: { start: GridPoint; end: GridPoint } };
type GridInteraction = {
  kind: 'move';
  frameId: string;
  start: GridPoint;
  origin: LargeCanvasGridRect;
  preview: LargeCanvasGridRect;
  valid: boolean;
};

type CanvasPanInteraction = {
  pointerId: number;
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
};

type ManualDrawingTransaction = {
  pointerId: number;
  start: GridPoint;
  before: ManualCells;
  working: ManualCells;
  rafId: number | null;
};

type RafTarget = { rafId: number | null } | null | undefined;

export type LargeCanvasPaletteDisplay = {
  code: string;
  hex: string;
  name: string | null;
};

export function cancelLargeCanvasRaf(target: RafTarget, cancel: (rafId: number) => void): void {
  const rafId = target?.rafId;
  if (typeof rafId === 'number') cancel(rafId);
}

export function getLargeCanvasPaletteDisplay(
  id: string,
  color: { hex: string; code?: string; name?: string } | undefined,
): LargeCanvasPaletteDisplay {
  const code = color?.code?.trim() || id;
  const name = color?.name?.trim();
  return {
    code,
    hex: color?.hex ?? '#CBD5E1',
    name: name && name !== code ? name : null,
  };
}

/** Visits each matching four-connected cell at most once with a bounded queue. */
export function fillLargeCanvasConnectedRegion(
  width: number,
  height: number,
  start: LargeCanvasGridPoint,
  source: string | null,
  replacement: string | null,
  read: (x: number, y: number) => string | null,
  write: (x: number, y: number, colorId: string | null) => void,
): number {
  if (
    source === replacement
    || !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || start.x < 0
    || start.x >= width
    || start.y < 0
    || start.y >= height
  ) return 0;

  const capacity = width * height;
  const queue = new Int32Array(capacity);
  const queued = new Uint8Array(capacity);
  let head = 0;
  let tail = 1;
  let changed = 0;
  const startIndex = start.y * width + start.x;
  queue[0] = startIndex;
  queued[startIndex] = 1;

  while (head < tail) {
    const cellIndex = queue[head++];
    const x = cellIndex % width;
    const y = (cellIndex - x) / width;
    if (read(x, y) !== source) continue;

    write(x, y, replacement);
    changed += 1;

    let neighbor = cellIndex - 1;
    if (x > 0 && !queued[neighbor]) { queued[neighbor] = 1; queue[tail++] = neighbor; }
    neighbor = cellIndex + 1;
    if (x + 1 < width && !queued[neighbor]) { queued[neighbor] = 1; queue[tail++] = neighbor; }
    neighbor = cellIndex - width;
    if (y > 0 && !queued[neighbor]) { queued[neighbor] = 1; queue[tail++] = neighbor; }
    neighbor = cellIndex + width;
    if (y + 1 < height && !queued[neighbor]) { queued[neighbor] = 1; queue[tail++] = neighbor; }
  }

  return changed;
}

const MAX_FRAME_HISTORY = 40;

function createEmptyGrid(width: number, height: number): GridSnapshot {
  return Array.from({ length: height }, () => Array<string | null>(width).fill(null));
}

function cloneGrid(grid: GridSnapshot): GridSnapshot {
  return grid.map(row => [...row]);
}

function manualCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function isBoardPoint(point: GridPoint): boolean {
  return point.x >= 0 && point.x < BOARD_GRID_WIDTH && point.y >= 0 && point.y < BOARD_GRID_HEIGHT;
}

function cloneManualCells(cells: ManualCells): ManualCells {
  return new Map(cells);
}

function manualCellsEqual(left: ManualCells, right: ManualCells): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

function readManualCell(cells: ManualCells, point: GridPoint): string | null {
  return cells.get(manualCellKey(point.x, point.y)) ?? null;
}

function writeManualCell(cells: ManualCells, point: GridPoint, colorId: string | null): void {
  if (!isBoardPoint(point)) return;
  const key = manualCellKey(point.x, point.y);
  if (colorId === null) cells.delete(key);
  else cells.set(key, colorId);
}

function serializeManualCells(cells: ManualCells): ManualEntry[] {
  const entries: ManualEntry[] = [];
  cells.forEach((colorId, key) => {
    const [x, y] = key.split(',').map(Number);
    if (Number.isInteger(x) && Number.isInteger(y) && isBoardPoint({ x, y }) && colorId) entries.push([x, y, colorId]);
  });
  return entries;
}

function gridsEqual(left: GridSnapshot, right: GridSnapshot): boolean {
  if (left.length !== right.length || left.some((row, y) => row.length !== right[y]?.length)) return false;
  return left.every((row, y) => row.every((value, x) => value === right[y]?.[x]));
}

function getLinePoints(start: GridPoint, end: GridPoint): GridPoint[] {
  const points: GridPoint[] = [];
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const sx = start.x < end.x ? 1 : -1;
  const sy = start.y < end.y ? 1 : -1;
  let error = dx - dy;
  let x = start.x;
  let y = start.y;
  while (true) {
    points.push({ x, y });
    if (x === end.x && y === end.y) return points;
    const doubled = error * 2;
    if (doubled > -dy) { error -= dy; x += sx; }
    if (doubled < dx) { error += dx; y += sy; }
  }
}

function getRectanglePoints(start: GridPoint, end: GridPoint): GridPoint[] {
  const points: GridPoint[] = [];
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  for (let x = minX; x <= maxX; x += 1) {
    points.push({ x, y: minY }, { x, y: maxY });
  }
  for (let y = minY + 1; y < maxY; y += 1) {
    points.push({ x: minX, y }, { x: maxX, y });
  }
  return points;
}

function getCirclePoints(start: GridPoint, end: GridPoint): GridPoint[] {
  const points = new Set<string>();
  const radius = Math.round(Math.hypot(end.x - start.x, end.y - start.y));
  let x = radius;
  let y = 0;
  let error = 0;
  const add = (px: number, py: number) => points.add(`${px},${py}`);
  while (x >= y) {
    add(start.x + x, start.y + y);
    add(start.x + y, start.y + x);
    add(start.x - y, start.y + x);
    add(start.x - x, start.y + y);
    add(start.x - x, start.y - y);
    add(start.x - y, start.y - x);
    add(start.x + y, start.y - x);
    add(start.x + x, start.y - y);
    if (error <= 0) { y += 1; error += 2 * y + 1; }
    if (error > 0) { x -= 1; error -= 2 * x + 1; }
  }
  return [...points].map(value => {
    const [x, y] = value.split(',').map(Number);
    return { x, y };
  });
}

function createId(prefix = 'large-frame'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createFrame(rect: LargeCanvasGridRect, index: number, maxSide: LargeCanvasMaxSide): LargeCanvasFrame {
  return {
    id: rect.id,
    title: `图框 ${index + 1}`,
    rect,
    maxSide,
    sourceImageDataUrl: null,
    mode: 'cartoon',
    beanResult: null,
    loading: false,
    error: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isConversionMode(value: unknown): value is LargeCanvasConversionMode {
  return value === 'cartoon' || value === 'photo' || value === 'logo';
}

function isMaxSide(value: unknown): value is LargeCanvasMaxSide {
  return value === 25 || value === 50 || value === 100;
}

function normalizeViewScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_VIEW_SCALE;
  const clamped = Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, value));
  return Number((Math.round(clamped / VIEW_SCALE_STEP) * VIEW_SCALE_STEP).toFixed(2));
}

function readStoredViewScale(): number {
  if (typeof window === 'undefined') return DEFAULT_VIEW_SCALE;
  try {
    const raw = window.localStorage.getItem(LARGE_CANVAS_VIEW_SCALE_KEY);
    return raw === null ? DEFAULT_VIEW_SCALE : normalizeViewScale(Number(raw));
  } catch {
    return DEFAULT_VIEW_SCALE;
  }
}

function isViewScaleIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('button, input, select, textarea, [contenteditable="true"], [data-view-scale-ignore]'));
}

function readBeanResult(value: unknown, width: number, height: number): (string | null)[][] | null {
  if (!Array.isArray(value) || value.length !== height) return null;
  const rows: (string | null)[][] = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== width || !row.every(cell => cell === null || typeof cell === 'string')) return null;
    rows.push([...row] as (string | null)[]);
  }
  return rows;
}

function readManualEntries(value: unknown): ManualEntry[] {
  if (!Array.isArray(value)) return [];
  const cells = new Map<string, string>();
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 3) continue;
    const [x, y, colorId] = entry;
    if (!Number.isInteger(x) || !Number.isInteger(y) || typeof colorId !== 'string' || !colorId || !isBoardPoint({ x, y })) continue;
    cells.set(manualCellKey(x, y), colorId);
  }
  return serializeManualCells(cells);
}

function restorePersistedFrames(): { frames: LargeCanvasFrame[]; selectedId: string | null; manualEntries: ManualEntry[]; restoreNotice: string | null } {
  if (typeof window === 'undefined') return { frames: [], selectedId: null, manualEntries: [], restoreNotice: null };
  try {
    const raw = window.localStorage.getItem(LARGE_CANVAS_STORAGE_KEY);
    if (!raw) return { frames: [], selectedId: null, manualEntries: [], restoreNotice: null };
    const parsed: unknown = JSON.parse(raw);
    const source = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.frames) ? parsed.frames : [];
    const frames: LargeCanvasFrame[] = [];
    const ids = new Set<string>();
    let skippedFrames = 0;
    let droppedLegacySources = 0;
    for (const value of source) {
      if (!isRecord(value) || typeof value.id !== 'string' || !value.id || value.id.length > 160 || ids.has(value.id)) {
        skippedFrames += 1;
        continue;
      }
      const rawRect = isRecord(value.rect) ? value.rect : null;
      if (!rawRect || !['x', 'y', 'width', 'height'].every(key => typeof rawRect[key] === 'number' && Number.isInteger(rawRect[key]))) {
        skippedFrames += 1;
        continue;
      }
      const rect = snapLargeCanvasGridRect({ id: value.id, x: rawRect.x as number, y: rawRect.y as number, width: rawRect.width as number, height: rawRect.height as number });
      if (rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || rect.width > LARGE_CANVAS_MAX_GRID_SIZE || rect.height > LARGE_CANVAS_MAX_GRID_SIZE || rect.x + rect.width > BOARD_GRID_WIDTH || rect.y + rect.height > BOARD_GRID_HEIGHT) {
        skippedFrames += 1;
        continue;
      }
      // Legacy records did not have maxSide. Infer the smallest valid tier that preserves their size.
      const maxSide: LargeCanvasMaxSide = isMaxSide(value.maxSide)
        ? value.maxSide
        : LARGE_CANVAS_MAX_SIDES.find(side => Math.max(rect.width, rect.height) <= side) ?? 100;
      const accepted = getNewLargeCanvasGridRectCandidate(rect, frames.map(frame => frame.rect));
      if (!accepted) {
        skippedFrames += 1;
        continue;
      }
      const beanResult = readBeanResult(value.beanResult, accepted.width, accepted.height);
      if (value.beanResult !== null && value.beanResult !== undefined && !beanResult) {
        skippedFrames += 1;
        continue;
      }
      if (typeof value.sourceImageDataUrl === 'string') droppedLegacySources += 1;
      const title = typeof value.title === 'string' && value.title.trim() && value.title.trim().length <= 80
        ? value.title.trim()
        : `图框 ${frames.length + 1}`;
      const error = typeof value.error === 'string' && value.error.trim() && value.error.trim().length <= 160
        ? value.error.trim()
        : null;
      frames.push({
        id: value.id,
        title,
        rect: accepted,
        maxSide,
        sourceImageDataUrl: null,
        mode: isConversionMode(value.mode) ? value.mode : 'cartoon',
        beanResult,
        loading: false,
        error,
      });
      ids.add(value.id);
    }
    const selectedId = isRecord(parsed) && typeof parsed.selectedId === 'string' && frames.some(frame => frame.id === parsed.selectedId) ? parsed.selectedId : null;
    const manualEntries = isRecord(parsed) ? readManualEntries(parsed.manualEntries) : [];
    const notices = [
      skippedFrames ? `已跳过 ${skippedFrames} 个损坏图框。` : '',
      droppedLegacySources ? '旧版源图未恢复；需要重新上传图片后才能重新生成。' : '',
    ].filter(Boolean);
    return { frames, selectedId, manualEntries, restoreNotice: notices.join(' ') || null };
  } catch {
    return { frames: [], selectedId: null, manualEntries: [], restoreNotice: '本地大画板记录损坏，已忽略该记录。' };
  }
}

function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  return fetch(dataUrl).then(response => response.blob()).then(blob => new File([blob], name, { type: blob.type || 'image/png' }));
}

function getImageNaturalSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (typeof URL === 'undefined' || typeof Image === 'undefined') {
      resolve({ width: 1, height: 1 });
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: image.naturalWidth || image.width || 1, height: image.naturalHeight || image.height || 1 });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('无法读取图片尺寸'));
    };
    image.src = objectUrl;
  });
}

function drawBeanAt(context: CanvasRenderingContext2D, colorId: string, paletteMap: Map<string, { hex: string; code?: string; name?: string }>, px: number, py: number, beadShape: BeadShape): void {
  context.fillStyle = paletteMap.get(colorId)?.hex ?? '#CBD5E1';
  if (beadShape === 'circle_flat' || beadShape === 'fuse_3d') {
    context.beginPath();
    context.arc(px + GRID_CELL_SIZE / 2, py + GRID_CELL_SIZE / 2, GRID_CELL_SIZE * 0.42, 0, Math.PI * 2);
    context.fill();
    if (beadShape === 'fuse_3d') {
      context.fillStyle = 'rgba(255,255,255,0.3)';
      context.beginPath();
      context.arc(px + GRID_CELL_SIZE * 0.36, py + GRID_CELL_SIZE * 0.34, GRID_CELL_SIZE * 0.13, 0, Math.PI * 2);
      context.fill();
    }
  } else {
    context.fillRect(px + 1, py + 1, GRID_CELL_SIZE - 2, GRID_CELL_SIZE - 2);
  }
}

function drawBeanResult(context: CanvasRenderingContext2D, frame: LargeCanvasFrame, paletteMap: Map<string, { hex: string; code?: string; name?: string }>, offsetX: number, offsetY: number, beadShape: BeadShape = 'circle_flat'): void {
  if (!frame.beanResult) return;
  frame.beanResult.forEach((row, y) => row.forEach((colorId, x) => {
    if (!colorId) return;
    drawBeanAt(context, colorId, paletteMap, (frame.rect.x - offsetX + x) * GRID_CELL_SIZE, (frame.rect.y - offsetY + y) * GRID_CELL_SIZE, beadShape);
  }));
}

function drawExportSheet(
  canvas: HTMLCanvasElement,
  frames: LargeCanvasFrame[],
  paletteMap: Map<string, { hex: string; code?: string; name?: string }>,
  beadShape: BeadShape,
  brandName: string,
  manualCells: ManualCells,
): void {
  const bounds: { minX: number; minY: number; maxX: number; maxY: number }[] = frames.map(frame => ({
    minX: frame.rect.x,
    minY: frame.rect.y,
    maxX: frame.rect.x + frame.rect.width,
    maxY: frame.rect.y + frame.rect.height,
  }));
  manualCells.forEach((_, key) => {
    const [x, y] = key.split(',').map(Number);
    if (Number.isInteger(x) && Number.isInteger(y) && isBoardPoint({ x, y })) bounds.push({ minX: x, minY: y, maxX: x + 1, maxY: y + 1 });
  });
  if (!bounds.length) {
    canvas.width = 1;
    canvas.height = 1;
    return;
  }
  const minX = Math.min(...bounds.map(bound => bound.minX));
  const minY = Math.min(...bounds.map(bound => bound.minY));
  const maxX = Math.max(...bounds.map(bound => bound.maxX));
  const maxY = Math.max(...bounds.map(bound => bound.maxY));
  const cell = GRID_CELL_SIZE;
  const marginLeft = 42;
  const marginTop = 38;
  const legendWidth = 250;
  const composedCells = new Map<string, string>();
  frames.forEach(frame => frame.beanResult?.forEach((row, y) => row.forEach((colorId, x) => {
    if (colorId) composedCells.set(manualCellKey(frame.rect.x + x, frame.rect.y + y), colorId);
  })));
  manualCells.forEach((colorId, key) => {
    const [x, y] = key.split(',').map(Number);
    if (Number.isInteger(x) && Number.isInteger(y) && isBoardPoint({ x, y })) composedCells.set(key, colorId);
  });
  const counts = new Map<string, number>();
  composedCells.forEach(colorId => counts.set(colorId, (counts.get(colorId) ?? 0) + 1));
  const legendHeight = Math.max(18, counts.size * 16 + 48);
  canvas.width = (maxX - minX) * cell + marginLeft + legendWidth;
  canvas.height = Math.max((maxY - minY) * cell + marginTop + 18, marginTop + legendHeight);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#1e293b';
  context.font = 'bold 14px sans-serif';
  context.fillText(`${brandName} · ${beadShape === 'fuse_3d' ? '3D立体' : beadShape === 'circle_flat' ? '圆豆平面' : beadShape === 'ironed' ? '熨烫豆' : '方豆平面'}`, 8, 18);
  const gridWidth = maxX - minX;
  const gridHeight = maxY - minY;
  context.strokeStyle = '#cbd5e1';
  context.lineWidth = 0.5;
  for (let x = 0; x <= gridWidth; x += 1) {
    context.beginPath();
    context.moveTo(marginLeft + x * cell, marginTop);
    context.lineTo(marginLeft + x * cell, marginTop + gridHeight * cell);
    context.stroke();
  }
  for (let y = 0; y <= gridHeight; y += 1) {
    context.beginPath();
    context.moveTo(marginLeft, marginTop + y * cell);
    context.lineTo(marginLeft + gridWidth * cell, marginTop + y * cell);
    context.stroke();
  }
  context.fillStyle = '#64748b';
  context.font = '9px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  for (let x = 0; x < gridWidth; x += 5) context.fillText(getColumnLetter(minX + x), marginLeft + x * cell + cell / 2, marginTop - 8);
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (let y = 0; y < gridHeight; y += 5) context.fillText(String(minY + y + 1), marginLeft - 6, marginTop + y * cell + cell / 2);
  frames.forEach(frame => {
    drawBeanResult(context, frame, paletteMap, minX - marginLeft / cell, minY - marginTop / cell, beadShape);
  });
  manualCells.forEach((colorId, key) => {
    const [x, y] = key.split(',').map(Number);
    if (Number.isInteger(x) && Number.isInteger(y) && isBoardPoint({ x, y })) {
      drawBeanAt(context, colorId, paletteMap, marginLeft + (x - minX) * cell, marginTop + (y - minY) * cell, beadShape);
    }
  });
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#0f172a';
  context.font = 'bold 11px sans-serif';
  context.fillText('色号统计', marginLeft + gridWidth * cell + 14, marginTop + 12);
  let legendY = marginTop + 30;
  [...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([id, count]) => {
    const color = paletteMap.get(id);
    context.fillStyle = color?.hex ?? '#cbd5e1';
    context.fillRect(marginLeft + gridWidth * cell + 14, legendY - 9, 12, 12);
    context.fillStyle = '#334155';
    context.font = '10px sans-serif';
    context.fillText(`${color?.code ?? id} · ${count}颗${color?.name ? ` · ${color.name}` : ''}`, marginLeft + gridWidth * cell + 32, legendY);
    legendY += 16;
  });
}

function getManualCellsInRect(cells: ManualCells, rect: LargeCanvasGridRect): ManualCells {
  const result = new Map<string, string>();
  cells.forEach((colorId, key) => {
    const [x, y] = key.split(',').map(Number);
    if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) result.set(key, colorId);
  });
  return result;
}

function hasManualCellsInRect(cells: ManualCells, rect: LargeCanvasGridRect): boolean {
  for (const key of cells.keys()) {
    const [x, y] = key.split(',').map(Number);
    if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) return true;
  }
  return false;
}

function downloadCanvas(canvas: HTMLCanvasElement, name: string): void {
  const link = document.createElement('a');
  link.download = name;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function FrameBeanGrid({ frame, paletteMap, rect, beadShape, showCodeLabels }: { frame: LargeCanvasFrame; paletteMap: Map<string, { hex: string; code?: string }>; rect: LargeCanvasGridRect; beadShape: BeadShape; showCodeLabels: boolean }) {
  const grid = frame.beanResult;
  if (!grid || grid.length !== rect.height || grid[0]?.length !== rect.width) return null;
  return (
    <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${rect.width}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rect.height}, minmax(0, 1fr))` }} aria-label={`${frame.title}豆点阵`}>
      {grid.flatMap((row, y) => row.map((colorId, x) => {
        const color = colorId ? paletteMap.get(colorId) : undefined;
        const isRound = beadShape === 'circle_flat' || beadShape === 'fuse_3d';
        return (
        <span key={`${y}-${x}`} className="flex min-h-0 min-w-0 items-center justify-center overflow-hidden text-[5px] font-black leading-none text-slate-950/75" style={{
          backgroundColor: color?.hex ?? (colorId ? '#CBD5E1' : 'transparent'),
          borderRadius: isRound ? '999px' : beadShape === 'ironed' ? '2px' : '0',
          margin: isRound || beadShape === 'ironed' ? '1px' : 0,
          boxShadow: beadShape === 'fuse_3d' ? 'inset 1px 1px 2px rgba(255,255,255,0.65), inset -1px -1px 2px rgba(15,23,42,0.25)' : undefined,
        }}>{showCodeLabels && colorId ? color?.code ?? colorId : ''}</span>
        );
      }))}
    </div>
  );
}

function ManualBeanLayer({ cells, paletteMap, beadShape, cellSize, showCodeLabels }: { cells: ManualCells; paletteMap: Map<string, { hex: string; code?: string }>; beadShape: BeadShape; cellSize: number; showCodeLabels: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isRound = beadShape === 'circle_flat' || beadShape === 'fuse_3d';
  const inset = isRound || beadShape === 'ironed' ? Math.max(0.5, cellSize * 0.1) : 0;
  const beadSize = Math.max(1, cellSize - inset * 2);
  const width = BOARD_GRID_WIDTH * cellSize;
  const height = BOARD_GRID_HEIGHT * cellSize;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (showCodeLabels) {
      context.font = `900 ${Math.max(4, Math.round(cellSize * 0.45))}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
    }

    cells.forEach((colorId, key) => {
      const separator = key.indexOf(',');
      const x = Number(key.slice(0, separator));
      const y = Number(key.slice(separator + 1));
      if (!Number.isInteger(x) || !Number.isInteger(y) || !isBoardPoint({ x, y })) return;
      const color = paletteMap.get(colorId);
      const left = x * cellSize + inset;
      const top = y * cellSize + inset;
      context.fillStyle = color?.hex ?? '#CBD5E1';
      if (isRound) {
        context.beginPath();
        context.arc(left + beadSize / 2, top + beadSize / 2, beadSize / 2, 0, Math.PI * 2);
        context.fill();
        if (beadShape === 'fuse_3d') {
          context.fillStyle = 'rgba(255,255,255,0.35)';
          context.beginPath();
          context.arc(left + beadSize * 0.36, top + beadSize * 0.34, Math.max(0.5, beadSize * 0.13), 0, Math.PI * 2);
          context.fill();
        }
      } else {
        context.fillRect(left, top, beadSize, beadSize);
      }
      if (showCodeLabels) {
        context.fillStyle = 'rgba(15,23,42,0.75)';
        context.fillText(color?.code ?? colorId, x * cellSize + cellSize / 2, y * cellSize + cellSize / 2);
      }
    });
    canvas.dataset.renderedCellCount = String(cells.size);
  }, [beadShape, beadSize, cells, cellSize, height, inset, isRound, paletteMap, showCodeLabels, width]);

  return <canvas ref={canvasRef} data-large-canvas-manual-layer data-cell-count={cells.size} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-20" style={{ width, height }} />;
}

function findAvailableRect(width: number, height: number, frames: readonly LargeCanvasFrame[], id = createId('large-frame')): LargeCanvasGridRect | null {
  if (width > BOARD_GRID_WIDTH || height > BOARD_GRID_HEIGHT) return null;
  const occupied = frames.map(frame => frame.rect);
  for (let y = 0; y <= BOARD_GRID_HEIGHT - height; y += 1) {
    for (let x = 0; x <= BOARD_GRID_WIDTH - width; x += 1) {
      const candidate = { id, x, y, width, height };
      if (getNewLargeCanvasGridRectCandidate(candidate, occupied)) return candidate;
    }
  }
  return null;
}

export const LargeCanvasView: React.FC<LargeCanvasViewProps> = ({
  paletteMap,
  brandName,
  paletteOptions,
  selectedPaletteId,
  onChangePalette,
  beadShape,
  onChangeBeadShape,
  canvasBackdrop,
  onChangeCanvasBackdrop,
  showGridLines,
  showCodeLabels,
  onChangeShowCodeLabels,
  showDataPreview,
  onChangeShowDataPreview,
  conversionSettings,
  onChangeConversionSettings,
  onConvertImage,
  onPrepareImage,
  onOpenFrame,
}) => {
  const { currentUser, userProfile } = useAuth();
  const initialState = useRef<{ frames: LargeCanvasFrame[]; selectedId: string | null; manualEntries: ManualEntry[]; restoreNotice: string | null } | null>(null);
  if (!initialState.current) initialState.current = restorePersistedFrames();
  const [frames, setFrames] = useState<LargeCanvasFrame[]>(() => initialState.current?.frames ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(() => initialState.current?.selectedId ?? null);
  const [manualCells, setManualCells] = useState<ManualCells>(() => new Map((initialState.current?.manualEntries ?? []).map(([x, y, colorId]) => [manualCellKey(x, y), colorId])));
  const [popupTab, setPopupTab] = useState<'basic' | 'params'>('basic');
  const [drawMode, setDrawMode] = useState(false);
  const [drawColorId, setDrawColorId] = useState<string | null>(() => Array.from(paletteMap.keys())[0] ?? null);
  const [panMode, setPanMode] = useState(true);
  const [activeTool, setActiveTool] = useState<LargeCanvasTool>('pan');
  const [symmetryMode, setSymmetryMode] = useState<LargeCanvasSymmetry>('none');
  const [toolbarExpanded, setToolbarExpanded] = useState(true);
  const [mobileToolbarPanel, setMobileToolbarPanel] = useState<'tools' | 'view' | 'settings'>('tools');
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [colorPickerAnchor, setColorPickerAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const colorPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const drawingPointerRef = useRef<number | null>(null);
  const drawingTransactionRef = useRef<{
    frameId: string;
    start: GridPoint;
    before: GridSnapshot;
    working: GridSnapshot;
    rafId: number | null;
  } | null>(null);
  const shapePreviewRef = useRef<{ frameId: string; start: GridPoint; end: GridPoint; rafId: number | null } | null>(null);
  const [shapePreview, setShapePreview] = useState<ShapePreview | null>(null);
  const manualDrawingRef = useRef<ManualDrawingTransaction | null>(null);
  const manualShapePreviewRef = useRef<{ start: GridPoint; end: GridPoint; rafId: number | null } | null>(null);
  const [manualShapePreview, setManualShapePreview] = useState<ManualShapePreview | null>(null);
  const frameHistoryRef = useRef(new Map<string, FrameHistory>());
  const [historyVersion, setHistoryVersion] = useState(0);
  const manualCellsRef = useRef<ManualCells>(manualCells);
  const manualHistoryRef = useRef<ManualHistory>({ past: [], future: [] });
  const [manualHistoryVersion, setManualHistoryVersion] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [newFrameMaxSide, setNewFrameMaxSide] = useState<LargeCanvasMaxSide>(DEFAULT_MAX_SIDE);
  const [interaction, setInteraction] = useState<GridInteraction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [restoreNotice] = useState<string | null>(() => initialState.current?.restoreNotice ?? null);
  const [viewScale, setViewScale] = useState(readStoredViewScale);
  const viewScaleRef = useRef(viewScale);
  const pinchStateRef = useRef({ active: false, initialDistance: 0, initialScale: DEFAULT_VIEW_SCALE });
  const canvasHoveredRef = useRef(false);
  const spacePressedRef = useRef(false);
  const panInteractionRef = useRef<CanvasPanInteraction | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const requestVersions = useRef(new Map<string, number>());

  const hasFormalLogin = Boolean(currentUser) && !isGuestAccount(currentUser) && !isGuestAccount(userProfile);

  const requireFormalLoginForExport = useCallback((): boolean => {
    if (hasFormalLogin) return true;
    setMessage('请先登录，再导出图纸。');
    window.dispatchEvent(new Event('unauthorized'));
    return false;
  }, [hasFormalLogin]);

  useEffect(() => {
    if (hasFormalLogin) {
      setMessage(current => current === '请先登录，再导出图纸。' ? null : current);
    }
  }, [hasFormalLogin]);

  const chooseDrawColor = (colorId: string | null) => {
    setDrawColorId(colorId);
    setActiveTool(colorId === null ? 'eraser' : 'pencil');
    setPanMode(false);
    setDrawMode(true);
    setIsColorPickerOpen(false);
  };

  const toggleColorPicker = (trigger: HTMLButtonElement | null = colorPickerTriggerRef.current) => {
    if (isColorPickerOpen) {
      setIsColorPickerOpen(false);
      return;
    }
    const bounds = trigger?.getBoundingClientRect();
    if (bounds) {
      const width = Math.min(Math.max(bounds.width, 230), window.innerWidth - 16);
      setColorPickerAnchor({
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
        top: Math.min(bounds.bottom + 8, Math.max(8, window.innerHeight - 300)),
        width,
      });
    }
    setIsColorPickerOpen(true);
  };

  const selectTool = (tool: LargeCanvasTool) => {
    setActiveTool(tool);
    setPanMode(tool === 'pan');
    setDrawMode(tool !== 'pan');
    if (tool === 'pencil' && !drawColorId) setDrawColorId(Array.from(paletteMap.keys())[0] ?? null);
    if (tool === 'eraser') setDrawColorId(null);
  };

  useEffect(() => () => {
    cancelLargeCanvasRaf(drawingTransactionRef.current, rafId => window.cancelAnimationFrame(rafId));
    cancelLargeCanvasRaf(shapePreviewRef.current, rafId => window.cancelAnimationFrame(rafId));
    cancelLargeCanvasRaf(manualDrawingRef.current, rafId => window.cancelAnimationFrame(rafId));
    cancelLargeCanvasRaf(manualShapePreviewRef.current, rafId => window.cancelAnimationFrame(rafId));
  }, []);

  useEffect(() => {
    manualCellsRef.current = manualCells;
  }, [manualCells]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const persistedFrames = frames.map(({ sourceImageDataUrl: _sourceImageDataUrl, loading: _loading, error: _error, ...frame }) => frame);
        window.localStorage.setItem(LARGE_CANVAS_STORAGE_KEY, JSON.stringify({ frames: persistedFrames, selectedId, manualEntries: serializeManualCells(manualCells) }));
        setStorageMessage(null);
      } catch {
        setStorageMessage('本地保存空间不足，当前工作区仍可继续使用。');
      }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [frames, manualCells, selectedId]);

  useEffect(() => {
    viewScaleRef.current = viewScale;
    try {
      window.localStorage.setItem(LARGE_CANVAS_VIEW_SCALE_KEY, String(viewScale));
    } catch {
      setStorageMessage('本地保存空间不足，缩放偏好未保存。');
    }
  }, [viewScale]);

  const updateFrame = (id: string, update: Partial<LargeCanvasFrame>) => {
    setFrames(current => current.map(frame => frame.id === id ? { ...frame, ...update } : frame));
  };

  const getFrameGrid = (frame: LargeCanvasFrame): GridSnapshot => {
    if (frame.beanResult && frame.beanResult.length === frame.rect.height && frame.beanResult[0]?.length === frame.rect.width) return cloneGrid(frame.beanResult);
    return createEmptyGrid(frame.rect.width, frame.rect.height);
  };

  const commitFrameGrid = (frameId: string, nextGrid: GridSnapshot, beforeGrid?: GridSnapshot): void => {
    setFrames(current => current.map(frame => {
      if (frame.id !== frameId) return frame;
      const previous = beforeGrid ?? getFrameGrid(frame);
      if (gridsEqual(previous, nextGrid)) return frame;
      const history = frameHistoryRef.current.get(frameId) ?? { past: [], future: [] };
      history.past = [...history.past, cloneGrid(previous)].slice(-MAX_FRAME_HISTORY);
      history.future = [];
      frameHistoryRef.current.set(frameId, history);
      return { ...frame, beanResult: cloneGrid(nextGrid), sourceImageDataUrl: null, error: null };
    }));
    setHistoryVersion(value => value + 1);
  };

  const replaceFrameGrid = (frameId: string, nextGrid: GridSnapshot): void => {
    setFrames(current => current.map(frame => frame.id === frameId ? { ...frame, beanResult: cloneGrid(nextGrid), sourceImageDataUrl: null, error: null } : frame));
  };

  const undoFrame = (frameId: string): void => {
    const history = frameHistoryRef.current.get(frameId);
    if (!history?.past.length) return;
    const previous = history.past[history.past.length - 1];
    const frame = frames.find(item => item.id === frameId);
    if (!frame || !previous) return;
    history.past = history.past.slice(0, -1);
    history.future = [...history.future, getFrameGrid(frame)].slice(-MAX_FRAME_HISTORY);
    frameHistoryRef.current.set(frameId, history);
    replaceFrameGrid(frameId, previous);
    setHistoryVersion(value => value + 1);
  };

  const redoFrame = (frameId: string): void => {
    const history = frameHistoryRef.current.get(frameId);
    if (!history?.future.length) return;
    const next = history.future[history.future.length - 1];
    const frame = frames.find(item => item.id === frameId);
    if (!frame || !next) return;
    history.future = history.future.slice(0, -1);
    history.past = [...history.past, getFrameGrid(frame)].slice(-MAX_FRAME_HISTORY);
    frameHistoryRef.current.set(frameId, history);
    replaceFrameGrid(frameId, next);
    setHistoryVersion(value => value + 1);
  };

  const replaceManualCells = (nextCells: ManualCells): void => {
    const snapshot = cloneManualCells(nextCells);
    manualCellsRef.current = snapshot;
    setManualCells(snapshot);
  };

  const commitManualCells = (nextCells: ManualCells, beforeCells: ManualCells = manualCellsRef.current): boolean => {
    if (manualCellsEqual(beforeCells, nextCells)) return false;
    const history = manualHistoryRef.current;
    history.past = [...history.past, cloneManualCells(beforeCells)].slice(-MAX_FRAME_HISTORY);
    history.future = [];
    replaceManualCells(nextCells);
    setManualHistoryVersion(value => value + 1);
    return true;
  };

  const undoManual = (): void => {
    const history = manualHistoryRef.current;
    const previous = history.past[history.past.length - 1];
    if (!previous) return;
    history.past = history.past.slice(0, -1);
    history.future = [...history.future, cloneManualCells(manualCellsRef.current)].slice(-MAX_FRAME_HISTORY);
    replaceManualCells(previous);
    setManualHistoryVersion(value => value + 1);
  };

  const redoManual = (): void => {
    const history = manualHistoryRef.current;
    const next = history.future[history.future.length - 1];
    if (!next) return;
    history.future = history.future.slice(0, -1);
    history.past = [...history.past, cloneManualCells(manualCellsRef.current)].slice(-MAX_FRAME_HISTORY);
    replaceManualCells(next);
    setManualHistoryVersion(value => value + 1);
  };

  const getManualSymmetricPoints = (point: GridPoint): GridPoint[] => {
    if (!isBoardPoint(point)) return [];
    const points = new Map<string, GridPoint>();
    const add = (x: number, y: number) => {
      const candidate = { x, y };
      if (isBoardPoint(candidate)) points.set(manualCellKey(x, y), candidate);
    };
    add(point.x, point.y);
    if (symmetryMode === 'horizontal' || symmetryMode === 'both') add(BOARD_GRID_WIDTH - 1 - point.x, point.y);
    if (symmetryMode === 'vertical' || symmetryMode === 'both') add(point.x, BOARD_GRID_HEIGHT - 1 - point.y);
    if (symmetryMode === 'both') add(BOARD_GRID_WIDTH - 1 - point.x, BOARD_GRID_HEIGHT - 1 - point.y);
    return [...points.values()];
  };

  const applyManualPoints = (cells: ManualCells, points: GridPoint[], colorId: string | null): void => {
    points.forEach(point => getManualSymmetricPoints(point).forEach(candidate => writeManualCell(cells, candidate, colorId)));
  };

  const getManualShapePoints = (start: GridPoint, end: GridPoint): GridPoint[] => {
    if (activeTool === 'line') return getLinePoints(start, end);
    if (activeTool === 'rectangle' || activeTool === 'cut') return getRectanglePoints(start, end);
    return getCirclePoints(start, end);
  };

  const applyManualBucket = (cells: ManualCells, point: GridPoint): void => {
    const replacement = drawColorId;
    getManualSymmetricPoints(point).forEach(seed => {
      const source = readManualCell(cells, seed);
      fillLargeCanvasConnectedRegion(
        BOARD_GRID_WIDTH,
        BOARD_GRID_HEIGHT,
        seed,
        source,
        replacement,
        (x, y) => readManualCell(cells, { x, y }),
        (x, y, colorId) => writeManualCell(cells, { x, y }, colorId),
      );
    });
  };

  const applyManualReplace = (cells: ManualCells, source: string | null): void => {
    if (source === drawColorId) return;
    if (source === null) {
      if (drawColorId === null) return;
      for (let y = 0; y < BOARD_GRID_HEIGHT; y += 1) {
        for (let x = 0; x < BOARD_GRID_WIDTH; x += 1) writeManualCell(cells, { x, y }, drawColorId);
      }
      return;
    }
    [...cells.entries()].forEach(([key, colorId]) => {
      if (colorId === source) {
        if (drawColorId === null) cells.delete(key);
        else cells.set(key, drawColorId);
      }
    });
  };

  const getManualCutBounds = (start: GridPoint, end: GridPoint): { minX: number; maxX: number; minY: number; maxY: number } | null => {
    const minX = Math.max(0, Math.min(start.x, end.x));
    const maxX = Math.min(BOARD_GRID_WIDTH - 1, Math.max(start.x, end.x));
    const minY = Math.max(0, Math.min(start.y, end.y));
    const maxY = Math.min(BOARD_GRID_HEIGHT - 1, Math.max(start.y, end.y));
    if (minX > maxX || minY > maxY || (minX === maxX && minY === maxY)) return null;
    return { minX, maxX, minY, maxY };
  };

  const applyManualCut = (cells: ManualCells, bounds: { minX: number; maxX: number; minY: number; maxY: number }): void => {
    [...cells.keys()].forEach(key => {
      const [x, y] = key.split(',').map(Number);
      if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) cells.delete(key);
    });
  };

  useEffect(() => {
    if (drawColorId && paletteMap.has(drawColorId)) return;
    setDrawColorId(Array.from(paletteMap.keys())[0] ?? null);
  }, [drawColorId, paletteMap]);

  const ensureEditableGrid = (frame: LargeCanvasFrame): void => {
    if (frame.beanResult && frame.beanResult.length === frame.rect.height && frame.beanResult[0]?.length === frame.rect.width) return;
    updateFrame(frame.id, {
      beanResult: Array.from({ length: frame.rect.height }, () => Array<string | null>(frame.rect.width).fill(null)),
      sourceImageDataUrl: null,
      loading: false,
      error: null,
    });
  };

  const applyPointToGrid = (grid: GridSnapshot, point: GridPoint, frame: LargeCanvasFrame, colorId: string | null): void => {
    const x = point.x - frame.rect.x;
    const y = point.y - frame.rect.y;
    if (x >= 0 && y >= 0 && x < frame.rect.width && y < frame.rect.height) grid[y][x] = colorId;
  };

  const isPointInFrame = (point: GridPoint, frame: LargeCanvasFrame): boolean => (
    point.x >= frame.rect.x
    && point.y >= frame.rect.y
    && point.x < frame.rect.x + frame.rect.width
    && point.y < frame.rect.y + frame.rect.height
  );

  const getSymmetricPoints = (point: GridPoint, frame: LargeCanvasFrame): GridPoint[] => {
    if (!isPointInFrame(point, frame)) return [];
    const relativeX = point.x - frame.rect.x;
    const relativeY = point.y - frame.rect.y;
    const points = new Map<string, GridPoint>();
    const add = (x: number, y: number) => points.set(`${x},${y}`, { x, y });
    add(point.x, point.y);
    if (symmetryMode === 'horizontal' || symmetryMode === 'both') add(frame.rect.x + frame.rect.width - 1 - relativeX, point.y);
    if (symmetryMode === 'vertical' || symmetryMode === 'both') add(point.x, frame.rect.y + frame.rect.height - 1 - relativeY);
    if (symmetryMode === 'both') add(frame.rect.x + frame.rect.width - 1 - relativeX, frame.rect.y + frame.rect.height - 1 - relativeY);
    return [...points.values()].filter(candidate => isPointInFrame(candidate, frame));
  };

  const applySymmetricPointsToGrid = (grid: GridSnapshot, points: GridPoint[], frame: LargeCanvasFrame, colorId: string | null): void => {
    points.forEach(point => getSymmetricPoints(point, frame).forEach(candidate => applyPointToGrid(grid, candidate, frame, colorId)));
  };

  const mapSymmetricPoints = (points: GridPoint[], frame: LargeCanvasFrame): GridPoint[] => {
    const mapped = new Map<string, GridPoint>();
    points.forEach(point => getSymmetricPoints(point, frame).forEach(candidate => mapped.set(`${candidate.x},${candidate.y}`, candidate)));
    return [...mapped.values()];
  };

  const paintAtPoint = (point: GridPoint, frameId: string, targetGrid?: GridSnapshot): void => {
    const frame = frames.find(item => item.id === frameId);
    if (!frame) return;
    const nextGrid = targetGrid ?? getFrameGrid(frame);
    applySymmetricPointsToGrid(nextGrid, [point], frame, activeTool === 'eraser' ? null : drawColorId);
    if (targetGrid) replaceFrameGrid(frameId, nextGrid);
    else commitFrameGrid(frameId, nextGrid);
  };

  const nextRequestVersion = (id: string): number => {
    const version = (requestVersions.current.get(id) ?? 0) + 1;
    requestVersions.current.set(id, version);
    return version;
  };

  const getOtherRects = (frameId?: string) => frames.filter(frame => frame.id !== frameId).map(frame => frame.rect);

  const convertFrame = (frame: LargeCanvasFrame, fileOrPromise: File | Promise<File>, mode: LargeCanvasConversionMode, maxSide: LargeCanvasMaxSide, title: string, dimensions?: { width: number; height: number }) => {
    const version = nextRequestVersion(frame.id);
    updateFrame(frame.id, { loading: true, error: null });
    void Promise.resolve(fileOrPromise)
      .then(async file => {
        const natural = dimensions ?? await getImageNaturalSize(file);
        if (requestVersions.current.get(frame.id) !== version) return null;
        const size = getLargeCanvasGridDimensions(natural.width, natural.height, maxSide);
        const candidate = getNewLargeCanvasGridRectCandidate({ ...frame.rect, width: size.width, height: size.height }, getOtherRects(frame.id));
        if (!candidate || candidate.x + candidate.width > BOARD_GRID_WIDTH || candidate.y + candidate.height > BOARD_GRID_HEIGHT) {
          throw new Error('图框尺寸扩大后与其他图框重叠，已拦截。');
        }
        if (requestVersions.current.get(frame.id) !== version) return null;
        const result = await onConvertImage(file, mode, candidate.width, candidate.height);
        return { candidate, result };
      })
      .then(payload => {
        if (!payload || requestVersions.current.get(frame.id) !== version) return;
        updateFrame(frame.id, {
          rect: payload.candidate,
          title,
          mode,
          maxSide,
          sourceImageDataUrl: payload.result.sourceImageDataUrl,
          beanResult: payload.result.grid,
          loading: false,
          error: null,
        });
      })
      .catch(error => {
        if (requestVersions.current.get(frame.id) !== version) return;
        const errorMessage = error instanceof Error ? error.message : '图片转换失败';
        updateFrame(frame.id, {
          loading: false,
          error: errorMessage === IMAGE_PREPROCESSING_CANCELLED ? frame.error : errorMessage,
        });
      });
  };

  const reconvertFrame = (frame: LargeCanvasFrame, maxSide = frame.maxSide) => {
    if (!frame.sourceImageDataUrl) {
      setMessage('该图框没有可用源图，手绘结果不能重新生成。');
      return;
    }
    convertFrame(frame, dataUrlToFile(frame.sourceImageDataUrl, `${frame.title}.png`), frame.mode, maxSide, frame.title);
  };

  const loadFile = (frame: LargeCanvasFrame, file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) {
      setMessage('请选择图片文件。');
      return;
    }
    convertFrame(frame, onPrepareImage ? onPrepareImage(file) : file, frame.mode, frame.maxSide, file.name.replace(/\.[^/.]+$/, '') || frame.title);
  };

  const getGridPoint = (event: React.PointerEvent): GridPoint | null => {
    const board = boardRef.current;
    if (!board) return null;
    const bounds = board.getBoundingClientRect();
    const scaledCellSize = GRID_CELL_SIZE * viewScale;
    return {
      x: Math.max(0, Math.min(BOARD_GRID_WIDTH - 1, Math.floor((event.clientX - bounds.left) / scaledCellSize))),
      y: Math.max(0, Math.min(BOARD_GRID_HEIGHT - 1, Math.floor((event.clientY - bounds.top) / scaledCellSize))),
    };
  };

  const updateManualShapePreview = (start: GridPoint, end: GridPoint): void => {
    const sourcePoints = getManualShapePoints(start, end).filter(isBoardPoint);
    const points = activeTool === 'cut'
      ? sourcePoints
      : [...new Map(sourcePoints.flatMap(point => getManualSymmetricPoints(point).map(candidate => [manualCellKey(candidate.x, candidate.y), candidate] as const))).values()];
    setManualShapePreview({ points, selection: activeTool === 'cut' ? { start, end } : undefined });
  };

  const startManualDrawing = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!drawMode || event.button !== 0 || pinchStateRef.current.active || isViewScaleIgnoredTarget(event.target)) return;
    const point = getGridPoint(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    const before = cloneManualCells(manualCellsRef.current);
    const working = cloneManualCells(before);
    manualDrawingRef.current = { pointerId: event.pointerId, start: point, before, working, rafId: null };
    manualShapePreviewRef.current = ['line', 'rectangle', 'circle', 'cut'].includes(activeTool)
      ? { start: point, end: point, rafId: null }
      : null;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (activeTool === 'bucket') {
      applyManualBucket(working, point);
      commitManualCells(working, before);
      manualDrawingRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (activeTool === 'eyedropper') {
      setDrawColorId(readManualCell(working, point));
      manualDrawingRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (activeTool === 'replace') {
      applyManualReplace(working, readManualCell(working, point));
      commitManualCells(working, before);
      manualDrawingRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (!manualShapePreviewRef.current) {
      applyManualPoints(working, [point], activeTool === 'eraser' ? null : drawColorId);
      replaceManualCells(working);
    } else {
      updateManualShapePreview(point, point);
    }
  };

  const continueManualDrawing = (event: React.PointerEvent<HTMLDivElement>): void => {
    const transaction = manualDrawingRef.current;
    if (!transaction || transaction.pointerId !== event.pointerId || pinchStateRef.current.active) return;
    event.preventDefault();
    event.stopPropagation();
    const point = getGridPoint(event);
    if (!point) return;
    const shapePreview = manualShapePreviewRef.current;
    if (shapePreview) {
      shapePreview.end = point;
      if (shapePreview.rafId === null) {
        shapePreview.rafId = window.requestAnimationFrame(() => {
          if (manualShapePreviewRef.current !== shapePreview) return;
          const preview = shapePreview;
          preview.rafId = null;
          updateManualShapePreview(preview.start, preview.end);
        });
      }
      return;
    }
    applyManualPoints(transaction.working, [point], activeTool === 'eraser' ? null : drawColorId);
    if (transaction.rafId === null) {
      transaction.rafId = window.requestAnimationFrame(() => {
        if (manualDrawingRef.current !== transaction) return;
        transaction.rafId = null;
        replaceManualCells(transaction.working);
      });
    }
  };

  const finishManualDrawing = (event: React.PointerEvent<HTMLDivElement>): void => {
    const transaction = manualDrawingRef.current;
    if (!transaction || transaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    cancelLargeCanvasRaf(transaction, rafId => window.cancelAnimationFrame(rafId));
    if (manualShapePreviewRef.current) {
      const preview = manualShapePreviewRef.current;
      cancelLargeCanvasRaf(preview, rafId => window.cancelAnimationFrame(rafId));
      const nextCells = cloneManualCells(transaction.before);
      if (activeTool === 'cut') {
        const bounds = getManualCutBounds(preview.start, preview.end);
        if (bounds) applyManualCut(nextCells, bounds);
      } else {
        applyManualPoints(nextCells, getManualShapePoints(preview.start, preview.end), activeTool === 'eraser' ? null : drawColorId);
      }
      commitManualCells(nextCells, transaction.before);
    } else if (activeTool !== 'bucket' && activeTool !== 'eyedropper' && activeTool !== 'replace') {
      commitManualCells(transaction.working, transaction.before);
    }
    manualDrawingRef.current = null;
    manualShapePreviewRef.current = null;
    setManualShapePreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const cancelManualDrawing = (event: React.PointerEvent<HTMLDivElement>): void => {
    const transaction = manualDrawingRef.current;
    if (!transaction || transaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    cancelLargeCanvasRaf(transaction, rafId => window.cancelAnimationFrame(rafId));
    cancelLargeCanvasRaf(manualShapePreviewRef.current, rafId => window.cancelAnimationFrame(rafId));
    replaceManualCells(transaction.before);
    manualDrawingRef.current = null;
    manualShapePreviewRef.current = null;
    setManualShapePreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const changeViewScale = (value: number, anchor?: { clientX: number; clientY: number }): boolean => {
    const previous = viewScaleRef.current;
    const next = normalizeViewScale(value);
    if (next === previous) return false;

    const scrollContainer = scrollContainerRef.current;
    const board = boardRef.current;
    let anchorOffsetX = 0;
    let anchorOffsetY = 0;
    if (anchor && scrollContainer && board) {
      const bounds = board.getBoundingClientRect();
      anchorOffsetX = anchor.clientX - bounds.left;
      anchorOffsetY = anchor.clientY - bounds.top;
    }

    viewScaleRef.current = next;
    setViewScale(next);
    if (anchor && scrollContainer && board) {
      const ratio = next / previous;
      window.requestAnimationFrame(() => {
        scrollContainer.scrollLeft += anchorOffsetX * (ratio - 1);
        scrollContainer.scrollTop += anchorOffsetY * (ratio - 1);
      });
    }
    return true;
  };

  const handleViewWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (isViewScaleIgnoredTarget(event.target) || event.deltaY === 0) return;
    const next = viewScaleRef.current + (event.deltaY < 0 ? VIEW_SCALE_STEP : -VIEW_SCALE_STEP);
    changeViewScale(next, { clientX: event.clientX, clientY: event.clientY });
    // Keep canvas wheel zoom local, including Ctrl/Meta wheel which would otherwise zoom the browser.
    event.preventDefault();
  };

  const stopCanvasPan = (pointerId?: number) => {
    const pan = panInteractionRef.current;
    if (!pan || (pointerId !== undefined && pan.pointerId !== pointerId)) return;
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer?.hasPointerCapture(pan.pointerId)) scrollContainer.releasePointerCapture(pan.pointerId);
    panInteractionRef.current = null;
    setIsPanning(false);
  };

  const startCanvasPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const startedOnFrame = event.target instanceof Element && Boolean(event.target.closest('[data-large-canvas-frame]'));
    if (
      event.button !== 0
      || (!spacePressedRef.current && !panMode)
      || pinchStateRef.current.active
      || isViewScaleIgnoredTarget(event.target)
      || (startedOnFrame && !spacePressedRef.current)
    ) return;
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    event.preventDefault();
    event.stopPropagation();
    setInteraction(null);
    panInteractionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: scrollContainer.scrollLeft,
      scrollTop: scrollContainer.scrollTop,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveCanvasPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panInteractionRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    event.preventDefault();
    event.stopPropagation();
    scrollContainer.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    scrollContainer.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
  };

  const finishCanvasPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panInteractionRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    stopCanvasPan(event.pointerId);
  };

  const fitViewToContent = () => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    const content = frames.length
      ? {
          minX: Math.min(...frames.map(frame => frame.rect.x)),
          minY: Math.min(...frames.map(frame => frame.rect.y)),
          maxX: Math.max(...frames.map(frame => frame.rect.x + frame.rect.width)),
          maxY: Math.max(...frames.map(frame => frame.rect.y + frame.rect.height)),
        }
      : { minX: 0, minY: 0, maxX: BOARD_GRID_WIDTH, maxY: BOARD_GRID_HEIGHT };
    const contentWidth = Math.max(1, content.maxX - content.minX) * GRID_CELL_SIZE;
    const contentHeight = Math.max(1, content.maxY - content.minY) * GRID_CELL_SIZE;
    const usableWidth = Math.max(GRID_CELL_SIZE, scrollContainer.clientWidth - 32);
    const usableHeight = Math.max(GRID_CELL_SIZE, scrollContainer.clientHeight - 32);
    const next = normalizeViewScale(Math.min(usableWidth / contentWidth, usableHeight / contentHeight));

    viewScaleRef.current = next;
    setViewScale(next);
    window.requestAnimationFrame(() => {
      const scaledWidth = contentWidth * next;
      const scaledHeight = contentHeight * next;
      scrollContainer.scrollLeft = Math.max(0, content.minX * GRID_CELL_SIZE * next - Math.max(0, (scrollContainer.clientWidth - scaledWidth) / 2));
      scrollContainer.scrollTop = Math.max(0, content.minY * GRID_CELL_SIZE * next - Math.max(0, (scrollContainer.clientHeight - scaledHeight) / 2));
    });
  };

  useEffect(() => {
    const canUseCanvasShortcut = () => {
      const scrollContainer = scrollContainerRef.current;
      return Boolean(scrollContainer && (canvasHoveredRef.current || document.activeElement === scrollContainer) && !isViewScaleIgnoredTarget(document.activeElement));
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && canUseCanvasShortcut()) {
        spacePressedRef.current = true;
        event.preventDefault();
        return;
      }
      if (!canUseCanvasShortcut() || (!event.ctrlKey && !event.metaKey)) return;
      if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') {
        changeViewScale(viewScaleRef.current + VIEW_SCALE_STEP);
        event.preventDefault();
      } else if (event.key === '-' || event.code === 'NumpadSubtract') {
        changeViewScale(viewScaleRef.current - VIEW_SCALE_STEP);
        event.preventDefault();
      } else if (event.key === '0' || event.code === 'Numpad0') {
        fitViewToContent();
        event.preventDefault();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      spacePressedRef.current = false;
      stopCanvasPan();
    };
    const handleWindowBlur = () => {
      spacePressedRef.current = false;
      stopCanvasPan();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [frames]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2 || isViewScaleIgnoredTarget(event.target)) return;
      const first = event.touches[0];
      const second = event.touches[1];
      if (!first || !second) return;
      pinchStateRef.current = {
        active: true,
        initialDistance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
        initialScale: viewScaleRef.current,
      };
      setInteraction(null);
      event.preventDefault();
    };

    const handleTouchMove = (event: TouchEvent) => {
      const state = pinchStateRef.current;
      if (!state.active || event.touches.length < 2) return;
      const first = event.touches[0];
      const second = event.touches[1];
      if (!first || !second || state.initialDistance <= 0) return;
      event.preventDefault();
      const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
      const midpoint = {
        clientX: (first.clientX + second.clientX) / 2,
        clientY: (first.clientY + second.clientY) / 2,
      };
      changeViewScale(state.initialScale * (distance / state.initialDistance), midpoint);
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinchStateRef.current.active = false;
    };

    scrollContainer.addEventListener('touchstart', handleTouchStart, { passive: false });
    scrollContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
    scrollContainer.addEventListener('touchend', handleTouchEnd);
    scrollContainer.addEventListener('touchcancel', handleTouchEnd);
    return () => {
      scrollContainer.removeEventListener('touchstart', handleTouchStart);
      scrollContainer.removeEventListener('touchmove', handleTouchMove);
      scrollContainer.removeEventListener('touchend', handleTouchEnd);
      scrollContainer.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  const clampGridRectToBoard = (rect: LargeCanvasGridRect): LargeCanvasGridRect => {
    const snapped = snapLargeCanvasGridRect(rect);
    return {
      ...snapped,
      x: Math.max(0, Math.min(BOARD_GRID_WIDTH - snapped.width, snapped.x)),
      y: Math.max(0, Math.min(BOARD_GRID_HEIGHT - snapped.height, snapped.y)),
    };
  };

  const startFrameMove = (event: React.PointerEvent, frame: LargeCanvasFrame) => {
    if (event.button !== 0 || pinchStateRef.current.active) return;
    event.stopPropagation();
    const point = getGridPoint(event);
    if (!point) return;
    setSelectedId(frame.id);
    setInteraction({ kind: 'move', frameId: frame.id, start: point, origin: frame.rect, preview: frame.rect, valid: true });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const applyBucket = (grid: GridSnapshot, frame: LargeCanvasFrame, point: GridPoint): void => {
    const replacement = drawColorId;
    getSymmetricPoints(point, frame).forEach(seed => {
      const x = seed.x - frame.rect.x;
      const y = seed.y - frame.rect.y;
      const source = grid[y]?.[x];
      if (source === undefined) return;
      fillLargeCanvasConnectedRegion(
        frame.rect.width,
        frame.rect.height,
        { x, y },
        source,
        replacement,
        (cellX, cellY) => grid[cellY]?.[cellX] ?? null,
        (cellX, cellY, colorId) => { grid[cellY][cellX] = colorId; },
      );
    });
  };

  const applyReplace = (grid: GridSnapshot, source: string | null): void => {
    if (source === drawColorId) return;
    grid.forEach((row, y) => row.forEach((value, x) => { if (value === source) grid[y][x] = drawColorId; }));
  };

  const getShapePoints = (start: GridPoint, end: GridPoint): GridPoint[] => {
    if (activeTool === 'line') return getLinePoints(start, end);
    if (activeTool === 'rectangle' || activeTool === 'cut') return getRectanglePoints(start, end);
    return getCirclePoints(start, end);
  };

  const getCutBounds = (start: GridPoint, end: GridPoint, frame: LargeCanvasFrame): { minX: number; maxX: number; minY: number; maxY: number } | null => {
    const minX = Math.max(frame.rect.x, Math.min(start.x, end.x));
    const maxX = Math.min(frame.rect.x + frame.rect.width - 1, Math.max(start.x, end.x));
    const minY = Math.max(frame.rect.y, Math.min(start.y, end.y));
    const maxY = Math.min(frame.rect.y + frame.rect.height - 1, Math.max(start.y, end.y));
    if (minX > maxX || minY > maxY || (minX === maxX && minY === maxY)) return null;
    return { minX, maxX, minY, maxY };
  };

  const applyCut = (grid: GridSnapshot, bounds: { minX: number; maxX: number; minY: number; maxY: number }, frame: LargeCanvasFrame): void => {
    grid.forEach((row, y) => row.forEach((_, x) => {
      const globalX = frame.rect.x + x;
      const globalY = frame.rect.y + y;
      if (globalX < bounds.minX || globalX > bounds.maxX || globalY < bounds.minY || globalY > bounds.maxY) grid[y][x] = null;
    }));
  };

  const startDrawing = (event: React.PointerEvent, frame: LargeCanvasFrame) => {
    if (event.button !== 0 || pinchStateRef.current.active) return;
    event.stopPropagation();
    if (selectedId !== frame.id) {
      setSelectedId(frame.id);
      return;
    }
    setSelectedId(frame.id);
    ensureEditableGrid(frame);
    const point = getGridPoint(event);
    if (!point) return;
    const before = getFrameGrid(frame);
    const working = cloneGrid(before);
    drawingPointerRef.current = event.pointerId;
    drawingTransactionRef.current = { frameId: frame.id, start: point, before, working, rafId: null };
    shapePreviewRef.current = ['line', 'rectangle', 'circle', 'cut'].includes(activeTool) ? { frameId: frame.id, start: point, end: point, rafId: null } : null;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (activeTool === 'bucket') applyBucket(working, frame, point);
    else if (activeTool === 'eyedropper') {
      const colorId = working[point.y - frame.rect.y]?.[point.x - frame.rect.x];
      setDrawColorId(colorId ?? null);
    } else if (activeTool === 'replace') {
      const source = working[point.y - frame.rect.y]?.[point.x - frame.rect.x] ?? null;
      applyReplace(working, source);
    } else if (!shapePreviewRef.current) {
      applySymmetricPointsToGrid(working, [point], frame, activeTool === 'eraser' ? null : drawColorId);
    }
    drawingTransactionRef.current.working = working;
    if (activeTool === 'pencil' || activeTool === 'eraser') replaceFrameGrid(frame.id, working);
    if (activeTool === 'bucket' || activeTool === 'replace') {
      commitFrameGrid(frame.id, working, before);
      drawingPointerRef.current = null;
      drawingTransactionRef.current = null;
    }
  };

  const continueDrawing = (event: React.PointerEvent) => {
    const transaction = drawingTransactionRef.current;
    if (!transaction || drawingPointerRef.current !== event.pointerId || pinchStateRef.current.active) return;
    event.preventDefault();
    event.stopPropagation();
    const point = getGridPoint(event);
    const frame = frames.find(item => item.id === transaction.frameId);
    if (!point || !frame) return;
    const shapePreview = shapePreviewRef.current;
    if (shapePreview) {
      shapePreview.end = point;
      if (shapePreview.rafId === null) {
        shapePreview.rafId = window.requestAnimationFrame(() => {
          if (shapePreviewRef.current !== shapePreview) return;
          const preview = shapePreview;
          preview.rafId = null;
          const previewFrame = frames.find(item => item.id === preview.frameId);
          if (!previewFrame) return;
          const points = activeTool === 'cut'
            ? getShapePoints(preview.start, preview.end).filter(point => isPointInFrame(point, previewFrame))
            : mapSymmetricPoints(getShapePoints(preview.start, preview.end), previewFrame);
          setShapePreview({ frameId: preview.frameId, points, selection: activeTool === 'cut' ? { start: preview.start, end: preview.end } : undefined });
        });
      }
      return;
    }
    applySymmetricPointsToGrid(transaction.working, [point], frame, activeTool === 'eraser' ? null : drawColorId);
    if (transaction.rafId === null) {
      transaction.rafId = window.requestAnimationFrame(() => {
        if (drawingTransactionRef.current !== transaction) return;
        transaction.rafId = null;
        replaceFrameGrid(transaction.frameId, transaction.working);
      });
    }
  };

  const finishDrawing = (event: React.PointerEvent) => {
    const transaction = drawingTransactionRef.current;
    if (!transaction || drawingPointerRef.current !== event.pointerId) return;
    cancelLargeCanvasRaf(transaction, rafId => window.cancelAnimationFrame(rafId));
    if (shapePreviewRef.current) {
      const preview = shapePreviewRef.current;
      cancelLargeCanvasRaf(preview, rafId => window.cancelAnimationFrame(rafId));
      const frame = frames.find(item => item.id === transaction.frameId);
      if (frame) {
        const nextGrid = cloneGrid(transaction.before);
        if (activeTool === 'cut') {
          const bounds = getCutBounds(preview.start, preview.end, frame);
          if (bounds) {
            applyCut(nextGrid, bounds, frame);
            commitFrameGrid(transaction.frameId, nextGrid, transaction.before);
          }
        } else {
          applySymmetricPointsToGrid(nextGrid, getShapePoints(preview.start, preview.end), frame, activeTool === 'eraser' ? null : drawColorId);
          commitFrameGrid(transaction.frameId, nextGrid, transaction.before);
        }
      }
    } else if (activeTool !== 'bucket' && activeTool !== 'eyedropper' && activeTool !== 'replace') {
      commitFrameGrid(transaction.frameId, transaction.working, transaction.before);
    }
    drawingPointerRef.current = null;
    drawingTransactionRef.current = null;
    shapePreviewRef.current = null;
    setShapePreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const cancelDrawing = (event: React.PointerEvent) => {
    const transaction = drawingTransactionRef.current;
    if (!transaction || drawingPointerRef.current !== event.pointerId) return;
    cancelLargeCanvasRaf(transaction, rafId => window.cancelAnimationFrame(rafId));
    cancelLargeCanvasRaf(shapePreviewRef.current, rafId => window.cancelAnimationFrame(rafId));
    replaceFrameGrid(transaction.frameId, transaction.before);
    drawingPointerRef.current = null;
    drawingTransactionRef.current = null;
    shapePreviewRef.current = null;
    setShapePreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const updateInteraction = (event: React.PointerEvent) => {
    if (!interaction || pinchStateRef.current.active) return;
    const point = getGridPoint(event);
    if (!point) return;
    const preview = clampGridRectToBoard({ ...interaction.origin, x: interaction.origin.x + point.x - interaction.start.x, y: interaction.origin.y + point.y - interaction.start.y });
    setInteraction({ ...interaction, preview, valid: getMovedLargeCanvasGridRectCandidate(interaction.origin, { x: preview.x, y: preview.y }, getOtherRects(interaction.frameId)) !== null });
  };

  const finishInteraction = () => {
    if (!interaction) return;
    if (!interaction.valid) {
      setMessage('图框不能与其他图框重叠。');
    } else {
      updateFrame(interaction.frameId, { rect: interaction.preview });
    }
    setInteraction(null);
  };

  const addFrame = () => {
    const rect = findAvailableRect(newFrameMaxSide, newFrameMaxSide, frames);
    if (!rect) {
      setMessage('画板没有足够的连续空白位置。');
      return;
    }
    const frame = createFrame(rect, frames.length, newFrameMaxSide);
    setFrames(current => [...current, frame]);
    setSelectedId(frame.id);
    setMessage(null);
  };

  const deleteFrame = (id: string) => {
    nextRequestVersion(id);
    frameHistoryRef.current.delete(id);
    setHistoryVersion(value => value + 1);
    setFrames(current => current.filter(frame => frame.id !== id));
    setSelectedId(current => current === id ? null : current);
    setHoveredId(current => current === id ? null : current);
  };

  const clearAllFrames = () => {
    frameHistoryRef.current.clear();
    setHistoryVersion(value => value + 1);
    setFrames([]);
    setSelectedId(null);
    setHoveredId(null);
  };

  const changeMode = (frame: LargeCanvasFrame, mode: LargeCanvasConversionMode) => {
    setSelectedId(frame.id);
    if (frame.loading || mode === frame.mode) return;
    if (frame.sourceImageDataUrl) reconvertFrame({ ...frame, mode }, frame.maxSide);
    else updateFrame(frame.id, { mode });
  };

  const changeMaxSide = (frame: LargeCanvasFrame, maxSide: LargeCanvasMaxSide) => {
    setSelectedId(frame.id);
    if (frame.loading || maxSide === frame.maxSide) return;
    if (frame.sourceImageDataUrl) reconvertFrame(frame, maxSide);
    else {
      const size = getLargeCanvasGridDimensions(frame.rect.width, frame.rect.height, maxSide);
      const candidate = getNewLargeCanvasGridRectCandidate({ ...frame.rect, width: size.width, height: size.height }, getOtherRects(frame.id));
      if (!candidate || candidate.x + candidate.width > BOARD_GRID_WIDTH || candidate.y + candidate.height > BOARD_GRID_HEIGHT) {
        setMessage('图框尺寸扩大后与其他图框重叠，已拦截。');
        return;
      }
      updateFrame(frame.id, { rect: candidate, maxSide, beanResult: null, error: null });
    }
  };

  const exportFrame = (frame: LargeCanvasFrame) => {
    if (!requireFormalLoginForExport()) return;
    setMessage(null);
    if (!frame.beanResult && !getManualCellsInRect(manualCells, frame.rect).size) {
      setMessage('该图框还没有生成图纸。');
      return;
    }
    const canvas = document.createElement('canvas');
    drawExportSheet(canvas, [frame], paletteMap, beadShape, brandName, getManualCellsInRect(manualCells, frame.rect));
    downloadCanvas(canvas, `${frame.title || '图框'}-拼豆图纸.png`);
  };

  const exportWholeCanvas = () => {
    if (!requireFormalLoginForExport()) return;
    setMessage(null);
    const completed = frames.filter(frame => frame.beanResult);
    if (!completed.length && !manualCells.size) {
      setMessage('当前没有可导出的图纸。');
      return;
    }
    const canvas = document.createElement('canvas');
    drawExportSheet(canvas, completed, paletteMap, beadShape, brandName, manualCells);
    downloadCanvas(canvas, '大画板-拼豆图纸.png');
  };

  const interactionFrameId = interaction?.frameId;
  const completedCount = frames.filter(frame => frame.beanResult).length;
  const canUndoManual = manualHistoryVersion >= 0 && manualHistoryRef.current.past.length > 0;
  const canRedoManual = manualHistoryVersion >= 0 && manualHistoryRef.current.future.length > 0;
  const selectedFrame = selectedId ? frames.find(frame => frame.id === selectedId) ?? null : null;
  const selectedDrawColor = drawColorId ? paletteMap.get(drawColorId) : undefined;
  const selectedDrawColorDisplay = drawColorId ? getLargeCanvasPaletteDisplay(drawColorId, selectedDrawColor) : null;
  const selectedDrawColorCode = selectedDrawColorDisplay?.code ?? '橡皮擦';
  const selectedDrawColorName = selectedDrawColorDisplay
    ? selectedDrawColorDisplay.name ? `${selectedDrawColorDisplay.name} · ${selectedDrawColorDisplay.hex}` : selectedDrawColorDisplay.hex
    : drawColorId ? '未知颜色' : '清除颜色';
  const selectedFrameCounts = selectedFrame?.beanResult
    ? [...selectedFrame.beanResult.flat().reduce((counts, colorId) => {
        if (colorId) counts.set(colorId, (counts.get(colorId) ?? 0) + 1);
        return counts;
      }, new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])
    : [];
  const scaledCellSize = GRID_CELL_SIZE * viewScale;
  const scaledMajorGridSize = GRID_CELL_SIZE * 5 * viewScale;
  const scaledMinorGridSize = GRID_CELL_SIZE * viewScale;
  const gridLineSize = 1;
  const majorGridLineColor = 'rgba(71, 85, 105, 0.4)';
  const minorGridLineColor = 'rgba(100, 116, 139, 0.2)';
  const backdropColor: Record<CanvasBackdrop, string> = {
    dark_grid: '#f8fafc',
    light_pegboard: '#fffdf5',
    wood: '#f5e6d3',
    studio: '#f3e8ff',
    slate: '#e2e8f0',
  };
  const drawingTools = [
    ['pan', '平移拖拽', Hand],
    ['pencil', '画笔', Paintbrush],
    ['line', '直线', Minus],
    ['rectangle', '矩形', Square],
    ['circle', '圆形', Circle],
    ['bucket', '油漆桶', PaintBucket],
    ['eyedropper', '吸管', Pipette],
    ['eraser', '橡皮擦', Eraser],
    ['replace', '转换全图此色', RefreshCw],
  ] as [LargeCanvasTool, string, typeof Hand][];

  return (
    <main className="min-h-0 flex-1 overflow-hidden bg-slate-100 text-slate-900">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 flex-col gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-6 sm:py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Grid2X2 className="h-5 w-5 shrink-0 text-purple-600" />
            <h1 className="text-base font-extrabold text-slate-900 sm:text-lg">大画板</h1>
            <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700">全局拼豆网格</span>
            <label className="ml-auto flex shrink-0 items-center gap-1 text-[10px] font-bold text-purple-700 sm:text-xs">
              <span className="hidden xs:inline">选用拼豆色卡</span>
              <select aria-label="选用拼豆色卡" value={selectedPaletteId} onChange={event => onChangePalette(event.target.value)} className="max-w-[145px] rounded-lg border border-purple-200 bg-white px-2 py-1 text-[10px] font-bold text-purple-900 outline-none focus:border-purple-500 sm:max-w-[180px] sm:text-xs">
                {paletteOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            {selectedPaletteId === 'MARD_291' && (
              <p role="status" className="basis-full text-[10px] leading-4 text-amber-800 sm:ml-auto sm:max-w-xl">
                P/Q/R/T/Y/ZG 珠光、荧光、夜光等特殊材质为屏幕模拟色，仅用于算法匹配参考，不能作为实物精准对色依据。
              </p>
            )}
          </div>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <span className="hidden text-xs font-semibold text-slate-500 sm:inline">{frames.length} 个图框 · {completedCount} 个结果</span>
              <button type="button" onClick={() => setToolbarExpanded(current => !current)} className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-2 py-1 text-[10px] font-bold text-purple-700" aria-expanded={toolbarExpanded}>{toolbarExpanded ? '折叠工具' : '展开工具'}</button>
              <button type="button" onClick={addFrame} className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-2 py-1 text-[10px] font-bold text-white shadow-sm hover:bg-purple-700"><Plus className="h-3.5 w-3.5" />图框</button>
              <button type="button" onClick={exportWholeCanvas} disabled={!completedCount && !manualCells.size} className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-white px-2 py-1 text-[10px] font-bold text-purple-700 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-3.5 w-3.5" />导出</button>
              <button type="button" onClick={clearAllFrames} disabled={!frames.length} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />清空</button>
            </div>
          </div>
          {toolbarExpanded && (
            <div className="min-w-0 pb-0.5" role="toolbar" aria-label="大画板工具栏">
              <div className="grid min-h-[116px] gap-2 sm:hidden">
                <div className="grid grid-cols-3 rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label="大画板移动工具分组">
                  {([
                    ['tools', '工具'],
                    ['view', '视图'],
                    ['settings', '设置'],
                  ] as const).map(([panel, label]) => <button key={panel} type="button" role="tab" aria-selected={mobileToolbarPanel === panel} onClick={() => setMobileToolbarPanel(panel)} className={`min-h-8 rounded px-2 text-[11px] font-bold ${mobileToolbarPanel === panel ? 'bg-white text-purple-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{label}</button>)}
                </div>
                <div className="min-h-[78px]">
                  {mobileToolbarPanel === 'tools' && (
                    <div className="space-y-1.5" role="tabpanel" aria-label="绘图工具">
                      <div className="grid grid-cols-10 gap-1" role="group" aria-label="绘图与平移工具">
                        {drawingTools.map(([tool, title, Icon]) => <button key={tool} type="button" title={title} aria-label={title} onClick={() => selectTool(tool)} className={`flex h-8 min-w-0 items-center justify-center rounded border border-slate-200 ${activeTool === tool ? (tool === 'eraser' ? 'bg-rose-600 text-white' : 'bg-purple-600 text-white') : 'bg-slate-50 text-purple-700 hover:bg-white'}`}><Icon className="h-3.5 w-3.5" /></button>)}
                        <button type="button" title="剪切到拖选区域" aria-label="剪切到拖选区域" onClick={() => selectTool('cut')} className={`flex h-8 items-center justify-center rounded border border-slate-200 ${activeTool === 'cut' ? 'bg-purple-600 text-white' : 'bg-slate-50 text-purple-700 hover:bg-white'}`}><Scissors className="h-3.5 w-3.5" /></button>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1">
                        <label className="flex min-w-0 items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-bold text-purple-700">对称<select aria-label="对称模式" value={symmetryMode} onChange={event => setSymmetryMode(event.target.value as LargeCanvasSymmetry)} className="min-w-0 flex-1 rounded border border-purple-200 bg-white px-1 py-1 text-[10px] font-bold text-purple-900"><option value="none">无对称</option><option value="horizontal">水平</option><option value="vertical">垂直</option><option value="both">水平+垂直</option></select></label>
                        <button type="button" title="撤销" aria-label="撤销" disabled={drawMode ? !canUndoManual : !selectedId || !(selectedId && (frameHistoryRef.current.get(selectedId)?.past.length ?? 0))} onClick={() => drawMode ? undoManual() : selectedId && undoFrame(selectedId)} className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"><Undo2 className="h-3.5 w-3.5" /></button>
                        <button type="button" title="重做" aria-label="重做" disabled={drawMode ? !canRedoManual : !selectedId || !(selectedId && (frameHistoryRef.current.get(selectedId)?.future.length ?? 0))} onClick={() => drawMode ? redoManual() : selectedId && redoFrame(selectedId)} className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"><Redo2 className="h-3.5 w-3.5" /></button>
                      </div>
                      <button ref={colorPickerTriggerRef} type="button" title="选择绘图颜色" aria-label={`选择绘图颜色：${selectedDrawColorCode} ${selectedDrawColorName}`} aria-expanded={isColorPickerOpen} onClick={event => toggleColorPicker(event.currentTarget)} className="inline-flex h-8 w-full min-w-0 items-center gap-1.5 rounded border border-slate-200 bg-white px-2 text-left text-[10px] font-bold text-slate-700 hover:border-purple-300"><span className="h-4 w-4 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: selectedDrawColor?.hex ?? 'transparent' }} /><span className="shrink-0 text-purple-800">{selectedDrawColorCode}</span><span className="truncate text-slate-500">{selectedDrawColorName}</span></button>
                    </div>
                  )}
                  {mobileToolbarPanel === 'view' && (
                    <div className="space-y-1.5" role="tabpanel" aria-label="画板视图">
                      <div className="flex h-8 items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1"><button type="button" title="缩小画板" aria-label="缩小画板" disabled={viewScale <= MIN_VIEW_SCALE} onClick={() => setViewScale(current => normalizeViewScale(current - VIEW_SCALE_STEP))} className="rounded p-1 text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"><ZoomOut className="h-4 w-4" /></button><input aria-label="画板缩放百分比" type="range" min={MIN_VIEW_SCALE * 100} max={MAX_VIEW_SCALE * 100} step={VIEW_SCALE_STEP * 100} value={Math.round(viewScale * 100)} onChange={event => setViewScale(normalizeViewScale(Number(event.target.value) / 100))} className="min-w-0 flex-1 accent-purple-600" /><span className="w-10 text-center text-[10px] font-bold text-slate-600">{Math.round(viewScale * 100)}%</span><button type="button" title="放大画板" aria-label="放大画板" disabled={viewScale >= MAX_VIEW_SCALE} onClick={() => setViewScale(current => normalizeViewScale(current + VIEW_SCALE_STEP))} className="rounded p-1 text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"><ZoomIn className="h-4 w-4" /></button></div>
                      <div className="grid grid-cols-3 gap-1 rounded border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="拼豆形态">{([['fuse_3d', '3D立体豆'], ['circle_flat', '平面圆豆'], ['square', '像素方块']] as [BeadShape, string][]).map(([shape, label]) => <button key={shape} type="button" onClick={() => onChangeBeadShape(shape)} className={`h-8 rounded px-1 text-[10px] font-bold ${beadShape === shape ? 'bg-purple-600 text-white' : 'text-purple-700 hover:bg-white'}`}>{label}</button>)}</div>
                      <div className="grid grid-cols-2 gap-1" role="group" aria-label="显示选项"><button type="button" onClick={() => onChangeShowCodeLabels(!showCodeLabels)} className={`h-8 rounded border border-slate-200 px-2 text-[10px] font-bold ${showCodeLabels ? 'bg-purple-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-white'}`}>色号标记</button><button type="button" onClick={() => onChangeShowDataPreview(!showDataPreview)} className={`inline-flex h-8 items-center justify-center gap-1 rounded border border-slate-200 px-2 text-[10px] font-bold ${showDataPreview ? 'bg-purple-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-white'}`}><Eye className="h-3.5 w-3.5" />数据预览</button></div>
                    </div>
                  )}
                  {mobileToolbarPanel === 'settings' && (
                    <div className="space-y-1.5" role="tabpanel" aria-label="画板设置">
                      <label className="flex h-8 items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 text-[10px] font-bold text-slate-600">背景<select aria-label="大画板背景" value={canvasBackdrop} onChange={event => onChangeCanvasBackdrop(event.target.value as CanvasBackdrop)} className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1 py-1 text-[10px] font-semibold"><option value="dark_grid">浅灰网格</option><option value="light_pegboard">浅色底板</option><option value="wood">木纹色</option><option value="studio">工作室紫</option><option value="slate">石板灰</option></select></label>
                      <div className="grid grid-cols-3 gap-1 rounded border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="新图框档位">{LARGE_CANVAS_MAX_SIDES.map(side => <button key={side} type="button" onClick={() => setNewFrameMaxSide(side)} className={`h-8 rounded px-2 text-[10px] font-bold ${newFrameMaxSide === side ? 'bg-purple-600 text-white' : 'text-purple-700 hover:bg-white'}`}>{side}格</button>)}</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="hidden min-w-0 items-center gap-2 overflow-x-auto pb-0.5 sm:flex">
                <div className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="绘图与平移工具">
                  {drawingTools.map(([tool, title, Icon]) => <button key={tool} type="button" title={title} aria-label={title} onClick={() => selectTool(tool)} className={`rounded p-1.5 ${activeTool === tool ? (tool === 'eraser' ? 'bg-rose-600 text-white' : 'bg-purple-600 text-white') : 'text-purple-700 hover:bg-white'}`}><Icon className="h-3.5 w-3.5" /></button>)}
                  <label className="flex items-center gap-1 border-l border-slate-200 pl-1 text-[10px] font-bold text-purple-700">对称<select aria-label="对称模式" value={symmetryMode} onChange={event => setSymmetryMode(event.target.value as LargeCanvasSymmetry)} className="max-w-[98px] rounded border border-purple-200 bg-white px-1 py-1 text-[10px] font-bold text-purple-900"><option value="none">无对称</option><option value="horizontal">水平</option><option value="vertical">垂直</option><option value="both">水平+垂直</option></select></label>
                  <button ref={colorPickerTriggerRef} type="button" title="选择绘图颜色" aria-label={`选择绘图颜色：${selectedDrawColorCode} ${selectedDrawColorName}`} aria-expanded={isColorPickerOpen} onClick={event => toggleColorPicker(event.currentTarget)} className="inline-flex min-w-0 max-w-[180px] items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-left text-[10px] font-bold text-slate-700 hover:border-purple-300"><span className="h-3.5 w-3.5 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: selectedDrawColor?.hex ?? 'transparent' }} /><span className="shrink-0 text-purple-800">{selectedDrawColorCode}</span><span className="truncate text-slate-500">{selectedDrawColorName}</span></button>
                  <button type="button" title="撤销" aria-label="撤销" disabled={drawMode ? !canUndoManual : !selectedId || !(selectedId && (frameHistoryRef.current.get(selectedId)?.past.length ?? 0))} onClick={() => drawMode ? undoManual() : selectedId && undoFrame(selectedId)} className="rounded p-1.5 text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"><Undo2 className="h-3.5 w-3.5" /></button>
                  <button type="button" title="重做" aria-label="重做" disabled={drawMode ? !canRedoManual : !selectedId || !(selectedId && (frameHistoryRef.current.get(selectedId)?.future.length ?? 0))} onClick={() => drawMode ? redoManual() : selectedId && redoFrame(selectedId)} className="rounded p-1.5 text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"><Redo2 className="h-3.5 w-3.5" /></button>
                  <button type="button" title="剪切到拖选区域" aria-label="剪切到拖选区域" onClick={() => selectTool('cut')} className={`rounded p-1.5 ${activeTool === 'cut' ? 'bg-purple-600 text-white' : 'text-purple-700 hover:bg-white'}`}><Scissors className="h-3.5 w-3.5" /></button>
                </div>
                <div className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="画板缩放"><button type="button" title="缩小画板" aria-label="缩小画板" disabled={viewScale <= MIN_VIEW_SCALE} onClick={() => setViewScale(current => normalizeViewScale(current - VIEW_SCALE_STEP))} className="rounded p-1 text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"><ZoomOut className="h-3.5 w-3.5" /></button><input aria-label="画板缩放百分比" type="range" min={MIN_VIEW_SCALE * 100} max={MAX_VIEW_SCALE * 100} step={VIEW_SCALE_STEP * 100} value={Math.round(viewScale * 100)} onChange={event => setViewScale(normalizeViewScale(Number(event.target.value) / 100))} className="w-20 accent-purple-600" /><span className="w-10 text-center text-[10px] font-bold text-slate-600">{Math.round(viewScale * 100)}%</span><button type="button" title="放大画板" aria-label="放大画板" disabled={viewScale >= MAX_VIEW_SCALE} onClick={() => setViewScale(current => normalizeViewScale(current + VIEW_SCALE_STEP))} className="rounded p-1 text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"><ZoomIn className="h-3.5 w-3.5" /></button></div>
                <label className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600">背景<select aria-label="大画板背景" value={canvasBackdrop} onChange={event => onChangeCanvasBackdrop(event.target.value as CanvasBackdrop)} className="max-w-[110px] rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-semibold"><option value="dark_grid">浅灰网格</option><option value="light_pegboard">浅色底板</option><option value="wood">木纹色</option><option value="studio">工作室紫</option><option value="slate">石板灰</option></select></label>
                <div className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="拼豆形态">{([['fuse_3d', '3D立体豆'], ['circle_flat', '平面圆豆'], ['square', '像素方块']] as [BeadShape, string][]).map(([shape, label]) => <button key={shape} type="button" onClick={() => onChangeBeadShape(shape)} className={`rounded px-1.5 py-1 text-[10px] font-bold ${beadShape === shape ? 'bg-purple-600 text-white' : 'text-purple-700 hover:bg-white'}`}>{label}</button>)}</div>
                <div className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="显示选项"><button type="button" onClick={() => onChangeShowCodeLabels(!showCodeLabels)} className={`rounded px-1.5 py-1 text-[10px] font-bold ${showCodeLabels ? 'bg-purple-600 text-white' : 'text-slate-500 hover:bg-white'}`}>色号标记</button><button type="button" onClick={() => onChangeShowDataPreview(!showDataPreview)} className={`inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-[10px] font-bold ${showDataPreview ? 'bg-purple-600 text-white' : 'text-slate-500 hover:bg-white'}`}><Eye className="h-3 w-3" />数据预览</button></div>
                <div className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="新图框档位">{LARGE_CANVAS_MAX_SIDES.map(side => <button key={side} type="button" onClick={() => setNewFrameMaxSide(side)} className={`rounded-md px-2 py-1 text-[10px] font-bold ${newFrameMaxSide === side ? 'bg-purple-600 text-white' : 'text-purple-700 hover:bg-purple-100'}`}>{side}</button>)}</div>
              </div>
            </div>
          )}
        </header>

        {isColorPickerOpen && colorPickerAnchor && typeof document !== 'undefined' && createPortal(
          <div className="fixed inset-0 z-[100]" onPointerDown={() => setIsColorPickerOpen(false)}>
            <section
              role="dialog"
              aria-label="选择绘图颜色"
              className="fixed rounded-lg border border-purple-200 bg-white p-2 shadow-xl"
              style={{ left: colorPickerAnchor.left, top: colorPickerAnchor.top, width: colorPickerAnchor.width, maxWidth: 'calc(100vw - 1rem)' }}
              onPointerDown={event => event.stopPropagation()}
            >
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] font-extrabold text-slate-700">
                <span>选择绘图颜色</span>
                <button type="button" className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setIsColorPickerOpen(false)} aria-label="关闭颜色选择">关闭</button>
              </div>
              <div className="max-h-60 space-y-0.5 overflow-y-auto overscroll-contain pr-0.5">
                {Array.from(paletteMap.entries()).map(([id, color]) => {
                  const isSelected = id === drawColorId;
                  const display = getLargeCanvasPaletteDisplay(id, color);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => chooseDrawColor(id)}
                      className={`flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-1 text-left text-[10px] font-semibold ${isSelected ? 'bg-purple-100 text-purple-900' : 'text-slate-700 hover:bg-slate-50'}`}
                    >
                      <span className="h-4 w-4 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: color.hex }} />
                      <span className="w-16 shrink-0 font-extrabold">{display.code}</span>
                      {display.name && <span className="min-w-0 flex-1 truncate text-slate-600">{display.name}</span>}
                      <span className="shrink-0 font-mono text-[9px] text-slate-500">{display.hex}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>,
          document.body,
        )}

        <div
          ref={scrollContainerRef}
          tabIndex={0}
          onPointerEnter={() => { canvasHoveredRef.current = true; }}
          onPointerLeave={() => { canvasHoveredRef.current = false; }}
          onPointerDownCapture={startCanvasPan}
          onPointerMoveCapture={moveCanvasPan}
          onPointerUpCapture={finishCanvasPan}
          onPointerCancelCapture={finishCanvasPan}
          onWheel={handleViewWheel}
          className={`relative min-h-0 flex-1 overflow-auto p-4 sm:p-6 outline-none ${isPanning ? 'cursor-grabbing select-none' : 'cursor-default'}`}
        >
          <div
            ref={boardRef}
            className="relative border border-slate-300 shadow-inner"
            style={{ width: BOARD_GRID_WIDTH * scaledCellSize, height: BOARD_GRID_HEIGHT * scaledCellSize, backgroundColor: backdropColor[canvasBackdrop], backgroundImage: showGridLines ? `linear-gradient(${majorGridLineColor} ${gridLineSize}px, transparent ${gridLineSize}px), linear-gradient(90deg, ${majorGridLineColor} ${gridLineSize}px, transparent ${gridLineSize}px), linear-gradient(${minorGridLineColor} ${gridLineSize}px, transparent ${gridLineSize}px), linear-gradient(90deg, ${minorGridLineColor} ${gridLineSize}px, transparent ${gridLineSize}px)` : undefined, backgroundSize: showGridLines ? `${scaledMajorGridSize}px ${scaledMajorGridSize}px, ${scaledMajorGridSize}px ${scaledMajorGridSize}px, ${scaledMinorGridSize}px ${scaledMinorGridSize}px, ${scaledMinorGridSize}px ${scaledMinorGridSize}px` : undefined }}
            onPointerDownCapture={event => { if (drawMode) startManualDrawing(event); }}
            onPointerMoveCapture={event => { if (drawMode) continueManualDrawing(event); }}
            onPointerUpCapture={event => { if (drawMode) finishManualDrawing(event); }}
            onPointerCancelCapture={event => { if (drawMode) cancelManualDrawing(event); }}
            onLostPointerCapture={event => { if (drawMode) finishManualDrawing(event); }}
            onPointerDown={event => { if (!drawMode && event.target === event.currentTarget) { setSelectedId(null); setHoveredId(null); setMessage(null); } }}
            onPointerMove={updateInteraction}
            onPointerUp={finishInteraction}
            onPointerCancel={() => setInteraction(null)}
          >
            <div className="pointer-events-none absolute left-3 top-2 text-[10px] font-bold text-slate-400">1格 = 1颗拼豆 · 每5格粗线 · {BOARD_GRID_WIDTH} × {BOARD_GRID_HEIGHT}</div>
            {Array.from({ length: Math.ceil(BOARD_GRID_WIDTH / 5) }, (_, index) => index * 5).map(x => <span key={`col-${x}`} className="pointer-events-none absolute -top-4 -translate-x-1/2 text-[9px] font-semibold text-slate-400" style={{ left: x * scaledCellSize + scaledCellSize / 2 }}>{getColumnLetter(x)}</span>)}
            {Array.from({ length: Math.ceil(BOARD_GRID_HEIGHT / 5) }, (_, index) => index * 5).map(y => <span key={`row-${y}`} className="pointer-events-none absolute -left-5 -translate-y-1/2 text-right text-[9px] font-semibold text-slate-400" style={{ top: y * scaledCellSize + scaledCellSize / 2 }}>{y + 1}</span>)}
            {frames.map(frame => {
              const activeInteraction = interactionFrameId === frame.id ? interaction : null;
              const renderRect = activeInteraction ? activeInteraction.preview : frame.rect;
              const valid = activeInteraction ? activeInteraction.valid : true;
              const isSelected = selectedId === frame.id;
              const isHovered = hoveredId === frame.id;
              const showPopup = !drawMode && (isSelected || (selectedId === null && isHovered));
              return (
                <article key={frame.id} data-large-canvas-frame aria-label={frame.title} className={`absolute overflow-visible ${!drawMode && (isSelected || isHovered) ? 'z-30' : 'z-10'}`} style={{ left: renderRect.x * scaledCellSize, top: renderRect.y * scaledCellSize, width: renderRect.width * scaledCellSize, height: renderRect.height * scaledCellSize, touchAction: drawMode ? 'none' : 'auto' }} onPointerEnter={() => setHoveredId(frame.id)} onPointerLeave={() => { if (selectedId !== frame.id) setHoveredId(current => current === frame.id ? null : current); }} onPointerDown={event => drawMode ? startDrawing(event, frame) : startFrameMove(event, frame)} onPointerMove={event => drawMode ? continueDrawing(event) : updateInteraction(event)} onPointerUp={event => drawMode ? finishDrawing(event) : finishInteraction()} onPointerCancel={event => drawMode ? cancelDrawing(event) : setInteraction(null)} onLostPointerCapture={event => drawMode ? finishDrawing(event) : finishInteraction()} onClick={event => { event.stopPropagation(); setSelectedId(frame.id); }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); event.stopPropagation(); loadFile(frame, event.dataTransfer.files[0]); }}>
                  <div className={`pointer-events-none absolute inset-0 ${valid ? (isSelected ? 'ring-2 ring-amber-400' : 'ring-1 ring-purple-500/70') : 'ring-2 ring-rose-500'}`} />
                  <FrameBeanGrid frame={frame} paletteMap={paletteMap} rect={renderRect} beadShape={beadShape} showCodeLabels={showCodeLabels && (viewScale >= 0.8 || isSelected)} />
                  {shapePreview?.frameId === frame.id && <div className="pointer-events-none absolute inset-0"><div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${renderRect.width}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${renderRect.height}, minmax(0, 1fr))` }}>{shapePreview.points.map(point => <span key={`${point.x}-${point.y}`} className={`z-10 m-0.5 rounded-sm ${shapePreview.selection ? 'bg-rose-600/75' : 'bg-purple-700/75'}`} style={{ gridColumn: point.x - renderRect.x + 1, gridRow: point.y - renderRect.y + 1 }} />)}</div></div>}
                  {frame.loading && <div className="absolute inset-0 flex items-center justify-center bg-white/70"><Loader2 className="h-5 w-5 animate-spin text-purple-600" /></div>}
                  {frame.error && <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-rose-600/90 px-1 py-0.5 text-[9px] font-bold text-white"><AlertTriangle className="h-3 w-3 shrink-0" />转换失败</div>}
                  <input ref={input => { if (input) inputRefs.current.set(frame.id, input); }} type="file" accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; loadFile(frame, file); }} />
                  {showPopup && (
                    <div data-view-scale-ignore className="absolute left-0 z-50 rounded-md border border-slate-200 bg-white p-1.5 shadow-lg" style={{ top: renderRect.y === 0 ? renderRect.height * scaledCellSize + 6 : -50, width: 'min(220px, calc(100vw - 1.5rem))' }} onPointerDown={event => { event.stopPropagation(); setSelectedId(frame.id); }} onPointerMove={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
                      <div className="flex items-center justify-between gap-1"><span className="truncate text-[10px] font-extrabold text-slate-800">{frame.title}</span><button type="button" aria-label="关闭图框浮窗" className="rounded p-0.5 text-slate-400 hover:bg-slate-100" onClick={event => { event.stopPropagation(); setSelectedId(null); setHoveredId(null); }}><X className="h-3 w-3" /></button></div>
                      <div className="mt-0.5 flex items-center justify-between text-[9px] font-bold text-slate-500"><span>{renderRect.width} × {renderRect.height}格 · {frame.maxSide}格</span><span>{frame.loading ? '生成中' : frame.error ? '失败' : frame.beanResult ? '已生成' : '待上传'}</span></div>
                      <div className="mt-1 flex gap-0.5 rounded bg-slate-100 p-0.5" role="tablist" aria-label="图框设置面板">
                        <button type="button" role="tab" aria-selected={popupTab === 'basic'} onClick={() => setPopupTab('basic')} className={`flex-1 rounded px-1.5 py-1 text-[9px] font-bold ${popupTab === 'basic' ? 'bg-white text-purple-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>基础设置</button>
                        <button type="button" role="tab" aria-selected={popupTab === 'params'} onClick={() => setPopupTab('params')} className={`flex-1 rounded px-1.5 py-1 text-[9px] font-bold ${popupTab === 'params' ? 'bg-white text-purple-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>参数设置</button>
                      </div>
                      {popupTab === 'basic' ? (
                        <>
                          <div className="mt-1.5 grid grid-cols-5 gap-0.5"><button type="button" title="上传图片" onClick={() => inputRefs.current.get(frame.id)?.click()} className="inline-flex items-center justify-center gap-0.5 rounded border border-purple-200 bg-purple-600 px-1 py-0.5 text-[9px] font-bold text-white hover:bg-purple-700"><Upload className="h-2.5 w-2.5" />上传</button><button type="button" title="绘制图框" onClick={() => { setSelectedId(frame.id); chooseDrawColor(drawColorId ?? Array.from(paletteMap.keys())[0] ?? null); }} className="inline-flex items-center justify-center gap-0.5 rounded border border-emerald-200 bg-emerald-50 px-1 py-0.5 text-[9px] font-bold text-emerald-700 hover:bg-emerald-100"><Paintbrush className="h-2.5 w-2.5" />绘制</button><button type="button" title="导出图框" disabled={!frame.beanResult && !hasManualCellsInRect(manualCells, frame.rect)} onClick={() => exportFrame(frame)} className="inline-flex items-center justify-center gap-0.5 rounded border border-purple-200 px-1 py-0.5 text-[9px] font-bold text-purple-700 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-2.5 w-2.5" />导出</button><button type="button" title="打开图框" disabled={!frame.beanResult} onClick={() => onOpenFrame(frame)} className="inline-flex items-center justify-center rounded border border-slate-200 px-1 py-0.5 text-[9px] font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">打开</button><button type="button" title="删除图框" onClick={() => deleteFrame(frame.id)} className="inline-flex items-center justify-center gap-0.5 rounded border border-rose-200 px-1 py-0.5 text-[9px] font-bold text-rose-700 hover:bg-rose-50"><Trash2 className="h-2.5 w-2.5" />删</button></div>
                          <div className="mt-1 grid grid-cols-3 gap-0.5" role="group" aria-label="图框尺寸档位">{LARGE_CANVAS_MAX_SIDES.map(side => <button key={side} type="button" disabled={frame.loading} onClick={() => changeMaxSide(frame, side)} className={`rounded px-1 py-0.5 text-[9px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${frame.maxSide === side ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>{side}格</button>)}</div>
                          <div className="mt-1 grid grid-cols-3 gap-0.5" role="group" aria-label="当前图框转换模式">{LARGE_CANVAS_MODES.map(({ id: mode, label }) => <button key={mode} type="button" disabled={frame.loading} onClick={() => changeMode(frame, mode)} className={`rounded px-1 py-0.5 text-[9px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${frame.mode === mode ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'}`}>{label}</button>)}</div>
                        </>
                      ) : (
                        <div className="mt-1.5 space-y-1.5" role="group" aria-label="图框转换参数">
                          <div className="rounded border border-purple-100 bg-purple-50/60 p-1.5">
                            <button type="button" disabled={frame.loading || !frame.sourceImageDataUrl} onClick={() => reconvertFrame(frame)} className="w-full rounded bg-purple-600 px-2 py-1 text-[9px] font-extrabold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-slate-300">{frame.loading ? '重新生成中…' : '应用并重新生成'}</button>
                            <p className="mt-1 text-[9px] leading-4 text-slate-500">{frame.sourceImageDataUrl ? '参数修改后，点击此按钮应用到当前图片图框。' : '此图框没有源图（手绘或刷新后的旧记录），不能重新生成。'}</p>
                          </div>
                          <label className="block text-[9px] font-bold text-slate-600">量化强度 <span className="float-right text-slate-400">{Math.round(conversionSettings.quantizationStrength ?? 35)}</span><input aria-label="量化强度" type="range" min="0" max="100" step="1" value={conversionSettings.quantizationStrength ?? 35} onChange={event => onChangeConversionSettings({ quantizationStrength: Number(event.target.value) })} className="mt-0.5 w-full accent-purple-600" /></label>
                          <label className="block text-[9px] font-bold text-slate-600">清晰度 <span className="float-right text-slate-400">{Math.round(conversionSettings.sharpening)}</span><input aria-label="清晰度" type="range" min="0" max="100" step="1" value={conversionSettings.sharpening} onChange={event => onChangeConversionSettings({ sharpening: Number(event.target.value) })} className="mt-0.5 w-full accent-purple-600" /></label>
                          <label className="flex items-center justify-between gap-2 text-[9px] font-bold text-slate-600"><span>移除背景</span><input aria-label="移除背景" type="checkbox" checked={Boolean(conversionSettings.backgroundRemovalEnabled)} onChange={event => onChangeConversionSettings({ backgroundRemovalEnabled: event.target.checked })} className="accent-purple-600" /></label>
                          <label className="flex items-center justify-between gap-2 text-[9px] font-bold text-slate-600"><span>抖动算法</span><select aria-label="抖动算法" value={conversionSettings.dither} onChange={event => onChangeConversionSettings({ dither: event.target.value as DitherMode })} className="max-w-28 rounded border border-slate-200 bg-white px-1 py-0.5 text-[9px] font-semibold text-slate-700"><option value="none">无</option><option value="floyd">Floyd-Steinberg</option><option value="atkinson">Atkinson</option></select></label>
                          <label className="flex items-center justify-between gap-2 text-[9px] font-bold text-slate-600"><span>色彩算法</span><select aria-label="色彩匹配算法" value={conversionSettings.colorMatchAlgo} onChange={event => onChangeConversionSettings({ colorMatchAlgo: event.target.value as ColorMatchAlgo })} className="max-w-28 rounded border border-slate-200 bg-white px-1 py-0.5 text-[9px] font-semibold text-slate-700"><option value="ciede2000_bright">CIEDE2000 明亮</option><option value="ciede2000_vivid">CIEDE2000 鲜艳</option><option value="ciede2000">CIEDE2000</option><option value="cie76">CIE76</option><option value="rgb_weighted">RGB 加权</option><option value="oklab">OKLab</option><option value="rgb">RGB</option></select></label>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            <ManualBeanLayer cells={manualCells} paletteMap={paletteMap} beadShape={beadShape} cellSize={scaledCellSize} showCodeLabels={showCodeLabels && viewScale >= 0.8} />
            {manualShapePreview && <div className="pointer-events-none absolute inset-0 z-30">{manualShapePreview.points.map(point => <span key={`${point.x}-${point.y}`} className={`absolute rounded-sm ${manualShapePreview.selection ? 'bg-rose-600/75' : 'bg-purple-700/75'}`} style={{ left: point.x * scaledCellSize + 1, top: point.y * scaledCellSize + 1, width: Math.max(1, scaledCellSize - 2), height: Math.max(1, scaledCellSize - 2) }} />)}</div>}
          </div>
          {showDataPreview && selectedFrame && (
            <aside className="pointer-events-auto mt-3 w-full max-w-xl rounded-lg border border-purple-200 bg-white/95 p-3 shadow-sm" aria-label="选中图框数据预览">
              <div className="flex items-center justify-between gap-2 text-xs font-extrabold text-purple-900">
                <span>{selectedFrame.title} · {selectedFrame.rect.width} × {selectedFrame.rect.height}格</span>
                <span>{selectedFrame.beanResult ? `${selectedFrame.beanResult.flat().filter(Boolean).length}颗` : '未生成'}</span>
              </div>
              {selectedFrameCounts.length ? (
                <div className="mt-2 grid max-h-32 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
                  {selectedFrameCounts.map(([id, count]) => {
                    const color = paletteMap.get(id);
                    return <div key={id} className="flex min-w-0 items-center gap-1 rounded border border-slate-100 px-1.5 py-1 text-[10px] font-semibold text-slate-700"><span className="h-3 w-3 shrink-0 rounded-sm border border-slate-200" style={{ backgroundColor: color?.hex ?? '#CBD5E1' }} /><span className="truncate">{color?.code ?? id}</span><span className="ml-auto shrink-0 text-slate-500">{count}</span></div>;
                  })}
                </div>
              ) : <p className="mt-1 text-[10px] text-slate-500">当前图框暂无豆子数据。</p>}
            </aside>
          )}
        </div>
        {(message || storageMessage || restoreNotice) && <div role="status" className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-800">{message ?? storageMessage ?? restoreNotice}</div>}
      </div>
    </main>
  );
};
