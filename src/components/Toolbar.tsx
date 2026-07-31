import React from 'react';
import {
  Pencil,
  PaintBucket,
  Pipette,
  Eraser,
  RefreshCw,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Circle as CircleIcon,
  Square,
  Hash,
  Grid2x2,
  Eye,
  Minus,
  Spline,
  FlipHorizontal,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Layers,
  Wand2,
} from 'lucide-react';
import { BeadColor, BeadShape, ToolType, SymmetryMode, CanvasBackdrop } from '../types';

interface ToolbarProps {
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  selectedColor: BeadColor | null;
  onOpenColorPicker: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  beadShape: BeadShape;
  setBeadShape: (shape: BeadShape) => void;
  showSymbols: boolean;
  setShowSymbols: (show: boolean) => void;
  showGridLines: boolean;
  setShowGridLines: (show: boolean) => void;
  showCoordinates: boolean;
  setShowCoordinates: (show: boolean) => void;
  
  symmetryMode: SymmetryMode;
  setSymmetryMode: (mode: SymmetryMode) => void;
  canvasBackdrop: CanvasBackdrop;
  setCanvasBackdrop: (backdrop: CanvasBackdrop) => void;
  onShiftGrid: (dir: 'up' | 'down' | 'left' | 'right') => void;
  onOpenImageStudio: () => void;
  hasImage: boolean;
  showOverlay: boolean;
  setShowOverlay: (show: boolean) => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  activeTool,
  setActiveTool,
  selectedColor,
  onOpenColorPicker,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  beadShape,
  setBeadShape,
  showSymbols,
  setShowSymbols,
  showGridLines,
  setShowGridLines,
  showCoordinates,
  setShowCoordinates,
  symmetryMode,
  setSymmetryMode,
  canvasBackdrop,
  setCanvasBackdrop,
  onShiftGrid,
  onOpenImageStudio,
  hasImage,
  showOverlay,
  setShowOverlay,
}) => {
  const tools: { id: ToolType; label: string; icon: React.ReactNode }[] = [
    { id: 'pencil', label: '画笔 (P)', icon: <Pencil className="w-3.5 h-3.5" /> },
    { id: 'line', label: '直线', icon: <Minus className="w-3.5 h-3.5" /> },
    { id: 'rectangle', label: '矩形', icon: <Square className="w-3.5 h-3.5" /> },
    { id: 'circle', label: '圆形', icon: <CircleIcon className="w-3.5 h-3.5" /> },
    { id: 'bucket', label: '油漆桶 (B)', icon: <PaintBucket className="w-3.5 h-3.5" /> },
    { id: 'eyedropper', label: '吸管 (I)', icon: <Pipette className="w-3.5 h-3.5" /> },
    { id: 'eraser', label: '橡皮擦 (E)', icon: <Eraser className="w-3.5 h-3.5" /> },
    { id: 'replace', label: '替换全图此色 (R)', icon: <RefreshCw className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="bg-slate-900 border-b border-slate-800 text-slate-200 px-3 py-2 flex items-center justify-between gap-2.5 text-xs shadow-sm z-20 select-none overflow-x-auto scrollbar-none">
      {/* Left: Editing Tools & Active Color Swatch */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Active Color Swatch */}
        <button
          onClick={onOpenColorPicker}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors"
          title="点击选择当前涂色拼豆"
        >
          <div
            className="w-5 h-5 rounded-full border border-black/20 shadow-inner flex items-center justify-center font-bold text-[9px]"
            style={{ backgroundColor: selectedColor ? selectedColor.hex : '#CCCCCC' }}
          >
            {selectedColor?.symbol || ''}
          </div>
          <div className="text-left">
            <div className="font-bold text-slate-100 leading-none">
              {selectedColor ? selectedColor.code : '未选择'}
            </div>
            <div className="text-[10px] text-slate-400 leading-none mt-0.5 max-w-[80px] truncate">
              {selectedColor ? selectedColor.name : '点此选色'}
            </div>
          </div>
        </button>

        <div className="h-5 w-px bg-slate-800 hidden sm:block" />

        {/* Image Studio Launcher Button */}
        {hasImage && (
          <button
            onClick={onOpenImageStudio}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-bold rounded-lg shadow-sm cursor-pointer transition-all active:scale-95 text-[11px]"
            title="打开图像AI增强与转换工作坊"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>转换增强工作坊</span>
          </button>
        )}

        {/* Paint & Shape Tools Buttons */}
        <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700/80">
          {tools.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTool(t.id)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                activeTool === t.id
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
              }`}
              title={t.label}
            >
              {t.icon}
              <span className="hidden xl:inline text-[11px]">{t.label.split(' ')[0]}</span>
            </button>
          ))}
        </div>

        {/* Symmetry Selector */}
        <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700/80 text-[11px]">
          <span className="px-1.5 text-slate-400 flex items-center gap-1">
            <Spline className="w-3 h-3 text-rose-400" />
            对称:
          </span>
          <select
            value={symmetryMode}
            onChange={e => setSymmetryMode(e.target.value as SymmetryMode)}
            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200 outline-none cursor-pointer"
          >
            <option value="none">无对称</option>
            <option value="horizontal">↔ 左右镜像</option>
            <option value="vertical">↕ 上下镜像</option>
            <option value="quad">❖ 4向四轴镜像</option>
          </select>
        </div>

        {/* Shift Grid Offset */}
        <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700/80">
          <span className="px-1.5 text-slate-400 text-[10px]">平移:</span>
          <button
            onClick={() => onShiftGrid('left')}
            className="p-1 hover:bg-slate-700 rounded text-slate-300 cursor-pointer"
            title="向左平移 1 豆"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onShiftGrid('right')}
            className="p-1 hover:bg-slate-700 rounded text-slate-300 cursor-pointer"
            title="向右平移 1 豆"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onShiftGrid('up')}
            className="p-1 hover:bg-slate-700 rounded text-slate-300 cursor-pointer"
            title="向上平移 1 豆"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onShiftGrid('down')}
            className="p-1 hover:bg-slate-700 rounded text-slate-300 cursor-pointer"
            title="向下平移 1 豆"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="h-5 w-px bg-slate-800 hidden sm:block" />

        {/* Undo / Redo */}
        <div className="flex items-center gap-1">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
            title="撤销 (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
            title="重做 (Ctrl+Y)"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Right: Display Overlays, Backdrop & Zoom Controls */}
      <div className="flex items-center gap-2.5 shrink-0 ml-2">
        {/* Canvas Backdrop Selector */}
        <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700/80 text-[11px]">
          <span className="px-1.5 text-slate-400 flex items-center gap-1">
            <Layers className="w-3 h-3 text-sky-400" />
            背景:
          </span>
          <select
            value={canvasBackdrop}
            onChange={e => setCanvasBackdrop(e.target.value as CanvasBackdrop)}
            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200 outline-none cursor-pointer"
          >
            <option value="dark_grid">深色网格</option>
            <option value="light_pegboard">白色插板</option>
            <option value="wood">复古木纹</option>
            <option value="studio">暗调工作台</option>
          </select>
        </div>

        {/* Bead Shape Style */}
        <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700/80 text-[11px]">
          <button
            onClick={() => setBeadShape('fuse_3d')}
            className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1 cursor-pointer ${
              beadShape === 'fuse_3d' ? 'bg-slate-700 text-amber-300 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
            title="3D立体拼豆样式"
          >
            <CircleIcon className="w-3.5 h-3.5 fill-amber-400/20" />
            <span className="hidden lg:inline">3D立体豆</span>
          </button>
          <button
            onClick={() => setBeadShape('circle_flat')}
            className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1 cursor-pointer ${
              beadShape === 'circle_flat' ? 'bg-slate-700 text-amber-300 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
            title="平面圆豆样式"
          >
            <CircleIcon className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">平面圆豆</span>
          </button>
          <button
            onClick={() => setBeadShape('square')}
            className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1 cursor-pointer ${
              beadShape === 'square' ? 'bg-slate-700 text-amber-300 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
            title="像素方块样式"
          >
            <Square className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">像素方块</span>
          </button>
        </div>

        {/* Overlays: Symbols & Overlay photo */}
        <div className="flex items-center gap-1">
          {hasImage && (
            <button
              onClick={() => setShowOverlay(!showOverlay)}
              className={`px-2 py-1.5 rounded-lg border transition-colors flex items-center gap-1 cursor-pointer ${
                showOverlay
                  ? 'bg-amber-950/80 border-amber-600 text-amber-300 font-bold'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
              title="在网格上显示原图半透明叠影衬底"
            >
              <Eye className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[11px]">原图叠影</span>
            </button>
          )}

          <button
            onClick={() => setShowSymbols(!showSymbols)}
            className={`px-2 py-1.5 rounded-lg border transition-colors flex items-center gap-1 cursor-pointer ${
              showSymbols
                ? 'bg-rose-950/80 border-rose-600 text-rose-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="显示/隐藏拼豆色号标识/符号"
          >
            <Hash className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">色号标识</span>
          </button>

          <button
            onClick={() => setShowGridLines(!showGridLines)}
            className={`px-2 py-1.5 rounded-lg border transition-colors flex items-center gap-1 cursor-pointer ${
              showGridLines
                ? 'bg-slate-800 border-slate-600 text-slate-200'
                : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
            title="显示/隐藏网格线"
          >
            <Grid2x2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">网格线</span>
          </button>
        </div>

        <div className="h-5 w-px bg-slate-800 hidden sm:block" />

        {/* Zoom Controls */}
        <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700/80">
          <button
            onClick={onZoomOut}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded cursor-pointer"
            title="缩小"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="px-2 text-[11px] font-mono font-medium text-slate-300 min-w-[42px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={onZoomIn}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded cursor-pointer"
            title="放大"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onResetZoom}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded cursor-pointer"
            title="适应屏幕"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

