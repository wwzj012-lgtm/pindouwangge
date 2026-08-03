import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { LayoutGrid, Sliders, BarChart3, Wand2, Download, Palette } from 'lucide-react';
import {
  BeadColor,
  BeadShape,
  BrandKey,
  ConvertSettings,
  ProjectData,
  ToolType,
  SymmetryMode,
  CanvasBackdrop,
} from './types';
import { BRAND_PALETTES } from './data/palettes';
import { SAMPLE_IMAGES } from './data/samples';
import { imageToGrid } from './utils/colorUtils';
import { smartCropSubject } from './utils/cropUtils';

import { Header } from './components/Header';
import { Toolbar } from './components/Toolbar';
import { GridCanvas } from './components/GridCanvas';
import { SettingsPanel } from './components/SettingsPanel';
import { StatsPanel } from './components/StatsPanel';
import { PaletteManagerModal } from './components/PaletteManagerModal';
import { ExportModal } from './components/ExportModal';
import { ColorReplaceModal } from './components/ColorReplaceModal';
import { ImageStudioModal } from './components/ImageStudioModal';
import { UserGuideModal } from './components/UserGuideModal';
import { SmartBeadReducerModal } from './components/SmartBeadReducerModal';
import { AuthModal } from './components/AuthModal';
import { AdminPanelModal } from './components/AdminPanelModal';

