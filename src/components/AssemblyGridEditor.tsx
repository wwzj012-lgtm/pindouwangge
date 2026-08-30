import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { AssemblyEditableGrid } from '../utils/assemblyGridEditor';

type Tool = 'pan' | 'paint' | 'erase' | 'picker';

interface AssemblyGridEditorProps {
  cells: AssemblyEditableGrid;
  paletteMap: Map<string, { hex: string }>;
  tool: Tool;
  selectedColor: string | null;
  onEdit: (x: number, y: number, color: string | null) => void;
  onPick: (color: string | null) => void;
}

export function AssemblyGridEditor({ cells, paletteMap, tool, selectedColor, onEdit, onPick }: AssemblyGridEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const lastCellRef = useRef<string | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const panRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const [coordinate, setCoordinate] = useState<string>('移动指针查看坐标');
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [isDesktop, setIsDesktop] = useState(false);
  const [viewport, setViewport] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const width = cells[0]?.length ?? 0;
  const height = cells.length;

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 1024px)');
    const updateDesktopMode = () => setIsDesktop(desktopQuery.matches);
    updateDesktopMode();
    desktopQuery.addEventListener('change', updateDesktopMode);
    return () => desktopQuery.removeEventListener('change', updateDesktopMode);
  }, []);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const updatePreviewSize = () => setPreviewSize({ width: preview.clientWidth, height: preview.clientHeight });
    updatePreviewSize();
    const observer = new ResizeObserver(updatePreviewSize);
    observer.observe(preview);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || !width || !height) return;
    const fittedCellSize = isDesktop && previewSize.width && previewSize.height
      ? Math.floor(Math.min(previewSize.width / width, previewSize.height / height))
      : Math.floor(640 / Math.max(width, height));
    const cellSize = Math.max(1, fittedCellSize);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * cellSize * dpr; canvas.height = height * cellSize * dpr;
    const context = canvas.getContext('2d'); if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = '#FFFFFF'; context.fillRect(0, 0, width * cellSize, height * cellSize);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const colorId = cells[y][x]; context.fillStyle = colorId ? paletteMap.get(colorId)?.hex ?? colorId : '#FFFFFF'; context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize); }
    context.strokeStyle = '#DDD6FE'; context.lineWidth = 1;
    for (let x = 0; x <= width; x += 1) { context.beginPath(); context.moveTo(x * cellSize + 0.5, 0); context.lineTo(x * cellSize + 0.5, height * cellSize); context.stroke(); }
    for (let y = 0; y <= height; y += 1) { context.beginPath(); context.moveTo(0, y * cellSize + 0.5); context.lineTo(width * cellSize, y * cellSize + 0.5); context.stroke(); }
  }, [cells, height, isDesktop, paletteMap, previewSize, width]);

  const cellAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / rect.width * width);
    const y = Math.floor((event.clientY - rect.top) / rect.height * height);
    return x >= 0 && x < width && y >= 0 && y < height ? { x, y } : null;
  };
  const apply = (event: PointerEvent<HTMLCanvasElement>) => {
    const cell = cellAt(event); if (!cell) return;
    setCoordinate(`${cell.x + 1} 列 · ${cell.y + 1} 行`);
    const key = `${cell.x}:${cell.y}`; if (lastCellRef.current === key) return; lastCellRef.current = key;
    if (tool === 'picker') { onPick(cells[cell.y][cell.x]); return; }
    if (tool === 'erase') onEdit(cell.x, cell.y, null);
    else if (selectedColor) onEdit(cell.x, cell.y, selectedColor);
  };

  const fittedCellSize = isDesktop && previewSize.width && previewSize.height
    ? Math.max(1, Math.floor(Math.min(previewSize.width / width, previewSize.height / height)))
    : Math.max(1, Math.floor(640 / Math.max(width, height)));
  const canvasWidth = width * fittedCellSize;
  const canvasHeight = height * fittedCellSize;

  return <div className="mt-3 min-w-0 overflow-hidden rounded-xl border border-purple-100 bg-purple-50/40 p-2 sm:p-3 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"><div ref={previewRef} className="min-w-0 overflow-hidden rounded bg-white lg:flex lg:min-h-0 lg:flex-1 lg:items-center lg:justify-center"><canvas ref={canvasRef} role="grid" aria-label="可编辑二维图纸" onPointerDown={event => { drawingRef.current = true; lastCellRef.current = null; event.currentTarget.setPointerCapture(event.pointerId); apply(event); }} onPointerMove={event => { if (drawingRef.current) apply(event); else { const cell = cellAt(event); if (cell) setCoordinate(`${cell.x + 1} 列 · ${cell.y + 1} 行`); } }} onPointerUp={() => { drawingRef.current = false; lastCellRef.current = null; }} onPointerCancel={() => { drawingRef.current = false; lastCellRef.current = null; }} className="block w-full touch-none cursor-crosshair lg:w-auto" style={isDesktop ? { width: canvasWidth, height: canvasHeight } : { aspectRatio: `${width} / ${height}` }} /></div><div className="mt-2 flex shrink-0 flex-wrap items-center justify-between gap-1 text-[10px] font-bold text-purple-400"><span>列 1—{width} · 行 1—{height}</span><span>{coordinate}</span></div></div>;
}
