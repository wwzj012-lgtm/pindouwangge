import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { StoredPatternProject } from '../utils/patternGridCodec';
import { practiceSectionLabel } from '../utils/practiceProgress';
import './CommunityPatternCanvas.css';

type Selection = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };
type View = Point & { zoom: number };
type Gesture =
  | { kind: 'pan'; last: Point }
  | { kind: 'select'; anchor: Point }
  | { kind: 'pinch'; center: Point; distance: number };

/** Viewport rect the workspace wants the canvas to frame (section focus, next bead, ...). */
export interface CommunityPatternFocusRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Incrementing counter: a new value re-applies the focus even for the same rect. */
  nonce: number;
  /** Preferred zoom for the focus; defaults to "fit the rect". Clamped to the view range. */
  zoom?: number;
  /** Dim everything outside the rect. Defaults to true; a single-bead focus opts out. */
  dim?: boolean;
}

export interface CommunityPatternCanvasProps {
  project: StoredPatternProject;
  highlightColorId?: string | null;
  selection?: { x: number; y: number; width: number; height: number } | null;
  onSelectionChange?: (selection: { x: number; y: number; width: number; height: number }) => void;
  maxSelectionSide?: number;
  selecting?: boolean;
  /** Section size in cells. 0 (or negative) disables sections, dashed guides and badges. */
  sectionSize?: number;
  /** Cells already placed, indexed by `y * width + x`. */
  doneCells?: ReadonlySet<number> | null;
  /** Click/tap a filled cell to toggle "placed". Omit to disable the interaction. */
  onToggleCell?: ((index: number) => void) | null;
  /** Undo the last placed bead (Ctrl/Cmd+Z while the canvas is focused). */
  onUndoCell?: (() => void) | null;
  focusRect?: CommunityPatternFocusRect | null;
  /** Dim everything outside `focusRect`. Defaults to true when a focus is active. */
  dimOutside?: boolean;
  /** Cell to flash briefly (purple ring) so the user can find it. */
  flashCell?: { x: number; y: number; nonce: number } | null;
  /** Cells outside this rect are dimmed while `focusRect` is active. */
  /**
   * Community patterns are read-only and crop-able. The user's own board/library is
   * neither: it is an "实操视图" that simply doesn't modify the original.
   */
  readOnlyView?: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const MAX_ZOOM = 64;
const PADDING = 20;
const RULER_SIZE = 18;
/** Below this cell size the per-cell "done" veil is invisible; skipping it keeps huge grids smooth. */
const DONE_MIN_CELL_PX = 1.5;
/** Hard cap on the per-frame cell loop: 900² fully zoomed out stays interactive. */
const DONE_MAX_VISIBLE_CELLS = 400_000;
const FLASH_DURATION_MS = 1200;

/** Ruler label spacing (in cells) for the current zoom. */
function rulerStep(zoom: number): number {
  if (zoom >= 22) return 1;
  if (zoom >= 8) return 5;
  if (zoom >= 3) return 10;
  return 20;
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.arcTo(x + width, y, x + width, y + r, r);
  context.lineTo(x + width, y + height - r);
  context.arcTo(x + width, y + height, x + width - r, y + height, r);
  context.lineTo(x + r, y + height);
  context.arcTo(x, y + height, x, y + height - r, r);
  context.lineTo(x, y + r);
  context.arcTo(x, y, x + r, y, r);
}

/** Display only: grid IDs, null cells and the author's palette stay untouched. */
export function CommunityPatternCanvas({
  project, highlightColorId = null, selection = null, onSelectionChange,
  maxSelectionSide, selecting = false, sectionSize = 0, doneCells = null,
  onToggleCell = null, onUndoCell = null, focusRect = null, dimOutside = true,
  flashCell = null, readOnlyView = true,
}: CommunityPatternCanvasProps) {
  const { width, height, grid, palette } = project;
  const helpId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const viewRef = useRef<View>({ x: 0, y: 0, zoom: 1 });
  const press = useRef<{ pointerId: number; point: Point; cell: Point | null; moved: boolean } | null>(null);
  const appliedFocus = useRef(0);
  const hadFocus = useRef(false);
  const [view, setView] = useState(viewRef.current);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [hover, setHover] = useState<Point | null>(null);
  const [draft, setDraft] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showRulers, setShowRulers] = useState(true);
  const [flashActive, setFlashActive] = useState(false);
  const colors = useMemo(() => new Map(palette.map(color => [color.id, color])), [palette]);
  const selectionLimit = Number.isFinite(maxSelectionSide)
    ? Math.max(1, Math.floor(maxSelectionSide!)) : Math.max(width, height);
  const fitZoom = Math.min(MAX_ZOOM, Math.max(0.001, Math.min(
    Math.max(1, size.width - PADDING * 2) / width,
    Math.max(1, size.height - PADDING * 2) / height,
  )));
  const minZoom = Math.max(0.001, fitZoom / 4);
  const sectionStep = sectionSize > 0 ? Math.floor(sectionSize) : 0;