export default function App() {
  // 1. Core State
  const [projectName, setProjectName] = useState('我的拼豆创意图纸');
  const [brand, setBrand] = useState<BrandKey>('MARD');
  const [activePalette, setActivePalette] = useState<BeadColor[]>(BRAND_PALETTES.MARD);

  // Conversion Settings
  const [settings, setSettings] = useState<ConvertSettings>({
    width: 29,
    height: 29,
    keepAspectRatio: true,
    brand: 'MARD',
    dither: 'none',
    colorLimit: 0,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    transparentCutoff: 128,
    boardSize: 29,
    sharpening: 30,
    outlineBoost: true,
    chromaKeyColor: null,
    colorMatchAlgo: 'ciede2000',
  });

  // Source Image element reference
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);

  // Grid Matrix: 2D Array of BeadColor ID (or null for empty peg)
  const [grid, setGrid] = useState<(string | null)[][]>(() =>
    Array.from({ length: 29 }, () => Array(29).fill(null))
  );

  // Undo / Redo History Stack
  const [history, setHistory] = useState<(string | null)[][][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Editing Tool State
  const [activeTool, setActiveTool] = useState<ToolType>('pencil');
  const [selectedColor, setSelectedColor] = useState<BeadColor | null>(BRAND_PALETTES.MARD[0]);
  const [highlightColorId, setHighlightColorId] = useState<string | null>(null);
  const [symmetryMode, setSymmetryMode] = useState<SymmetryMode>('none');

  // Display Mode & Backdrop Settings
  const [beadShape, setBeadShape] = useState<BeadShape>('fuse_3d');
  const [canvasBackdrop, setCanvasBackdrop] = useState<CanvasBackdrop>('dark_grid');
  const [showSymbols, setShowSymbols] = useState(true);
  const [showGridLines, setShowGridLines] = useState(true);
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [showOverlay, setShowOverlay] = useState(false);
  const [zoom, setZoom] = useState(1.0);

  // Modals & Drawer State
  const [mobileDrawer, setMobileDrawer] = useState<'none' | 'settings' | 'stats'>('none');
  const [isPaletteModalOpen, setIsPaletteModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isStudioModalOpen, setIsStudioModalOpen] = useState(false);
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);
  const [isSmartReduceModalOpen, setIsSmartReduceModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [replaceSourceColor, setReplaceSourceColor] = useState<BeadColor | null>(null);
  const [erasedColorCoords, setErasedColorCoords] = useState<Map<string, [number, number][]>>(() => new Map<string, [number, number][]>());

  // Palette Lookup Map
  const paletteMap = useMemo(() => {
    return new Map(activePalette.map(c => [c.id, c]));
  }, [activePalette]);

  // Sync palette when brand changes
  useEffect(() => {
    const brandColors = BRAND_PALETTES[brand] || BRAND_PALETTES.MARD;
    setActivePalette(brandColors);
    if (!selectedColor || !brandColors.some(c => c.id === selectedColor.id)) {
      setSelectedColor(brandColors[0]);
    }
  }, [brand]);

  // Push new state to undo history stack
  const pushHistory = useCallback((newGrid: (string | null)[][]) => {
    setHistory(prev => {
      const sliced = prev.slice(0, historyIndex + 1);
      return [...sliced, newGrid];
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  // Handle Undo / Redo
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      setGrid(history[historyIndex - 1]);
    }
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
      setGrid(history[historyIndex + 1]);
    }
  }, [history, historyIndex]);

  // Perform Image Pixel Conversion
  const convertImageToGrid = useCallback(
    (img: HTMLImageElement, currentSettings: ConvertSettings, currentPalette: BeadColor[]) => {
      let targetW = currentSettings.width;
      let targetH = currentSettings.height;

      if (currentSettings.keepAspectRatio && img.width > 0 && img.height > 0) {
        const ratio = img.height / img.width;
        targetH = Math.max(10, Math.round(targetW * ratio));
        setSettings(s => ({ ...s, height: targetH }));
      }

      const effectiveSettings = { ...currentSettings, width: targetW, height: targetH };
      const newGrid = imageToGrid(img, effectiveSettings, currentPalette);

      setGrid(newGrid);
      pushHistory(newGrid);
    },
    [pushHistory]
  );

  // Re-convert on settings update if source image exists
  const handleReconvert = () => {
    if (sourceImage) {
      convertImageToGrid(sourceImage, settings, activePalette);
    }
  };

  // Load Image File
  const handleImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = evt => {
      if (evt.target?.result) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          setSourceImage(img);
          setProjectName(file.name.replace(/\.[^/.]+$/, ''));
          convertImageToGrid(img, settings, activePalette);
        };
        img.src = evt.target.result as string;
      }
    };
    reader.readAsDataURL(file);
  };

  // Load Sample Preset Image
  const handleLoadSample = (sampleUrl: string) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setSourceImage(img);
      setProjectName('可爱草莓示例拼豆');
      convertImageToGrid(img, settings, activePalette);
    };
    img.src = sampleUrl;
  };

  // Load default sample strawberry on first load
  useEffect(() => {
    handleLoadSample(SAMPLE_IMAGES[0].url);
  }, []);

  // Clear Canvas
  const handleClearCanvas = () => {
    const emptyGrid = Array.from({ length: settings.height }, () =>
      Array(settings.width).fill(null)
    );
    setGrid(emptyGrid);
    pushHistory(emptyGrid);
  };

  // Shift Grid in cardinal direction
  const handleShiftGrid = (dir: 'up' | 'down' | 'left' | 'right') => {
    const h = settings.height;
    const w = settings.width;
    const newGrid = Array.from({ length: h }, () => Array(w).fill(null));

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sx = x;
        let sy = y;
        if (dir === 'left') sx = x + 1;
        if (dir === 'right') sx = x - 1;
        if (dir === 'up') sy = y + 1;
        if (dir === 'down') sy = y - 1;

        if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
          newGrid[y][x] = grid[sy][sx];
        }
      }
    }
    setGrid(newGrid);
    pushHistory(newGrid);
  };

  // Interactive Painting on Cell Click/Drag / Flood Fill / Shapes
  const handleCellClick = (x: number, y: number) => {
    if (x < 0 || x >= settings.width || y < 0 || y >= settings.height) return;

    if (activeTool === 'pencil') {
      if (!selectedColor) return;
      const nextColorId = selectedColor.id;
      if (grid[y][x] === nextColorId) return;

      const newGrid = grid.map(row => [...row]);

      const applyPoint = (px: number, py: number) => {
        if (px >= 0 && px < settings.width && py >= 0 && py < settings.height) {
          newGrid[py][px] = nextColorId;
        }
      };

      // Apply with symmetry
      applyPoint(x, y);
      if (symmetryMode === 'horizontal' || symmetryMode === 'quad') {
        applyPoint(settings.width - 1 - x, y);
      }
      if (symmetryMode === 'vertical' || symmetryMode === 'quad') {
        applyPoint(x, settings.height - 1 - y);
      }
      if (symmetryMode === 'quad') {
        applyPoint(settings.width - 1 - x, settings.height - 1 - y);
      }

      setGrid(newGrid);
      pushHistory(newGrid);
    } else if (activeTool === 'eraser') {
      if (grid[y][x] === null) return;
      const newGrid = grid.map(row => [...row]);

      const erasePoint = (px: number, py: number) => {
        if (px >= 0 && px < settings.width && py >= 0 && py < settings.height) {
          newGrid[py][px] = null;
        }
      };

      erasePoint(x, y);
      if (symmetryMode === 'horizontal' || symmetryMode === 'quad') {
        erasePoint(settings.width - 1 - x, y);
      }
      if (symmetryMode === 'vertical' || symmetryMode === 'quad') {
        erasePoint(x, settings.height - 1 - y);
      }
      if (symmetryMode === 'quad') {
        erasePoint(settings.width - 1 - x, settings.height - 1 - y);
      }

      setGrid(newGrid);
      pushHistory(newGrid);
    } else if (activeTool === 'bucket') {
      if (!selectedColor) return;
      const targetColorId = grid[y][x];
      const fillColorId = selectedColor.id;
      if (targetColorId === fillColorId) return;

      const newGrid = grid.map(row => [...row]);
      const queue: [number, number][] = [[x, y]];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const [cx, cy] = queue.pop()!;
        const key = `${cx},${cy}`;
        if (visited.has(key)) continue;
        visited.add(key);

        if (
          cx >= 0 &&
          cx < settings.width &&
          cy >= 0 &&
          cy < settings.height &&
          newGrid[cy][cx] === targetColorId
        ) {
          newGrid[cy][cx] = fillColorId;
          queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
        }
      }

      setGrid(newGrid);
      pushHistory(newGrid);
    } else if (activeTool === 'replace') {
      const sourceId = grid[y][x];
      if (sourceId) {
        const sourceBead = paletteMap.get(sourceId);
        if (sourceBead) setReplaceSourceColor(sourceBead);
      }
    }
  };

  // Shape creation handler from GridCanvas (Line / Rectangle / Circle)
  const handleApplyShape = (points: { x: number; y: number }[]) => {
    if (!selectedColor || points.length === 0) return;
    const colorId = selectedColor.id;
    const newGrid = grid.map(row => [...row]);

    const applyPoint = (px: number, py: number) => {
      if (px >= 0 && px < settings.width && py >= 0 && py < settings.height) {
        newGrid[py][px] = colorId;
      }
    };

    points.forEach(pt => {
      applyPoint(pt.x, pt.y);
      if (symmetryMode === 'horizontal' || symmetryMode === 'quad') {
        applyPoint(settings.width - 1 - pt.x, pt.y);
      }
      if (symmetryMode === 'vertical' || symmetryMode === 'quad') {
        applyPoint(pt.x, settings.height - 1 - pt.y);
      }
      if (symmetryMode === 'quad') {
        applyPoint(settings.width - 1 - pt.x, settings.height - 1 - pt.y);
      }
    });

    setGrid(newGrid);
    pushHistory(newGrid);
  };

  // Replace all instances of sourceColorId with targetColorId or erase if TRANSPARENT_ERASE
  const handleExecuteReplace = (sourceId: string, targetId: string) => {
    const newGrid = grid.map(row =>
      row.map(cell => {
        if (cell === sourceId) {
          return targetId === 'TRANSPARENT_ERASE' ? null : targetId;
        }
        return cell;
      })
    );
    setGrid(newGrid);
    pushHistory(newGrid);
  };

  // Erase all instances of a specific colorId
  const handleEraseColor = useCallback((colorId: string) => {
    const coords: [number, number][] = [];
    grid.forEach((row, y) => {
      row.forEach((cell, x) => {
        if (cell === colorId) {
          coords.push([x, y]);
        }
      });
    });

    if (coords.length > 0) {
      setErasedColorCoords(prev => {
        const next = new Map<string, [number, number][]>(prev);
        const existing = next.get(colorId) || [];
        next.set(colorId, [...existing, ...coords]);
        return next;
      });

      const newGrid = grid.map(row =>
        row.map(cell => (cell === colorId ? null : cell))
      );
      setGrid(newGrid);
      pushHistory(newGrid);
    }
  }, [grid, pushHistory]);

  // Restore an erased color back to the grid
  const handleRestoreColor = useCallback((colorId: string) => {
    const coords = erasedColorCoords.get(colorId);

    if (coords && coords.length > 0) {
      const newGrid = grid.map(row => [...row]);
      for (const [x, y] of coords) {
        if (y < newGrid.length && x < newGrid[y].length && newGrid[y][x] === null) {
          newGrid[y][x] = colorId;
        }
      }
      setGrid(newGrid);
      pushHistory(newGrid);
    }

    setErasedColorCoords(prev => {
      const next = new Map<string, [number, number][]>(prev);
      next.delete(colorId);
      return next;
    });

    const restoredColor = paletteMap.get(colorId);
    if (restoredColor) {
      setSelectedColor(restoredColor);
    }
  }, [grid, erasedColorCoords, pushHistory, paletteMap]);

  // Flood-fill clear connected outer background beads starting from grid edges
  const handleClearOuterBackground = useCallback(() => {
    const h = settings.height;
    const w = settings.width;
    if (h === 0 || w === 0) return;

    const newGrid = grid.map(row => [...row]);
    const visited = Array.from({ length: h }, () => Array(w).fill(false));

    // Sample potential outer background color IDs from edge coordinates
    const sampleColorIds = new Set<string>();
    const edgeCoords = [
      [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
      [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1],
      [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)]
    ];
    for (const [cx, cy] of edgeCoords) {
      const cid = grid[cy]?.[cx];
      if (cid) sampleColorIds.add(cid);
    }

    if (sampleColorIds.size === 0) return;

    // Queue for BFS
    const queue: [number, number][] = [];

    // Push all border cells that match a sampled background color
    for (let x = 0; x < w; x++) {
      if (grid[0][x] && sampleColorIds.has(grid[0][x]!)) {
        queue.push([x, 0]);
        visited[0][x] = true;
      }
      if (grid[h - 1][x] && sampleColorIds.has(grid[h - 1][x]!)) {
        queue.push([x, h - 1]);
        visited[h - 1][x] = true;
      }
    }
    for (let y = 0; y < h; y++) {
      if (grid[y][0] && sampleColorIds.has(grid[y][0]!)) {
        queue.push([0, y]);
        visited[y][0] = true;
      }
      if (grid[y][w - 1] && sampleColorIds.has(grid[y][w - 1]!)) {
        queue.push([w - 1, y]);
        visited[y][w - 1] = true;
      }
    }

    const clearedByColor = new Map<string, [number, number][]>();
    let clearedCount = 0;

    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      const curColor = grid[cy][cx];
      if (curColor) {
        if (!clearedByColor.has(curColor)) {
          clearedByColor.set(curColor, []);
        }
        clearedByColor.get(curColor)!.push([cx, cy]);
      }
      newGrid[cy][cx] = null;
      clearedCount++;

      const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny][nx]) {
          if (grid[ny][nx] && grid[ny][nx] === curColor) {
            visited[ny][nx] = true;
            queue.push([nx, ny]);
          }
        }
      }
    }

    if (clearedCount > 0) {
      setErasedColorCoords(prev => {
        const next = new Map<string, [number, number][]>(prev);
        clearedByColor.forEach((coords, cid) => {
          const existing = next.get(cid) || [];
          next.set(cid, [...existing, ...coords]);
        });
        return next;
      });
      setGrid(newGrid);
      pushHistory(newGrid);
    }
  }, [grid, settings, pushHistory]);

  // Export & Import Project JSON
  const handleExportJson = () => {
    const project: ProjectData = {
      version: '1.0',
      name: projectName,
      width: settings.width,
      height: settings.height,
      boardSize: settings.boardSize,
      brand,
      grid,
      createdAt: new Date().toISOString(),
    };

    const jsonStr = JSON.stringify(project, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${projectName}.perler`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (jsonStr: string) => {
    try {
      const project: ProjectData = JSON.parse(jsonStr);
      if (project.grid && Array.isArray(project.grid)) {
        setProjectName(project.name || '导入的拼豆项目');
        setBrand(project.brand || 'MARD');
        setSettings(s => ({
          ...s,
          width: project.width || project.grid[0].length,
          height: project.height || project.grid.length,
          boardSize: project.boardSize || 29,
        }));
        setGrid(project.grid);
        pushHistory(project.grid);
      }
    } catch {
      alert('解析拼豆工程文件失败，请确保格式正确');
    }
  };

  // Keyboard Shortcuts (P, B, I, E, R, Ctrl+Z, Ctrl+Y)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) handleRedo();
          else handleUndo();
        } else if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          handleRedo();
        }
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'p') setActiveTool('pencil');
      else if (key === 'h') setActiveTool('hand');
      else if (key === 'b') setActiveTool('bucket');
      else if (key === 'i') setActiveTool('eyedropper');
      else if (key === 'e') setActiveTool('eraser');
      else if (key === 'r') setActiveTool('replace');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  return (
    <div className="flex flex-col h-screen bg-slate-950 font-sans text-slate-100 overflow-hidden">
      {/* Top Main Navigation Header */}
      <Header
        projectName={projectName}
        setProjectName={setProjectName}
        brand={brand}
        setBrand={setBrand}
        onImageUpload={handleImageUpload}
        onLoadSample={handleLoadSample}
        onExportJson={handleExportJson}
        onImportJson={handleImportJson}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        onOpenPaletteModal={() => setIsPaletteModalOpen(true)}
        onOpenGuideModal={() => setIsGuideModalOpen(true)}
        onOpenSmartReduceModal={() => setIsSmartReduceModalOpen(true)}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        onClearCanvas={handleClearCanvas}
        settings={settings}
        setSettings={setSettings}
      />

      {/* Editing Toolbar */}
      <Toolbar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        selectedColor={selectedColor}
        onOpenColorPicker={() => setIsPaletteModalOpen(true)}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        onUndo={handleUndo}
        onRedo={handleRedo}
        zoom={zoom}
        onZoomIn={() => setZoom(z => Math.min(4.0, z * 1.15))}
        onZoomOut={() => setZoom(z => Math.max(0.3, z * 0.85))}
        onResetZoom={() => setZoom(1.0)}
        beadShape={beadShape}
        setBeadShape={setBeadShape}
        showSymbols={showSymbols}
        setShowSymbols={setShowSymbols}
        showGridLines={showGridLines}
        setShowGridLines={setShowGridLines}
        showCoordinates={showCoordinates}
        setShowCoordinates={setShowCoordinates}
        symmetryMode={symmetryMode}
        setSymmetryMode={setSymmetryMode}
        canvasBackdrop={canvasBackdrop}
        setCanvasBackdrop={setCanvasBackdrop}
        onShiftGrid={handleShiftGrid}
        onOpenImageStudio={() => setIsStudioModalOpen(true)}
        hasImage={sourceImage !== null}
        showOverlay={showOverlay}
        setShowOverlay={setShowOverlay}
      />

      {/* Main Workspace: Left Settings, Center Grid Canvas, Right Stats */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile Backdrop Overlay for Side Drawers */}
        {mobileDrawer !== 'none' && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-30 lg:hidden transition-opacity"
            onClick={() => setMobileDrawer('none')}
          />
        )}

        {/* Left Panel: Conversion Settings (Desktop sidebar + Mobile drawer) */}
        <div
          className={`h-full transition-transform duration-300 ease-in-out z-40 ${
            mobileDrawer === 'settings'
              ? 'fixed inset-y-0 left-0 max-w-[85vw] shadow-2xl block'
              : 'hidden lg:block'
          }`}
        >
          <SettingsPanel
            settings={settings}
            setSettings={setSettings}
            onReconvert={handleReconvert}
            hasImage={sourceImage !== null}
            onOpenImageStudio={() => {
              setMobileDrawer('none');
              setIsStudioModalOpen(true);
            }}
            onOpenSmartReduceModal={() => {
              setMobileDrawer('none');
              setIsSmartReduceModalOpen(true);
            }}
            onCloseMobile={() => setMobileDrawer('none')}
          />
        </div>

        {/* Center Canvas Area */}
        <div className="flex-1 h-full relative min-w-0">
          <GridCanvas
            grid={grid}
            paletteMap={paletteMap}
            width={settings.width}
            height={settings.height}
            boardSize={settings.boardSize}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            selectedColor={selectedColor}
            highlightColorId={highlightColorId}
            beadShape={beadShape}
            showSymbols={showSymbols}
            showGridLines={showGridLines}
            showCoordinates={showCoordinates}
            canvasBackdrop={canvasBackdrop}
            symmetryMode={symmetryMode}
            sourceImage={sourceImage}
            showOverlay={showOverlay}
            zoom={zoom}
            setZoom={setZoom}
            onCellClick={handleCellClick}
            onApplyShape={handleApplyShape}
            onEyedropColor={color => setSelectedColor(color)}
          />
        </div>

        {/* Right Panel: Color Statistics (Desktop sidebar + Mobile drawer) */}
        <div
          className={`h-full transition-transform duration-300 ease-in-out z-40 ${
            mobileDrawer === 'stats'
              ? 'fixed inset-y-0 right-0 max-w-[85vw] shadow-2xl block'
              : 'hidden lg:block'
          }`}
        >
          <StatsPanel
            grid={grid}
            paletteMap={paletteMap}
            width={settings.width}
            height={settings.height}
            boardSize={settings.boardSize}
            highlightColorId={highlightColorId}
            onSetHighlightColorId={setHighlightColorId}
            onOpenReplaceModal={color => setReplaceSourceColor(color)}
            onSelectColor={color => setSelectedColor(color)}
            onClearOuterBackground={handleClearOuterBackground}
            onEraseColor={handleEraseColor}
            onRestoreColor={handleRestoreColor}
            erasedColorCoords={erasedColorCoords}
            onCloseMobile={() => setMobileDrawer('none')}
          />
        </div>
      </div>

      {/* Mobile Bottom Navigation Bar (< lg screens) */}
      <nav className="lg:hidden bg-slate-900/95 border-t border-slate-800 backdrop-blur-md px-1.5 py-1 flex items-center justify-around z-30 shrink-0 text-[9px]">
        <button
          onClick={() => setMobileDrawer('none')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 px-2 rounded-lg transition-all cursor-pointer ${
            mobileDrawer === 'none'
              ? 'text-rose-400 font-bold bg-rose-500/15 border border-rose-500/30 shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>画布</span>
        </button>

        <button
          onClick={() => setMobileDrawer(mobileDrawer === 'settings' ? 'none' : 'settings')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 px-2 rounded-lg transition-all cursor-pointer ${
            mobileDrawer === 'settings'
              ? 'text-rose-400 font-bold bg-rose-500/15 border border-rose-500/30 shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>设置</span>
        </button>

        <button
          onClick={() => setMobileDrawer(mobileDrawer === 'stats' ? 'none' : 'stats')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 px-2 rounded-lg transition-all cursor-pointer ${
            mobileDrawer === 'stats'
              ? 'text-emerald-400 font-bold bg-emerald-500/15 border border-emerald-500/30 shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          <span>用量</span>
        </button>

        {sourceImage && (
          <button
            onClick={() => setIsStudioModalOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 py-1 px-2 rounded-lg text-amber-400 hover:text-amber-300 font-medium transition-all cursor-pointer"
            title="高级图像增强与转拼豆工作坊"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>图像增强</span>
          </button>
        )}

        <button
          onClick={() => setIsExportModalOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 py-1 px-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-all cursor-pointer shadow-xs active:scale-95"
        >
          <Download className="w-3.5 h-3.5" />
          <span>导出</span>
        </button>
      </nav>

      {/* Modals */}
      <PaletteManagerModal
        isOpen={isPaletteModalOpen}
        onClose={() => setIsPaletteModalOpen(false)}
        brand={brand}
        activePalette={activePalette}
        setActivePalette={setActivePalette}
        onSelectColor={color => setSelectedColor(color)}
      />

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        grid={grid}
        paletteMap={paletteMap}
        width={settings.width}
        height={settings.height}
        boardSize={settings.boardSize}
        brandName={brand}
        projectName={projectName}
        beadShape={beadShape}
      />

      <ColorReplaceModal
        isOpen={replaceSourceColor !== null}
        onClose={() => setReplaceSourceColor(null)}
        sourceColor={replaceSourceColor}
        activePalette={activePalette}
        onExecuteReplace={handleExecuteReplace}
      />

      <UserGuideModal
        isOpen={isGuideModalOpen}
        onClose={() => setIsGuideModalOpen(false)}
      />

      <SmartBeadReducerModal
        isOpen={isSmartReduceModalOpen}
        onClose={() => setIsSmartReduceModalOpen(false)}
        grid={grid}
        palette={activePalette}
        onApplyReducedGrid={(newGrid) => {
          setGrid(newGrid);
          pushHistory(newGrid);
          setSettings(s => ({
            ...s,
            width: newGrid[0]?.length || s.width,
            height: newGrid.length || s.height,
          }));
        }}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onOpenAdminPanel={() => setIsAdminPanelOpen(true)}
      />

      <AdminPanelModal
        isOpen={isAdminPanelOpen}
        onClose={() => setIsAdminPanelOpen(false)}
      />

      {sourceImage && (
        <ImageStudioModal
          isOpen={isStudioModalOpen}
          onClose={() => setIsStudioModalOpen(false)}
          sourceImage={sourceImage}
          settings={settings}
          setSettings={setSettings}
          activePalette={activePalette}
          onApplyConversion={(newGrid, updatedImg) => {
            if (updatedImg) {
              setSourceImage(updatedImg);
            }
            setGrid(newGrid);
            pushHistory(newGrid);
          }}
        />
      )}
    </div>
  );
}

