import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Focus, Hand, Pencil } from 'lucide-react';
import { BeadColor, BeadShape, ToolType, SymmetryMode, CanvasBackdrop } from '../types';
import { drawBeadOnCanvas, getColumnLetter } from '../utils/exportUtils';

interface GridCanvasProps {
  grid: (string | null)[][];
  paletteMap: Map<string, BeadColor>;
  width: number;
  height: number;
  boardSize: number;
  activeTool: ToolType;
  setActiveTool?: (tool: ToolType) => void;
  selectedColor: BeadColor | null;
  highlightColorId: string | null;
  beadShape: BeadShape;
  showSymbols: boolean;
  showGridLines: boolean;
  showCoordinates: boolean;
  zoom: number;
  setZoom: (zoom: number) => void;
  onCellClick: (x: number, y: number) => void;
  onMultiCellClick?: (points: { x: number; y: number }[]) => void;
  onEyedropColor: (color: BeadColor) => void;
  symmetryMode?: SymmetryMode;
  canvasBackdrop?: CanvasBackdrop;
  overlayImage?: HTMLImageElement | null;
  showOverlay?: boolean;
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
  beadShape,
  showSymbols,
  showGridLines,
  showCoordinates,
  zoom,
  setZoom,
  onCellClick,
  onMultiCellClick,
  onEyedropColor,
  symmetryMode = 'none',
  canvasBackdrop = 'dark_grid',
  overlayImage = null,
  showOverlay = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Pan offsets
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Remember last drawing tool before switching to hand
  const [lastDrawTool, setLastDrawTool] = useState<ToolType>('pencil');

  useEffect(() => {
    if (activeTool !== 'hand') {
      setLastDrawTool(activeTool);
    }
  }, [activeTool]);

