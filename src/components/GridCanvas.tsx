import React, { useRef, useEffect, useState, useCallback, useLayoutEffect, type MutableRefObject } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Minimize2, Focus, Hand, Pencil, Eye, EyeOff, Image as ImageIcon, X, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Upload, RotateCcw, Cloud } from 'lucide-react';
import { BeadColor, BeadShape, ToolType, SymmetryMode, CanvasBackdrop } from '../types';
import { drawPreviewBeadOnCanvas, getPreviewCellBounds } from '../utils/ironedPreview';
import { getColumnLabelPositions, getRowLabelPositions } from '../utils/gridCoordinateLabels';
import { getColorDisplayState } from '../utils/completionHighlight';
import { getGridImageFitRect } from '../utils/gridImageFit';
import { clampCanvasViewport, MIN_CANVAS_ZOOM } from '../utils/canvasViewport';
import { getVisibleGridRange } from '../utils/visibleGridRange';
import type { BackgroundCleanupPreview } from '../hooks/useBackgroundCleanup';
import { BackgroundCleanupOverlay } from './BackgroundCleanupOverlay';
import { normalizeSymmetryAxes, reflectGridPoints, type SymmetryAxes } from '../utils/gridEditing';
import {
  changeImagePreviewScale,
  createInitialImagePreviewView,
  forwardReferenceImageUpload,
  IMAGE_PREVIEW_CONTROLS,
  IMAGE_PREVIEW_TOOLBAR_CLASS,
  resetImagePreviewView,
  type ImagePreviewView,
} from '../utils/imagePreviewView';
import {
  clampReferencePanelPosition,
  getCollapsedReferencePanelPosition,
  getExpandedReferencePanelPosition,
  getInitialReferencePanelPosition,
  type ReferencePanelPosition,
} from '../utils/referencePanelPosition';

/** Below this many pixels per bead a fingertip cannot hit a single bead. */
const MIN_PAINTABLE_CELL_PX = 9;

/** Zoom target used by the "too small to paint" shortcut. */
const COMFORTABLE_CELL_PX = 26;

/**
 * Bottom strip covered by the floating zoom cluster and the size chip on
 * phones. Framing subtracts it so a focused board never ends underneath them.
 */
const MOBILE_CANVAS_BOTTOM_BAND = 64;

interface GridCanvasProps {
  cleanupPreview?: BackgroundCleanupPreview | null;
  symmetryAxes?: SymmetryAxes;
  onSymmetryAxesChange?: (axes: SymmetryAxes) => void;
  grid: (string | null)[][];
  paletteMap: Map<string, BeadColor>;
  width: number;
  height: number;
  boardSize: number;
  activeTool: ToolType;
  setActiveTool?: (tool: ToolType) => void;
  selectedColor: BeadColor | null;
  highlightColorId?: string | null;
  highlightColorIds?: string[];
  completedColorIds?: string[];
  beadShape: BeadShape;
  showSymbols: boolean;
  showGridLines: boolean;
  showCoordinates: boolean;
  zoom: number;
  setZoom: (zoom: number) => void;
  onCellClick: (x: number, y: number) => void;
  onHistoryTransactionStart?: () => void;
  onHistoryTransactionEnd?: () => void;
  onMultiCellClick?: (points: { x: number; y: number }[]) => void;
  onApplyShape?: (points: { x: number; y: number }[]) => void;
  onEyedropColor: (color: BeadColor) => void;
  symmetryMode?: SymmetryMode;
  canvasBackdrop?: CanvasBackdrop;
  sourceImage?: HTMLImageElement | null;
  overlayImage?: HTMLImageElement | null;
  showOverlay?: boolean;
  overlayOpacity?: number;
  onReferenceImageUpload?: (file: File) => void;
  onResetCanvas?: () => void;
  keepImageAspectRatio?: boolean;
  /**
   * Keeps the shared canvas business behavior intact while allowing each
   * workspace shell to install only the interaction listeners it needs.
   */
  interactionProfile?: 'desktop' | 'touch' | 'hybrid';
  /**
   * Lets a mobile shell own the board switcher chrome. On a phone a floating
   * prev/next pill covers the grid it is meant to help with, and stepping to
   * board 5 costs four taps; the shell renders a docked tab strip in the thumb
   * zone instead and drives it through this API.
   */
  boardNavApiRef?: MutableRefObject<BoardNavApi | null>;
  onBoardNavStateChange?: (state: BoardNavState) => void;
}

/** Board geometry the shell needs to draw its own board switcher. */
export interface BoardNavState {
  focusedBoard: number | null;
  totalBoards: number;
}

export interface BoardNavApi {
  /** Focus one physical pegboard by index, 0-based. */
  focusBoard: (index: number) => void;
  /** Frame the whole pattern and clear the focused board. */
  showWholePattern: () => void;
}

// Bresenham's Line Algorithm
function getLinePoints(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let currX = x0;
  let currY = y0;

  while (true) {
    points.push({ x: currX, y: currY });
    if (currX === x1 && currY === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      currX += sx;
    }
    if (e2 < dx) {
      err += dx;
      currY += sy;
    }
  }

  return points;
}

// Rectangle Outline Points
function getRectanglePoints(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);

  for (let x = minX; x <= maxX; x++) {
    points.push({ x, y: minY });
    points.push({ x, y: maxY });
  }
  for (let y = minY + 1; y < maxY; y++) {
    points.push({ x: minX, y });
    points.push({ x: maxX, y });
  }

  return points;
}

// Circle Outline Points (Midpoint Circle)
function getCirclePoints(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const radius = Math.round(Math.sqrt(Math.pow(x1 - x0, 2) + Math.pow(y1 - y0, 2)));
  const points = new Set<string>();

  let x = radius;
  let y = 0;
  let err = 0;

  const addPoint = (px: number, py: number) => {
    points.add(`${px},${py}`);
  };

  while (x >= y) {
    addPoint(x0 + x, y0 + y);
    addPoint(x0 + y, y0 + x);
    addPoint(x0 - y, y0 + x);
    addPoint(x0 - x, y0 + y);
    addPoint(x0 - x, y0 - y);
    addPoint(x0 - y, y0 - x);
    addPoint(x0 + y, y0 - x);
    addPoint(x0 + x, y0 - y);

    if (err <= 0) {
      y += 1;
      err += 2 * y + 1;
    }
    if (err > 0) {
      x -= 1;
      err -= 2 * x + 1;
    }
  }

  return Array.from(points).map(str => {
    const [px, py] = str.split(',').map(Number);
    return { x: px, y: py };
  });
}

function isCanvasInteractionIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('button, input, textarea, select, [contenteditable="true"], [role="dialog"], [aria-modal="true"]'));
}

function getCanvasDpr(): number {
  // Large touch boards are dominated by fill/stroke count, not resolution.
  // Bound backing-store work more aggressively on phones/tablets; desktop
  // retains a sharper retina canvas.
  const deviceDpr = window.devicePixelRatio || 1;
  const isTouchSized = window.matchMedia('(pointer: coarse)').matches;
  return Math.min(isTouchSized ? 1.35 : 2, Math.max(1, deviceDpr));
}

