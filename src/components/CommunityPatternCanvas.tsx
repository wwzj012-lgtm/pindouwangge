import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { StoredPatternProject } from '../utils/patternGridCodec';
import './CommunityPatternCanvas.css';

type Selection = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };
type View = Point & { zoom: number };
type Gesture =
  | { kind: 'pan'; last: Point }
  | { kind: 'select'; anchor: Point }
  | { kind: 'pinch'; center: Point; distance: number };

export interface CommunityPatternCanvasProps {
  project: StoredPatternProject;
  highlightColorId?: string | null;
  selection?: { x: number; y: number; width: number; height: number } | null;
  onSelectionChange?: (selection: { x: number; y: number; width: number; height: number }) => void;
  maxSelectionSide?: number;
  selecting?: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const MAX_ZOOM = 64;
const PADDING = 20;

/** Display only: grid IDs, null cells and the author's palette stay untouched. */
export function CommunityPatternCanvas({
  project, highlightColorId = null, selection = null, onSelectionChange,
  maxSelectionSide, selecting = false,
}: CommunityPatternCanvasProps) {
  const { width, height, grid, palette } = project;
  const helpId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const viewRef = useRef<View>({ x: 0, y: 0, zoom: 1 });
  const [view, setView] = useState(viewRef.current);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [hover, setHover] = useState<Point | null>(null);
  const [draft, setDraft] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const colors = useMemo(() => new Map(palette.map(color => [color.id, color])), [palette]);
  const selectionLimit = Number.isFinite(maxSelectionSide)
    ? Math.max(1, Math.floor(maxSelectionSide!)) : Math.max(width, height);
  const fitZoom = Math.min(MAX_ZOOM, Math.max(0.001, Math.min(
    Math.max(1, size.width - PADDING * 2) / width,
    Math.max(1, size.height - PADDING * 2) / height,
  )));
  const minZoom = Math.max(0.001, fitZoom / 4);

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
  }, [view, size, pixels, highlightedPixels, grid, colors, width, height, highlightColorId, activeSelection]);

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
    } else gesture.current = { kind: 'pan', last: point };
  };
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = localPoint(event);
    if (!pointers.current.has(event.pointerId)) {
      if (pointers.current.size) return;
      const cell = cellAt(point);
      const next = cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height ? cell : null;
      setHover(current => current?.x === next?.x && current?.y === next?.y ? current : next);
      return;
    }
    pointers.current.set(event.pointerId, point);
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
    pointers.current.delete(event.pointerId);
    gesture.current = pointers.current.size ? { kind: 'pan', last: [...pointers.current.values()][0] } : null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!pointers.current.size) { setDragging(false); setDraft(null); }
  };

  const hoverId = hover ? grid[hover.y]?.[hover.x] ?? null : null;
  const hoverColor = hoverId === null ? null : colors.get(hoverId);
  return (
    <section className="community-pattern-canvas" aria-label="社区只读图纸">
      <div className="community-pattern-canvas__toolbar">
        <span className="community-pattern-canvas__dimensions">{width} × {height} 格 · 只读</span>
        <div className="community-pattern-canvas__controls" role="group" aria-label="图纸视图">
          <button type="button" aria-label="缩小图纸" disabled={view.zoom <= minZoom} onClick={() => zoomAt(1 / 1.3)}>−</button>
          <output className="community-pattern-canvas__zoom" aria-label="视图缩放">{Math.round(view.zoom / fitZoom * 100)}%</output>
          <button type="button" aria-label="放大图纸" disabled={view.zoom >= MAX_ZOOM} onClick={() => zoomAt(1.3)}>＋</button>
          <button type="button" aria-label="适应图纸" onClick={fit}>适应</button>
        </div>
      </div>
      <div ref={viewportRef} className="community-pattern-canvas__viewport">
        <canvas
          ref={canvasRef}
          className="community-pattern-canvas__surface"
          data-selecting={selecting || undefined}
          data-dragging={dragging || undefined}
          aria-label="只读网格图纸，可拖拽移动、缩放和框选副本区域"
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
        <span>{hover ? '列 ' + (hover.x + 1) + ' · 行 ' + (hover.y + 1) + ' · ' + (hoverColor ? hoverColor.code + ' (' + hoverColor.id + ')' : '空格') : '指向网格查看坐标与原色号'}</span>
        {activeSelection && <span>选区 {activeSelection.width} × {activeSelection.height} 格</span>}
      </div>
      <p id={helpId} className="community-pattern-canvas__help">
        拖拽移动 · 滚轮缩放 · 双指缩放
        {selecting ? '。单指拖拽框选副本（每边最多 ' + selectionLimit + ' 格）；Shift 或鼠标右键拖拽移动。' : '。放大至每格 22px 可查看原色号。'}
        框选仅用于独立副本，不修改原图。
      </p>
    </section>
  );
}
