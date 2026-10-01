import React, { useRef, useEffect, useState, useCallback, useLayoutEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Minimize2, Focus, Hand, Pencil, Eye, EyeOff, Image as ImageIcon, X, ChevronUp, ChevronDown, Upload, RotateCcw } from 'lucide-react';
import { BeadColor, BeadShape, ToolType, SymmetryMode, CanvasBackdrop } from '../types';
import { drawBeadOnCanvas, getColumnLetter } from '../utils/exportUtils';
import { getColumnLabelPositions, getRowLabelPositions } from '../utils/gridCoordinateLabels';
import { getColorDisplayState } from '../utils/completionHighlight';
import { getGridImageFitRect } from '../utils/gridImageFit';
import {
  changeImagePreviewScale,
  createInitialImagePreviewView,
  forwardReferenceImageUpload,
  IMAGE_PREVIEW_CONTROLS,
  IMAGE_PREVIEW_TOOLBAR_CLASS,
  resetImagePreviewView,
} from '../utils/imagePreviewView';
import {
  clampReferencePanelPosition,
  getInitialReferencePanelPosition,
  type ReferencePanelPosition,
} from '../utils/referencePanelPosition';

interface GridCanvasProps {
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
  // High-DPR mobile canvases multiply every fill/stroke cost without adding
  // useful detail at the board's small cell sizes. Keep desktop retina sharp
  // while bounding the cost on phones and tablets.
  return Math.min(2, Math.max(1, window.devicePixelRatio || 1));
}