  // One source pixel per cell, never a zoom-sized backing bitmap or cell DOM.
  const pixels = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const context = source.getContext('2d');
    if (!context) return null;
    const image = context.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const id = grid[y][x];
        const color = id === null ? undefined : colors.get(id);
        if (!color) continue;
        const offset = (y * width + x) * 4;
        image.data[offset] = color.rgb[0];
        image.data[offset + 1] = color.rgb[1];
        image.data[offset + 2] = color.rgb[2];
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    return source;
  }, [grid, colors, width, height]);

  const highlightedPixels = useMemo(() => {
    if (highlightColorId === null || !pixels) return null;
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const context = source.getContext('2d');
    if (!context) return null;
    const image = context.createImageData(width, height);
    const color = colors.get(highlightColorId);
    if (color) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (grid[y][x] !== highlightColorId) continue;
          const offset = (y * width + x) * 4;
          image.data[offset] = color.rgb[0];
          image.data[offset + 1] = color.rgb[1];
          image.data[offset + 2] = color.rgb[2];
          image.data[offset + 3] = 255;
        }
      }
    }
    context.putImageData(image, 0, 0);
    // White beads need a visible marker even below the grid-line threshold.
    // Tint only this disposable display mask, never the original pixel cache.
    context.globalCompositeOperation = 'source-atop';
    context.fillStyle = 'rgba(124, 58, 237, 0.23)';
    context.fillRect(0, 0, width, height);
    return source;
  }, [highlightColorId, pixels, colors, grid, width, height]);

  const boundView = useCallback((next: View): View => {
    const zoom = clamp(next.zoom, minZoom, MAX_ZOOM);
    const boundAxis = (position: number, paper: number, viewport: number) => {
      const visible = Math.min(32, paper, viewport / 2);
      return clamp(position, visible - paper, viewport - visible);
    };
    return {
      zoom,
      x: boundAxis(next.x, width * zoom, size.width),
      y: boundAxis(next.y, height * zoom, size.height),
    };
  }, [width, height, size, minZoom]);

  const updateView = useCallback((next: View) => {
    viewRef.current = boundView(next);
    setView(viewRef.current);
    setHover(null);
  }, [boundView]);

  const stopGesture = useCallback(() => {
    gesture.current = null;
    press.current = null;
    const captured = [...pointers.current.keys()];
    pointers.current.clear();
    for (const id of captured) {
      if (canvasRef.current?.hasPointerCapture(id)) canvasRef.current.releasePointerCapture(id);
    }
    setDraft(null);
    setDragging(false);
  }, []);

  const fit = useCallback(() => {
    stopGesture();
    updateView({ zoom: fitZoom, x: (size.width - width * fitZoom) / 2, y: (size.height - height * fitZoom) / 2 });
  }, [stopGesture, updateView, fitZoom, size, width, height]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      if (width && height) setSize(current => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { fit(); }, [fit, grid]);
  useEffect(() => { stopGesture(); }, [selecting, stopGesture]);
  useEffect(() => {
    window.addEventListener('blur', stopGesture);
    return () => window.removeEventListener('blur', stopGesture);
  }, [stopGesture]);

  const zoomAt = useCallback((factor: number, anchor: Point = { x: size.width / 2, y: size.height / 2 }) => {
    const current = viewRef.current;
    const zoom = clamp(current.zoom * factor, minZoom, MAX_ZOOM);
    updateView({ zoom, x: anchor.x - (anchor.x - current.x) * zoom / current.zoom, y: anchor.y - (anchor.y - current.y) * zoom / current.zoom });
  }, [size, minZoom, updateView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (gesture.current) return;
      const rect = canvas.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
      zoomAt(Math.exp(-clamp(delta, -300, 300) * 0.002), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => canvas.removeEventListener('wheel', wheel);
  }, [zoomAt, size.height]);

  // Section focus: frame the requested rect once per nonce, after the viewport is measured.
  useEffect(() => {
    if (!focusRect) {
      if (!hadFocus.current) return;
      hadFocus.current = false;
      appliedFocus.current = 0;
      fit();
      return;
    }
    if (size.width <= 1 || size.height <= 1) return;
    if (appliedFocus.current === focusRect.nonce) return;
    appliedFocus.current = focusRect.nonce;
    hadFocus.current = true;
    const requested = typeof focusRect.zoom === 'number' && focusRect.zoom > 0
      ? focusRect.zoom
      : Math.min(
        Math.max(1, size.width - PADDING * 2) / Math.max(1, focusRect.width),
        Math.max(1, size.height - PADDING * 2) / Math.max(1, focusRect.height),
      );
    const zoom = clamp(requested, minZoom, MAX_ZOOM);
    updateView({
      zoom,
      x: size.width / 2 - (focusRect.x + focusRect.width / 2) * zoom,
      y: size.height / 2 - (focusRect.y + focusRect.height / 2) * zoom,
    });
  }, [focusRect, size, minZoom, updateView, fit]);

  // A new flash target restarts the highlight timer, so repeated "next bead" clicks stay visible.
  // Reduced-motion users get the instant jump without the blinking ring.
  useEffect(() => {
    if (!flashCell) return;
    const reduceMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setFlashActive(false);
      return;
    }
    setFlashActive(true);
    const timer = window.setTimeout(() => setFlashActive(false), FLASH_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [flashCell]);

  const activeSelection = draft ?? selection;
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context || !pixels) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const backingWidth = Math.max(1, Math.round(size.width * dpr));
      const backingHeight = Math.max(1, Math.round(size.height * dpr));
      if (canvas.width !== backingWidth) canvas.width = backingWidth;
      if (canvas.height !== backingHeight) canvas.height = backingHeight;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, size.width, size.height);
      const { x, y, zoom } = view;
      const left = clamp(Math.floor(-x / zoom), 0, width);
      const top = clamp(Math.floor(-y / zoom), 0, height);
      const right = clamp(Math.ceil((size.width - x) / zoom), 0, width);
      const bottom = clamp(Math.ceil((size.height - y) / zoom), 0, height);
      context.fillStyle = '#eee9f3';
      context.fillRect(x, y, width * zoom, height * zoom);
      context.imageSmoothingEnabled = false;
      const drawPixels = (source: HTMLCanvasElement) => {
        if (right > left && bottom > top) context.drawImage(source, left, top, right - left, bottom - top, x + left * zoom, y + top * zoom, (right - left) * zoom, (bottom - top) * zoom);
      };
      context.globalAlpha = highlightColorId === null ? 1 : 0.18;
      drawPixels(pixels);
      context.globalAlpha = 1;
      if (highlightedPixels) drawPixels(highlightedPixels);
      if (zoom >= 6) {
        context.beginPath();
        for (let col = left; col <= right; col++) {
          context.moveTo(x + col * zoom, y + top * zoom);
          context.lineTo(x + col * zoom, y + bottom * zoom);
        }
        for (let row = top; row <= bottom; row++) {
          context.moveTo(x + left * zoom, y + row * zoom);
          context.lineTo(x + right * zoom, y + row * zoom);
        }
        context.strokeStyle = 'rgba(72, 51, 92, 0.22)';
        context.lineWidth = 0.75;
        context.stroke();
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.font = '600 ' + Math.min(13, zoom * 0.31) + 'px system-ui, sans-serif';
        for (let row = top; row < bottom; row++) {
          for (let col = left; col < right; col++) {
            const id = grid[row][col];
            const color = id === null ? undefined : colors.get(id);
            const cellX = x + col * zoom;
            const cellY = y + row * zoom;
            if (!color) {
              context.fillStyle = 'rgba(112, 88, 137, 0.35)';
              context.fillRect(cellX + zoom / 2 - 0.75, cellY + zoom / 2 - 0.75, 1.5, 1.5);
            } else {
              if (id === highlightColorId) {
                context.strokeStyle = '#7c3aed';
                context.lineWidth = 1.5;
                context.strokeRect(cellX + 2, cellY + 2, zoom - 4, zoom - 4);
              }
              if (zoom < 22) continue;
              const [r, g, b] = color.rgb;
              context.fillStyle = r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#261735' : '#fff';
              context.globalAlpha = highlightColorId !== null && id !== highlightColorId ? 0.3 : 1;
              context.fillText(color.code, cellX + zoom / 2, cellY + zoom / 2, zoom - 4);
              context.globalAlpha = 1;
            }
          }
        }
      }
      context.strokeStyle = '#9e8bb1';
      context.lineWidth = 1.5;
      context.strokeRect(x, y, width * zoom, height * zoom);

      // ---- Placed cells: one batched veil path + one batched checkmark path. No DOM, no cache rebuild.
      if (doneCells && doneCells.size > 0 && zoom >= DONE_MIN_CELL_PX
        && (right - left) * (bottom - top) <= DONE_MAX_VISIBLE_CELLS) {
        context.beginPath();
        for (let row = top; row < bottom; row++) {
          const rowBase = row * width;
          const cellY = y + row * zoom;
          for (let col = left; col < right; col++) {
            if (!doneCells.has(rowBase + col)) continue;
            context.rect(x + col * zoom, cellY, zoom, zoom);
          }
        }
        context.fillStyle = 'rgba(255, 255, 255, 0.62)';
        context.fill();
        if (zoom >= 10) {
          context.beginPath();
          for (let row = top; row < bottom; row++) {
            const rowBase = row * width;
            const cellY = y + row * zoom;
            for (let col = left; col < right; col++) {
              if (!doneCells.has(rowBase + col)) continue;
              const cellX = x + col * zoom;
              context.moveTo(cellX + zoom * 0.28, cellY + zoom * 0.54);
              context.lineTo(cellX + zoom * 0.44, cellY + zoom * 0.7);
              context.lineTo(cellX + zoom * 0.74, cellY + zoom * 0.34);
            }
          }
          context.strokeStyle = '#16a34a';
          context.lineWidth = Math.max(1, Math.min(2.6, zoom * 0.1));
          context.lineCap = 'round';
          context.lineJoin = 'round';
          context.stroke();
          context.lineCap = 'butt';
          context.lineJoin = 'miter';
        }
      }

      // ---- Section guides (dashed) + A1/B3 badges, in screen space at fixed 10px type.
      if (sectionStep > 0) {
        const stepPx = sectionStep * zoom;
        const columnLimit = Math.min(right, width);
        const rowLimit = Math.min(bottom, height);
        context.save();
        context.strokeStyle = 'rgba(109, 40, 217, 0.45)';
        context.lineWidth = 1;
        context.setLineDash([4, 3]);
        context.beginPath();
        // Inner boundaries only: the outer frame is already stroked above.
        for (let col = Math.ceil(left / sectionStep) * sectionStep; col <= columnLimit; col += sectionStep) {
          if (col <= 0 || col >= width) continue;
          context.moveTo(x + col * zoom, y + top * zoom);
          context.lineTo(x + col * zoom, y + bottom * zoom);
        }
        for (let row = Math.ceil(top / sectionStep) * sectionStep; row <= rowLimit; row += sectionStep) {
          if (row <= 0 || row >= height) continue;
          context.moveTo(x + left * zoom, y + row * zoom);
          context.lineTo(x + right * zoom, y + row * zoom);
        }
        context.stroke();
        context.restore();
        // Below ~4px per cell the badges smear into noise, so they start at zoom 4.
        if (zoom >= 4) {
          const firstCol = Math.floor(left / sectionStep);
          const lastCol = Math.max(firstCol, Math.ceil(right / sectionStep) - 1);
          const firstRow = Math.floor(top / sectionStep);
          const lastRow = Math.max(firstRow, Math.ceil(bottom / sectionStep) - 1);
          const minX = showRulers ? RULER_SIZE : 0;
          const minY = showRulers ? RULER_SIZE : 0;
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          for (let row = firstRow; row <= lastRow; row++) {
            for (let col = firstCol; col <= lastCol; col++) {
              const badgeX = Math.max(minX, x + col * stepPx) + 3;
              const badgeY = Math.max(minY, y + row * stepPx) + 3;
              if (badgeX > size.width - 26 || badgeY > size.height - 18) continue;
              const label = practiceSectionLabel(col, row);
              context.font = '600 10px system-ui, sans-serif';
              // 10px type with 1px / 4px padding inside a 4px-rounded 85%-white chip.
              const badgeWidth = Math.min(34, context.measureText(label).width + 9);
              context.beginPath();
              roundedRectPath(context, badgeX, badgeY, badgeWidth, 14, 4);
              context.fillStyle = 'rgba(255, 255, 255, 0.85)';
              context.fill();
              context.strokeStyle = 'rgba(109, 40, 217, 0.3)';
              context.lineWidth = 1;
              context.stroke();
              context.fillStyle = '#5b21b6';
              context.fillText(label, badgeX + badgeWidth / 2, badgeY + 7.5);
            }
          }
        }
      }

      // ---- Focus veil: everything outside the focused section fades, inside stays readable.
      if (focusRect && dimOutside && (focusRect.dim ?? true)) {
        const focusX = x + focusRect.x * zoom;
        const focusY = y + focusRect.y * zoom;
        const focusWidth = focusRect.width * zoom;
        const focusHeight = focusRect.height * zoom;
        context.save();
        context.beginPath();
        context.rect(0, 0, size.width, size.height);
        context.rect(focusX, focusY, focusWidth, focusHeight);
        context.fillStyle = 'rgba(255, 255, 255, 0.55)';
        context.fill('evenodd');
        context.restore();
      }

      // ---- Flash ring for "locate next bead" (self-expiring, never a DOM node).
      if (flashActive && flashCell) {
        const cellX = x + flashCell.x * zoom;
        const cellY = y + flashCell.y * zoom;
        context.strokeStyle = '#7c3aed';
        context.lineWidth = 2.5;
        context.strokeRect(cellX - 2, cellY - 2, zoom + 4, zoom + 4);
      }

      // ---- Rulers: pinned to the viewport edges, drawn last so nothing covers them.
      if (showRulers) {
        const step = rulerStep(zoom);
        const firstCol = Math.max(0, Math.ceil(left / step) * step);
        const firstRow = Math.max(0, Math.ceil(top / step) * step);
        context.fillStyle = 'rgba(255, 255, 255, 0.86)';
        context.fillRect(0, 0, size.width, RULER_SIZE);
        context.fillRect(0, 0, RULER_SIZE, size.height);
        context.strokeStyle = 'rgba(109, 40, 217, 0.18)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(0, RULER_SIZE - 0.5);
        context.lineTo(size.width, RULER_SIZE - 0.5);
        context.moveTo(RULER_SIZE - 0.5, 0);
        context.lineTo(RULER_SIZE - 0.5, size.height);
        context.stroke();
        // 10px monospace keeps digits tabular (fixed advance) so numbers never jitter.
        const fontSize = 10;
        const rulerFont = (weight: number) => `${weight} ${fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
        context.textBaseline = 'middle';
        context.font = rulerFont(500);
        for (let col = firstCol; col <= Math.min(right, width - 1); col += step) {
          const px = x + col * zoom;
          if (px < RULER_SIZE + 1 || px > size.width - 2) continue;
          const label = col + 1;
          // Decade starts read purple; the origin and every 5th mark read bold.
          const decade = label === 1 || label % 10 === 0;
          const bold = decade || label % 5 === 0;
          context.fillStyle = decade ? '#6d28d9' : '#4c1d95';
          context.font = rulerFont(bold ? 700 : 500);
          context.textAlign = 'left';
          context.fillText(String(label), px + 2, RULER_SIZE / 2);
        }
        for (let row = firstRow; row <= Math.min(bottom, height - 1); row += step) {
          const py = y + row * zoom;
          if (py < RULER_SIZE + 1 || py > size.height - 2) continue;
          const label = row + 1;
          const decade = label === 1 || label % 10 === 0;
          const bold = decade || label % 5 === 0;
          context.fillStyle = decade ? '#6d28d9' : '#4c1d95';
          context.font = rulerFont(bold ? 700 : 500);
          context.textAlign = 'left';
          context.fillText(String(label), 2, py + fontSize / 2 + 1);
        }
        context.textAlign = 'center';
      }

      if (activeSelection) {
        const startX = clamp(activeSelection.x, 0, width);
        const startY = clamp(activeSelection.y, 0, height);
        const endX = clamp(activeSelection.x + activeSelection.width, startX, width);
        const endY = clamp(activeSelection.y + activeSelection.height, startY, height);
        context.fillStyle = 'rgba(124, 58, 237, 0.16)';
        context.fillRect(x + startX * zoom, y + startY * zoom, (endX - startX) * zoom, (endY - startY) * zoom);
        context.strokeStyle = '#6d28d9';
        context.lineWidth = 2;
        context.setLineDash([6, 3]);
        context.strokeRect(x + startX * zoom, y + startY * zoom, (endX - startX) * zoom, (endY - startY) * zoom);
        context.setLineDash([]);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [
    view, size, pixels, highlightedPixels, grid, colors, width, height, highlightColorId,
    activeSelection, doneCells, sectionStep, showRulers, focusRect, dimOutside, flashActive, flashCell,
  ]);

  const localPoint = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const cellAt = (point: Point): Point => ({
    x: Math.floor((point.x - viewRef.current.x) / viewRef.current.zoom),
    y: Math.floor((point.y - viewRef.current.y) / viewRef.current.zoom),
  });
  const boundedCell = (point: Point): Point => {
    const cell = cellAt(point);
    return { x: clamp(cell.x, 0, width - 1), y: clamp(cell.y, 0, height - 1) };
  };
  const cellInside = (cell: Point): boolean =>
    cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height;
  const emitSelection = (anchor: Point, point: Point) => {
    const cell = boundedCell(point);
    const endX = clamp(cell.x, anchor.x - selectionLimit + 1, anchor.x + selectionLimit - 1);
    const endY = clamp(cell.y, anchor.y - selectionLimit + 1, anchor.y + selectionLimit - 1);
    const next = { x: Math.min(anchor.x, endX), y: Math.min(anchor.y, endY), width: Math.abs(endX - anchor.x) + 1, height: Math.abs(endY - anchor.y) + 1 };
    setDraft(next);
    onSelectionChange?.(next);
  };
  const pinch = (): Extract<Gesture, { kind: 'pinch' }> => {
    const [a, b] = [...pointers.current.values()];
    return { kind: 'pinch', center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  };
  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if ((event.button !== 0 && event.button !== 2) || pointers.current.size >= 2) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const point = localPoint(event);
    pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    if (pointers.current.size === 2) {
      gesture.current = pinch();
      press.current = null;
      setDraft(null);
      setHover(null);
    } else if (selecting && !event.shiftKey && event.button !== 2) {
      const cell = cellAt(point);
      if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height) {
        gesture.current = { kind: 'pan', last: point };
        return;
      }
      gesture.current = { kind: 'select', anchor: cell };
      // The first finger of a pinch must not emit a one-cell crop.
      if (event.pointerType !== 'touch') emitSelection(cell, point);
    } else {
      gesture.current = { kind: 'pan', last: point };
      // Press-to-toggle candidate: only a <4px release counts as a "placed bead" tap.
      // The rulers are a screen-space overlay pinned over real cells, so a press under
      // them must never mark a bead the user cannot see.
      const overRuler = showRulers && (point.x < RULER_SIZE || point.y < RULER_SIZE);
      if (onToggleCell && event.button === 0 && !overRuler) {
        const cell = cellAt(point);
        press.current = { pointerId: event.pointerId, point, cell: cellInside(cell) ? cell : null, moved: false };
      }
    }
  };
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = localPoint(event);
    if (!pointers.current.has(event.pointerId)) {
      if (pointers.current.size) return;
      const cell = cellAt(point);
      const next = cellInside(cell) ? cell : null;
      setHover(current => current?.x === next?.x && current?.y === next?.y ? current : next);
      return;
    }
    pointers.current.set(event.pointerId, point);
    const pending = press.current;
    if (pending && pending.pointerId === event.pointerId && !pending.moved
      && Math.hypot(point.x - pending.point.x, point.y - pending.point.y) >= 4) {
      pending.moved = true;
    }
    const active = gesture.current;
    if (active?.kind === 'pinch' && pointers.current.size === 2) {
      const next = pinch();
      const current = viewRef.current;
      const zoom = clamp(current.zoom * next.distance / active.distance, minZoom, MAX_ZOOM);
      updateView({ zoom, x: next.center.x - (active.center.x - current.x) * zoom / current.zoom, y: next.center.y - (active.center.y - current.y) * zoom / current.zoom });
      gesture.current = next;
    } else if (active?.kind === 'pan') {
      updateView({ ...viewRef.current, x: viewRef.current.x + point.x - active.last.x, y: viewRef.current.y + point.y - active.last.y });
      gesture.current = { kind: 'pan', last: point };
    } else if (active?.kind === 'select') {
      emitSelection(active.anchor, point);
      setHover(boundedCell(point));
    }
  };
  const pointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    if (gesture.current?.kind === 'select' && event.type === 'pointerup') {
      emitSelection(gesture.current.anchor, localPoint(event));
    }
    // Tap to toggle "placed": practice mode only, single pointer, no drag, filled cell.
    const pending = press.current;
    if (pending && pending.pointerId === event.pointerId && event.type === 'pointerup'
      && !pending.moved && pointers.current.size === 1 && pending.cell && onToggleCell) {
      const { x: cellX, y: cellY } = pending.cell;
      if (grid[cellY]?.[cellX] != null) onToggleCell(cellY * width + cellX);
    }
    press.current = null;
    pointers.current.delete(event.pointerId);
    gesture.current = pointers.current.size ? { kind: 'pan', last: [...pointers.current.values()][0] } : null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!pointers.current.size) { setDragging(false); setDraft(null); }
  };

  const hoverId = hover ? grid[hover.y]?.[hover.x] ?? null : null;
  const hoverColor = hoverId === null ? null : colors.get(hoverId);
  const interactive = Boolean(onToggleCell) && !selecting;
  const hoverPlaced = hover && doneCells ? doneCells.has(hover.y * width + hover.x) : false;
  const hoverSection = hover && sectionStep > 0 && interactive
    ? practiceSectionLabel(Math.floor(hover.x / sectionStep), Math.floor(hover.y / sectionStep))
    : null;
  // Progress lives in the practice panel only; this slot stays a pointer readout.
  const hoverText = hover
    ? '列 ' + (hover.x + 1) + ' · 行 ' + (hover.y + 1) + ' · ' + (hoverColor ? hoverColor.code + ' (' + hoverColor.id + ')' : '空格')
      + (hoverSection ? ' · 所在区块 ' + hoverSection : '')
      + (interactive ? (hoverPlaced ? ' · 已拼' : ' · 未拼') : '')
    : '指向网格查看坐标与原色号';
  return (
    <section className="community-pattern-canvas" aria-label={readOnlyView ? '社区只读图纸' : '图纸实操视图'}
      data-sections={sectionStep > 0 ? sectionStep : undefined}>
      <div className="community-pattern-canvas__toolbar">
        <span className="community-pattern-canvas__dimensions">{width} × {height} 格 · {readOnlyView ? '只读' : '实操视图'}</span>
        <div className="community-pattern-canvas__controls" role="group" aria-label="图纸视图">
          <button type="button" aria-label="缩小图纸" disabled={view.zoom <= minZoom} onClick={() => zoomAt(1 / 1.3)}>−</button>
          <output className="community-pattern-canvas__zoom" aria-label="视图缩放">{Math.round(view.zoom / fitZoom * 100)}%</output>
          <button type="button" aria-label="放大图纸" disabled={view.zoom >= MAX_ZOOM} onClick={() => zoomAt(1.3)}>＋</button>
          <button type="button" aria-label="适应图纸" onClick={fit}>适应</button>
          <button type="button" aria-label={showRulers ? '隐藏行列坐标标尺' : '显示行列坐标标尺'} aria-pressed={showRulers} data-active={showRulers || undefined} onClick={() => setShowRulers(value => !value)}>坐标</button>
        </div>
      </div>
      <div ref={viewportRef} className="community-pattern-canvas__viewport">
        <canvas
          ref={canvasRef}
          className="community-pattern-canvas__surface"
          data-selecting={selecting || undefined}
          data-dragging={dragging || undefined}
          data-practice={interactive || undefined}
          aria-label={(readOnlyView ? '只读网格图纸，' : '网格图纸，')
            + (interactive ? '点击豆格记录已拼，可拖拽移动、缩放' : '可拖拽移动、缩放和框选副本区域')}
          aria-describedby={helpId}
          tabIndex={0}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerEnd}
          onPointerCancel={pointerEnd}
          onLostPointerCapture={pointerEnd}
          onPointerLeave={() => setHover(null)}
          onContextMenu={event => event.preventDefault()}
          onKeyDown={event => {
            if (onUndoCell && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey
              && (event.key === 'z' || event.key === 'Z')) {
              event.preventDefault();
              onUndoCell();
              return;
            }
            if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomAt(1.3); }
            else if (event.key === '-') { event.preventDefault(); zoomAt(1 / 1.3); }
            else if (event.key === '0') { event.preventDefault(); fit(); }
            else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
              event.preventDefault();
              updateView({ ...viewRef.current, x: viewRef.current.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0), y: viewRef.current.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) });
            }
          }}
        >浏览器需支持 Canvas 才能查看原始图纸。</canvas>
      </div>
      <div className="community-pattern-canvas__status">
        <span>{hoverText}</span>
        {activeSelection && <span>选区 {activeSelection.width} × {activeSelection.height} 格</span>}
      </div>
      <p id={helpId} className="community-pattern-canvas__help">
        拖拽移动 · 滚轮缩放 · 双指缩放
        {selecting ? '。单指拖拽框选副本（每边最多 ' + selectionLimit + ' 格）；Shift 或鼠标右键拖拽移动。' : '。放大至每格 22px 可查看原色号。'}
        {interactive ? '点击豆格记录「已拼」，空格子不计数。' : ''}
        {readOnlyView ? '框选仅用于独立副本，不修改原图。' : '只记录已拼进度，不修改原图纸。'}
      </p>
    </section>
  );
}
