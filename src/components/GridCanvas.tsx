import React, { useRef, useEffect, useState, useCallback } from 'react';
import { BeadColor, BeadShape, ToolType } from '../types';
import { drawBeadOnCanvas, getColumnLetter } from '../utils/exportUtils';

interface GridCanvasProps {
  grid: (string | null)[][];
  paletteMap: Map<string, BeadColor>;
  width: number;
  height: number;
  boardSize: number;
  activeTool: ToolType;
  selectedColor: BeadColor | null;
  highlightColorId: string | null;
  beadShape: BeadShape;
  showSymbols: boolean;
  showGridLines: boolean;
  showCoordinates: boolean;
  zoom: number;
  setZoom: (zoom: number) => void;
  onCellClick: (x: number, y: number) => void;
  onCellHover?: (x: number, y: number) => void;
  onEyedropColor: (color: BeadColor) => void;
}

export const GridCanvas: React.FC<GridCanvasProps> = ({
  grid,
  paletteMap,
  width,
  height,
  boardSize,
  activeTool,
  selectedColor,
  highlightColorId,
  beadShape,
  showSymbols,
  showGridLines,
  showCoordinates,
  zoom,
  setZoom,
  onCellClick,
  onCellHover,
  onEyedropColor,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Pan offsets
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Drawing mouse drag state
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastCell, setLastCell] = useState<{ x: number; y: number } | null>(null);

  // Cell size base in pixels
  const baseCellSize = 20;
  const cellSize = baseCellSize * zoom;
  const coordOffset = showCoordinates ? 28 : 0;

  // Convert client mouse event to grid cell coordinates (x, y)
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

  // Center & auto fit view
  const resetView = useCallback(() => {
    if (!containerRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;
    const gridPixelWidth = width * cellSize + coordOffset;
    const gridPixelHeight = height * cellSize + coordOffset;

    setPan({
      x: Math.max(20, (clientWidth - gridPixelWidth) / 2),
      y: Math.max(20, (clientHeight - gridPixelHeight) / 2),
    });
  }, [width, height, cellSize, coordOffset]);

  useEffect(() => {
    resetView();
  }, [width, height]);

  // Handle Wheel Zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
    const newZoom = Math.min(4.0, Math.max(0.3, zoom * zoomFactor));

    // Zoom towards mouse pointer
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      const mouseX = e.clientX - rect.left - pan.x;
      const mouseY = e.clientY - rect.top - pan.y;

      const zoomRatio = newZoom / zoom;
      setPan({
        x: mouseX - (mouseX - pan.x) * zoomRatio,
        y: mouseY - (mouseY - pan.y) * zoomRatio,
      });
    }

    setZoom(newZoom);
  };

  // Main Canvas Render loop
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Grid drawing offset
    const startX = pan.x + coordOffset;
    const startY = pan.y + coordOffset;

    // 1. Render Coordinate Labels (Top letters A..Z, Left numbers 1..N)
    if (showCoordinates) {
      ctx.fillStyle = '#94A3B8';
      ctx.font = `bold ${Math.max(10, Math.floor(11 * Math.min(zoom, 1.2)))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Top X coordinates
      for (let x = 0; x < width; x++) {
        const px = startX + x * cellSize + cellSize / 2;
        if (px >= 0 && px <= canvasWidth) {
          ctx.fillText(getColumnLetter(x), px, pan.y + coordOffset / 2);
        }
      }

      // Left Y coordinates
      ctx.textAlign = 'right';
      for (let y = 0; y < height; y++) {
        const py = startY + y * cellSize + cellSize / 2;
        if (py >= 0 && py <= canvasHeight) {
          ctx.fillText((y + 1).toString(), startX - 6, py);
        }
      }
    }

    // 2. Pegboard Background Canvas Area
    const gridPixelWidth = width * cellSize;
    const gridPixelHeight = height * cellSize;

    ctx.fillStyle = '#1E293B';
    ctx.fillRect(startX, startY, gridPixelWidth, gridPixelHeight);

    // 3. Render Bead Grid Cells
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = startX + x * cellSize;
        const py = startY + y * cellSize;

        // Skip off-screen cells
        if (
          px + cellSize < 0 ||
          px > canvasWidth ||
          py + cellSize < 0 ||
          py > canvasHeight
        ) {
          continue;
        }

        const colorId = grid[y]?.[x];

        if (colorId) {
          const bead = paletteMap.get(colorId);
          const colorHex = bead ? bead.hex : '#CCCCCC';
          const symbolStr = showSymbols && bead ? (bead.symbol || bead.code) : null;

          // Highlight mode check (dim others if a specific color is focused)
          const isDimmed = highlightColorId !== null && colorId !== highlightColorId;

          ctx.save();
          if (isDimmed) {
            ctx.globalAlpha = 0.15; // Dim unselected beads
          }

          drawBeadOnCanvas(ctx, px, py, cellSize, colorHex, beadShape, symbolStr);

          // Highlight border for focused color
          if (highlightColorId && colorId === highlightColorId) {
            ctx.strokeStyle = '#F43F5E';
            ctx.lineWidth = 2;
            ctx.strokeRect(px, py, cellSize, cellSize);
          }

          ctx.restore();
        } else {
          // Empty peg
          ctx.fillStyle = '#0F172A';
          ctx.fillRect(px, py, cellSize, cellSize);

          if (showGridLines) {
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(px, py, cellSize, cellSize);
          }

          // Peg dot
          ctx.beginPath();
          ctx.arc(px + cellSize / 2, py + cellSize / 2, Math.max(1, cellSize * 0.1), 0, Math.PI * 2);
          ctx.fillStyle = '#475569';
          ctx.fill();
        }
      }
    }

    // 4. Board Boundary Lines & Index Labels (e.g., 29x29 pegboard outlines)
    if (boardSize > 0) {
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 2;

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

      // Render Board Index Labels (e.g. Board 1, Board 2...)
      const boardsX = Math.ceil(width / boardSize);
      const boardsY = Math.ceil(height / boardSize);

      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#38BDF8';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      for (let by = 0; by < boardsY; by++) {
        for (let bx = 0; bx < boardsX; bx++) {
          const boardNum = by * boardsX + bx + 1;
          const px = startX + bx * boardSize * cellSize + 6;
          const py = startY + by * boardSize * cellSize + 6;
          ctx.fillText(`板 ${boardNum}`, px, py);
        }
      }
    }

    // 5. Grid Outer Border
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, gridPixelWidth, gridPixelHeight);
  }, [
    grid,
    paletteMap,
    width,
    height,
    boardSize,
    beadShape,
    showSymbols,
    showGridLines,
    showCoordinates,
    highlightColorId,
    pan,
    cellSize,
    coordOffset,
    zoom,
  ]);

  // Window Resize & Canvas Resolution setup
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        canvasRef.current.width = clientWidth;
        canvasRef.current.height = clientHeight;
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

  // Pointer event handlers for drawing / panning
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || e.button === 2 || e.shiftKey) {
      // Pan canvas
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
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
    setLastCell(cell);
    onCellClick(cell.x, cell.y);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }

    const cell = clientToGrid(e.clientX, e.clientY);
    if (cell && onCellHover) {
      onCellHover(cell.x, cell.y);
    }

    if (isDrawing && cell) {
      if (!lastCell || lastCell.x !== cell.x || lastCell.y !== cell.y) {
        setLastCell(cell);
        onCellClick(cell.x, cell.y);
      }
    }
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    setIsDrawing(false);
    setLastCell(null);
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-slate-950 overflow-hidden cursor-crosshair select-none"
      onWheel={handleWheel}
      onContextMenu={e => e.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="w-full h-full block"
      />

      {/* Floating Info Overlay at bottom left */}
      <div className="absolute bottom-3 left-3 bg-slate-900/90 border border-slate-800 text-slate-300 text-[11px] px-3 py-1.5 rounded-lg backdrop-blur shadow-md flex items-center gap-3">
        <span>画布尺寸: <strong className="text-white">{width} × {height}</strong> 豆</span>
        <span>拼豆板: <strong className="text-sky-400">{Math.ceil(width / boardSize) * Math.ceil(height / boardSize)}</strong> 板 ({boardSize}x{boardSize})</span>
        <span className="text-slate-500 hidden sm:inline">提示: 按住 Shift 或右键拖拽平移画布</span>
      </div>
    </div>
  );
};