  // Drawing mouse drag state
  const [isDrawing, setIsDrawing] = useState(false);
  const [shapeStartCell, setShapeStartCell] = useState<{ x: number; y: number } | null>(null);
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null);

  // Cell size base in pixels
  const baseCellSize = 20;
  const cellSize = baseCellSize * zoom;
  const coordOffset = showCoordinates ? 28 : 0;

  // Refs for touch gesture sync
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const activeToolRef = useRef(activeTool);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

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

    const padding = clientWidth < 640 ? 20 : 36;
    const availW = Math.max(100, clientWidth - padding * 2);
    const availH = Math.max(100, clientHeight - padding * 2);

    const scaleX = availW / totalGridW;
    const scaleY = availH / totalGridH;
    const bestZoom = Math.min(3.5, Math.max(0.25, Math.min(scaleX, scaleY)));

    setZoom(bestZoom);

    const finalPixelW = width * baseCellSize * bestZoom + coordOffset;
    const finalPixelH = height * baseCellSize * bestZoom + coordOffset;

    setPan({
      x: Math.max(8, (clientWidth - finalPixelW) / 2),
      y: Math.max(8, (clientHeight - finalPixelH) / 2),
    });
  }, [width, height, coordOffset, baseCellSize, setZoom]);

  useEffect(() => {
    fitToView();
  }, [width, height]);

  // Handle Touch Gestures (Pinch to zoom & two-finger / hand panning)
  useEffect(() => {
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
        setIsDrawing(false);
        setIsPanning(true);
      } else if (e.touches.length === 1) {
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
          const newZoom = Math.min(4.5, Math.max(0.2, state.initialZoom * scale));

          const rect = container.getBoundingClientRect();
          const focusX = state.initialMidX - rect.left - state.initialPanX;
          const focusY = state.initialMidY - rect.top - state.initialPanY;
          const zoomRatio = newZoom / state.initialZoom;

          const deltaMidX = midX - state.initialMidX;
          const deltaMidY = midY - state.initialMidY;

          const newPanX = state.initialMidX - rect.left - (focusX * zoomRatio) + deltaMidX;
          const newPanY = state.initialMidY - rect.top - (focusY * zoomRatio) + deltaMidY;

          setZoom(newZoom);
          setPan({ x: newPanX, y: newPanY });
        }
      } else if (e.touches.length === 1 && state.isPanningSingle) {
        e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - state.lastSingleTouchX;
        const dy = t.clientY - state.lastSingleTouchY;
        state.lastSingleTouchX = t.clientX;
        state.lastSingleTouchY = t.clientY;

        setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        touchStateRef.current.isPinch = false;
      }
      if (e.touches.length === 0) {
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
  }, [setZoom]);

  // Handle Mouse Wheel Zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
    const newZoom = Math.min(4.5, Math.max(0.2, zoom * zoomFactor));

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

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const startX = pan.x + coordOffset;
    const startY = pan.y + coordOffset;

    // 1. Render Coordinate Labels (Top letters A..Z, Left numbers 1..N)
    if (showCoordinates) {
      ctx.fillStyle = '#94A3B8';
      ctx.font = `bold ${Math.max(10, Math.floor(11 * Math.min(zoom, 1.2)))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let x = 0; x < width; x++) {
        const px = startX + x * cellSize + cellSize / 2;
        if (px >= 0 && px <= canvasWidth) {
          ctx.fillText(getColumnLetter(x), px, pan.y + coordOffset / 2);
        }
      }

      ctx.textAlign = 'right';
      for (let y = 0; y < height; y++) {
        const py = startY + y * cellSize + cellSize / 2;
        if (py >= 0 && py <= canvasHeight) {
          ctx.fillText((y + 1).toString(), startX - 6, py);
        }
      }
    }

    // 2. Pegboard Area Fill based on Canvas Backdrop
    const gridPixelWidth = width * cellSize;
    const gridPixelHeight = height * cellSize;

    if (canvasBackdrop === 'light_pegboard') {
      ctx.fillStyle = '#E2E8F0';
    } else if (canvasBackdrop === 'wood') {
      ctx.fillStyle = '#78350F';
    } else if (canvasBackdrop === 'studio') {
      ctx.fillStyle = '#0F172A';
    } else if (canvasBackdrop === 'slate') {
      ctx.fillStyle = '#1E293B';
    } else {
      ctx.fillStyle = '#090D16'; // dark_grid
    }
    ctx.fillRect(startX, startY, gridPixelWidth, gridPixelHeight);

    // 3. Render Source Image Semi-transparent Overlay if enabled
    if (showOverlay && overlayImage) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.drawImage(overlayImage, startX, startY, gridPixelWidth, gridPixelHeight);
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
          const symbolStr = showSymbols && bead ? (bead.symbol || bead.code) : null;

          const isDimmed = highlightColorId !== null && colorId !== highlightColorId;

          ctx.save();
          if (isDimmed) ctx.globalAlpha = 0.15;

          drawBeadOnCanvas(ctx, px, py, cellSize, colorHex, beadShape, symbolStr);

          if (highlightColorId && colorId === highlightColorId) {
            ctx.strokeStyle = '#F43F5E';
            ctx.lineWidth = 2;
            ctx.strokeRect(px, py, cellSize, cellSize);
          }

          ctx.restore();
        } else {
          // Empty peg styling based on backdrop
          ctx.fillStyle =
            canvasBackdrop === 'light_pegboard' ? '#F1F5F9' : '#0F172A';
          ctx.fillRect(px, py, cellSize, cellSize);

          if (showGridLines) {
            ctx.strokeStyle =
              canvasBackdrop === 'light_pegboard' ? '#CBD5E1' : '#334155';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(px, py, cellSize, cellSize);
          }

          // Peg dot center
          ctx.beginPath();
          ctx.arc(px + cellSize / 2, py + cellSize / 2, Math.max(1, cellSize * 0.1), 0, Math.PI * 2);
          ctx.fillStyle =
            canvasBackdrop === 'light_pegboard' ? '#94A3B8' : '#475569';
          ctx.fill();
        }
      }
    }

    // 6. Symmetry Crosshairs Guidelines
    if (symmetryMode !== 'none') {
      ctx.strokeStyle = '#F43F5E';
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

    // 8. Grid Outer Border
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, gridPixelWidth, gridPixelHeight);
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
    pan,
    cellSize,
    coordOffset,
    zoom,
    symmetryMode,
    canvasBackdrop,
    overlayImage,
    showOverlay,
    isDrawing,
    shapeStartCell,
    hoverCell,
    applySymmetryToPoints,
  ]);

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

  // Pointer Handlers for Mouse & Single-Point interactions
  const handlePointerDown = (e: React.PointerEvent) => {
    // If pinch gesture active, ignore pointerdown
    if (touchStateRef.current.isPinch) return;

    if (e.button === 1 || e.button === 2 || e.shiftKey || activeTool === 'hand') {
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
    setShapeStartCell(cell);

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
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
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

  const handlePointerUp = () => {
    if (isDrawing && shapeStartCell && hoverCell) {
      let finalPoints: { x: number; y: number }[] = [];
      if (activeTool === 'line') {
        finalPoints = getLinePoints(shapeStartCell.x, shapeStartCell.y, hoverCell.x, hoverCell.y);
      } else if (activeTool === 'rectangle') {
        finalPoints = getRectanglePoints(shapeStartCell.x, shapeStartCell.y, hoverCell.x, hoverCell.y);
      } else if (activeTool === 'circle') {
        finalPoints = getCirclePoints(shapeStartCell.x, shapeStartCell.y, hoverCell.x, hoverCell.y);
      }

      if (finalPoints.length > 0) {
        const symPoints = applySymmetryToPoints(finalPoints);
        if (onMultiCellClick) {
          onMultiCellClick(symPoints);
        }
      }
    }

    setIsPanning(false);
    setIsDrawing(false);
    setShapeStartCell(null);
  };

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
      className={`relative w-full h-full bg-slate-950 overflow-hidden select-none touch-none ${
        activeTool === 'hand' ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-crosshair'
      }`}
      onWheel={handleWheel}
      onContextMenu={e => e.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="w-full h-full block touch-none"
      />

      {/* Hover Pixel Info Popover Card */}
      {hoverCell && (
        <div className="absolute top-2 left-2 sm:top-3 sm:left-3 bg-slate-900/90 border border-slate-800 text-slate-200 text-[10px] sm:text-xs px-2 py-1.5 sm:px-3 sm:py-2 rounded-lg sm:rounded-xl backdrop-blur-md shadow-lg flex items-center gap-2 sm:gap-3 pointer-events-none z-10">
          <div className="font-mono text-sky-400 font-bold">
            {getColumnLetter(hoverCell.x)}{hoverCell.y + 1} ({hoverCell.x + 1}, {hoverCell.y + 1})
          </div>
          {hoveredBead ? (
            <div className="flex items-center gap-1.5 border-l border-slate-700 pl-2 sm:pl-3">
              <div
                className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full border border-black/30 shadow-inner shrink-0"
                style={{ backgroundColor: hoveredBead.hex }}
              />
              <span className="font-bold">{hoveredBead.code}</span>
              <span className="text-slate-400 hidden xs:inline">({hoveredBead.name})</span>
            </div>
          ) : (
            <span className="text-slate-500 border-l border-slate-700 pl-2 sm:pl-3">空位置</span>
          )}
        </div>
      )}

      {/* Floating Info Overlay at bottom left */}
      <div className="absolute bottom-2.5 sm:bottom-3 left-2 sm:left-3 bg-slate-900/90 border border-slate-800 text-slate-300 text-[9px] sm:text-[11px] px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg backdrop-blur-md shadow-md flex flex-wrap items-center gap-1.5 sm:gap-2 max-w-[calc(100vw-180px)] sm:max-w-none z-10">
        <span><strong className="text-white">{width} × {height}</strong> 豆</span>
        <span><strong className="text-sky-400">{Math.ceil(width / boardSize) * Math.ceil(height / boardSize)}</strong> 板 ({boardSize}x{boardSize})</span>
        {symmetryMode !== 'none' && (
          <span className="text-rose-400 font-bold bg-rose-950/60 px-1 py-0.2 rounded border border-rose-600/40 text-[8px] sm:text-[10px]">
            {symmetryMode === 'horizontal' ? '左右镜像' : symmetryMode === 'vertical' ? '上下镜像' : '4向镜像'}
          </span>
        )}
      </div>

      {/* Mobile & Touch Floating Zoom & Pan Controls at bottom right */}
      <div className="absolute bottom-2.5 sm:bottom-3 right-2 sm:right-3 bg-slate-900/95 border border-slate-800 rounded-xl p-1 shadow-2xl flex items-center gap-1 z-10 backdrop-blur-md">
        {/* Toggle Hand / Pan Tool Button */}
        {setActiveTool && (
          <button
            onClick={toggleHandTool}
            className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center cursor-pointer transition-all active:scale-95 ${
              activeTool === 'hand'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/30 ring-2 ring-amber-400/50'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
            }`}
            title={activeTool === 'hand' ? '切换回画笔模式' : '平移/拖拽画布模式'}
          >
            {activeTool === 'hand' ? <Pencil className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Hand className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400" />}
          </button>
        )}

        <div className="w-px h-4 bg-slate-800" />

        {/* Focus / Auto-Fit View Button */}
        <button
          onClick={fitToView}
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-sky-400 flex items-center justify-center cursor-pointer transition-colors border border-slate-700/80"
          title="居中适应屏幕"
        >
          <Focus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>

        {/* Reset 100% Zoom */}
        <button
          onClick={() => {
            setZoom(1.0);
            setPan({ x: 40, y: 40 });
          }}
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 flex items-center justify-center cursor-pointer transition-colors border border-slate-700/80"
          title="重置 100%"
        >
          <Maximize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>

        <span className="text-[9px] sm:text-[10px] font-mono font-bold text-sky-400 px-1 select-none min-w-[32px] sm:min-w-[36px] text-center">
          {Math.round(zoom * 100)}%
        </span>

        {/* Zoom Out */}
        <button
          onClick={() => setZoom(Math.max(0.2, zoom * 0.8))}
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 flex items-center justify-center cursor-pointer transition-colors border border-slate-700/80"
          title="缩小"
        >
          <ZoomOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>

        {/* Zoom In */}
        <button
          onClick={() => setZoom(Math.min(4.5, zoom * 1.25))}
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 flex items-center justify-center cursor-pointer transition-colors border border-slate-700/80"
          title="放大"
        >
          <ZoomIn className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
      </div>
    </div>
  );
};