export const GridCanvas: React.FC<GridCanvasProps> = ({
  cleanupPreview,
  symmetryAxes,
  onSymmetryAxesChange,
  grid,
  paletteMap,
  width,
  height,
  boardSize,
  activeTool,
  setActiveTool,
  selectedColor,
  highlightColorId,
  highlightColorIds,
  completedColorIds = [],
  beadShape,
  showSymbols,
  showGridLines,
  showCoordinates,
  zoom,
  setZoom,
  onCellClick,
  onHistoryTransactionStart,
  onHistoryTransactionEnd,
  onMultiCellClick,
  onApplyShape,
  onEyedropColor,
  symmetryMode = 'none',
  canvasBackdrop = 'dark_grid',
  sourceImage = null,
  overlayImage = null,
  showOverlay = false,
  overlayOpacity = 0.35,
  onReferenceImageUpload,
  onResetCanvas,
  keepImageAspectRatio = true,
  interactionProfile = 'hybrid',
  boardNavApiRef,
  onBoardNavStateChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referencePanelRef = useRef<HTMLDivElement>(null);
  const canvasHoveredRef = useRef(false);
  const spacePressedRef = useRef(false);

  // Pan offsets
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [isPanning, setIsPanning] = useState(false);

  // Remember last drawing tool before switching to hand
  const [lastDrawTool, setLastDrawTool] = useState<ToolType>('pencil');

  // Original image reference preview state
  const effectiveImage = sourceImage || overlayImage;
  const [overlayReady, setOverlayReady] = useState(false);
  const overlayImageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    overlayImageRef.current = null;
    setOverlayReady(false);
    if (!effectiveImage) return;
    if (effectiveImage.complete && effectiveImage.naturalWidth > 0) {
      overlayImageRef.current = effectiveImage;
      setOverlayReady(true);
      return;
    }
    const handleLoad = () => {
      overlayImageRef.current = effectiveImage;
      setOverlayReady(true);
    };
    effectiveImage.addEventListener('load', handleLoad);
    return () => effectiveImage.removeEventListener('load', handleLoad);
  }, [effectiveImage]);
  const [isEnlargedModalOpen, setIsEnlargedModalOpen] = useState(false);
  const [modalImageView, updateModalImageView] = useState(createInitialImagePreviewView);
  const modalImageViewportRef = useRef<HTMLDivElement>(null);
  const modalImageRef = useRef<HTMLImageElement>(null);
  // Keep the drawing surface clear on phones initially; the reference stays one tap away.
  const [isThumbnailMinimized, setIsThumbnailMinimized] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
  ));
  const modalImageDragRef = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null);
  const [referencePanelPosition, setReferencePanelPosition] = useState<ReferencePanelPosition>({ x: 8, y: 8 });
  const referencePanelDragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startPosition: ReferencePanelPosition } | null>(null);
  const [isReferenceSheetOpen, setIsReferenceSheetOpen] = useState(false);
  // Which physical pegboard the mobile board navigator is showing (null = whole pattern).
  const [focusedBoard, setFocusedBoard] = useState<number | null>(null);
  const focusedBoardRef = useRef<number | null>(null);
  const referencePanelInitializedRef = useRef(false);
  const [isCanvasResetDialogOpen, setIsCanvasResetDialogOpen] = useState(false);
  const confirmCanvasResetRef = useRef<HTMLButtonElement>(null);
  const lastExpandedSizeRef = useRef<{ width: number; height: number }>({ width: 300, height: 220 });

  const boundModalImageView = useCallback((view: ImagePreviewView): ImagePreviewView => {
    const viewport = modalImageViewportRef.current;
    const image = modalImageRef.current;
    if (!viewport || !image || !image.clientWidth || !image.clientHeight) return view;
    // The DOM image scales about its center; the shared helper takes a top-left.
    const centeredX = (viewport.clientWidth - image.clientWidth * view.scale) / 2;
    const centeredY = (viewport.clientHeight - image.clientHeight * view.scale) / 2;
    const bounded = clampCanvasViewport(
      { zoom: view.scale, x: centeredX + view.pan.x, y: centeredY + view.pan.y },
      { width: viewport.clientWidth, height: viewport.clientHeight },
      { width: image.clientWidth, height: image.clientHeight },
    );
    const pan = { x: bounded.x - centeredX, y: bounded.y - centeredY };
    return pan.x === view.pan.x && pan.y === view.pan.y ? view : { ...view, pan };
  }, []);

  const setModalImageView = useCallback((update: React.SetStateAction<ImagePreviewView>) => {
    updateModalImageView(current => boundModalImageView(typeof update === 'function' ? update(current) : update));
  }, [boundModalImageView]);

  const zoomModalImage = useCallback((delta: number) => {
    setModalImageView(current => {
      const next = changeImagePreviewScale(current, delta);
      const ratio = next.scale / current.scale;
      return { ...next, pan: { x: current.pan.x * ratio, y: current.pan.y * ratio } };
    });
  }, [setModalImageView]);

  useLayoutEffect(() => {
    const viewport = modalImageViewportRef.current;
    const image = modalImageRef.current;
    if (!isEnlargedModalOpen || !viewport || !image) return;
    const clamp = () => setModalImageView(current => current);
    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(viewport);
    observer.observe(image);
    return () => observer.disconnect();
  }, [isEnlargedModalOpen, effectiveImage, setModalImageView]);

  const resetModalImageView = useCallback(() => {
    setModalImageView(resetImagePreviewView());
  }, [setModalImageView]);

  const openEnlargedImagePreview = useCallback(() => {
    resetModalImageView();
    setIsEnlargedModalOpen(true);
  }, [resetModalImageView]);

  useEffect(() => {
    resetModalImageView();
  }, [effectiveImage, resetModalImageView]);

  const clampReferencePanel = useCallback((position: ReferencePanelPosition) => {
    const container = containerRef.current;
    const panel = referencePanelRef.current;
    if (!container || !panel) return position;

    return clampReferencePanelPosition(
      position,
      { width: container.clientWidth, height: container.clientHeight },
      { width: panel.offsetWidth, height: panel.offsetHeight },
    );
  }, []);

  useLayoutEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches) return;
    const container = containerRef.current;
    const panel = referencePanelRef.current;
    if (!container || !panel) return;

    const updatePosition = () => {
      if (!isThumbnailMinimized && panel.offsetWidth > 60) {
        lastExpandedSizeRef.current = {
          width: panel.offsetWidth,
          height: panel.offsetHeight,
        };
      }
      setReferencePanelPosition(current => {
        if (!referencePanelInitializedRef.current) {
          referencePanelInitializedRef.current = true;
          return getInitialReferencePanelPosition(
            { width: container.clientWidth, height: container.clientHeight },
            { width: panel.offsetWidth, height: panel.offsetHeight },
          );
        }
        return clampReferencePanelPosition(
          current,
          { width: container.clientWidth, height: container.clientHeight },
          { width: panel.offsetWidth, height: panel.offsetHeight },
        );
      });
    };

    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(container);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [effectiveImage, isThumbnailMinimized]);

  const handleCollapseReferencePanel = useCallback(() => {
    const container = containerRef.current;
    const panel = referencePanelRef.current;
    const isSm = typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches;
    const cloudSize = isSm ? 48 : 44;
    const minimizedSize = { width: cloudSize, height: cloudSize };

    if (container && panel) {
      const expandedSize = {
        width: panel.offsetWidth || (isSm ? 300 : Math.min(220, container.clientWidth - 16)),
        height: panel.offsetHeight || 220,
      };
      lastExpandedSizeRef.current = expandedSize;

      const targetPos = getCollapsedReferencePanelPosition(
        referencePanelPosition,
        { width: container.clientWidth, height: container.clientHeight },
        expandedSize,
        minimizedSize,
      );
      setReferencePanelPosition(targetPos);
    }
    setIsThumbnailMinimized(true);
  }, [referencePanelPosition]);

  const handleExpandReferencePanel = useCallback(() => {
    const container = containerRef.current;
    const isSm = typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches;
    const cloudSize = isSm ? 48 : 44;
    const minimizedSize = { width: cloudSize, height: cloudSize };

    if (container) {
      const expandedSize = {
        width: lastExpandedSizeRef.current.width || (isSm ? 300 : Math.min(220, container.clientWidth - 16)),
        height: lastExpandedSizeRef.current.height || 220,
      };

      const targetPos = getExpandedReferencePanelPosition(
        referencePanelPosition,
        { width: container.clientWidth, height: container.clientHeight },
        expandedSize,
        minimizedSize,
      );
      setReferencePanelPosition(targetPos);
    }
    setIsThumbnailMinimized(false);
  }, [referencePanelPosition]);

  const handleReferencePanelPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    referencePanelDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: referencePanelPosition,
    };
  }, [referencePanelPosition]);

  const handleReferencePanelPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = referencePanelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    setReferencePanelPosition(clampReferencePanel({
      x: drag.startPosition.x + event.clientX - drag.startClientX,
      y: drag.startPosition.y + event.clientY - drag.startClientY,
    }));
  }, [clampReferencePanel]);

  const stopReferencePanelDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (referencePanelDragRef.current?.pointerId === event.pointerId) {
      referencePanelDragRef.current = null;
    }
  }, []);

  const cloudDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPos: ReferencePanelPosition;
    hasMoved: boolean;
  } | null>(null);

  const handleCloudPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    cloudDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPos: referencePanelPosition,
      hasMoved: false,
    };
  }, [referencePanelPosition]);

  const handleCloudPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = cloudDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      drag.hasMoved = true;
      setReferencePanelPosition(clampReferencePanel({
        x: drag.startPos.x + dx,
        y: drag.startPos.y + dy,
      }));
    }
  }, [clampReferencePanel]);

  const handleCloudPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = cloudDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!drag.hasMoved) {
      handleExpandReferencePanel();
    }
    cloudDragRef.current = null;
  }, [handleExpandReferencePanel]);

  const handleCloudPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (cloudDragRef.current?.pointerId === event.pointerId) {
      cloudDragRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isCanvasResetDialogOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    confirmCanvasResetRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsCanvasResetDialogOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      previousFocus?.focus();
    };
  }, [isCanvasResetDialogOpen]);

  const confirmCanvasReset = useCallback(() => {
    onResetCanvas?.();
    setIsCanvasResetDialogOpen(false);
  }, [onResetCanvas]);

  const handleModalImagePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    modalImageDragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }, []);

  const handleModalImagePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = modalImageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.clientX;
    const deltaY = event.clientY - drag.clientY;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    setModalImageView(view => ({
      ...view,
      pan: { x: view.pan.x + deltaX, y: view.pan.y + deltaY },
    }));
  }, [setModalImageView]);

  const stopModalImagePan = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (modalImageDragRef.current?.pointerId === event.pointerId) {
      modalImageDragRef.current = null;
    }
  }, []);

  // Fullscreen Full Pattern Preview State
  const [isFullscreenPreview, setIsFullscreenPreview] = useState<boolean>(false);

  const toggleFullscreenPreview = useCallback(() => {
    if (!isFullscreenPreview) {
      setIsFullscreenPreview(true);
      if (containerRef.current && containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen().catch(() => {});
      }
    } else {
      setIsFullscreenPreview(false);
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }, [isFullscreenPreview]);

  useEffect(() => {
    const handleFsChange = () => {
      const isFs = !!document.fullscreenElement;
      if (!isFs && isFullscreenPreview) {
        setIsFullscreenPreview(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, [isFullscreenPreview]);

  useEffect(() => {
    if (activeTool !== 'hand') {
      setLastDrawTool(activeTool);
    }
  }, [activeTool]);

  // Drawing mouse drag state
  const [isDrawing, setIsDrawing] = useState(false);
  const [shapeStartCell, setShapeStartCell] = useState<{ x: number; y: number } | null>(null);
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const cleanupPointerRef = useRef<{ pointerId: number; x: number; y: number; id: number; moved: boolean; panX: number; panY: number } | null>(null);
  const spacePanPointerIdRef = useRef<number | null>(null);
  const isHistoryTransactionActiveRef = useRef(false);
  const historyTransactionEndRef = useRef(onHistoryTransactionEnd);

  useEffect(() => {
    historyTransactionEndRef.current = onHistoryTransactionEnd;
  }, [onHistoryTransactionEnd]);

  const finishHistoryTransaction = useCallback(() => {
    if (!isHistoryTransactionActiveRef.current) return;
    isHistoryTransactionActiveRef.current = false;
    historyTransactionEndRef.current?.();
  }, []);

  useEffect(() => finishHistoryTransaction, [finishHistoryTransaction]);

  const isCleanupPreview = !!cleanupPreview;
  useEffect(() => {
    // A preview can open during a stroke; it must never resume after cancellation.
    cleanupPointerRef.current = null;
    activePointerIdRef.current = null;
    setIsDrawing(false);
    setShapeStartCell(null);
    finishHistoryTransaction();
  }, [isCleanupPreview, finishHistoryTransaction]);

  // Cell size base in pixels
  const baseCellSize = 20;
  const cellSize = baseCellSize * zoom;
  const boardsAcross = Math.max(1, Math.ceil(width / boardSize));
  const boardsDown = Math.max(1, Math.ceil(height / boardSize));
  const totalBoards = boardsAcross * boardsDown;
  const canvasBottomBand = interactionProfile === 'desktop' ? 0 : MOBILE_CANVAS_BOTTOM_BAND;
  const showPaintScaleHint = interactionProfile !== 'desktop' && !isFullscreenPreview && focusedBoard === null && cellSize < MIN_PAINTABLE_CELL_PX;
  const minSymbolCellSize = 18;
  const coordOffset = showCoordinates ? 28 : 0;
  const axes = normalizeSymmetryAxes(symmetryAxes, width, height);
  const axisDragRef = useRef<{axis:'x'|'y'; pointerId:number} | null>(null);

  // Refs for touch gesture sync
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const activeToolRef = useRef(activeTool);
  const panStartRef = useRef({ x: 0, y: 0 });
  const transformFrameRef = useRef<number | null>(null);
  const pendingTransformRef = useRef<{ zoom: number; pan: { x: number; y: number } } | null>(null);

  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  const boundGridTransform = useCallback((nextZoom: number, nextPan: { x: number; y: number }) => {
    const container = containerRef.current;
    if (!container) return { zoom: nextZoom, pan: nextPan };
    // Bound the active board in its own frame. Whole-pattern centering can
    // otherwise overwrite a lower board's pan and push it under the zoom dock.
    // Keep the stored pan in whole-grid coordinates for drawing and overlays.
    const index = focusedBoardRef.current;
    const across = Math.max(1, Math.ceil(width / boardSize));
    const x0 = index === null ? 0 : (index % across) * boardSize;
    const y0 = index === null ? 0 : Math.floor(index / across) * boardSize;
    const frameWidth = index === null ? width : Math.min(boardSize, width - x0);
    const frameHeight = index === null ? height : Math.min(boardSize, height - y0);
    const originX = x0 * baseCellSize * nextZoom;
    const originY = y0 * baseCellSize * nextZoom;
    const bounded = clampCanvasViewport(
      { zoom: 1, x: nextPan.x + originX, y: nextPan.y + originY },
      { width: container.clientWidth, height: Math.max(0, container.clientHeight - canvasBottomBand) },
      { width: frameWidth * baseCellSize * nextZoom + coordOffset, height: frameHeight * baseCellSize * nextZoom + coordOffset },
    );
    return { zoom: nextZoom, pan: { x: bounded.x - originX, y: bounded.y - originY } };
  }, [width, height, boardSize, coordOffset, canvasBottomBand]);

  // Also handle zoom supplied by the parent and ruler/board geometry changes.
  useLayoutEffect(() => {
    const bounded = boundGridTransform(zoom, pan);
    const pending = pendingTransformRef.current;
    const next = pending ? boundGridTransform(pending.zoom, pending.pan) : bounded;
    zoomRef.current = next.zoom;
    panRef.current = next.pan;
    if (pending) pendingTransformRef.current = next;
    if (bounded.pan.x !== pan.x || bounded.pan.y !== pan.y) setPan(bounded.pan);
  }, [zoom, pan, boundGridTransform]);

  const scheduleTransformCommit = useCallback((nextZoom: number, nextPan: { x: number; y: number }) => {
    // Pointer/touch events can arrive much faster than a phone can paint. Keep
    // refs current for coordinate math, but commit React state at most once per
    // animation frame so the expensive canvas render is coalesced.
    const bounded = boundGridTransform(nextZoom, nextPan);
    zoomRef.current = bounded.zoom;
    panRef.current = bounded.pan;
    pendingTransformRef.current = bounded;
    if (transformFrameRef.current !== null) return;

    transformFrameRef.current = window.requestAnimationFrame(() => {
      transformFrameRef.current = null;
      const pending = pendingTransformRef.current;
      pendingTransformRef.current = null;
      if (!pending) return;
      setZoom(pending.zoom);
      setPan(pending.pan);
    });
  }, [setZoom, boundGridTransform]);

  useEffect(() => () => {
    if (transformFrameRef.current !== null) {
      window.cancelAnimationFrame(transformFrameRef.current);
      transformFrameRef.current = null;
    }
  }, []);

  const changeZoomAtClient = useCallback((targetZoom: number, clientX: number, clientY: number): boolean => {
    const previousZoom = zoomRef.current;
    const nextZoom = Math.min(4.5, Math.max(MIN_CANVAS_ZOOM, targetZoom));
    if (nextZoom === previousZoom) return false;

    const rect = canvasRef.current?.getBoundingClientRect();
    const nextPan = rect
      ? (() => {
          const localX = clientX - rect.left;
          const localY = clientY - rect.top;
          const ratio = nextZoom / previousZoom;
          return {
            x: localX - coordOffset - (localX - coordOffset - panRef.current.x) * ratio,
            y: localY - coordOffset - (localY - coordOffset - panRef.current.y) * ratio,
          };
        })()
      : panRef.current;
    scheduleTransformCommit(nextZoom, nextPan);
    return true;
  }, [scheduleTransformCommit, coordOffset]);

  const changeZoomAtCanvasCenter = useCallback((factor: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return false;
    return changeZoomAtClient(zoomRef.current * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [changeZoomAtClient]);

  // A fitted large pattern lands around 20% zoom, i.e. ~4px per bead — smaller
  // than a fingertip, so taps land on the wrong bead. This jumps straight to a
  // paintable scale from the inline hint instead of asking for a precise pinch.
  const zoomToEditingScale = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return false;
    return changeZoomAtClient(COMFORTABLE_CELL_PX / baseCellSize, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [baseCellSize, changeZoomAtClient]);

  // Touch tracking ref for pinch-to-zoom & two-finger pan
  const touchStateRef = useRef<{
    isPinch: boolean;
    initialDist: number;
    initialZoom: number;
    initialMidX: number;
    initialMidY: number;
    initialPanX: number;
    initialPanY: number;
    lastSingleTouchX: number;
    lastSingleTouchY: number;
    isPanningSingle: boolean;
  }>({
    isPinch: false,
    initialDist: 0,
    initialZoom: 1.0,
    initialMidX: 0,
    initialMidY: 0,
    initialPanX: 0,
    initialPanY: 0,
    lastSingleTouchX: 0,
    lastSingleTouchY: 0,
    isPanningSingle: false,
  });

  // Convert client coordinates to grid cell coordinates (x, y)
  const clientToGrid = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const canvasX = clientX - rect.left - pan.x - coordOffset;
      const canvasY = clientY - rect.top - pan.y - coordOffset;

      const x = Math.floor(canvasX / cellSize);
      const y = Math.floor(canvasY / cellSize);

      if (x >= 0 && x < width && y >= 0 && y < height) {
        return { x, y };
      }
      return null;
    },
    [pan, cellSize, width, height, coordOffset]
  );

  // Auto-fit & center view in container
  const fitToView = useCallback(() => {
    if (!containerRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;
    if (clientWidth <= 0 || clientHeight <= 0) return;

    const padding = clientWidth < 640 ? 12 : 36;
    const availW = Math.max(1, clientWidth - padding * 2);
    const availH = Math.max(1, clientHeight - padding * 2 - canvasBottomBand);

    const scaleX = Math.max(1, availW - coordOffset) / (width * baseCellSize);
    const scaleY = Math.max(1, availH - coordOffset) / (height * baseCellSize);
    const bestZoom = Math.min(3.5, Math.max(MIN_CANVAS_ZOOM, Math.min(scaleX, scaleY)));

    const finalPixelW = width * baseCellSize * bestZoom + coordOffset;
    const finalPixelH = height * baseCellSize * bestZoom + coordOffset;

    focusedBoardRef.current = null;
    setFocusedBoard(null);
    scheduleTransformCommit(bestZoom, {
      x: (clientWidth - finalPixelW) / 2,
      y: (clientHeight - canvasBottomBand - finalPixelH) / 2,
    });
  }, [width, height, coordOffset, baseCellSize, canvasBottomBand, scheduleTransformCommit]);

  // Zoom to one physical pegboard, the way the split-board export lays it out:
  // a whole board legible at once, with its row/column numbers around it.
  const focusBoard = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) return;
    const { clientWidth, clientHeight } = container;
    if (clientWidth <= 0 || clientHeight <= 0) return;
    const across = Math.max(1, Math.ceil(width / boardSize));
    const down = Math.max(1, Math.ceil(height / boardSize));
    const total = across * down;
    if (total <= 1) return;
    const next = ((index % total) + total) % total;
    const col = next % across;
    const row = Math.floor(next / across);
    const x0 = col * boardSize;
    const y0 = row * boardSize;
    const boardW = Math.min(boardSize, width - x0);
    const boardH = Math.min(boardSize, height - y0);
    if (boardW <= 0 || boardH <= 0) return;

    // Short landscape canvases may have less than 20px left after the ruler
    // and dock. Spend spare room on cells before adding decorative margins.
    const padding = Math.min(10, Math.max(0, (clientHeight - canvasBottomBand - coordOffset - 40) / 2));
    // The board switcher lives in the dock below the canvas now, so no band is
    // reserved at the top. The zoom cluster still floats over the bottom-right
    // corner though, so framing keeps the board clear of it instead of painting
    // the last two rows underneath a row of buttons.
    const availW = Math.max(1, container.clientWidth - coordOffset - padding * 2);
    const availH = Math.max(1, container.clientHeight - coordOffset - padding * 2 - canvasBottomBand);
    const scale = Math.min(availW / (boardW * baseCellSize), availH / (boardH * baseCellSize));
    const nextZoom = Math.min(4.5, Math.max(MIN_CANVAS_ZOOM, scale));

    const boardPxW = boardW * baseCellSize * nextZoom;
    const boardPxH = boardH * baseCellSize * nextZoom;
    // Screen x of grid column 0 is pan.x + coordOffset; centre the board inside
    // the cell area, which starts after the ruler strip.
    const centerX = coordOffset + (container.clientWidth - coordOffset) / 2;
    const centerY = coordOffset + (container.clientHeight - canvasBottomBand - coordOffset) / 2;
    focusedBoardRef.current = next;
    setFocusedBoard(next);
    scheduleTransformCommit(nextZoom, {
      x: centerX - coordOffset - x0 * baseCellSize * nextZoom - boardPxW / 2,
      y: centerY - coordOffset - y0 * baseCellSize * nextZoom - boardPxH / 2,
    });
  }, [boardSize, baseCellSize, coordOffset, height, width, scheduleTransformCommit, canvasBottomBand]);

  const fitContentToView = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    grid.forEach((row, y) => row.forEach((colorId, x) => {
      if (!colorId) return;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }));

    if (maxX < minX || maxY < minY) {
      fitToView();
      return;
    }

    const padding = container.clientWidth < 640 ? 20 : 36;
    const contentWidth = (maxX - minX + 1) * baseCellSize;
    const contentHeight = (maxY - minY + 1) * baseCellSize;
    const bestZoom = Math.min(4.5, Math.max(MIN_CANVAS_ZOOM, Math.min(
      Math.max(100, container.clientWidth - padding * 2) / contentWidth,
      Math.max(100, container.clientHeight - padding * 2) / contentHeight,
    )));
    const scaledWidth = contentWidth * bestZoom;
    const scaledHeight = contentHeight * bestZoom;
    const nextPan = {
      x: (container.clientWidth - scaledWidth) / 2 - coordOffset - minX * baseCellSize * bestZoom,
      y: (container.clientHeight - scaledHeight) / 2 - coordOffset - minY * baseCellSize * bestZoom,
    };

    scheduleTransformCommit(bestZoom, nextPan);
  }, [baseCellSize, coordOffset, fitToView, grid, height, scheduleTransformCommit, width]);

  // Phones open on board 1: fitting a 79×44 sheet into 390px gives ~4px per
  // bead, which nobody can tap. Desktop keeps the whole-pattern fit.
  const resetCanvasView = useCallback(() => {
    if (interactionProfile !== 'desktop' && totalBoards > 1) {
      focusBoard(0);
      return;
    }
    fitToView();
  }, [fitToView, focusBoard, interactionProfile, totalBoards]);

  /** Back to the whole sheet: clear the spotlight and frame everything. */
  const showWholePattern = useCallback(() => {
    setFocusedBoard(null);
    fitToView();
  }, [fitToView]);

  // Publish the board switch to the shell. The strip lives outside the canvas
  // box (docked above the tool dock) so it can never cover the grid it is
  // switching, and it stays inside the thumb zone instead of the top-left.
  useEffect(() => {
    if (!boardNavApiRef) return;
    boardNavApiRef.current = { focusBoard, showWholePattern };
    return () => { boardNavApiRef.current = null; };
  }, [boardNavApiRef, focusBoard, showWholePattern]);

  useEffect(() => {
    onBoardNavStateChange?.({ focusedBoard, totalBoards });
  }, [focusedBoard, totalBoards, onBoardNavStateChange]);

  useEffect(() => {
    resetCanvasView();
    // The container may still be 0-sized on the very first pass; the delayed
    // pass below re-applies the same choice once layout settles.
  }, [width, height, boardSize, interactionProfile]);

  useEffect(() => {
    const timer = setTimeout(() => {
      // Fullscreen preview is a look-at-the-whole-pattern mode by definition.
      if (isFullscreenPreview) fitToView();
      else resetCanvasView();
    }, 80);
    return () => clearTimeout(timer);
  }, [isFullscreenPreview, fitToView, resetCanvasView]);

  // Handle Touch Gestures (Pinch to zoom & two-finger / hand panning)
  useEffect(() => {
    if (interactionProfile === 'desktop') return;

    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        cleanupPointerRef.current = null;
        // Two-finger pinch / pan start
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;

        touchStateRef.current = {
          isPinch: true,
          initialDist: dist,
          initialZoom: zoomRef.current,
          initialMidX: midX,
          initialMidY: midY,
          initialPanX: panRef.current.x,
          initialPanY: panRef.current.y,
          lastSingleTouchX: 0,
          lastSingleTouchY: 0,
          isPanningSingle: false,
        };
        finishHistoryTransaction();
        setIsDrawing(false);
        setIsPanning(true);
      } else if (interactionProfile === 'hybrid' && e.touches.length === 1) {
        const t = e.touches[0];
        if (activeToolRef.current === 'hand') {
          e.preventDefault();
          touchStateRef.current.isPanningSingle = true;
          touchStateRef.current.lastSingleTouchX = t.clientX;
          touchStateRef.current.lastSingleTouchY = t.clientY;
          setIsPanning(true);
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const state = touchStateRef.current;

      if (e.touches.length === 2 && state.isPinch) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;

        if (state.initialDist > 0) {
          const scale = dist / state.initialDist;
          const newZoom = Math.min(4.5, Math.max(MIN_CANVAS_ZOOM, state.initialZoom * scale));

          const rect = container.getBoundingClientRect();
          const focusX = state.initialMidX - rect.left - state.initialPanX - coordOffset;
          const focusY = state.initialMidY - rect.top - state.initialPanY - coordOffset;
          const zoomRatio = newZoom / state.initialZoom;

          const deltaMidX = midX - state.initialMidX;
          const deltaMidY = midY - state.initialMidY;

          const newPanX = state.initialMidX - rect.left - coordOffset - (focusX * zoomRatio) + deltaMidX;
          const newPanY = state.initialMidY - rect.top - coordOffset - (focusY * zoomRatio) + deltaMidY;

          scheduleTransformCommit(newZoom, { x: newPanX, y: newPanY });
        }
      } else if (interactionProfile === 'hybrid' && e.touches.length === 1 && state.isPanningSingle) {
        e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - state.lastSingleTouchX;
        const dy = t.clientY - state.lastSingleTouchY;
        state.lastSingleTouchX = t.clientX;
        state.lastSingleTouchY = t.clientY;

        scheduleTransformCommit(zoomRef.current, {
          x: panRef.current.x + dx,
          y: panRef.current.y + dy,
        });
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        touchStateRef.current.isPinch = false;
      }
      if (interactionProfile === 'hybrid' && e.touches.length === 0) {
        touchStateRef.current.isPanningSingle = false;
        setIsPanning(false);
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [finishHistoryTransaction, interactionProfile, scheduleTransformCommit, coordOffset]);

  // Handle mouse-wheel zoom around the current pointer position.
  const handleWheel = useCallback((event: WheelEvent) => {
    if (interactionProfile === 'touch') return;
    if (isCanvasInteractionIgnoredTarget(event.target) || event.deltaY === 0) return;
    const zoomFactor = event.deltaY < 0 ? 1.12 : 0.88;
    event.preventDefault();
    changeZoomAtClient(zoomRef.current * zoomFactor, event.clientX, event.clientY);
  }, [changeZoomAtClient, interactionProfile]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const applySymmetryToPoints = useCallback(
    (points: {x:number;y:number}[]) => reflectGridPoints(points, symmetryMode as SymmetryMode, width, height, symmetryAxes),
    [symmetryMode, width, height, symmetryAxes?.x, symmetryAxes?.y],
  );

  // Main Canvas Render loop
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = getCanvasDpr();
    const canvasWidth = canvas.width / dpr;
    const canvasHeight = canvas.height / dpr;
    const visibleColumns = getVisibleGridRange(width, cellSize, pan.x + coordOffset, canvasWidth);
    const visibleRows = getVisibleGridRange(height, cellSize, pan.y + coordOffset, canvasHeight);
    const isLargeTouchOverview = interactionProfile === 'touch' && width * height >= 10_000 && cellSize < 14;
    const useDetailedBeads = !isLargeTouchOverview && (cellSize >= 6 || width * height <= 10_000);

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const startX = pan.x + coordOffset;
    const startY = pan.y + coordOffset;

    // Geometry of the board currently in focus, if any. Used both for the
    // spotlight scrim and for restarting the rulers at 1, the way a printed
    // split-board sheet numbers each board on its own.
    const focusRect = (() => {
      if (focusedBoard === null) return null;
      const across = Math.max(1, Math.ceil(width / boardSize));
      const down = Math.max(1, Math.ceil(height / boardSize));
      const total = across * down;
      const index = ((focusedBoard % total) + total) % total;
      const col = index % across;
      const row = Math.floor(index / across);
      const cols = Math.min(boardSize, width - col * boardSize);
      const rows = Math.min(boardSize, height - row * boardSize);
      return {
        x: startX + col * boardSize * cellSize,
        y: startY + row * boardSize * cellSize,
        w: cols * cellSize,
        h: rows * cellSize,
        cols,
        rows,
      };
    })();

    // 2. Pegboard Area Fill based on Canvas Backdrop
    const gridPixelWidth = width * cellSize;
    const gridPixelHeight = height * cellSize;

    const boardPaperColor = canvasBackdrop === 'wood'
      ? '#F5E6D3'
      : canvasBackdrop === 'studio'
        ? '#F3E8FF'
        : canvasBackdrop === 'slate'
          ? '#F1F5F9'
          : '#FAF8FF'; // light pegboard + default
    // Lift the pattern off the desk so it reads as one sheet of paper rather
    // than a coloured rectangle painted directly on the page.
    ctx.save();
    ctx.fillStyle = boardPaperColor;
    ctx.shadowColor = 'rgba(76, 29, 149, 0.18)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    ctx.fillRect(startX, startY, gridPixelWidth, gridPixelHeight);
    ctx.restore();
    ctx.fillStyle = boardPaperColor;
    ctx.fillRect(startX, startY, gridPixelWidth, gridPixelHeight);

    // 3. Render Source Image Semi-transparent Overlay if enabled
    const drawableOverlay = overlayImageRef.current || effectiveImage;
    if (showOverlay && drawableOverlay && overlayReady) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.05, Math.min(0.8, overlayOpacity));
      ctx.globalCompositeOperation = 'multiply';
      ctx.beginPath();
      ctx.rect(startX, startY, gridPixelWidth, gridPixelHeight);
      ctx.clip();
      const fit = getGridImageFitRect(
        drawableOverlay.naturalWidth || drawableOverlay.width,
        drawableOverlay.naturalHeight || drawableOverlay.height,
        gridPixelWidth,
        gridPixelHeight,
        keepImageAspectRatio,
      );
      if (fit) ctx.drawImage(drawableOverlay, startX + fit.x, startY + fit.y, fit.width, fit.height);
      ctx.restore();
    }

    // 4. Calculate Preview Shape Points if actively dragging Shape Tools
    let previewPoints: { x: number; y: number }[] = [];
    if (isDrawing && shapeStartCell && hoverCell) {
      if (activeTool === 'line') {
        previewPoints = getLinePoints(shapeStartCell.x, shapeStartCell.y, hoverCell.x, hoverCell.y);
      } else if (activeTool === 'rectangle') {
        previewPoints = getRectanglePoints(shapeStartCell.x, shapeStartCell.y, hoverCell.x, hoverCell.y);
      } else if (activeTool === 'circle') {
        previewPoints = getCirclePoints(shapeStartCell.x, shapeStartCell.y, hoverCell.x, hoverCell.y);
      }
      previewPoints = applySymmetryToPoints(previewPoints);
    }

    const previewSet = new Set(previewPoints.map(p => `${p.x},${p.y}`));

    const activeHighlightIds = highlightColorIds ?? (highlightColorId ? [highlightColorId] : []);
    // A visual surface preview, not a pegboard: retain the user's switches in
    // state so all drafting aids return unchanged when leaving ironed mode.
    const isIronedPreview = beadShape === 'ironed';
    const drawGridLines = showGridLines && !isIronedPreview;
    const drawCellGridLines = drawGridLines && !isLargeTouchOverview;

    // 5. Render Bead Grid Cells
      for (let y = visibleRows.start; y < visibleRows.end; y++) {
        for (let x = visibleColumns.start; x < visibleColumns.end; x++) {
        const px = startX + x * cellSize;
        const py = startY + y * cellSize;

        const isShapePreview = previewSet.has(`${x},${y}`);
        const colorId = grid[y]?.[x];

        // At overview zoom, individual empty peg dots and bead bevels become
        // sub-pixel work. Keep the silhouette/colors; restore detail on zoom.
        if (!colorId && !isShapePreview && cellSize < 8) continue;

        if (isShapePreview && selectedColor) {
          // Render preview ghost bead for shape tools
          ctx.save();
          ctx.globalAlpha = 0.8;
          drawPreviewBeadOnCanvas(ctx, px, py, cellSize, selectedColor.hex, beadShape, null);
          ctx.restore();
        } else if (colorId) {
          const bead = paletteMap.get(colorId);
          const colorHex = bead ? bead.hex : '#CCCCCC';
          if (!useDetailedBeads) {
            const state = getColorDisplayState(colorId, activeHighlightIds, completedColorIds);
            ctx.save();
            if (state === 'dimmed') ctx.globalAlpha = 0.15;
            ctx.fillStyle = colorHex;
            ctx.fillRect(px, py, cellSize, cellSize);
            if (state === 'focused') {
              ctx.strokeStyle = '#e11d48'; ctx.lineWidth = Math.max(1, cellSize * 0.18);
              ctx.strokeRect(px, py, cellSize, cellSize);
            }
            ctx.restore();
            continue;
          }
          const symbolStr = showSymbols && !isIronedPreview && cellSize >= minSymbolCellSize && bead
            ? (bead.code || bead.symbol)
            : null;

          const displayState = getColorDisplayState(colorId, activeHighlightIds, completedColorIds);
          const isDimmed = displayState === 'dimmed';
          const isCompleted = displayState === 'completed';

          ctx.save();
          if (isDimmed) ctx.globalAlpha = 0.15;
          if (isCompleted) {
            ctx.globalAlpha = 0.72;
            ctx.filter = 'saturate(0.35)';
          }

          drawPreviewBeadOnCanvas(ctx, px, py, cellSize, colorHex, beadShape, symbolStr, grid, x, y);

          if (isCompleted) {
            ctx.filter = 'none';
            ctx.globalAlpha = 0.92;
            ctx.save();
            ctx.beginPath();
            ctx.rect(px, py, cellSize, cellSize);
            ctx.clip();
            ctx.strokeStyle = 'rgba(71, 85, 105, 0.62)';
            ctx.lineWidth = Math.max(1, Math.min(2, cellSize * 0.08));
            for (let offset = -cellSize; offset < cellSize * 2; offset += Math.max(4, cellSize * 0.24)) {
              ctx.beginPath();
              ctx.moveTo(px + offset, py + cellSize);
              ctx.lineTo(px + offset + cellSize, py);
              ctx.stroke();
            }
            ctx.restore();
            ctx.setLineDash([3, 2]);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = Math.max(1, Math.min(2, cellSize * 0.1));
            ctx.strokeRect(px + 1, py + 1, Math.max(0, cellSize - 2), Math.max(0, cellSize - 2));
            ctx.setLineDash([]);
          }

          if (displayState === 'focused') {
            ctx.strokeStyle = '#F43F5E';
            ctx.lineWidth = 2;
            ctx.strokeRect(px, py, cellSize, cellSize);
          }

          ctx.restore();
        } else {
          // Empty peg styling based on backdrop
          ctx.fillStyle = showOverlay
            ? (canvasBackdrop === 'wood' ? 'rgba(250, 240, 230, 0.18)' : 'rgba(255, 255, 255, 0.12)')
            : (canvasBackdrop === 'wood' ? '#FAF0E6' : '#FFFFFF');
          if (isIronedPreview) {
            const bounds = getPreviewCellBounds(ctx, px, py, cellSize);
            ctx.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);
          } else {
            ctx.fillRect(px, py, cellSize, cellSize);
          }

          if (drawCellGridLines) {
            ctx.strokeStyle = showOverlay
              ? (canvasBackdrop === 'wood' ? 'rgba(217, 119, 6, 0.6)' : 'rgba(100, 116, 139, 0.35)')
              : (canvasBackdrop === 'wood' ? '#FCD34D' : '#E2E8F0');
            ctx.lineWidth = 0.5;
            ctx.strokeRect(px, py, cellSize, cellSize);
          }

          if (!isIronedPreview && !isLargeTouchOverview) {
            // Peg dot center is a drafting aid, not part of the fused design.
            ctx.beginPath();
            ctx.arc(px + cellSize / 2, py + cellSize / 2, Math.max(1, cellSize * 0.12), 0, Math.PI * 2);
            ctx.fillStyle = showOverlay
              ? (canvasBackdrop === 'wood' ? 'rgba(217, 119, 6, 0.65)' : 'rgba(100, 116, 139, 0.45)')
              : (canvasBackdrop === 'wood' ? '#D97706' : '#94A3B8');
            ctx.fill();
          }
        }
      }
    }

    // 6. Symmetry Crosshairs Guidelines
    if (symmetryMode !== 'none') {
      ctx.strokeStyle = '#9333EA';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);

      if (symmetryMode === 'horizontal' || symmetryMode === 'quad') {
        const midX = startX + axes.x * cellSize;
        ctx.beginPath();
        ctx.moveTo(midX, startY);
        ctx.lineTo(midX, startY + gridPixelHeight);
        ctx.stroke();
      }
      if (symmetryMode === 'vertical' || symmetryMode === 'quad') {
        const midY = startY + axes.y * cellSize;
        ctx.beginPath();
        ctx.moveTo(startX, midY);
        ctx.lineTo(startX + gridPixelWidth, midY);
        ctx.stroke();
      }

      ctx.setLineDash([]); // Reset line dash
    }

    // 7. 5×5 Dashed & 10×10 Bold Grid System (Standard Physical Bead Board Lines)
    if (drawGridLines) {
      const firstFiveX = Math.max(5, Math.ceil(visibleColumns.start / 5) * 5);
      const endFiveX = Math.min(width, visibleColumns.end);
      const firstFiveY = Math.max(5, Math.ceil(visibleRows.start / 5) * 5);
      const endFiveY = Math.min(height, visibleRows.end);
      // (a) 5×5 Dashed Guidelines (forming 5*5 dashed small squares)
      ctx.save();
      ctx.strokeStyle = canvasBackdrop === 'wood'
        ? 'rgba(217, 119, 6, 0.55)'
        : (canvasBackdrop === 'dark_grid' ? 'rgba(148, 163, 184, 0.6)' : 'rgba(100, 116, 139, 0.65)');
      ctx.lineWidth = Math.max(1, Math.min(1.5, cellSize * 0.08));
      ctx.setLineDash([4, 2.5]);

      for (let x = firstFiveX; x < endFiveX; x += 5) {
        if (x % 10 === 0) continue; // Multiples of 10 are bold solid lines
        const px = startX + x * cellSize;
        ctx.beginPath();
        ctx.moveTo(px, startY);
        ctx.lineTo(px, startY + gridPixelHeight);
        ctx.stroke();
      }

      for (let y = firstFiveY; y < endFiveY; y += 5) {
        if (y % 10 === 0) continue;
        const py = startY + y * cellSize;
        ctx.beginPath();
        ctx.moveTo(startX, py);
        ctx.lineTo(startX + gridPixelWidth, py);
        ctx.stroke();
      }
      ctx.restore();

      // (b) 10×10 Bold Solid Guidelines (forming 10*10 bold large squares)
      ctx.save();
      ctx.strokeStyle = canvasBackdrop === 'wood'
        ? 'rgba(180, 83, 9, 0.85)'
        : (canvasBackdrop === 'dark_grid' ? 'rgba(226, 232, 240, 0.85)' : 'rgba(30, 41, 59, 0.85)');
      ctx.lineWidth = Math.max(1.8, Math.min(2.5, cellSize * 0.12));
      ctx.setLineDash([]);

      const firstTenX = Math.max(10, Math.ceil(visibleColumns.start / 10) * 10);
      const endTenX = Math.min(width, visibleColumns.end);
      const firstTenY = Math.max(10, Math.ceil(visibleRows.start / 10) * 10);
      const endTenY = Math.min(height, visibleRows.end);
      for (let x = firstTenX; x < endTenX; x += 10) {
        const px = startX + x * cellSize;
        ctx.beginPath();
        ctx.moveTo(px, startY);
        ctx.lineTo(px, startY + gridPixelHeight);
        ctx.stroke();
      }

      for (let y = firstTenY; y < endTenY; y += 10) {
        const py = startY + y * cellSize;
        ctx.beginPath();
        ctx.moveTo(startX, py);
        ctx.lineTo(startX + gridPixelWidth, py);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 7b. Board seams. Every physical pegboard is a separate tray, so the
    // boundary matters more than the 10-cell drafting guides: it tells the user
    // where one board ends. Without it a 3-board pattern looks like one sheet
    // and the "第 N 板" navigation below has nothing to point at.
    const boardsAcross = Math.max(1, Math.ceil(width / boardSize));
    const boardsDown = Math.max(1, Math.ceil(height / boardSize));
    if (showGridLines && (boardsAcross > 1 || boardsDown > 1)) {
      ctx.save();
      ctx.strokeStyle = canvasBackdrop === 'wood'
        ? 'rgba(120, 53, 15, 0.9)'
        : 'rgba(109, 40, 217, 0.72)';
      ctx.lineWidth = Math.max(1.6, Math.min(2.6, cellSize * 0.14));
      ctx.setLineDash([]);
      for (let bx = 1; bx < boardsAcross; bx++) {
        const px = startX + bx * boardSize * cellSize;
        if (px < startX || px > startX + gridPixelWidth) continue;
        ctx.beginPath();
        ctx.moveTo(px, startY);
        ctx.lineTo(px, startY + gridPixelHeight);
        ctx.stroke();
      }
      for (let by = 1; by < boardsDown; by++) {
        const py = startY + by * boardSize * cellSize;
        if (py < startY || py > startY + gridPixelHeight) continue;
        ctx.beginPath();
        ctx.moveTo(startX, py);
        ctx.lineTo(startX + gridPixelWidth, py);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 7c. Spotlight the focused board. Neighbouring boards share the exact same
    // pegboard texture, so without a scrim the user cannot tell where "第 N 板"
    // actually ends — the seam line alone is too quiet at low zoom.
    if (focusRect) {
      ctx.save();
      ctx.fillStyle = 'rgba(30, 21, 56, 0.13)';
      // Stay inside the cell area: the ruler strips above and to the left are
      // the only way to read a coordinate off a partition chart, so they must
      // never be dimmed along with the neighbouring boards.
      const bandTop = Math.max(startY, 0);
      const bandLeft = Math.max(startX, 0);
      if (focusRect.y > bandTop) ctx.fillRect(bandLeft, bandTop, canvasWidth - bandLeft, focusRect.y - bandTop);
      if (focusRect.y + focusRect.h < canvasHeight) {
        ctx.fillRect(bandLeft, focusRect.y + focusRect.h, canvasWidth - bandLeft, canvasHeight - (focusRect.y + focusRect.h));
      }
      if (focusRect.x > bandLeft) ctx.fillRect(bandLeft, focusRect.y, focusRect.x - bandLeft, focusRect.h);
      if (focusRect.x + focusRect.w < canvasWidth) {
        ctx.fillRect(focusRect.x + focusRect.w, focusRect.y, canvasWidth - (focusRect.x + focusRect.w), focusRect.h);
      }

      ctx.strokeStyle = 'rgba(124, 58, 237, 0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(focusRect.x + 1, focusRect.y + 1, focusRect.w - 2, focusRect.h - 2);
      ctx.restore();
    }

    // 8. Grid Outer Border (High-contrast clean frame)
    const frameWidth = Math.max(1.8, Math.min(2.5, cellSize * 0.12));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = frameWidth + 2;
    ctx.strokeRect(startX, startY, gridPixelWidth, gridPixelHeight);
    ctx.strokeStyle = canvasBackdrop === 'wood'
      ? 'rgba(180, 83, 9, 0.9)'
      : 'rgba(30, 41, 59, 0.9)';
    ctx.lineWidth = frameWidth;
    ctx.strokeRect(startX, startY, gridPixelWidth, gridPixelHeight);

    // Render rulers last: adjacent boards and their spotlight must not cover them.
    if (showCoordinates) {
      if (focusRect) {
        // Opaque ruler strips separate the local labels from neighbouring beads.
        ctx.fillStyle = boardPaperColor;
        ctx.fillRect(focusRect.x - coordOffset, focusRect.y - coordOffset, focusRect.w + coordOffset, coordOffset);
        ctx.fillRect(focusRect.x - coordOffset, focusRect.y, coordOffset, focusRect.h);
      }
      // Every backdrop in this app renders a light pegboard, so the ruler must
      // stay dark. Keying it off the 'dark_grid' name produced near-white
      // digits on a light desk — coordinates were effectively invisible.
      ctx.fillStyle = '#334155';
      ctx.font = `bold ${Math.max(10, Math.floor(11 * Math.min(zoom, 1.2)))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const columnLabels = getColumnLabelPositions({
        columns: focusRect ? focusRect.cols : width,
        cellSize,
        boardSize: focusRect ? focusRect.cols : boardSize,
        originX: focusRect ? focusRect.x : startX,
        viewportWidth: canvasWidth,
        getLabel: index => (index + 1).toString(),
        measureLabel: label => ctx.measureText(label).width,
      });
      for (const { label, center } of columnLabels) {
        ctx.fillText(label, center, (focusRect ? focusRect.y : startY) - coordOffset / 2);
      }

      ctx.textAlign = 'right';
      const rowMetrics = ctx.measureText('0');
      const rowLabelHeight = Math.max(
        10,
        rowMetrics.actualBoundingBoxAscent + rowMetrics.actualBoundingBoxDescent,
      );
      const rowLabels = getRowLabelPositions({
        rows: focusRect ? focusRect.rows : height,
        cellSize,
        boardSize: focusRect ? focusRect.rows : boardSize,
        originY: focusRect ? focusRect.y : startY,
        viewportHeight: canvasHeight,
        measureLabel: () => rowLabelHeight,
      });
      for (const { label, center } of rowLabels) {
        ctx.fillText(label, (focusRect ? focusRect.x : startX) - 6, center);
      }
    }

    ctx.restore();
  }, [
    grid,
    paletteMap,
    width,
    height,
    boardSize,
    activeTool,
    selectedColor,
    beadShape,
    showSymbols,
    showGridLines,
    showCoordinates,
    highlightColorId,
    highlightColorIds,
    completedColorIds,
    pan,
    cellSize,
    coordOffset,
    zoom,
    symmetryMode,
    canvasBackdrop,
    focusedBoard,
    overlayImage,
    showOverlay,
    overlayOpacity,
    effectiveImage,
    overlayReady,
    keepImageAspectRatio,
    isDrawing,
    shapeStartCell,
    hoverCell,
    applySymmetryToPoints,
    axes.x,
    axes.y,
  ]);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        const dpr = getCanvasDpr();
        canvasRef.current.width = Math.floor(clientWidth * dpr);
        canvasRef.current.height = Math.floor(clientHeight * dpr);
        canvasRef.current.style.width = `${clientWidth}px`;
        canvasRef.current.style.height = `${clientHeight}px`;
        const bounded = boundGridTransform(zoomRef.current, panRef.current);
        if (bounded.pan.x !== panRef.current.x || bounded.pan.y !== panRef.current.y) {
          scheduleTransformCommit(bounded.zoom, bounded.pan);
        }
        renderCanvas();
      }
    };

    handleResize();
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) observer.observe(containerRef.current);
    window.addEventListener('resize', handleResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [renderCanvas, boundGridTransform, scheduleTransformCommit]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Pointer Handlers for Mouse & Single-Point interactions
  const isPointerInputEnabled = useCallback((pointerType: string) => {
    if (interactionProfile === 'desktop') return pointerType === 'mouse' || pointerType === '';
    if (interactionProfile === 'touch') return pointerType === 'touch' || pointerType === 'pen';
    return true;
  }, [interactionProfile]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isPointerInputEnabled(e.pointerType)) return;
    if (interactionProfile === 'touch' && !e.isPrimary) return;

    // If pinch gesture active, ignore pointerdown
    if (touchStateRef.current.isPinch) return;

    const isSpacePan = e.button === 0 && spacePressedRef.current && !isCanvasInteractionIgnoredTarget(e.target);
    if (e.button === 1 || e.button === 2 || e.shiftKey || (!cleanupPreview && activeTool === 'hand') || isSpacePan) {
      if (isSpacePan) e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      activePointerIdRef.current = e.pointerId;
      if (isSpacePan) spacePanPointerIdRef.current = e.pointerId;
      setIsPanning(true);
      const nextPanStart = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
      panStartRef.current = nextPanStart;
      return;
    }

    const cell = clientToGrid(e.clientX, e.clientY);
    if (cleanupPreview) {
      const id = cell ? cleanupPreview.analysis.componentIds[cell.y * width + cell.x] : 0;
      cleanupPointerRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, id, moved: false, panX: panRef.current.x, panY: panRef.current.y };
      activePointerIdRef.current = e.pointerId;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    if (!cell) return;

    if (activeTool === 'eyedropper') {
      const colorId = grid[cell.y]?.[cell.x];
      if (colorId) {
        const bead = paletteMap.get(colorId);
        if (bead) onEyedropColor(bead);
      }
      return;
    }

    setIsDrawing(true);
    setShapeStartCell(cell);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    activePointerIdRef.current = e.pointerId;

    if (activeTool === 'pencil' || activeTool === 'eraser') {
      onHistoryTransactionStart?.();
      isHistoryTransactionActiveRef.current = true;
    }

    if (activeTool === 'pencil' || activeTool === 'eraser' || activeTool === 'bucket' || activeTool === 'replace' || activeTool === 'region_clear') {
      const symPoints = applySymmetryToPoints([cell]);
      if (onMultiCellClick && symPoints.length > 1) {
        onMultiCellClick(symPoints);
      } else {
        onCellClick(cell.x, cell.y);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isPointerInputEnabled(e.pointerType)) return;
    if (interactionProfile === 'touch' && (!e.isPrimary || touchStateRef.current.isPinch)) return;
    const cleanupPointer = cleanupPointerRef.current;
    if (cleanupPreview && cleanupPointer?.pointerId === e.pointerId) {
      const dx = e.clientX - cleanupPointer.x, dy = e.clientY - cleanupPointer.y;
      if (Math.hypot(dx, dy) > 8) cleanupPointer.moved = true;
      if (cleanupPointer.moved) scheduleTransformCommit(zoomRef.current, { x: cleanupPointer.panX + dx, y: cleanupPointer.panY + dy });
      return;
    }

    if (isPanning || spacePanPointerIdRef.current === e.pointerId) {
      if (spacePanPointerIdRef.current === e.pointerId) e.preventDefault();
      scheduleTransformCommit(zoomRef.current, {
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
      // Discard overshoot at the boundary so reversing direction moves at once.
      panStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
      return;
    }

    if (cleanupPreview) return;
    const cell = clientToGrid(e.clientX, e.clientY);
    const needsTouchShapePreview = isDrawing && (activeTool === 'line' || activeTool === 'rectangle' || activeTool === 'circle');
    if (e.pointerType !== 'touch' || needsTouchShapePreview) {
      setHoverCell(current => current?.x === cell?.x && current?.y === cell?.y ? current : cell);
    }

    if (isDrawing && cell) {
      if (activeTool === 'pencil' || activeTool === 'eraser') {
        const symPoints = applySymmetryToPoints([cell]);
        if (onMultiCellClick && symPoints.length > 1) {
          onMultiCellClick(symPoints);
        } else {
          onCellClick(cell.x, cell.y);
        }
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent, applyShape = true) => {
    if (!isPointerInputEnabled(e.pointerType)) return;
    if (interactionProfile === 'touch' && !e.isPrimary) return;
    if (activePointerIdRef.current !== e.pointerId) return;
    activePointerIdRef.current = null;
    if (cleanupPreview) {
      const pointer = cleanupPointerRef.current;
      cleanupPointerRef.current = null;
      const component = pointer ? cleanupPreview.analysis.components[pointer.id - 1] : null;
      if (applyShape && pointer && !pointer.moved && !touchStateRef.current.isPinch && component?.candidate) {
        cleanupPreview.onToggleComponent(component.id);
      }
      spacePanPointerIdRef.current = null;
      setIsPanning(false);
      return;
    }
    const wasSpacePan = spacePanPointerIdRef.current === e.pointerId;
    if (wasSpacePan) {
      spacePanPointerIdRef.current = null;
      e.preventDefault();
    }

    if (applyShape && isDrawing && shapeStartCell && hoverCell) {
      let finalPoints: { x: number; y: number }[] = [];
      if (activeTool === 'line') {
        finalPoints = getLinePoints(shapeStartCell.x, shapeStartCell.y, hoverCell.x, hoverCell.y);
      } else if (activeTool === 'rectangle') {
        finalPoints = getRectanglePoints(shapeStartCell.x, shapeStartCell.y, hoverCell.x, hoverCell.y);
      } else if (activeTool === 'circle') {
        finalPoints = getCirclePoints(shapeStartCell.x, shapeStartCell.y, hoverCell.x, hoverCell.y);
      }

      if (finalPoints.length > 0) {
        if (onApplyShape) onApplyShape(finalPoints);
        else if (onMultiCellClick) onMultiCellClick(applySymmetryToPoints(finalPoints));
      }
    }

    setIsPanning(false);
    setIsDrawing(false);
    setShapeStartCell(null);
    finishHistoryTransaction();
  };

  const stopSpacePan = useCallback(() => {
    const pointerId = spacePanPointerIdRef.current;
    if (pointerId === null) return;
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    if (activePointerIdRef.current === pointerId) activePointerIdRef.current = null;
    spacePanPointerIdRef.current = null;
    setIsPanning(false);
    setIsDrawing(false);
    setShapeStartCell(null);
    finishHistoryTransaction();
  }, [finishHistoryTransaction]);

  useEffect(() => {
    if (interactionProfile === 'touch') return;

    const canUseCanvasShortcut = () => Boolean(
      containerRef.current
      && (canvasHoveredRef.current || document.activeElement === containerRef.current)
      && !isCanvasInteractionIgnoredTarget(document.activeElement),
    );
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && canUseCanvasShortcut()) {
        spacePressedRef.current = true;
        event.preventDefault();
        return;
      }
      if (!canUseCanvasShortcut() || (!event.ctrlKey && !event.metaKey)) return;
      if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') {
        changeZoomAtCanvasCenter(1.12);
        event.preventDefault();
      } else if (event.key === '-' || event.code === 'NumpadSubtract') {
        changeZoomAtCanvasCenter(0.88);
        event.preventDefault();
      } else if (event.key === '0' || event.code === 'Numpad0') {
        fitContentToView();
        event.preventDefault();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      spacePressedRef.current = false;
      stopSpacePan();
    };
    const handleWindowBlur = () => {
      spacePressedRef.current = false;
      stopSpacePan();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [changeZoomAtCanvasCenter, fitContentToView, interactionProfile, stopSpacePan]);

  const hoveredBead = hoverCell && grid[hoverCell.y]?.[hoverCell.x]
    ? paletteMap.get(grid[hoverCell.y][hoverCell.x]!)
    : null;

  const toggleHandTool = () => {
    if (!setActiveTool) return;
    if (activeTool === 'hand') {
      setActiveTool(lastDrawTool);
    } else {
      setActiveTool('hand');
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={`relative w-full h-full bg-[#ECEAF4] bg-gradient-to-b from-[#F2F0F9] to-[#E6E3F1] overflow-hidden select-none touch-none transition-all ${
        isFullscreenPreview ? 'fixed inset-0 z-[9999] bg-[#ECEAF4] w-screen h-screen' : ''
      } ${
        isPanning ? 'cursor-grabbing' : activeTool === 'hand' ? 'cursor-grab' : 'cursor-crosshair'
      }`}
      onPointerEnter={() => { canvasHoveredRef.current = true; }}
      onPointerLeave={() => { canvasHoveredRef.current = false; }}
      onContextMenu={e => e.preventDefault()}
    >
      {/* Fullscreen Pattern Preview Top Banner */}
      {isFullscreenPreview && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 bg-white/95 border border-purple-200 text-purple-950 px-4 py-1.5 rounded-full shadow-lg backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-extrabold text-purple-900">全屏全图预览模式</span>
          <span className="text-[10px] text-purple-600 font-mono hidden sm:inline">(按 ESC 或点击退出)</span>
          <button
            onClick={toggleFullscreenPreview}
            className="p-1 hover:bg-rose-50 text-rose-600 rounded-full cursor-pointer transition-colors"
            title="退出全屏"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <canvas
        ref={canvasRef}
        data-grid-canvas
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={event => handlePointerUp(event, false)}
        onLostPointerCapture={event => handlePointerUp(event, false)}
        onPointerLeave={() => setHoverCell(null)}
        className="w-full h-full block touch-none"
      />
      {cleanupPreview && <BackgroundCleanupOverlay preview={cleanupPreview} cellSize={cellSize} originX={pan.x + coordOffset} originY={pan.y + coordOffset} />}
      {onSymmetryAxesChange && symmetryMode !== 'none' && (['x','y'] as const).map(axis => {
        if ((axis === 'x' && symmetryMode === 'vertical') || (axis === 'y' && symmetryMode === 'horizontal')) return null;
        const start = (event: React.PointerEvent<HTMLButtonElement>) => {
          event.preventDefault(); event.stopPropagation();
          axisDragRef.current = {axis, pointerId:event.pointerId};
          event.currentTarget.setPointerCapture(event.pointerId);
        };
        return <button key={axis} type="button" data-canvas-interaction-ignore
          aria-label={axis === 'x' ? '拖动左右对称轴' : '拖动上下对称轴'}
          title={axis === 'x' ? '左右对称轴：拖动调整，方向键微调' : '上下对称轴：拖动调整，方向键微调'}
          className="absolute z-10 flex h-11 w-11 touch-none items-center justify-center rounded-full border-2 border-white bg-purple-600 text-xs font-bold text-white shadow-md"
          style={axis === 'x' ? {left:Math.max(4,Math.min((containerRef.current?.clientWidth ?? 48)-48,pan.x+coordOffset+axes.x*cellSize-22)),top:4}
            : {left:4,top:Math.max(4,Math.min((containerRef.current?.clientHeight ?? 48)-48,pan.y+coordOffset+axes.y*cellSize-22))}}
          onPointerDown={start}
          onPointerMove={event => {
            if (axisDragRef.current?.pointerId !== event.pointerId) return;
            event.preventDefault(); event.stopPropagation();
            const rect = canvasRef.current!.getBoundingClientRect();
            const position = axis === 'x' ? (event.clientX-rect.left-pan.x-coordOffset)/cellSize : (event.clientY-rect.top-pan.y-coordOffset)/cellSize;
            onSymmetryAxesChange(normalizeSymmetryAxes({...axes,[axis]:position},width,height));
          }}
          onPointerUp={event => { axisDragRef.current=null; if(event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => {axisDragRef.current=null;}}
          onLostPointerCapture={() => {axisDragRef.current=null;}}
          onKeyDown={event => {
            if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -0.5 : 0.5;
            onSymmetryAxesChange(normalizeSymmetryAxes({...axes,[axis]:axes[axis]+delta},width,height));
          }}
        >{axis === 'x' ? '↔' : '↕'}</button>;
      })}

      {/* Hover Pixel Info Popover Card */}
      {hoverCell && (
        <div className="absolute top-2 left-2 sm:top-3 sm:left-3 bg-white/95 border border-purple-200/90 text-purple-950 text-xs px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl backdrop-blur-md shadow-sm flex items-center gap-2 pointer-events-none z-10 font-medium">
          <span className="font-mono font-bold text-purple-900">
            ({hoverCell.x + 1}, {hoverCell.y + 1})
          </span>
          {hoveredBead ? (
            <div className="flex items-center gap-1.5 border-l border-purple-200 pl-2">
              <div
                className="w-3.5 h-3.5 rounded-full border border-black/20 shadow-xs shrink-0"
                style={{ backgroundColor: hoveredBead.hex }}
              />
              <span className="font-extrabold text-purple-950">{hoveredBead.code}</span>
              {hoveredBead.name && hoveredBead.name !== hoveredBead.code && (
                <span className="text-purple-600 font-medium">({hoveredBead.name})</span>
              )}
            </div>
          ) : (
            <span className="text-purple-600 font-medium border-l border-purple-200 pl-2">无色</span>
          )}
        </div>
      )}

      {/* Floating Info Overlay at bottom left */}
      <div className={`${showPaintScaleHint ? 'hidden' : 'flex'} absolute bottom-2.5 sm:bottom-3 left-2 sm:left-3 bg-white/95 border border-purple-200/90 text-purple-900 text-[11px] px-2.5 py-1.5 rounded-2xl backdrop-blur-md shadow-md flex-wrap items-center gap-1.5 sm:gap-2 max-w-[calc(100vw-212px)] sm:max-w-none z-10 font-bold`}>
        <span><strong className="text-purple-950 font-black">{width} × {height}</strong> 豆</span>
        <span><strong className="text-purple-700 font-black">{Math.ceil(width / boardSize) * Math.ceil(height / boardSize)}</strong> 板 ({boardSize}x{boardSize})</span>
        {symmetryMode !== 'none' && (
          <span className="text-purple-900 font-bold bg-purple-100 px-1.5 py-0.5 rounded-lg border border-purple-300 text-[11px] sm:text-[10px]">
            {symmetryMode === 'horizontal' ? '左右镜像' : symmetryMode === 'vertical' ? '上下镜像' : '4向镜像'}
          </span>
        )}
      </div>

      {/* Mobile & Touch Floating Zoom & Pan Controls at bottom right */}
      <div data-canvas-interaction-ignore className="absolute bottom-2.5 sm:bottom-3 right-2 sm:right-3 bg-white/95 border border-purple-200/90 rounded-2xl p-1 sm:p-1.5 shadow-md flex items-center gap-0.5 sm:gap-1 z-10 backdrop-blur-md">
        {/* Toggle Hand / Pan Tool Button (desktop only; mobile pans with two fingers) */}
        {setActiveTool && (
          <button
            onClick={toggleHandTool}
            className={`hidden sm:flex w-8 h-8 rounded-xl items-center justify-center cursor-pointer transition-all active:scale-95 ${
              activeTool === 'hand'
                ? 'bg-purple-600 text-white font-bold shadow-xs'
                : 'bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200/80'
            }`}
            title={activeTool === 'hand' ? '切换回画笔模式' : '平移/拖拽画布模式'}
          >
            {activeTool === 'hand' ? <Pencil className="w-4 h-4" /> : <Hand className="w-4 h-4 text-purple-600" />}
          </button>
        )}

        <div className="hidden sm:block w-px h-4 bg-purple-200" />

        {/* Focus / Auto-Fit View Button. Kept on mobile too: after zooming in to
            paint there was previously no one-tap way back to the whole pattern. */}
        <button
          onClick={fitToView}
          aria-label="居中适应屏幕"
          className="flex h-11 w-11 sm:h-8 sm:w-8 rounded-xl bg-purple-50 hover:bg-purple-100 active:bg-purple-200 text-purple-900 items-center justify-center cursor-pointer transition-colors border border-purple-200/80"
          title="居中适应屏幕"
        >
          <Focus className="h-4 w-4" />
        </button>

        {/* Fullscreen Full Pattern Preview Button */}
        <button
          onClick={toggleFullscreenPreview}
          aria-label={isFullscreenPreview ? '退出全屏预览' : '全屏全图预览'}
          className={`flex h-11 w-11 sm:h-8 sm:w-8 rounded-xl items-center justify-center cursor-pointer transition-all border ${
            isFullscreenPreview
              ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
              : 'bg-purple-50 hover:bg-purple-100 active:bg-purple-200 text-purple-900 border-purple-200/80'
          }`}
          title={isFullscreenPreview ? '退出全屏预览' : '全屏全图预览'}
        >
          {isFullscreenPreview ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4 text-purple-700" />}
        </button>

        {/* Percentage readout is desktop-only: on a phone the capsule needs the
            width for real controls (fit / fullscreen / zoom), and the raw number
            is not actionable there. */}
        <span className="hidden sm:block text-[10px] font-mono font-black text-purple-900 px-1 select-none min-w-[36px] text-center">
          {Math.round(zoom * 100)}%
        </span>

        {/* Zoom Out */}
        <button
          onClick={() => changeZoomAtCanvasCenter(0.8)}
          aria-label="缩小"
          className="flex h-11 w-11 sm:h-8 sm:w-8 rounded-xl bg-purple-50 hover:bg-purple-100 active:bg-purple-200 text-purple-900 items-center justify-center cursor-pointer transition-colors border border-purple-200/80"
          title="缩小"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        {/* Zoom In */}
        <button
          onClick={() => changeZoomAtCanvasCenter(1.25)}
          aria-label="放大"
          className="flex h-11 w-11 sm:h-8 sm:w-8 rounded-xl bg-purple-50 hover:bg-purple-100 active:bg-purple-200 text-purple-900 items-center justify-center cursor-pointer transition-colors border border-purple-200/80"
          title="放大"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
      </div>

      {/* Draggable Original Image Reference Box */}
      <div
        ref={referencePanelRef}
        data-canvas-interaction-ignore
        className={`absolute z-20 hidden pointer-events-auto lg:block ${
          isThumbnailMinimized
            ? 'w-auto'
            : 'w-[min(220px,calc(100vw-16px))] sm:w-[300px]'
        }`}
        style={{ left: referencePanelPosition.x, top: referencePanelPosition.y }}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={e => {
            forwardReferenceImageUpload(e.target.files?.[0], onReferenceImageUpload);
            e.target.value = '';
          }}
          accept="image/*"
          className="hidden"
        />

        {isThumbnailMinimized ? (
          <div
            onPointerDown={handleCloudPointerDown}
            onPointerMove={handleCloudPointerMove}
            onPointerUp={handleCloudPointerUp}
            onPointerCancel={handleCloudPointerCancel}
            onLostPointerCapture={handleCloudPointerCancel}
            role="button"
            tabIndex={0}
            title="点击展开原图参考，长按可拖拽"
            aria-label="展开原图参考"
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleExpandReferencePanel();
              }
            }}
            className="group relative flex h-11 w-11 sm:h-12 sm:w-12 cursor-grab touch-none select-none items-center justify-center rounded-2xl border border-purple-200/90 bg-white/95 text-purple-700 shadow-md backdrop-blur-md transition-all hover:scale-105 hover:border-purple-400 hover:shadow-xl active:cursor-grabbing active:scale-95 ring-1 ring-purple-900/5"
          >
            <Cloud className="h-6 w-6 text-purple-600 transition-transform group-hover:scale-110 drop-shadow-xs" />
            {effectiveImage && (
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
              </span>
            )}
            <span className="pointer-events-none absolute left-full ml-2 hidden whitespace-nowrap rounded-lg bg-purple-950/90 px-2 py-1 text-[11px] font-medium text-white shadow-md backdrop-blur-xs group-hover:sm:inline-block">
              原图参考 · 点击展开
            </span>
          </div>
        ) : (
          <div className="hidden sm:block overflow-hidden rounded-2xl border border-purple-200/90 bg-white/95 shadow-xl backdrop-blur-md transition-all hover:shadow-2xl ring-1 ring-purple-900/5">
            <div
              onPointerDown={handleReferencePanelPointerDown}
              onPointerMove={handleReferencePanelPointerMove}
              onPointerUp={stopReferencePanelDrag}
              onPointerCancel={stopReferencePanelDrag}
              onLostPointerCapture={stopReferencePanelDrag}
              className="flex min-h-9 cursor-grab touch-none items-center justify-between gap-1 border-b border-purple-200/80 bg-gradient-to-r from-purple-50 via-indigo-50/50 to-purple-50 p-1 text-purple-950 active:cursor-grabbing sm:min-h-10"
              title="拖动原图参考位置"
              aria-label="拖动原图参考位置"
            >
              <div
                className="flex items-center gap-1"
                onPointerDown={event => event.stopPropagation()}
                data-reference-panel-controls
              >
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!onReferenceImageUpload}
                  className="inline-flex h-8 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-emerald-300 bg-emerald-50 px-2 text-[11px] font-bold text-emerald-800 transition-all hover:bg-emerald-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 shadow-2xs"
                  title="上传原图作为画板参考"
                  aria-label="上传原图"
                >
                  <Upload className="h-3 w-3 shrink-0 text-emerald-600" />
                  <span className="leading-none">上传</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsCanvasResetDialogOpen(true)}
                  disabled={!onResetCanvas}
                  className="inline-flex h-8 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-rose-300 bg-rose-50 px-2 text-[11px] font-bold text-rose-800 transition-all hover:bg-rose-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 shadow-2xs"
                  title="清空当前画板"
                  aria-label="重置当前画板"
                >
                  <RotateCcw className="h-3 w-3 shrink-0 text-rose-600" />
                  <span className="leading-none">重置</span>
                </button>
              </div>

              {/* Draggable spacer */}
              <div className="flex-1 h-8 cursor-grab active:cursor-grabbing" />

              {/* Right side collapse indicator button */}
              <div
                className="flex items-center justify-end pr-0.5"
                onPointerDown={event => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={handleCollapseReferencePanel}
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-purple-200 bg-purple-50/80 text-purple-700 transition-all hover:bg-purple-200 hover:text-purple-900 active:scale-90 shadow-2xs"
                  title="收起原图参考"
                  aria-label="收起原图参考"
                >
                  <ChevronUp className="h-3.5 w-3.5 shrink-0 text-purple-700" />
                </button>
              </div>
            </div>

            <div
              onPointerDown={handleReferencePanelPointerDown}
              onPointerMove={handleReferencePanelPointerMove}
              onPointerUp={stopReferencePanelDrag}
              onPointerCancel={stopReferencePanelDrag}
              onLostPointerCapture={stopReferencePanelDrag}
              className="hidden h-1 cursor-grab bg-purple-50/60 active:cursor-grabbing sm:block"
              title="拖动原图参考窗口"
              aria-label="拖动原图参考窗口"
            />

            <div className="p-1.5 sm:p-2 bg-gradient-to-b from-purple-50/30 to-indigo-50/20">
              {effectiveImage ? (
                <button
                  type="button"
                  onClick={openEnlargedImagePreview}
                  className="group relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-purple-200/90 bg-purple-50/80 shadow-xs transition-all hover:border-purple-400 hover:shadow-md active:scale-[0.99]"
                  title="点击放大查看原图"
                  aria-label="放大原图查看"
                >
                  <img
                    src={effectiveImage.src}
                    alt="原图参考"
                    className="max-h-[120px] w-auto max-w-full object-contain sm:max-h-[150px] lg:max-h-[180px] rounded-lg transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-purple-950/75 p-2 text-[11px] font-bold text-white opacity-0 backdrop-blur-xs transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <ZoomIn className="h-5 w-5 text-purple-200 animate-pulse" />
                    点击放大原图
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex min-h-24 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-purple-300/90 bg-gradient-to-br from-purple-50/90 via-indigo-50/50 to-pink-50/30 p-2 text-center transition-all hover:border-purple-500 hover:bg-purple-100/80 hover:shadow-inner sm:min-h-28 sm:p-3 group cursor-pointer"
                  title="点击上传图片做原图对照手动绘制"
                  aria-label="上传原图"
                >
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-purple-100/90 text-purple-600 flex items-center justify-center border border-purple-200/80 shadow-2xs mb-1 group-hover:scale-110 group-hover:bg-purple-600 group-hover:text-white transition-all">
                    <Upload className="h-5 w-5 text-purple-600 group-hover:text-white transition-colors" />
                  </div>
                  <span className="text-[13px] font-extrabold text-purple-950">上传原图</span>
                  <span className="mt-0.5 text-[11px] font-medium text-purple-600">对照原图手动绘制</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="lg:hidden absolute top-2 right-2 z-20" data-canvas-interaction-ignore>
        <button
          type="button"
          onClick={() => setIsReferenceSheetOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-purple-200 bg-white/95 text-purple-700 shadow-lg backdrop-blur-md active:scale-95"
          aria-label="打开原图参考"
          title="打开原图参考"
        >
          <ImageIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Board switching moved to the docked strip the mobile shell renders
          below this canvas (see boardNavApiRef). A floating pill here covered
          the very cells it was meant to help with, and stepping to board 5
          cost four taps. */}

      {/* A fitted large pattern drops to ~20% zoom, i.e. beads smaller than a
          fingertip. When the pattern spans several boards the fix is to switch
          to board editing (same geometry as the split-board export); a small
          single-board pattern just zooms to a paintable scale. */}
      {showPaintScaleHint && (
        <div className="absolute bottom-2.5 left-2 z-20 max-w-[calc(100%-212px)]" data-canvas-interaction-ignore>
          <button
            type="button"
            onClick={() => { if (totalBoards > 1) focusBoard(0); else zoomToEditingScale(); }}
            title={totalBoards > 1 ? '豆格太小，按板编辑更准' : '豆格太小，点此放大绘制'}
            className="flex min-h-11 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50/95 px-3 text-[11px] font-black text-amber-900 shadow-lg backdrop-blur-md active:scale-95"
          >
            <ZoomIn className="h-4 w-4 shrink-0" aria-hidden="true" />
            {totalBoards > 1 ? '按板编辑' : '放大绘制'}
          </button>
        </div>
      )}

      {isReferenceSheetOpen && (
        <div className="lg:hidden fixed inset-0 z-[55] flex items-end bg-slate-950/35" data-canvas-interaction-ignore onClick={() => setIsReferenceSheetOpen(false)}>
          <section className="w-full rounded-t-3xl border-t border-purple-200 bg-white p-4 pb-6 shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-purple-200" />
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-extrabold text-purple-950">原图参考</span>
              <button type="button" onClick={() => setIsReferenceSheetOpen(false)} className="rounded-lg px-3 py-1 text-xs font-bold text-purple-700 hover:bg-purple-50">关闭</button>
            </div>
            {effectiveImage ? (
              <button type="button" onClick={openEnlargedImagePreview} className="mb-3 flex max-h-56 w-full items-center justify-center overflow-hidden rounded-2xl border border-purple-200 bg-purple-50 p-2">
                <img src={effectiveImage.src} alt="原图参考" className="max-h-52 max-w-full object-contain" />
              </button>
            ) : (
              <button type="button" onClick={() => fileInputRef.current?.click()} className="mb-3 flex min-h-28 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-purple-300 bg-purple-50/70 text-purple-700">
                <Upload className="mb-1 h-6 w-6" />
                <span className="text-sm font-extrabold">上传原图</span>
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!onReferenceImageUpload} className="h-11 rounded-xl border border-emerald-300 bg-emerald-50 text-sm font-bold text-emerald-800 disabled:opacity-40"><Upload className="mr-1 inline h-4 w-4" />上传</button>
              <button type="button" onClick={() => setIsCanvasResetDialogOpen(true)} disabled={!onResetCanvas} className="h-11 rounded-xl border border-rose-300 bg-rose-50 text-sm font-bold text-rose-800 disabled:opacity-40"><RotateCcw className="mr-1 inline h-4 w-4" />重置画板</button>
            </div>
          </section>
        </div>
      )}

      {isCanvasResetDialogOpen && (
        <div
          data-canvas-interaction-ignore
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
          onClick={() => setIsCanvasResetDialogOpen(false)}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reset-canvas-title"
            aria-describedby="reset-canvas-description"
            className="w-full max-w-sm rounded-xl border border-rose-200 bg-white p-5 text-slate-900 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <h2 id="reset-canvas-title" className="text-base font-extrabold">清空当前画板？</h2>
            <p id="reset-canvas-description" className="mt-2 text-sm leading-6 text-slate-600">
              此操作会永久清空当前未保存图案，以及撤销和重做历史，且无法恢复。原图参考、网格尺寸、调色板和算法设置会保留。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCanvasResetDialogOpen(false)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
              >
                取消
              </button>
              <button
                ref={confirmCanvasResetRef}
                type="button"
                onClick={confirmCanvasReset}
                className="rounded-lg border border-rose-700 bg-rose-600 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-rose-700"
              >
                确认清空
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Enlarged Original Image Lightbox Modal */}
      {isEnlargedModalOpen && effectiveImage && (
        <div
          data-canvas-interaction-ignore
          className="fixed inset-0 z-50 bg-purple-950/40 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-fade-in"
          onClick={() => setIsEnlargedModalOpen(false)}
        >
          <div
            className="relative bg-white border border-purple-200 rounded-3xl max-w-5xl max-h-[92vh] w-full flex flex-col overflow-hidden shadow-2xl text-purple-950"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-purple-200/80 bg-purple-50/60">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between w-full">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="p-1.5 rounded-xl bg-purple-100 border border-purple-300 text-purple-700">
                  <ImageIcon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-extrabold text-purple-950 flex items-center gap-2">
                    原图高清对比与查看
                  </h3>
                  <p className="text-[11px] text-purple-600 font-mono">
                    分辨率: {effectiveImage.naturalWidth || effectiveImage.width} × {effectiveImage.naturalHeight || effectiveImage.height} px
                  </p>
                </div>
              </div>

              <div className={IMAGE_PREVIEW_TOOLBAR_CLASS}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!onReferenceImageUpload}
                  className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-purple-100 px-2 py-1.5 text-xs font-bold text-purple-900 border border-purple-300 transition-colors hover:bg-purple-200 disabled:cursor-not-allowed disabled:opacity-40"
                  title={IMAGE_PREVIEW_CONTROLS.upload.title}
                  aria-label={IMAGE_PREVIEW_CONTROLS.upload.ariaLabel}
                >
                  <Upload className="w-4 h-4" />
                  <span>上传原图</span>
                </button>
                <button
                  onClick={() => zoomModalImage(-0.25)}
                  className="p-1.5 rounded-xl bg-purple-100 hover:bg-purple-200 text-purple-900 text-xs flex items-center gap-1 border border-purple-300 transition-colors cursor-pointer font-bold"
                  title={IMAGE_PREVIEW_CONTROLS.zoomOut.title}
                  aria-label={IMAGE_PREVIEW_CONTROLS.zoomOut.ariaLabel}
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono text-purple-900 min-w-[40px] text-center font-bold">
                  {Math.round(modalImageView.scale * 100)}%
                </span>
                <button
                  onClick={() => zoomModalImage(0.25)}
                  className="p-1.5 rounded-xl bg-purple-100 hover:bg-purple-200 text-purple-900 text-xs flex items-center gap-1 border border-purple-300 transition-colors cursor-pointer font-bold"
                  title={IMAGE_PREVIEW_CONTROLS.zoomIn.title}
                  aria-label={IMAGE_PREVIEW_CONTROLS.zoomIn.ariaLabel}
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsCanvasResetDialogOpen(true)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-rose-300 bg-rose-50 px-2 py-1.5 text-xs font-bold text-rose-800 transition-colors hover:bg-rose-100"
                  title="重置图纸"
                  aria-label="重置图纸"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>重置图纸</span>
                </button>
                <div className="w-px h-5 bg-purple-200 mx-1" />
                <button
                  onClick={() => setIsEnlargedModalOpen(false)}
                  className="p-1.5 rounded-xl bg-purple-100 hover:bg-rose-100 text-purple-700 hover:text-rose-700 transition-colors border border-purple-200 cursor-pointer"
                  title={IMAGE_PREVIEW_CONTROLS.close.title}
                  aria-label={IMAGE_PREVIEW_CONTROLS.close.ariaLabel}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              </div>
            </div>

            {/* Modal Body: Draggable / Zoomable image preview */}
            <div className="flex-1 overflow-hidden p-4 flex items-center justify-center bg-purple-50/40 min-h-[320px] select-none">
              <div
                ref={modalImageViewportRef}
                onPointerDown={handleModalImagePointerDown}
                onPointerMove={handleModalImagePointerMove}
                onPointerUp={stopModalImagePan}
                onPointerCancel={stopModalImagePan}
                onLostPointerCapture={stopModalImagePan}
                className="relative border border-purple-200/80 rounded-2xl overflow-hidden shadow-xl bg-[radial-gradient(#DDD6FE_1px,transparent_1px)] [background-size:16px_16px] max-w-full max-h-full flex items-center justify-center p-2 cursor-grab active:cursor-grabbing touch-none"
              >
                <img
                  ref={modalImageRef}
                  src={effectiveImage.src}
                  alt="原图放大预览"
                  onLoad={() => setModalImageView(current => current)}
                  style={{
                    transform: `translate(${modalImageView.pan.x}px, ${modalImageView.pan.y}px) scale(${modalImageView.scale})`,
                    transformOrigin: 'center center',
                    transition: 'transform 0.15s ease-out',
                    boxShadow: '0 0 0 1px #6d5485, 0 0 0 3px rgba(255,255,255,.95)',
                  }}
                  className="max-h-[68vh] max-w-full object-contain pointer-events-none rounded-lg"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-2.5 border-t border-purple-200/80 bg-purple-50/60 flex items-center justify-between text-xs text-purple-600">
              <span className="hidden sm:inline">提示：点击顶部 +/- 或按钮自由放大/缩小原图细节</span>
              <button
                onClick={() => setIsEnlargedModalOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold transition-colors shadow-xs ml-auto cursor-pointer"
                title={IMAGE_PREVIEW_CONTROLS.close.title}
                aria-label={IMAGE_PREVIEW_CONTROLS.close.ariaLabel}
              >
                关闭预览
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