export const GridCanvas: React.FC<GridCanvasProps> = ({
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
  const [modalImageView, setModalImageView] = useState(createInitialImagePreviewView);
  // Keep the drawing surface clear on phones initially; the reference stays one tap away.
  const [isThumbnailMinimized, setIsThumbnailMinimized] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
  ));
  const modalImageDragRef = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null);
  const [referencePanelPosition, setReferencePanelPosition] = useState<ReferencePanelPosition>({ x: 8, y: 8 });
  const referencePanelDragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startPosition: ReferencePanelPosition } | null>(null);
  const [isReferenceSheetOpen, setIsReferenceSheetOpen] = useState(false);
  const referencePanelInitializedRef = useRef(false);
  const [isCanvasResetDialogOpen, setIsCanvasResetDialogOpen] = useState(false);
  const confirmCanvasResetRef = useRef<HTMLButtonElement>(null);

  const resetModalImageView = useCallback(() => {
    setModalImageView(resetImagePreviewView());
  }, []);

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
  }, []);

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

  // Cell size base in pixels
  const baseCellSize = 20;
  const cellSize = baseCellSize * zoom;
  const minSymbolCellSize = 18;
  const coordOffset = showCoordinates ? 28 : 0;

  // Refs for touch gesture sync
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const activeToolRef = useRef(activeTool);
  const panStartRef = useRef({ x: 0, y: 0 });
  const transformFrameRef = useRef<number | null>(null);
  const pendingTransformRef = useRef<{ zoom: number; pan: { x: number; y: number } } | null>(null);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  const scheduleTransformCommit = useCallback((nextZoom: number, nextPan: { x: number; y: number }) => {
    // Pointer/touch events can arrive much faster than a phone can paint. Keep
    // refs current for coordinate math, but commit React state at most once per
    // animation frame so the expensive canvas render is coalesced.
    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    pendingTransformRef.current = { zoom: nextZoom, pan: nextPan };
    if (transformFrameRef.current !== null) return;

    transformFrameRef.current = window.requestAnimationFrame(() => {
      transformFrameRef.current = null;
      const pending = pendingTransformRef.current;
      pendingTransformRef.current = null;
      if (!pending) return;
      setZoom(pending.zoom);
      setPan(pending.pan);
    });
  }, [setZoom]);

  useEffect(() => () => {
    if (transformFrameRef.current !== null) {
      window.cancelAnimationFrame(transformFrameRef.current);
      transformFrameRef.current = null;
    }
  }, []);

  const changeZoomAtClient = useCallback((targetZoom: number, clientX: number, clientY: number): boolean => {
    const previousZoom = zoomRef.current;
    const nextZoom = Math.min(4.5, Math.max(0.1, targetZoom));
    if (nextZoom === previousZoom) return false;

    const rect = canvasRef.current?.getBoundingClientRect();
    const nextPan = rect
      ? (() => {
          const localX = clientX - rect.left;
          const localY = clientY - rect.top;
          const ratio = nextZoom / previousZoom;
          return {
            x: localX - (localX - panRef.current.x) * ratio,
            y: localY - (localY - panRef.current.y) * ratio,
          };
        })()
      : panRef.current;
    scheduleTransformCommit(nextZoom, nextPan);
    return true;
  }, [scheduleTransformCommit]);

  const changeZoomAtCanvasCenter = useCallback((factor: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return false;
    return changeZoomAtClient(zoomRef.current * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [changeZoomAtClient]);

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

    const totalGridW = width * baseCellSize + coordOffset;
    const totalGridH = height * baseCellSize + coordOffset;

    const padding = clientWidth < 640 ? 12 : 36;
    const availW = Math.max(100, clientWidth - padding * 2);
    const availH = Math.max(100, clientHeight - padding * 2);

    const scaleX = availW / totalGridW;
    const scaleY = availH / totalGridH;
    const bestZoom = Math.min(3.5, Math.max(0.1, Math.min(scaleX, scaleY)));

    setZoom(bestZoom);

    const finalPixelW = width * baseCellSize * bestZoom + coordOffset;
    const finalPixelH = height * baseCellSize * bestZoom + coordOffset;

    setPan({
      x: Math.max(8, (clientWidth - finalPixelW) / 2),
      y: Math.max(8, (clientHeight - finalPixelH) / 2),
    });
  }, [width, height, coordOffset, baseCellSize, setZoom]);

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
    const bestZoom = Math.min(4.5, Math.max(0.1, Math.min(
      Math.max(100, container.clientWidth - padding * 2) / contentWidth,
      Math.max(100, container.clientHeight - padding * 2) / contentHeight,
    )));
    const scaledWidth = contentWidth * bestZoom;
    const scaledHeight = contentHeight * bestZoom;
    const nextPan = {
      x: (container.clientWidth - scaledWidth) / 2 - coordOffset - minX * baseCellSize * bestZoom,
      y: (container.clientHeight - scaledHeight) / 2 - coordOffset - minY * baseCellSize * bestZoom,
    };

    zoomRef.current = bestZoom;
    panRef.current = nextPan;
    setZoom(bestZoom);
    setPan(nextPan);
  }, [baseCellSize, coordOffset, fitToView, grid, height, setZoom, width]);

  useEffect(() => {
    fitToView();
  }, [width, height]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fitToView();
    }, 80);
    return () => clearTimeout(timer);
  }, [isFullscreenPreview, fitToView]);

  // Handle Touch Gestures (Pinch to zoom & two-finger / hand panning)
  useEffect(() => {
    if (interactionProfile === 'desktop') return;

    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
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
          const newZoom = Math.min(4.5, Math.max(0.1, state.initialZoom * scale));

          const rect = container.getBoundingClientRect();
          const focusX = state.initialMidX - rect.left - state.initialPanX;
          const focusY = state.initialMidY - rect.top - state.initialPanY;
          const zoomRatio = newZoom / state.initialZoom;

          const deltaMidX = midX - state.initialMidX;
          const deltaMidY = midY - state.initialMidY;

          const newPanX = state.initialMidX - rect.left - (focusX * zoomRatio) + deltaMidX;
          const newPanY = state.initialMidY - rect.top - (focusY * zoomRatio) + deltaMidY;

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
  }, [finishHistoryTransaction, interactionProfile, scheduleTransformCommit]);

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

  // Expand points by Symmetry Mode
  const applySymmetryToPoints = useCallback(
    (pts: { x: number; y: number }[]): { x: number; y: number }[] => {
      if (symmetryMode === 'none') return pts;

      const result = new Set<string>();
      for (const p of pts) {
        result.add(`${p.x},${p.y}`);

        if (symmetryMode === 'horizontal' || symmetryMode === 'quad') {
          const symX = width - 1 - p.x;
          if (symX >= 0 && symX < width) result.add(`${symX},${p.y}`);
        }
        if (symmetryMode === 'vertical' || symmetryMode === 'quad') {
          const symY = height - 1 - p.y;
          if (symY >= 0 && symY < height) result.add(`${p.x},${symY}`);
        }
        if (symmetryMode === 'quad') {
          const symX = width - 1 - p.x;
          const symY = height - 1 - p.y;
          if (symX >= 0 && symX < width && symY >= 0 && symY < height) {
            result.add(`${symX},${symY}`);
          }
        }
      }

      return Array.from(result).map(str => {
        const [x, y] = str.split(',').map(Number);
        return { x, y };
      });
    },
    [symmetryMode, width, height]
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

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const startX = pan.x + coordOffset;
    const startY = pan.y + coordOffset;

    // 1. Render Coordinate Labels (Top letters A..Z, Left numbers 1..N)
    if (showCoordinates) {
      ctx.fillStyle = '#6B21A8';
      ctx.font = `bold ${Math.max(10, Math.floor(11 * Math.min(zoom, 1.2)))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const columnLabels = getColumnLabelPositions({
        columns: width,
        cellSize,
        boardSize,
        originX: startX,
        viewportWidth: canvasWidth,
        getLabel: getColumnLetter,
        measureLabel: label => ctx.measureText(label).width,
      });
      for (const { label, center } of columnLabels) {
        ctx.fillText(label, center, pan.y + coordOffset / 2);
      }

      ctx.textAlign = 'right';
      const rowMetrics = ctx.measureText('0');
      const rowLabelHeight = Math.max(
        10,
        rowMetrics.actualBoundingBoxAscent + rowMetrics.actualBoundingBoxDescent,
      );
      const rowLabels = getRowLabelPositions({
        rows: height,
        cellSize,
        boardSize,
        originY: startY,
        viewportHeight: canvasHeight,
        measureLabel: () => rowLabelHeight,
      });
      for (const { label, center } of rowLabels) {
        ctx.fillText(label, startX - 6, center);
      }
    }

    // 2. Pegboard Area Fill based on Canvas Backdrop
    const gridPixelWidth = width * cellSize;
    const gridPixelHeight = height * cellSize;

    if (canvasBackdrop === 'light_pegboard') {
      ctx.fillStyle = '#FAF8FF';
    } else if (canvasBackdrop === 'wood') {
      ctx.fillStyle = '#F5E6D3';
    } else if (canvasBackdrop === 'studio') {
      ctx.fillStyle = '#F3E8FF';
    } else if (canvasBackdrop === 'slate') {
      ctx.fillStyle = '#F1F5F9';
    } else {
      ctx.fillStyle = '#FAF8FF'; // clean light pegboard
    }
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

    // 5. Render Bead Grid Cells
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = startX + x * cellSize;
        const py = startY + y * cellSize;

        if (
          px + cellSize < 0 ||
          px > canvasWidth ||
          py + cellSize < 0 ||
          py > canvasHeight
        ) {
          continue;
        }

        const isShapePreview = previewSet.has(`${x},${y}`);
        const colorId = grid[y]?.[x];

        if (isShapePreview && selectedColor) {
          // Render preview ghost bead for shape tools
          ctx.save();
          ctx.globalAlpha = 0.8;
          drawBeadOnCanvas(ctx, px, py, cellSize, selectedColor.hex, beadShape, null);
          ctx.restore();
        } else if (colorId) {
          const bead = paletteMap.get(colorId);
          const colorHex = bead ? bead.hex : '#CCCCCC';
          const symbolStr = showSymbols && cellSize >= minSymbolCellSize && bead
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

          drawBeadOnCanvas(ctx, px, py, cellSize, colorHex, beadShape, symbolStr);

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
          ctx.fillRect(px, py, cellSize, cellSize);

          if (showGridLines) {
            ctx.strokeStyle = showOverlay
              ? (canvasBackdrop === 'wood' ? 'rgba(217, 119, 6, 0.6)' : 'rgba(124, 58, 237, 0.42)')
              : (canvasBackdrop === 'wood' ? '#FCD34D' : '#E9D5FF');
            ctx.lineWidth = 0.5;
            ctx.strokeRect(px, py, cellSize, cellSize);
          }

          // Peg dot center
          ctx.beginPath();
          ctx.arc(px + cellSize / 2, py + cellSize / 2, Math.max(1, cellSize * 0.12), 0, Math.PI * 2);
          ctx.fillStyle = showOverlay
            ? (canvasBackdrop === 'wood' ? 'rgba(217, 119, 6, 0.65)' : 'rgba(124, 58, 237, 0.45)')
            : (canvasBackdrop === 'wood' ? '#D97706' : '#C4B5FD');
          ctx.fill();
        }
      }
    }

    // 6. Symmetry Crosshairs Guidelines
    if (symmetryMode !== 'none') {
      ctx.strokeStyle = '#9333EA';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);

      if (symmetryMode === 'horizontal' || symmetryMode === 'quad') {
        const midX = startX + (width * cellSize) / 2;
        ctx.beginPath();
        ctx.moveTo(midX, startY);
        ctx.lineTo(midX, startY + gridPixelHeight);
        ctx.stroke();
      }
      if (symmetryMode === 'vertical' || symmetryMode === 'quad') {
        const midY = startY + (height * cellSize) / 2;
        ctx.beginPath();
        ctx.moveTo(startX, midY);
        ctx.lineTo(startX + gridPixelWidth, midY);
        ctx.stroke();
      }

      ctx.setLineDash([]); // Reset line dash
    }

    // 7. Board Boundary Outlines
    if (boardSize > 0) {
      ctx.strokeStyle = 'rgba(124, 58, 237, 0.45)';
      ctx.lineWidth = 1.5;

      for (let x = 0; x <= width; x += boardSize) {
        const px = startX + x * cellSize;
        ctx.beginPath();
        ctx.moveTo(px, startY);
        ctx.lineTo(px, startY + gridPixelHeight);
        ctx.stroke();
      }

      for (let y = 0; y <= height; y += boardSize) {
        const py = startY + y * cellSize;
        ctx.beginPath();
        ctx.moveTo(startX, py);
        ctx.lineTo(startX + gridPixelWidth, py);
        ctx.stroke();
      }

      const boardsX = Math.ceil(width / boardSize);
      const boardsY = Math.ceil(height / boardSize);

      // Subtle translucent sub-board number badge
      const fontSize = Math.min(10, Math.max(8, Math.floor(cellSize * 0.45)));
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      for (let by = 0; by < boardsY; by++) {
        for (let bx = 0; bx < boardsX; bx++) {
          const boardNum = by * boardsX + bx + 1;
          const px = startX + bx * boardSize * cellSize + 4;
          const py = startY + by * boardSize * cellSize + 4;

          const labelText = `板 ${boardNum}`;
          const metrics = ctx.measureText(labelText);
          const bgW = metrics.width + 6;
          const bgH = fontSize + 4;

          // Soft light purple translucent background pill
          ctx.fillStyle = 'rgba(243, 232, 255, 0.9)';
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(px - 2, py - 2, bgW, bgH, 4);
            ctx.fill();
          } else {
            ctx.fillRect(px - 2, py - 2, bgW, bgH);
          }

          // Deep purple text label
          ctx.fillStyle = '#6B21A8';
          ctx.fillText(labelText, px, py);
        }
      }
    }

    // 8. Grid Outer Border
    ctx.strokeStyle = '#7C3AED';
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, gridPixelWidth, gridPixelHeight);

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
        renderCanvas();
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderCanvas]);

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
    if (e.button === 1 || e.button === 2 || e.shiftKey || activeTool === 'hand' || isSpacePan) {
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

    if (activeTool === 'pencil' || activeTool === 'eraser' || activeTool === 'bucket' || activeTool === 'replace') {
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

    if (isPanning || spacePanPointerIdRef.current === e.pointerId) {
      if (spacePanPointerIdRef.current === e.pointerId) e.preventDefault();
      scheduleTransformCommit(zoomRef.current, {
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
      return;
    }

    const cell = clientToGrid(e.clientX, e.clientY);
    setHoverCell(cell);

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
      className={`relative w-full h-full bg-[#F5F0FD] bg-[radial-gradient(#DDD6FE_1px,transparent_1px)] [background-size:20px_20px] overflow-hidden select-none touch-none transition-all ${
        isFullscreenPreview ? 'fixed inset-0 z-[9999] bg-[#F5F0FD] w-screen h-screen' : ''
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
          <span className="text-[10px] text-purple-500 font-mono hidden sm:inline">(按 ESC 或点击退出)</span>
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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={event => handlePointerUp(event, false)}
        onLostPointerCapture={event => handlePointerUp(event, false)}
        onPointerLeave={() => setHoverCell(null)}
        className="w-full h-full block touch-none"
      />

      {/* Hover Pixel Info Popover Card */}
      {hoverCell && (
        <div className="absolute top-2 left-2 sm:top-3 sm:left-3 bg-white/95 border border-purple-200/90 text-purple-950 text-[10px] sm:text-xs px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-2xl backdrop-blur-md shadow-md flex items-center gap-2 sm:gap-3 pointer-events-none z-10">
          <div className="font-mono text-purple-800 font-black">
            {getColumnLetter(hoverCell.x)}{hoverCell.y + 1} ({hoverCell.x + 1}, {hoverCell.y + 1})
          </div>
          {hoveredBead ? (
            <div className="flex items-center gap-1.5 border-l border-purple-200 pl-2 sm:pl-3">
              <div
                className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full border border-black/20 shadow-inner shrink-0"
                style={{ backgroundColor: hoveredBead.hex }}
              />
              <span className="font-extrabold text-purple-950">{hoveredBead.code}</span>
              <span className="text-purple-600 font-medium hidden xs:inline">({hoveredBead.name})</span>
            </div>
          ) : (
            <span className="text-purple-400 font-medium border-l border-purple-200 pl-2 sm:pl-3">空位置</span>
          )}
        </div>
      )}

      {/* Floating Info Overlay at bottom left */}
      <div className="absolute bottom-2.5 sm:bottom-3 left-2 sm:left-3 bg-white/95 border border-purple-200/90 text-purple-900 text-[9px] sm:text-[11px] px-2.5 py-1.5 rounded-2xl backdrop-blur-md shadow-md flex flex-wrap items-center gap-1.5 sm:gap-2 max-w-[calc(100vw-220px)] sm:max-w-none z-10 font-bold">
        <span><strong className="text-purple-950 font-black">{width} × {height}</strong> 豆</span>
        <span><strong className="text-purple-700 font-black">{Math.ceil(width / boardSize) * Math.ceil(height / boardSize)}</strong> 板 ({boardSize}x{boardSize})</span>
        {symmetryMode !== 'none' && (
          <span className="text-purple-900 font-bold bg-purple-100 px-1.5 py-0.5 rounded-lg border border-purple-300 text-[8px] sm:text-[10px]">
            {symmetryMode === 'horizontal' ? '左右镜像' : symmetryMode === 'vertical' ? '上下镜像' : '4向镜像'}
          </span>
        )}
      </div>

      {/* Mobile & Touch Floating Zoom & Pan Controls at bottom right */}
      <div data-canvas-interaction-ignore className="absolute bottom-2.5 sm:bottom-3 right-2 sm:right-3 bg-white/95 border border-purple-200/90 rounded-2xl p-1.5 shadow-md flex items-center gap-1 z-10 backdrop-blur-md">
        {/* Toggle Hand / Pan Tool Button */}
        {setActiveTool && (
          <button
            onClick={toggleHandTool}
            className={`w-9 h-9 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center cursor-pointer transition-all active:scale-95 ${
              activeTool === 'hand'
                ? 'bg-purple-600 text-white font-bold shadow-xs'
                : 'bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200/80'
            }`}
            title={activeTool === 'hand' ? '切换回画笔模式' : '平移/拖拽画布模式'}
          >
            {activeTool === 'hand' ? <Pencil className="w-4 h-4" /> : <Hand className="w-4 h-4 text-purple-600" />}
          </button>
        )}

        <div className="w-px h-4 bg-purple-200" />

        {/* Focus / Auto-Fit View Button */}
        <button
          onClick={fitToView}
          className="w-9 h-9 sm:w-8 sm:h-8 rounded-xl bg-purple-50 hover:bg-purple-100 active:bg-purple-200 text-purple-900 flex items-center justify-center cursor-pointer transition-colors border border-purple-200/80"
          title="居中适应屏幕"
        >
          <Focus className="w-4 h-4" />
        </button>

        {/* Fullscreen Full Pattern Preview Button */}
        <button
          onClick={toggleFullscreenPreview}
          className={`w-9 h-9 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center cursor-pointer transition-all border ${
            isFullscreenPreview
              ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
              : 'bg-purple-50 hover:bg-purple-100 active:bg-purple-200 text-purple-900 border-purple-200/80'
          }`}
          title={isFullscreenPreview ? '退出全屏预览' : '全屏全图预览'}
        >
          {isFullscreenPreview ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4 text-purple-700" />}
        </button>

        <span className="text-[9px] sm:text-[10px] font-mono font-black text-purple-900 px-1 select-none min-w-[32px] sm:min-w-[36px] text-center">
          {Math.round(zoom * 100)}%
        </span>

        {/* Zoom Out */}
        <button
          onClick={() => setZoom(Math.max(0.1, zoom * 0.8))}
          className="w-9 h-9 sm:w-8 sm:h-8 rounded-xl bg-purple-50 hover:bg-purple-100 active:bg-purple-200 text-purple-900 flex items-center justify-center cursor-pointer transition-colors border border-purple-200/80"
          title="缩小"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        {/* Zoom In */}
        <button
          onClick={() => setZoom(Math.min(4.5, zoom * 1.25))}
          className="w-9 h-9 sm:w-8 sm:h-8 rounded-xl bg-purple-50 hover:bg-purple-100 active:bg-purple-200 text-purple-900 flex items-center justify-center cursor-pointer transition-colors border border-purple-200/80"
          title="放大"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
      </div>

      {/* Draggable Original Image Reference Box */}
      <div
        ref={referencePanelRef}
        data-canvas-interaction-ignore
        className="absolute z-20 w-[min(220px,calc(100vw-16px))] sm:w-[300px] pointer-events-auto"
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
        <div className="hidden sm:block overflow-hidden rounded-2xl border border-purple-200/90 bg-white/95 shadow-lg backdrop-blur-md">
          <div
            onPointerDown={handleReferencePanelPointerDown}
            onPointerMove={handleReferencePanelPointerMove}
            onPointerUp={stopReferencePanelDrag}
            onPointerCancel={stopReferencePanelDrag}
            onLostPointerCapture={stopReferencePanelDrag}
            className="flex min-h-10 cursor-grab touch-none items-center gap-1 border-b border-purple-200/80 bg-purple-50/80 px-1 py-1 text-purple-950 active:cursor-grabbing sm:min-h-12 sm:gap-1.5 sm:px-1.5 sm:py-1.5"
            title="拖动原图参考位置"
            aria-label="拖动原图参考位置"
          >
            <div
              className="grid min-h-8 min-w-0 flex-1 grid-cols-[28px_repeat(3,minmax(0,1fr))] gap-0.5 sm:min-h-9 sm:grid-cols-[42px_repeat(3,minmax(0,1fr))] sm:gap-1"
              onPointerDown={event => event.stopPropagation()}
              data-reference-panel-controls
            >
              <div className="flex items-center justify-center rounded-md border border-purple-200 bg-purple-50 text-purple-700" aria-hidden="true">
                <ImageIcon className="h-3.5 w-3.5" />
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!onReferenceImageUpload}
                className="inline-flex h-8 min-w-0 cursor-pointer items-center justify-center gap-px whitespace-nowrap rounded-md border border-emerald-300 bg-emerald-50 px-0.5 text-[10px] font-bold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:gap-1 sm:px-1 sm:text-[11px]"
                title="上传原图作为画板参考"
                aria-label="上传原图"
              >
                <Upload className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
                <span>上传</span>
              </button>
              <button
                type="button"
                onClick={() => setIsCanvasResetDialogOpen(true)}
                disabled={!onResetCanvas}
                className="inline-flex h-8 min-w-0 cursor-pointer items-center justify-center gap-px whitespace-nowrap rounded-md border border-rose-300 bg-rose-50 px-0.5 text-[10px] font-bold text-rose-800 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:gap-1 sm:px-1 sm:text-[11px]"
                title="清空当前画板"
                aria-label="重置当前画板"
              >
                <RotateCcw className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
                <span>重置</span>
              </button>
              <button
                type="button"
                onClick={() => setIsThumbnailMinimized(value => !value)}
                className="inline-flex h-8 min-w-0 cursor-pointer items-center justify-center gap-px whitespace-nowrap rounded-md border border-purple-300 bg-purple-100 px-0.5 text-[10px] font-bold text-purple-900 transition-colors hover:bg-purple-200 sm:h-9 sm:gap-1 sm:px-1 sm:text-[11px]"
                title={isThumbnailMinimized ? '展开原图参考' : '收起原图参考'}
                aria-label={isThumbnailMinimized ? '展开原图参考' : '收起原图参考'}
                aria-expanded={!isThumbnailMinimized}
              >
                {isThumbnailMinimized ? <ChevronDown className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" /> : <ChevronUp className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />}
                <span>{isThumbnailMinimized ? '展开' : '收起'}</span>
              </button>
            </div>
            <div
              className="h-8 min-w-[12px] flex-1 cursor-grab rounded-md border border-transparent bg-transparent active:cursor-grabbing sm:h-9"
              aria-hidden="true"
            />
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

          {!isThumbnailMinimized && (
            <div className="p-1.5 sm:p-2">
              {effectiveImage ? (
                <button
                  type="button"
                  onClick={openEnlargedImagePreview}
                  className="group relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-purple-200/80 bg-purple-50 shadow-xs transition-transform active:scale-[0.99]"
                  title="点击放大查看原图"
                  aria-label="放大原图查看"
                >
                  <img
                    src={effectiveImage.src}
                    alt="原图参考"
                    className="max-h-[120px] w-auto max-w-full object-contain sm:max-h-[150px] lg:max-h-[180px]"
                  />
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-purple-950/70 p-2 text-[11px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <ZoomIn className="h-5 w-5 text-purple-200" />
                    点击放大原图
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex min-h-24 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-purple-300/90 bg-purple-50/70 p-2 text-center transition-colors hover:border-purple-500 hover:bg-purple-100/70 sm:min-h-28 sm:p-3"
                  title="点击上传图片做原图对照手动绘制"
                  aria-label="上传原图"
                >
                  <Upload className="mb-0.5 h-5 w-5 text-purple-600" />
                  <span className="text-[13px] font-extrabold text-purple-950">上传原图</span>
                  <span className="mt-0.5 text-[11px] font-medium text-purple-500">对照原图手动绘制</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="sm:hidden absolute top-2 right-2 z-20" data-canvas-interaction-ignore>
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

      {isReferenceSheetOpen && (
        <div className="sm:hidden fixed inset-0 z-[55] flex items-end bg-slate-950/35" data-canvas-interaction-ignore onClick={() => setIsReferenceSheetOpen(false)}>
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
                  onClick={() => setModalImageView(view => changeImagePreviewScale(view, -0.25))}
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
                  onClick={() => setModalImageView(view => changeImagePreviewScale(view, 0.25))}
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
                onPointerDown={handleModalImagePointerDown}
                onPointerMove={handleModalImagePointerMove}
                onPointerUp={stopModalImagePan}
                onPointerCancel={stopModalImagePan}
                onLostPointerCapture={stopModalImagePan}
                className="relative border border-purple-200/80 rounded-2xl overflow-hidden shadow-xl bg-[radial-gradient(#DDD6FE_1px,transparent_1px)] [background-size:16px_16px] max-w-full max-h-full flex items-center justify-center p-2 cursor-grab active:cursor-grabbing touch-none"
              >
                <img
                  src={effectiveImage.src}
                  alt="原图放大预览"
                  style={{
                    transform: `translate(${modalImageView.pan.x}px, ${modalImageView.pan.y}px) scale(${modalImageView.scale})`,
                    transformOrigin: 'center center',
                    transition: 'transform 0.15s ease-out'
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
