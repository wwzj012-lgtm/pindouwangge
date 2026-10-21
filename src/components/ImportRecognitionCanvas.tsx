import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Focus, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import type { ImportGridCalibration } from '../utils/importGridCalibration';
import type { ImportRecognitionResult } from '../utils/importRecognition';
import { recognitionCellKey } from '../utils/importRecognitionReview';
import { clampCanvasViewport } from '../utils/canvasViewport';

type CellPosition = { row: number; column: number };
type Comparison = 'result' | 'original' | 'overlay';
type Transform = { zoom: number; x: number; y: number };

interface Props {
  image: HTMLImageElement;
  result: ImportRecognitionResult;
  selected: CellPosition | null;
  pending: Set<string>;
  onlyReview: boolean;
  onSelect: (cell: CellPosition) => void;
}

/** A viewport-sized canvas: source, result, grid and hit testing use one transform. */
export function ImportRecognitionCanvas({ image, result, selected, pending, onlyReview, onSelect }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
  const [comparison, setComparison] = useState<Comparison>('result');
  const [view, setView] = useState<Transform>({ zoom: 1, x: 0, y: 0 });
  const [size, setSize] = useState({ width: 1, height: 1 });
  const calibration = result.calibration;
  const { columns, rows, cellWidth, cellHeight, originX, originY } = calibration;
  const width = columns * cellWidth;
  const height = rows * cellHeight;
  const fitZoom = Math.min(Math.max(1, size.width - 48) / width, Math.max(1, size.height - 48) / height);
  const maxZoom = Math.max(fitZoom * 2, 96 / Math.min(cellWidth, cellHeight));
  const boundView = useCallback((next: Transform) => clampCanvasViewport(next, size, { width, height }), [size, width, height]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      const rect = viewport.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => setView(boundView({ zoom: fitZoom, x: 0, y: 0 })), [fitZoom, boundView]);
  useEffect(() => { fit(); }, [fit]);

  const zoomAt = useCallback((factor: number, x = size.width / 2, y = size.height / 2) => {
    setView(current => {
      const zoom = Math.min(maxZoom, Math.max(fitZoom * 0.25, current.zoom * factor));
      return boundView({ zoom, x: x - (x - current.x) * zoom / current.zoom, y: y - (y - current.y) * zoom / current.zoom });
    });
  }, [fitZoom, maxZoom, size, boundView]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      zoomAt(Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * 0.004), event.clientX - rect.left, event.clientY - rect.top);
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [zoomAt]);

  // Rebuilt only when result/filter changes, never on a pan or zoom frame.
  const raster = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = columns;
    canvas.height = rows;
    const context = canvas.getContext('2d');
    if (!context) return canvas;
    result.cells.forEach((row, y) => row.forEach((cell, x) => {
      context.fillStyle = cell.color?.hex ?? (cell.status === 'invalid' ? '#fecdd3' : '#f3f0f7');
      context.fillRect(x, y, 1, 1);
      if (onlyReview && !pending.has(recognitionCellKey(y, x))) {
        context.fillStyle = 'rgba(148, 139, 166, .83)';
        context.fillRect(x, y, 1, 1);
      }
    }));
    return canvas;
  }, [columns, rows, result, pending, onlyReview]);

  useEffect(() => {
    if (!selected) return;
    setView(current => {
      const x = (selected.column + 0.5) * cellWidth * current.zoom + current.x;
      const y = (selected.row + 0.5) * cellHeight * current.zoom + current.y;
      if (x >= 20 && x <= size.width - 20 && y >= 20 && y <= size.height - 20) return current;
      return boundView({ ...current, x: size.width / 2 - (selected.column + 0.5) * cellWidth * current.zoom, y: size.height / 2 - (selected.row + 0.5) * cellHeight * current.zoom });
    });
  }, [selected, cellWidth, cellHeight, size, boundView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(size.width * dpr));
    canvas.height = Math.max(1, Math.round(size.height * dpr));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.save();
    context.translate(view.x, view.y);
    context.scale(view.zoom, view.zoom);
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    context.imageSmoothingEnabled = false;
    if (comparison !== 'result') context.drawImage(image, originX, originY, width, height, 0, 0, width, height);
    if (comparison !== 'original') {
      context.globalAlpha = comparison === 'overlay' ? 0.55 : 1;
      context.drawImage(raster, 0, 0, width, height);
      context.globalAlpha = 1;
    }
    const firstColumn = Math.max(0, Math.floor(-view.x / view.zoom / cellWidth));
    const lastColumn = Math.min(columns - 1, Math.ceil((size.width - view.x) / view.zoom / cellWidth));
    const firstRow = Math.max(0, Math.floor(-view.y / view.zoom / cellHeight));
    const lastRow = Math.min(rows - 1, Math.ceil((size.height - view.y) / view.zoom / cellHeight));
    const screenCellWidth = cellWidth * view.zoom;
    const screenCellHeight = cellHeight * view.zoom;
    const showCodes = comparison !== 'original' && screenCellWidth >= 29 && screenCellHeight >= 23;
    if (screenCellWidth >= 9 && screenCellHeight >= 9) {
      context.lineWidth = 0.6 / view.zoom;
      context.strokeStyle = 'rgba(91, 69, 116, .28)';
      context.beginPath();
      for (let x = firstColumn; x <= lastColumn + 1; x++) { context.moveTo(x * cellWidth, firstRow * cellHeight); context.lineTo(x * cellWidth, (lastRow + 1) * cellHeight); }
      for (let y = firstRow; y <= lastRow + 1; y++) { context.moveTo(firstColumn * cellWidth, y * cellHeight); context.lineTo((lastColumn + 1) * cellWidth, y * cellHeight); }
      context.stroke();
    }
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        const key = recognitionCellKey(row, column);
        const cell = result.cells[row]?.[column];
        if (pending.has(key)) {
          if (screenCellWidth >= 6 && screenCellHeight >= 6) {
            context.strokeStyle = '#f59e0b';
            context.lineWidth = 1.5 / view.zoom;
            context.strokeRect(column * cellWidth + 1 / view.zoom, row * cellHeight + 1 / view.zoom, cellWidth - 2 / view.zoom, cellHeight - 2 / view.zoom);
          } else {
            context.fillStyle = 'rgba(245, 158, 11, .55)';
            context.fillRect(column * cellWidth, row * cellHeight, cellWidth, cellHeight);
          }
        }
        if (showCodes && cell?.color && (!onlyReview || pending.has(key))) {
          const [r, g, b] = cell.color.rgb;
          context.fillStyle = r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#21152f' : '#ffffff';
          context.strokeStyle = context.fillStyle === '#ffffff' ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.65)';
          context.font = `600 ${Math.min(14, screenCellHeight * 0.3) / view.zoom}px ui-monospace, monospace`;
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.lineWidth = 2 / view.zoom;
          const x = (column + 0.5) * cellWidth;
          const y = (row + 0.5) * cellHeight;
          context.strokeText(cell.color.code, x, y, cellWidth - 4 / view.zoom);
          context.fillText(cell.color.code, x, y, cellWidth - 4 / view.zoom);
        }
      }
    }
    context.restore();
    // Display-only frame, shared by result/original/overlay and never rasterized
    // into either the uploaded image or the recognition raster.
    context.strokeStyle = 'rgba(255,255,255,.95)'; context.lineWidth = 4;
    context.strokeRect(view.x, view.y, width * view.zoom, height * view.zoom);
    context.strokeStyle = '#6d5485'; context.lineWidth = 1.5;
    context.strokeRect(view.x, view.y, width * view.zoom, height * view.zoom);
    if (selected) {
      const x = selected.column * cellWidth * view.zoom + view.x;
      const y = selected.row * cellHeight * view.zoom + view.y;
      context.strokeStyle = '#ffffff'; context.lineWidth = 5;
      context.strokeRect(x, y, screenCellWidth, screenCellHeight);
      context.strokeStyle = '#7c3aed'; context.lineWidth = 3;
      context.strokeRect(x, y, screenCellWidth, screenCellHeight);
    }
  }, [image, raster, comparison, view, size, selected, pending, onlyReview, result, width, height, columns, rows, cellWidth, cellHeight, originX, originY]);

  const selectAt = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (clientX - rect.left - view.x) / view.zoom;
    const y = (clientY - rect.top - view.y) / view.zoom;
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    onSelect({ row: Math.floor(y / cellHeight), column: Math.floor(x / cellWidth) });
  };
  const focusSelected = () => {
    const cell = selected ?? { row: 0, column: 0 };
    const zoom = Math.min(maxZoom, Math.max(fitZoom, 42 / Math.min(cellWidth, cellHeight)));
    setView(boundView({ zoom, x: size.width / 2 - (cell.column + 0.5) * cellWidth * zoom, y: size.height / 2 - (cell.row + 0.5) * cellHeight * zoom }));
  };

  return <div className="ir-viewer">
    <div className="ir-canvas-toolbar">
      <div className="ir-segment" role="group" aria-label="结果与原图对比">
        {([['result', '结果'], ['original', '原图'], ['overlay', '叠加']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={comparison === value} onClick={() => setComparison(value)}>{label}</button>)}
      </div>
      <div className="ir-zoom-tools">
        <button type="button" aria-label="缩小结果" title="缩小" onClick={() => zoomAt(1 / 1.4)}><Minus size={16} /></button>
        <span className="ir-zoom-value">{Math.round(view.zoom / fitZoom * 100)}%</span>
        <button type="button" aria-label="放大结果" title="放大" onClick={() => zoomAt(1.4)}><Plus size={16} /></button>
        <button type="button" aria-label="适应结果视图" title="适应视图" onClick={fit}><Maximize2 size={16} /></button>
        <button type="button" aria-label="重置结果视图" title="重置视图" onClick={() => { setComparison('result'); fit(); }}><RotateCcw size={16} /></button>
        <button type="button" aria-label="放大查看选中格" title="放大选中格" onClick={focusSelected}><Focus size={16} /></button>
      </div>
    </div>
    <div className="ir-result-viewport" ref={viewportRef}>
      <canvas ref={canvasRef} tabIndex={0} aria-label="识别结果，拖动平移，滚轮缩放，方向键选择相邻格" onKeyDown={event => {
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomAt(1.4); }
        else if (event.key === '-') { event.preventDefault(); zoomAt(1 / 1.4); }
        else if (event.key === '0') { event.preventDefault(); fit(); }
        else if (event.key.startsWith('Arrow')) {
          event.preventDefault();
          const cell = selected ?? { row: 0, column: 0 };
          onSelect({ row: Math.min(rows - 1, Math.max(0, cell.row + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0))), column: Math.min(columns - 1, Math.max(0, cell.column + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0))) });
        }
      }} onPointerDown={event => {
        if (event.button !== 0 && event.button !== 1) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: event.button === 1 };
      }} onPointerMove={event => {
        const drag = dragRef.current;
        if (!drag || drag.id !== event.pointerId) return;
        if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (drag.moved) setView(current => boundView({ ...current, x: current.x + dx, y: current.y + dy }));
        drag.x = event.clientX; drag.y = event.clientY;
      }} onPointerUp={event => {
        const drag = dragRef.current;
        if (drag?.id !== event.pointerId) return;
        if (!drag.moved) selectAt(event.clientX, event.clientY);
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={() => { dragRef.current = null; }} onLostPointerCapture={() => { dragRef.current = null; }} />
    </div>
    <div className="ir-canvas-caption"><span><i className="ir-dot ir-dot-purple" />选中格 <i className="ir-dot ir-dot-amber" />待复核</span><span>拖动平移 · 滚轮缩放 · 方向键选格</span></div>
  </div>;
}

/** Always samples the uploaded source, including fractional cell boundaries. */
export function ImportSourceCellCrop({ image, calibration, selected, edgeInsetRatio }: { image: HTMLImageElement; calibration: ImportGridCalibration; selected: CellPosition; edgeInsetRatio: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 160 * dpr; canvas.height = 160 * dpr;
    context.scale(dpr, dpr);
    context.clearRect(0, 0, 160, 160);
    const { originX, originY, cellWidth, cellHeight } = calibration;
    const scale = Math.min(144 / cellWidth, 144 / cellHeight);
    const width = cellWidth * scale; const height = cellHeight * scale;
    const x = (160 - width) / 2; const y = (160 - height) / 2;
    context.imageSmoothingEnabled = false;
    context.drawImage(image, originX + selected.column * cellWidth, originY + selected.row * cellHeight, cellWidth, cellHeight, x, y, width, height);
    if (edgeInsetRatio > 0) {
      context.strokeStyle = '#a855f7'; context.lineWidth = 1.5; context.setLineDash([4, 3]);
      context.strokeRect(x + width * edgeInsetRatio, y + height * edgeInsetRatio, width * (1 - edgeInsetRatio * 2), height * (1 - edgeInsetRatio * 2));
    }
  }, [image, calibration, selected, edgeInsetRatio]);
  return <canvas ref={ref} className="ir-source-crop" role="img" aria-label={`原图第 ${selected.row + 1} 行第 ${selected.column + 1} 列的真实像素放大${edgeInsetRatio ? '，虚线为参与识别的内部区域' : ''}`} />;
}
