import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Grid2X2, Maximize2, Minus, Move, Plus, RotateCcw, ScanSearch, SquareDashed } from 'lucide-react';
import { clampCanvasViewport } from '../utils/canvasViewport';
import {
  clipRecognitionRegion,
  deriveAlignedCalibration,
  moveGridAlignment,
  resizeGridAlignment,
  type ImportGridAlignment,
  type ImportRecognitionRegion,
} from '../utils/importGridAlignment';
import { warpOffsetAt } from '../utils/importGridWarp';

type Tool = 'grid' | 'pan' | 'region' | 'legend';
type Point = { x: number; y: number };
type View = Point & { zoom: number };
type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Edge = 'n' | 's' | 'e' | 'w';
type BoxHandle = Corner | Edge;
type DragMode = 'pan' | 'grid' | 'pitch' | 'draw' | 'region' | 'legendDraw' | BoxHandle;
interface Drag {
  pointerId: number;
  mode: DragMode;
  start: Point;
  alignment: ImportGridAlignment;
  region: ImportRecognitionRegion;
  view: View;
}

/** 图例区域（图像像素坐标，含端点）。与 importLegend 的 LegendFrameRect 同构。 */
export interface LegendRegionRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Props {
  image: HTMLImageElement;
  alignment: ImportGridAlignment;
  region: ImportRecognitionRegion;
  onAlignmentChange: (alignment: ImportGridAlignment) => void;
  onRegionChange: (region: ImportRecognitionRegion) => void;
  readOnly?: boolean;
  /** 用户框选的图例区域；null = 未框选。 */
  legendRegion?: LegendRegionRect | null;
  onLegendRegionChange?: (region: LegendRegionRect | null) => void;
  /** 外部请求切入的工具（如面板「框选图例区域」按钮）；undefined = 不接管。 */
  requestedTool?: Tool;
  /** 内部工具切换回调（供外部同步「框选模式已退出」等状态）。 */
  onToolChange?: (tool: Tool) => void;
}

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];
const CORNER_LABELS = { nw: '左上', ne: '右上', sw: '左下', se: '右下' };
const EDGES: Edge[] = ['n', 's', 'e', 'w'];
const EDGE_LABELS = { n: '上', s: '下', e: '右', w: '左' };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** All edits use original image pixels; view transforms never enter recognition. */
export function ImportGridAlignmentCanvas({ image, alignment, region, onAlignmentChange, onRegionChange, readOnly = false, legendRegion = null, onLegendRegionChange, requestedTool, onToolChange }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);
  const [internalTool, setInternalTool] = useState<Tool>('grid');
  const tool = requestedTool ?? internalTool;
  const setTool = useCallback((next: Tool) => {
    setInternalTool(next);
    onToolChange?.(next);
  }, [onToolChange]);
  const [activeDrag, setActiveDrag] = useState(false);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [size, setSize] = useState({ width: 1, height: 1 });
  const dimensions = useMemo(() => ({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height }), [image]);
  const derived = useMemo(() => deriveAlignedCalibration(alignment, region, dimensions), [alignment, region, dimensions]);
  const fitZoom = Math.max(0.001, Math.min(Math.max(1, size.width - 40) / dimensions.width, Math.max(1, size.height - 40) / dimensions.height));
  const boundView = useCallback((next: View) => clampCanvasViewport(next, size, dimensions), [size, dimensions]);
  const fit = useCallback(() => setView(boundView({ zoom: fitZoom, x: 0, y: 0 })), [boundView, fitZoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const rect = viewport.getBoundingClientRect();
      setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { fit(); }, [fit]);
  useEffect(() => {
    const clearSpace = () => { spaceRef.current = false; };
    window.addEventListener('keyup', clearSpace);
    window.addEventListener('blur', clearSpace);
    return () => { window.removeEventListener('keyup', clearSpace); window.removeEventListener('blur', clearSpace); };
  }, []);

  const zoomAt = useCallback((factor: number, x = size.width / 2, y = size.height / 2) => {
    setView(current => {
      const zoom = clamp(current.zoom * factor, Math.min(0.001, fitZoom), 64);
      return boundView({ zoom, x: x - (x - current.x) * zoom / current.zoom, y: y - (y - current.y) * zoom / current.zoom });
    });
  }, [boundView, fitZoom, size]);

  // Keep a phase-equivalent calibration block accessible after panning. Rebasing
  // is display-only until a handle is grabbed; it never clips the lattice phase.
  const block = useMemo(() => {
    if (dragRef.current?.mode === 'grid' || dragRef.current?.mode === 'pitch') return alignment;
    const pitch = alignment.cellSize;
    const chooseOrigin = (origin: number, pan: number, viewport: number, imageSize: number) => {
      const left = Math.max(0, -pan / view.zoom);
      const right = Math.min(imageSize, (viewport - pan) / view.zoom);
      const lower = left + Math.min(26 / view.zoom, Math.max(0, right - left) / 4);
      const upper = right - 3 * pitch - Math.min(26 / view.zoom, Math.max(0, right - left) / 4);
      if (lower <= upper) {
        const first = Math.ceil((lower - origin) / pitch);
        const last = Math.floor((upper - origin) / pitch);
        if (first <= last) return origin + clamp(0, first, last) * pitch;
      }
      return origin + Math.round(((left + right - 3 * pitch) / 2 - origin) / pitch) * pitch;
    };
    return { ...alignment, originX: chooseOrigin(alignment.originX, view.x, size.width, dimensions.width), originY: chooseOrigin(alignment.originY, view.y, size.height, dimensions.height) };
  }, [alignment, view, size, dimensions, activeDrag]);

  const toScreen = (point: Point) => ({ x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y });
  const blockStart = toScreen({ x: block.originX, y: block.originY });
  const blockEnd = toScreen({ x: block.originX + 3 * block.cellSize, y: block.originY + 3 * block.cellSize });
  // Small source grids still get two independent 44px touch targets. Leader
  // lines tie offset controls to the true corners without changing geometry.
  const handleOffset = Math.max(0, (66 - 3 * block.cellSize * view.zoom) / 2);
  const keepHandleVisible = (point: Point) => ({ x: clamp(point.x, 25, Math.max(25, size.width - 25)), y: clamp(point.y, 25, Math.max(25, size.height - 25)) });
  const redHandle = keepHandleVisible({ x: blockStart.x - handleOffset, y: blockStart.y - handleOffset });
  const blueHandle = keepHandleVisible({ x: blockEnd.x + handleOffset, y: blockEnd.y + handleOffset });
  const sparseStride = Math.max(1, Math.ceil(6 / (alignment.cellSize * view.zoom)));

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (dragRef.current || event.deltaY === 0) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
      const factor = Math.exp(-clamp(delta, -200, 200) * 0.002);
      // Wheel/trackpad always zooms the preview; the blue drag handle changes pitch.
      const rect = viewport.getBoundingClientRect();
      zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top);
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [readOnly, size.height, zoomAt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(size.width * dpr));
    canvas.height = Math.max(1, Math.round(size.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.zoom, view.zoom);
    ctx.imageSmoothingEnabled = view.zoom < 1;
    ctx.drawImage(image, 0, 0, dimensions.width, dimensions.height);
    ctx.beginPath();
    ctx.rect(0, 0, dimensions.width, dimensions.height);
    ctx.clip();

    const roi = derived.region;
    ctx.fillStyle = 'rgba(24, 19, 36, .30)';
    ctx.beginPath();
    ctx.rect(0, 0, dimensions.width, dimensions.height);
    ctx.rect(roi.x, roi.y, roi.width, roi.height);
    ctx.fill('evenodd');
    const calibration = derived.calibration;
    if (calibration) {
      ctx.fillStyle = 'rgba(52, 211, 153, .16)';
      ctx.fillRect(calibration.originX, calibration.originY, calibration.columns * calibration.cellWidth, calibration.rows * calibration.cellHeight);
    }

    // Draw only visible lines and a bounded display density. All source cells
    // remain real cells, including those whose line is skipped at small zoom.
    const left = Math.max(0, -view.x / view.zoom);
    const top = Math.max(0, -view.y / view.zoom);
    const right = Math.min(dimensions.width, (size.width - view.x) / view.zoom);
    const bottom = Math.min(dimensions.height, (size.height - view.y) / view.zoom);
    const pitch = alignment.cellSize;
    const phaseX = ((alignment.originX % pitch) + pitch) % pitch;
    const phaseY = ((alignment.originY % pitch) + pitch) % pitch;
    ctx.beginPath();
    ctx.lineWidth = 0.85 / view.zoom;
    ctx.strokeStyle = 'rgba(6, 182, 212, .8)';
    const warp = alignment.warp;
    if (warp) {
      // 分区相位场启用时画弯曲网格线：每条线沿轴逐格采样偏移后连线
      const stride = Math.max(1, sparseStride);
      for (let k = Math.ceil((left - phaseX) / pitch / stride) * stride; phaseX + k * pitch <= right; k += stride) {
        const x = phaseX + k * pitch;
        const firstY = Math.max(top, phaseY + Math.ceil((top - phaseY) / pitch) * pitch);
        let moved = false;
        for (let y = firstY; y <= bottom + pitch * 0.5; y += pitch) {
          const off = warpOffsetAt(warp, x, y);
          const px = x + off.dx;
          const py = y + off.dy;
          if (!moved) { ctx.moveTo(px, py); moved = true; } else ctx.lineTo(px, py);
        }
      }
      for (let k = Math.ceil((top - phaseY) / pitch / stride) * stride; phaseY + k * pitch <= bottom; k += stride) {
        const y = phaseY + k * pitch;
        const firstX = Math.max(left, phaseX + Math.ceil((left - phaseX) / pitch) * pitch);
        let moved = false;
        for (let x = firstX; x <= right + pitch * 0.5; x += pitch) {
          const off = warpOffsetAt(warp, x, y);
          const px = x + off.dx;
          const py = y + off.dy;
          if (!moved) { ctx.moveTo(px, py); moved = true; } else ctx.lineTo(px, py);
        }
      }
    } else {
      for (let k = Math.ceil((left - phaseX) / pitch / sparseStride) * sparseStride; phaseX + k * pitch <= right; k += sparseStride) {
        const x = phaseX + k * pitch;
        ctx.moveTo(x, top); ctx.lineTo(x, bottom);
      }
      for (let k = Math.ceil((top - phaseY) / pitch / sparseStride) * sparseStride; phaseY + k * pitch <= bottom; k += sparseStride) {
        const y = phaseY + k * pitch;
        ctx.moveTo(left, y); ctx.lineTo(right, y);
      }
    }
    ctx.stroke();
    if (calibration) {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2 / view.zoom;
      ctx.strokeRect(calibration.originX, calibration.originY, calibration.columns * pitch, calibration.rows * pitch);
    }

    if (!readOnly && tool === 'grid') {
      const side = block.cellSize * 3;
      ctx.fillStyle = 'rgba(34, 211, 238, .26)';
      ctx.fillRect(block.originX, block.originY, side, side);
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 2 / view.zoom;
      ctx.strokeRect(block.originX, block.originY, side, side);
      ctx.beginPath();
      for (let k = 1; k < 3; k++) {
        ctx.moveTo(block.originX + k * pitch, block.originY); ctx.lineTo(block.originX + k * pitch, block.originY + side);
        ctx.moveTo(block.originX, block.originY + k * pitch); ctx.lineTo(block.originX + side, block.originY + k * pitch);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4 / view.zoom;
    ctx.strokeRect(roi.x, roi.y, roi.width, roi.height);
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 2 / view.zoom;
    ctx.setLineDash([7 / view.zoom, 4 / view.zoom]);
    ctx.strokeRect(roi.x, roi.y, roi.width, roi.height);
    ctx.setLineDash([]);
    if (legendRegion) {
      const lx0 = Math.min(legendRegion.x0, legendRegion.x1);
      const ly0 = Math.min(legendRegion.y0, legendRegion.y1);
      const lw = Math.abs(legendRegion.x1 - legendRegion.x0);
      const lh = Math.abs(legendRegion.y1 - legendRegion.y0);
      ctx.fillStyle = 'rgba(139, 92, 246, .12)';
      ctx.fillRect(lx0, ly0, lw, lh);
      ctx.strokeStyle = '#8b5cf6';
      ctx.lineWidth = 2 / view.zoom;
      ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
      ctx.strokeRect(lx0, ly0, lw, lh);
      ctx.setLineDash([]);
    }
    ctx.restore();

    if (!readOnly && tool === 'grid') {
      for (const [from, to, color] of [[blockStart, redHandle, '#ef4444'], [blockEnd, blueHandle, '#2563eb']] as const) {
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke();
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      }
    }
  }, [image, alignment, block, derived, dimensions, view, size, sparseStride, tool, readOnly, legendRegion, blockStart.x, blockStart.y, blockEnd.x, blockEnd.y, redHandle.x, redHandle.y, blueHandle.x, blueHandle.y]);

  const sourcePoint = (event: { clientX: number; clientY: number }) => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left - view.x) / view.zoom, y: (event.clientY - rect.top - view.y) / view.zoom };
  };
  const startDrag = (event: React.PointerEvent<HTMLElement>, requested?: DragMode) => {
    if (event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    const point = sourcePoint(event);
    const insideImage = point.x >= 0 && point.y >= 0 && point.x <= dimensions.width && point.y <= dimensions.height;
    let mode = requested;
    if (!requested) {
      if (event.shiftKey || spaceRef.current) mode = 'pan';
      else if (tool === 'legend') mode = 'legendDraw';
      else if (tool === 'pan' || readOnly) mode = 'pan';
      else if (tool === 'grid') mode = 'grid';
      else if (insideImage) mode = 'draw';
      else return;
    }
    const editAlignment = mode === 'grid' || mode === 'pitch' ? block : alignment;
    dragRef.current = { pointerId: event.pointerId, mode, start: point, alignment: editAlignment, region: derived.region, view };
    if (editAlignment.originX !== alignment.originX || editAlignment.originY !== alignment.originY) onAlignmentChange(editAlignment);
    setActiveDrag(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = sourcePoint(event);
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (drag.mode === 'pan') {
      // Pan deltas use screen coordinates, independent of the updated view.
      const rect = viewportRef.current!.getBoundingClientRect();
      setView(boundView({ ...drag.view, x: event.clientX - rect.left - drag.start.x * drag.view.zoom, y: event.clientY - rect.top - drag.start.y * drag.view.zoom }));
    } else if (drag.mode === 'grid') onAlignmentChange(moveGridAlignment(drag.alignment, { x: dx, y: dy }));
    else if (drag.mode === 'pitch') onAlignmentChange(resizeGridAlignment(drag.alignment, {
      x: drag.alignment.originX + 3 * drag.alignment.cellSize + dx,
      y: drag.alignment.originY + 3 * drag.alignment.cellSize + dy,
    }, 3));
    else if (drag.mode === 'region') {
      const x = clamp(drag.region.x + dx, 0, dimensions.width - drag.region.width);
      const y = clamp(drag.region.y + dy, 0, dimensions.height - drag.region.height);
      onRegionChange({ ...drag.region, x, y });
    }     else if (drag.mode === 'draw') onRegionChange(clipRecognitionRegion({ x: drag.start.x, y: drag.start.y, width: dx, height: dy }, dimensions));
    else if (drag.mode === 'legendDraw') {
      if (!onLegendRegionChange) return;
      const x0 = clamp(Math.min(drag.start.x, point.x), 0, dimensions.width);
      const y0 = clamp(Math.min(drag.start.y, point.y), 0, dimensions.height);
      const x1 = clamp(Math.max(drag.start.x, point.x), 0, dimensions.width);
      const y1 = clamp(Math.max(drag.start.y, point.y), 0, dimensions.height);
      onLegendRegionChange({ x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1) });
    } else {
      const r = drag.region;
      const cornerMode = drag.mode.length === 2;
      const fromWest = drag.mode.endsWith('w');
      const fromNorth = drag.mode.startsWith('n');
      // 纯边（n/s/e/w）只调本边，另一轴锁定——窗口式单边调整
      const moveX = cornerMode || fromWest || drag.mode === 'e';
      const moveY = cornerMode || fromNorth || drag.mode === 's';
      const fixedX = fromWest ? r.x + r.width : r.x;
      const fixedY = fromNorth ? r.y + r.height : r.y;
      const movingX = clamp((fromWest ? r.x : r.x + r.width) + (moveX ? dx : 0), 0, dimensions.width);
      const movingY = clamp((fromNorth ? r.y : r.y + r.height) + (moveY ? dy : 0), 0, dimensions.height);
      onRegionChange(clipRecognitionRegion({ x: Math.min(fixedX, movingX), y: Math.min(fixedY, movingY), width: Math.abs(movingX - fixedX), height: Math.abs(movingY - fixedY) }, dimensions));
    }
  };
  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setActiveDrag(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const pointerProps = { onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag };
  const keyDown = (event: React.KeyboardEvent<HTMLElement>, handle?: 'grid' | 'pitch' | BoxHandle) => {
    if (event.code === 'Space' && !handle) { event.preventDefault(); spaceRef.current = true; return; }
    if (event.key === '0') { event.preventDefault(); fit(); return; }
    if (event.key === 'Escape' && tool === 'legend') {
      event.preventDefault();
      onLegendRegionChange?.(null);
      return;
    }
    if (['+', '=', '-'].includes(event.key)) {
      event.preventDefault();
      zoomAt(event.key === '-' ? 1 / 1.3 : 1.3);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
    const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
    const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
    if (readOnly || (!handle && tool === 'pan')) setView(boundView({ ...view, x: view.x + dx * 10, y: view.y + dy * 10 }));
    else if (handle === 'pitch') onAlignmentChange(resizeGridAlignment(block, { x: block.originX + 3 * block.cellSize + dx, y: block.originY + 3 * block.cellSize + dy }, 3));
    else if (handle && (CORNERS.includes(handle as Corner) || EDGES.includes(handle as Edge))) {
      const r = derived.region;
      const west = handle.endsWith('w'); const north = handle.startsWith('n');
      onRegionChange(clipRecognitionRegion({ x: r.x + (west ? dx : 0), y: r.y + (north ? dy : 0), width: r.width + (west ? -dx : dx), height: r.height + (north ? -dy : dy) }, dimensions));
    } else if (tool === 'region') {
      const r = derived.region;
      onRegionChange({ ...r, x: clamp(r.x + dx, 0, dimensions.width - r.width), y: clamp(r.y + dy, 0, dimensions.height - r.height) });
    } else onAlignmentChange(moveGridAlignment(alignment, { x: dx, y: dy }));
  };

  return <div className="ir-viewer ir-alignment-viewer">
    <div className="ir-canvas-toolbar">
      <div className="ir-segment ir-alignment-tools" role="group" aria-label="校准操作模式">
        {!readOnly && <>
          <button type="button" aria-pressed={tool === 'grid'} onClick={() => setTool('grid')}><Grid2X2 size={14} />调整网格</button>
          <button type="button" aria-pressed={tool === 'pan'} onClick={() => setTool('pan')}><Move size={14} />平移视图</button>
          <button type="button" aria-pressed={tool === 'region'} onClick={() => setTool('region')}><ScanSearch size={14} />框选识别区域</button>
        </>}
        {onLegendRegionChange && (
          <button
            type="button"
            className="ir-tool-legend"
            aria-pressed={tool === 'legend'}
            onClick={() => setTool(tool === 'legend' ? (readOnly ? 'pan' : 'grid') : 'legend')}
            title="框住图纸上的图例条（色点 + 色号 + 粒数），图例锁定只解析框内内容"
          ><SquareDashed size={14} />框选图例</button>
        )}
        {readOnly && <span className="ir-help">校准已冻结，准备识别</span>}
      </div>
      <div className="ir-zoom-tools"><button type="button" aria-label="缩小校准视图" onClick={() => zoomAt(1 / 1.3)}><Minus size={16} /></button><span className="ir-zoom-value">{Math.round(view.zoom * 100)}%</span><button type="button" aria-label="放大校准视图" onClick={() => zoomAt(1.3)}><Plus size={16} /></button><button type="button" aria-label="适应校准视图" onClick={fit}><Maximize2 size={16} /></button><button type="button" aria-label="重置校准视图" onClick={fit}><RotateCcw size={16} /></button></div>
    </div>
    {(!readOnly || tool === 'legend') && <div className="ir-alignment-instructions" id="ir-alignment-instructions">{tool === 'legend' ? <>拖动画布框住整条图例 · 框错可重新拖 · <button type="button" className="ir-text-button" onClick={() => onLegendRegionChange?.(null)}>清除框选</button></> : tool === 'grid' ? <><span className="ir-handle-key ir-handle-key-red" />红点拖动：对齐网格 <span className="ir-handle-key ir-handle-key-blue" />蓝点拖动：改变格距 <span className="ir-gesture-hint">滚轮 / 触控板：缩放预览</span></> : tool === 'pan' ? '拖动画布：平移图片 · 滚轮 / 触控板：缩放预览 · 工具栏可适应视图' : <>拖动画布框选 · 拖橙色中心移动 · 拖角点或边中点调整<button type="button" className="ir-text-button" onClick={() => onRegionChange({ x: 0, y: 0, ...dimensions })}>选择全图</button></>}</div>}
    <div ref={viewportRef} className="ir-viewport ir-alignment-viewport" data-tool={readOnly && tool !== 'legend' ? 'pan' : tool}>
      <canvas ref={canvasRef} tabIndex={0} onPointerDown={event => startDrag(event)} {...pointerProps} onKeyDown={event => keyDown(event)} onBlur={() => { spaceRef.current = false; }} aria-label="图纸网格校准预览，红点移动网格，蓝点调整格距，橙框限定识别区域，紫框为图例区域" aria-describedby={!readOnly || tool === 'legend' ? 'ir-alignment-instructions' : undefined} />
      {!readOnly && tool === 'grid' && <>
        <button type="button" className="ir-lattice-handle ir-lattice-anchor" style={{ left: redHandle.x, top: redHandle.y }} aria-label="红色锚点：移动周期网格" title="移动网格 · 方向键微调" onPointerDown={event => startDrag(event, 'grid')} {...pointerProps} onKeyDown={event => keyDown(event, 'grid')}><span /></button>
        <button type="button" className="ir-lattice-handle ir-lattice-size" style={{ left: blueHandle.x, top: blueHandle.y }} aria-label="蓝色控制点：调整三格大小" title="调整 3 格大小 · 方向键微调" onPointerDown={event => startDrag(event, 'pitch')} {...pointerProps} onKeyDown={event => keyDown(event, 'pitch')}><span /></button>
      </>}
      {!readOnly && tool === 'region' && derived.region.width > 0 && derived.region.height > 0 && CORNERS.map(corner => {
        const r = derived.region;
        const p = toScreen({ x: r.x + (corner.endsWith('e') ? r.width : 0), y: r.y + (corner.startsWith('s') ? r.height : 0) });
        if ((p.x < -22 || p.y < -22 || p.x > size.width + 22 || p.y > size.height + 22) && dragRef.current?.mode !== corner) return null;
        return <button key={corner} type="button" className="ir-region-handle" style={{ left: clamp(p.x, 22, size.width - 22), top: clamp(p.y, 22, size.height - 22) }} aria-label={`识别区域${CORNER_LABELS[corner]}角`} onPointerDown={event => startDrag(event, corner)} {...pointerProps} onKeyDown={event => keyDown(event, corner)}><span /></button>;
      })}
      {!readOnly && tool === 'region' && derived.region.width > 0 && derived.region.height > 0 && EDGES.map(edge => {
        const r = derived.region;
        const x = r.x * view.zoom + view.x;
        const y = r.y * view.zoom + view.y;
        const w = r.width * view.zoom;
        const h = r.height * view.zoom;
        const T = 16; // 热区厚度：整条边任意位置可抓，光标随边向变双向箭头
        const style = edge === 'n' ? { left: x, top: y - T / 2, width: w, height: T }
          : edge === 's' ? { left: x, top: y + h - T / 2, width: w, height: T }
          : edge === 'w' ? { left: x - T / 2, top: y, width: T, height: h }
          : { left: x + w - T / 2, top: y, width: T, height: h };
        return <div key={edge} role="button" tabIndex={0} className={`ir-region-edgezone ir-region-edgezone-${edge}`} style={style} aria-label={`识别区域${EDGE_LABELS[edge]}边：拖动单边调整`} title="拖动调整这一边" onPointerDown={event => startDrag(event, edge)} {...pointerProps} onKeyDown={event => keyDown(event, edge)} />;
      })}
      {!readOnly && tool === 'region' && derived.region.width > 0 && derived.region.height > 0 && <button type="button" className="ir-region-move" style={{ left: clamp((derived.region.x + derived.region.width / 2) * view.zoom + view.x, 25, Math.max(25, size.width - 25)), top: clamp((derived.region.y + derived.region.height / 2) * view.zoom + view.y, 25, Math.max(25, size.height - 25)) }} aria-label="移动识别区域" title="拖动以移动识别区域" onPointerDown={event => startDrag(event, 'region')} {...pointerProps} onKeyDown={event => keyDown(event)}><Move size={18} /></button>}
    </div>
    <div className="ir-canvas-caption"><span><i className="ir-dot ir-dot-cyan" />周期网格 <i className="ir-dot ir-dot-green" />纳入识别的完整格 <i className="ir-dot ir-dot-amber" />识别区域{legendRegion ? <> <i className="ir-dot ir-dot-violet" />图例区域</> : null}</span><span>{sparseStride > 1 ? `缩略显示每 ${sparseStride} 条网格线 · ` : ''}实际格距 {Number(alignment.cellSize.toFixed(3))} px · 中央青色小块仅为拖拽手柄，识别范围以绿色区域为准</span></div>
  </div>;
}
