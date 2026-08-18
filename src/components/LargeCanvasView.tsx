import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Download,
  Grid2X2,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
  ZoomIn,
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
  paletteMap: Map<string, { hex: string }>;
  onConvertImage: (
    file: File,
    mode: LargeCanvasConversionMode,
    gridW: number,
    gridH: number,
  ) => Promise<LargeCanvasConversionResult>;
  onOpenFrame: (frame: LargeCanvasFrame) => void;
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

type GridPoint = { x: number; y: number };
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

function restorePersistedFrames(): { frames: LargeCanvasFrame[]; selectedId: string | null } {
  if (typeof window === 'undefined') return { frames: [], selectedId: null };
  try {
    const raw = window.localStorage.getItem(LARGE_CANVAS_STORAGE_KEY);
    if (!raw) return { frames: [], selectedId: null };
    const parsed: unknown = JSON.parse(raw);
    const source = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.frames) ? parsed.frames : [];
    const frames: LargeCanvasFrame[] = [];
    const ids = new Set<string>();
    for (const value of source) {
      if (!isRecord(value) || typeof value.id !== 'string' || ids.has(value.id)) continue;
      const rawRect = isRecord(value.rect) ? value.rect : null;
      if (!rawRect || !['x', 'y', 'width', 'height'].every(key => typeof rawRect[key] === 'number' && Number.isInteger(rawRect[key]))) continue;
      const rect = snapLargeCanvasGridRect({ id: value.id, x: rawRect.x as number, y: rawRect.y as number, width: rawRect.width as number, height: rawRect.height as number });
      if (rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || rect.width > LARGE_CANVAS_MAX_GRID_SIZE || rect.height > LARGE_CANVAS_MAX_GRID_SIZE) continue;
      if (rect.x + rect.width > BOARD_GRID_WIDTH || rect.y + rect.height > BOARD_GRID_HEIGHT) continue;
      // Legacy records did not have maxSide. Infer the smallest valid tier that preserves their size.
      const maxSide: LargeCanvasMaxSide = isMaxSide(value.maxSide)
        ? value.maxSide
        : LARGE_CANVAS_MAX_SIDES.find(side => Math.max(rect.width, rect.height) <= side) ?? 100;
      const accepted = getNewLargeCanvasGridRectCandidate(rect, frames.map(frame => frame.rect));
      if (!accepted) continue;
      frames.push({
        id: value.id,
        title: typeof value.title === 'string' && value.title.trim() ? value.title : `图框 ${frames.length + 1}`,
        rect: accepted,
        maxSide,
        sourceImageDataUrl: typeof value.sourceImageDataUrl === 'string' ? value.sourceImageDataUrl : null,
        mode: isConversionMode(value.mode) ? value.mode : 'cartoon',
        beanResult: readBeanResult(value.beanResult, accepted.width, accepted.height),
        loading: false,
        error: typeof value.error === 'string' ? value.error : null,
      });
      ids.add(value.id);
    }
    const selectedId = isRecord(parsed) && typeof parsed.selectedId === 'string' && frames.some(frame => frame.id === parsed.selectedId) ? parsed.selectedId : null;
    return { frames, selectedId };
  } catch {
    return { frames: [], selectedId: null };
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

function drawBeanResult(context: CanvasRenderingContext2D, frame: LargeCanvasFrame, paletteMap: Map<string, { hex: string }>, offsetX: number, offsetY: number): void {
  if (!frame.beanResult) return;
  frame.beanResult.forEach((row, y) => row.forEach((colorId, x) => {
    if (!colorId) return;
    context.beginPath();
    context.arc((frame.rect.x - offsetX + x + 0.5) * GRID_CELL_SIZE, (frame.rect.y - offsetY + y + 0.5) * GRID_CELL_SIZE, GRID_CELL_SIZE * 0.42, 0, Math.PI * 2);
    context.fillStyle = paletteMap.get(colorId)?.hex ?? '#CBD5E1';
    context.fill();
  }));
}

function downloadCanvas(canvas: HTMLCanvasElement, name: string): void {
  const link = document.createElement('a');
  link.download = name;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function FrameBeanGrid({ frame, paletteMap, rect }: { frame: LargeCanvasFrame; paletteMap: Map<string, { hex: string }>; rect: LargeCanvasGridRect }) {
  const grid = frame.beanResult;
  if (!grid || grid.length !== rect.height || grid[0]?.length !== rect.width) return null;
  return (
    <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${rect.width}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rect.height}, minmax(0, 1fr))` }} aria-label={`${frame.title}豆点阵`}>
      {grid.flatMap((row, y) => row.map((colorId, x) => (
        <span key={`${y}-${x}`} className="block" style={{ backgroundColor: colorId ? paletteMap.get(colorId)?.hex ?? '#CBD5E1' : '#E2E8F0' }} />
      )))}
    </div>
  );
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

export const LargeCanvasView: React.FC<LargeCanvasViewProps> = ({ paletteMap, onConvertImage, onOpenFrame }) => {
  const initialState = useRef<{ frames: LargeCanvasFrame[]; selectedId: string | null } | null>(null);
  if (!initialState.current) initialState.current = restorePersistedFrames();
  const [frames, setFrames] = useState<LargeCanvasFrame[]>(() => initialState.current?.frames ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(() => initialState.current?.selectedId ?? null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [newFrameMaxSide, setNewFrameMaxSide] = useState<LargeCanvasMaxSide>(DEFAULT_MAX_SIDE);
  const [interaction, setInteraction] = useState<GridInteraction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
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

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem(LARGE_CANVAS_STORAGE_KEY, JSON.stringify({ frames, selectedId }));
        setStorageMessage(null);
      } catch {
        setStorageMessage('本地保存空间不足，当前工作区仍可继续使用。');
      }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [frames, selectedId]);

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

  const nextRequestVersion = (id: string): number => {
    const version = (requestVersions.current.get(id) ?? 0) + 1;
    requestVersions.current.set(id, version);
    return version;
  };

  const getOtherRects = (frameId?: string) => frames.filter(frame => frame.id !== frameId).map(frame => frame.rect);

  const convertFrame = (frame: LargeCanvasFrame, fileOrPromise: File | Promise<File>, mode: LargeCanvasConversionMode, maxSide: LargeCanvasMaxSide, title: string, dimensions?: { width: number; height: number }) => {
    const version = nextRequestVersion(frame.id);
    updateFrame(frame.id, { loading: true, error: null, mode, maxSide });
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
        updateFrame(frame.id, { rect: candidate, title, mode, maxSide, beanResult: null });
        return onConvertImage(file, mode, candidate.width, candidate.height);
      })
      .then(result => {
        if (!result || requestVersions.current.get(frame.id) !== version) return;
        updateFrame(frame.id, { sourceImageDataUrl: result.sourceImageDataUrl, beanResult: result.grid, loading: false, error: null });
      })
      .catch(error => {
        if (requestVersions.current.get(frame.id) !== version) return;
        updateFrame(frame.id, { loading: false, error: error instanceof Error ? error.message : '图片转换失败' });
      });
  };

  const reconvertFrame = (frame: LargeCanvasFrame, maxSide = frame.maxSide) => {
    if (!frame.sourceImageDataUrl) {
      const size = getLargeCanvasGridDimensions(frame.rect.width, frame.rect.height, maxSide);
      const candidate = getNewLargeCanvasGridRectCandidate({ ...frame.rect, width: size.width, height: size.height }, getOtherRects(frame.id));
      if (!candidate || candidate.x + candidate.width > BOARD_GRID_WIDTH || candidate.y + candidate.height > BOARD_GRID_HEIGHT) {
        setMessage('图框尺寸扩大后与其他图框重叠，已拦截。');
        return;
      }
      updateFrame(frame.id, { rect: candidate, maxSide, beanResult: null, error: null });
      return;
    }
    convertFrame(frame, dataUrlToFile(frame.sourceImageDataUrl, `${frame.title}.png`), frame.mode, maxSide, frame.title);
  };

  const loadFile = (frame: LargeCanvasFrame, file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) {
      setMessage('请选择图片文件。');
      return;
    }
    convertFrame(frame, file, frame.mode, frame.maxSide, file.name.replace(/\.[^/.]+$/, '') || frame.title);
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
    if (
      event.button !== 0
      || !spacePressedRef.current
      || pinchStateRef.current.active
      || isViewScaleIgnoredTarget(event.target)
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
    setFrames(current => current.filter(frame => frame.id !== id));
    setSelectedId(current => current === id ? null : current);
    setHoveredId(current => current === id ? null : current);
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
    if (!frame.beanResult) {
      setMessage('该图框还没有生成图纸。');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = frame.rect.width * GRID_CELL_SIZE;
    canvas.height = frame.rect.height * GRID_CELL_SIZE;
    const context = canvas.getContext('2d');
    if (!context) return;
    drawBeanResult(context, frame, paletteMap, frame.rect.x, frame.rect.y);
    downloadCanvas(canvas, `${frame.title || '图框'}-拼豆图纸.png`);
  };

  const exportWholeCanvas = () => {
    const completed = frames.filter(frame => frame.beanResult);
    if (!completed.length) {
      setMessage('当前没有可导出的图纸。');
      return;
    }
    const minX = Math.min(...completed.map(frame => frame.rect.x));
    const minY = Math.min(...completed.map(frame => frame.rect.y));
    const maxX = Math.max(...completed.map(frame => frame.rect.x + frame.rect.width));
    const maxY = Math.max(...completed.map(frame => frame.rect.y + frame.rect.height));
    const canvas = document.createElement('canvas');
    canvas.width = (maxX - minX) * GRID_CELL_SIZE;
    canvas.height = (maxY - minY) * GRID_CELL_SIZE;
    const context = canvas.getContext('2d');
    if (!context) return;
    completed.forEach(frame => drawBeanResult(context, frame, paletteMap, minX, minY));
    downloadCanvas(canvas, '大画板-拼豆图纸.png');
  };

  const interactionFrameId = interaction?.frameId;
  const completedCount = frames.filter(frame => frame.beanResult).length;
  const scaledCellSize = GRID_CELL_SIZE * viewScale;
  const scaledMajorGridSize = GRID_CELL_SIZE * 5 * viewScale;
  const scaledMinorGridSize = GRID_CELL_SIZE * viewScale;
  const gridLineSize = 1;
  const majorGridLineColor = 'rgba(71, 85, 105, 0.4)';
  const minorGridLineColor = 'rgba(100, 116, 139, 0.2)';

  return (
    <main className="min-h-0 flex-1 overflow-hidden bg-slate-100 text-slate-900">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div>
            <div className="flex items-center gap-2"><Grid2X2 className="h-5 w-5 text-purple-600" /><h1 className="text-base font-extrabold text-slate-900 sm:text-lg">大画板</h1><span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700">全局拼豆网格</span></div>
            <p className="mt-1 text-xs text-slate-500">每个图框独立生成，豆点始终对齐全局网格。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">{frames.length} 个图框 · {completedCount} 个结果</span>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="画板缩放">
              <button type="button" title="缩小画板" aria-label="缩小画板" disabled={viewScale <= MIN_VIEW_SCALE} onClick={() => setViewScale(current => normalizeViewScale(current - VIEW_SCALE_STEP))} className="rounded p-1 text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"><ZoomOut className="h-3.5 w-3.5" /></button>
              <input aria-label="画板缩放百分比" type="range" min={MIN_VIEW_SCALE * 100} max={MAX_VIEW_SCALE * 100} step={VIEW_SCALE_STEP * 100} value={Math.round(viewScale * 100)} onChange={event => setViewScale(normalizeViewScale(Number(event.target.value) / 100))} className="w-20 accent-purple-600" />
              <span className="w-10 text-center text-[10px] font-bold text-slate-600">{Math.round(viewScale * 100)}%</span>
              <button type="button" title="放大画板" aria-label="放大画板" disabled={viewScale >= MAX_VIEW_SCALE} onClick={() => setViewScale(current => normalizeViewScale(current + VIEW_SCALE_STEP))} className="rounded p-1 text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"><ZoomIn className="h-3.5 w-3.5" /></button>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="新图框档位">
              {LARGE_CANVAS_MAX_SIDES.map(side => <button key={side} type="button" onClick={() => setNewFrameMaxSide(side)} className={`rounded-md px-2 py-1 text-[10px] font-bold ${newFrameMaxSide === side ? 'bg-purple-600 text-white' : 'text-purple-700 hover:bg-purple-100'}`}>{side}</button>)}
            </div>
            <button type="button" onClick={addFrame} className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-purple-700"><Plus className="h-3.5 w-3.5" /> 添加图框</button>
            <button type="button" onClick={exportWholeCanvas} disabled={!completedCount} className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs font-bold text-purple-700 transition-colors hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-3.5 w-3.5" /> 导出整张</button>
            <button type="button" onClick={() => { setFrames([]); setSelectedId(null); }} disabled={!frames.length} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /> 清空</button>
          </div>
        </header>

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
          <div ref={boardRef} className="relative border border-slate-300 bg-white shadow-inner" style={{ width: BOARD_GRID_WIDTH * scaledCellSize, height: BOARD_GRID_HEIGHT * scaledCellSize, backgroundImage: `linear-gradient(${majorGridLineColor} ${gridLineSize}px, transparent ${gridLineSize}px), linear-gradient(90deg, ${majorGridLineColor} ${gridLineSize}px, transparent ${gridLineSize}px), linear-gradient(${minorGridLineColor} ${gridLineSize}px, transparent ${gridLineSize}px), linear-gradient(90deg, ${minorGridLineColor} ${gridLineSize}px, transparent ${gridLineSize}px)`, backgroundSize: `${scaledMajorGridSize}px ${scaledMajorGridSize}px, ${scaledMajorGridSize}px ${scaledMajorGridSize}px, ${scaledMinorGridSize}px ${scaledMinorGridSize}px, ${scaledMinorGridSize}px ${scaledMinorGridSize}px` }} onPointerDown={event => { if (event.target === event.currentTarget) { setSelectedId(null); setHoveredId(null); setMessage(null); } }} onPointerMove={updateInteraction} onPointerUp={finishInteraction} onPointerCancel={() => setInteraction(null)}>
            <div className="pointer-events-none absolute left-3 top-2 text-[10px] font-bold text-slate-400">1格 = 1颗拼豆 · 每5格粗线 · {BOARD_GRID_WIDTH} × {BOARD_GRID_HEIGHT}</div>
            {frames.map(frame => {
              const activeInteraction = interactionFrameId === frame.id ? interaction : null;
              const renderRect = activeInteraction ? activeInteraction.preview : frame.rect;
              const valid = activeInteraction ? activeInteraction.valid : true;
              const isSelected = selectedId === frame.id;
              const isHovered = hoveredId === frame.id;
              const showPopup = isSelected || (selectedId === null && isHovered);
              return (
                <article key={frame.id} aria-label={frame.title} className={`absolute overflow-visible ${isSelected || isHovered ? 'z-30' : 'z-10'}`} style={{ left: renderRect.x * scaledCellSize, top: renderRect.y * scaledCellSize, width: renderRect.width * scaledCellSize, height: renderRect.height * scaledCellSize }} onPointerEnter={() => setHoveredId(frame.id)} onPointerLeave={() => { if (selectedId !== frame.id) setHoveredId(current => current === frame.id ? null : current); }} onPointerDown={event => startFrameMove(event, frame)} onPointerMove={updateInteraction} onPointerUp={finishInteraction} onClick={event => { event.stopPropagation(); setSelectedId(frame.id); }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); event.stopPropagation(); loadFile(frame, event.dataTransfer.files[0]); }}>
                  <div className={`pointer-events-none absolute inset-0 ${valid ? (isSelected ? 'ring-2 ring-amber-400' : 'ring-1 ring-purple-500/70') : 'ring-2 ring-rose-500'}`} />
                  <FrameBeanGrid frame={frame} paletteMap={paletteMap} rect={renderRect} />
                  {frame.loading && <div className="absolute inset-0 flex items-center justify-center bg-white/70"><Loader2 className="h-5 w-5 animate-spin text-purple-600" /></div>}
                  {frame.error && <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-rose-600/90 px-1 py-0.5 text-[9px] font-bold text-white"><AlertTriangle className="h-3 w-3 shrink-0" />转换失败</div>}
                  <input ref={input => { if (input) inputRefs.current.set(frame.id, input); }} type="file" accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; loadFile(frame, file); }} />
                  {showPopup && (
                    <div data-view-scale-ignore className="absolute left-0 z-50 rounded-md border border-slate-200 bg-white p-1.5 shadow-lg" style={{ top: renderRect.y === 0 ? renderRect.height * scaledCellSize + 6 : -50, width: 'min(220px, calc(100vw - 1.5rem))' }} onPointerDown={event => { event.stopPropagation(); setSelectedId(frame.id); }} onPointerMove={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
                      <div className="flex items-center justify-between gap-1"><span className="truncate text-[10px] font-extrabold text-slate-800">{frame.title}</span><button type="button" aria-label="关闭图框浮窗" className="rounded p-0.5 text-slate-400 hover:bg-slate-100" onClick={event => { event.stopPropagation(); setSelectedId(null); setHoveredId(null); }}><X className="h-3 w-3" /></button></div>
                      <div className="mt-0.5 flex items-center justify-between text-[9px] font-bold text-slate-500"><span>{renderRect.width} × {renderRect.height}格 · {frame.maxSide}格</span><span>{frame.loading ? '生成中' : frame.error ? '失败' : frame.beanResult ? '已生成' : '待上传'}</span></div>
                      <div className="mt-1.5 grid grid-cols-4 gap-0.5"><button type="button" title="上传图片" onClick={() => inputRefs.current.get(frame.id)?.click()} className="inline-flex items-center justify-center gap-0.5 rounded border border-purple-200 bg-purple-600 px-1 py-0.5 text-[9px] font-bold text-white hover:bg-purple-700"><Upload className="h-2.5 w-2.5" />上传</button><button type="button" title="导出图框" disabled={!frame.beanResult} onClick={() => exportFrame(frame)} className="inline-flex items-center justify-center gap-0.5 rounded border border-purple-200 px-1 py-0.5 text-[9px] font-bold text-purple-700 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-2.5 w-2.5" />导出</button><button type="button" title="打开图框" disabled={!frame.beanResult} onClick={() => onOpenFrame(frame)} className="inline-flex items-center justify-center rounded border border-slate-200 px-1 py-0.5 text-[9px] font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">打开</button><button type="button" title="删除图框" onClick={() => deleteFrame(frame.id)} className="inline-flex items-center justify-center gap-0.5 rounded border border-rose-200 px-1 py-0.5 text-[9px] font-bold text-rose-700 hover:bg-rose-50"><Trash2 className="h-2.5 w-2.5" />删</button></div>
                      <div className="mt-1 grid grid-cols-3 gap-0.5" role="group" aria-label="图框尺寸档位">{LARGE_CANVAS_MAX_SIDES.map(side => <button key={side} type="button" disabled={frame.loading} onClick={() => changeMaxSide(frame, side)} className={`rounded px-1 py-0.5 text-[9px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${frame.maxSide === side ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>{side}格</button>)}</div>
                      <div className="mt-1 grid grid-cols-3 gap-0.5" role="group" aria-label="当前图框转换模式">{LARGE_CANVAS_MODES.map(({ id: mode, label }) => <button key={mode} type="button" disabled={frame.loading} onClick={() => changeMode(frame, mode)} className={`rounded px-1 py-0.5 text-[9px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${frame.mode === mode ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'}`}>{label}</button>)}</div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
        {(message || storageMessage) && <div role="status" className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-800">{message ?? storageMessage}</div>}
      </div>
    </main>
  );
};
