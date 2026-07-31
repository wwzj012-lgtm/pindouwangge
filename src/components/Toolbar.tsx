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
  Circle,
  Square,
  Hash,
  Grid2x2,
  Eye,
} from 'lucide-react';
import { BeadColor, BeadShape, ToolType } from '../types';

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
}) => {
  const tools: { id: ToolType; label: string; icon: React.ReactNode }[] = [
    { id: 'pencil', label: '画笔 (P)', icon: <Pencil className="w-4 h-4" /> },
    { id: 'bucket', label: '油漆桶 (B)', icon: <PaintBucket className="w-4 h-4" /> },
    { id: 'eyedropper', label: '吸管 (I)', icon: <Pipette className="w-4 h-4" /> },
    { id: 'eraser', label: '橡皮擦 (E)', icon: <Eraser className="w-4 h-4" /> },
    { id: 'replace', label: '替换全图此色 (R)', icon: <RefreshCw className="w-4 h-4" /> },
  ];

  return (
    <div className="bg-slate-900 border-b border-slate-800 text-slate-200 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs shadow-sm z-20 select-none">
      {/* Left: Editing Tools & Active Color Swatch */}
      <div className="flex items-center gap-3 flex-wrap">
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

        {/* Paint Tool Buttons */}
        <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700/80">
          {tools.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTool(t.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                activeTool === t.id
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
              }`}
              title={t.label}
            >
              {t.icon}
              <span className="hidden md:inline text-[11px]">{t.label.split(' ')[0]}</span>
            </button>
          ))}
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

      {/* Right: Display Overlays, Bead Style, Zoom Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Bead Shape Style */}
        <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700/80 text-[11px]">
          <button
            onClick={() => setBeadShape('fuse_3d')}
            className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1 cursor-pointer ${
              beadShape === 'fuse_3d' ? 'bg-slate-700 text-amber-300 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
            title="3D立体拼豆样式"
          >
            <Circle className="w-3.5 h-3.5 fill-amber-400/20" />
            <span className="hidden lg:inline">3D立体豆</span>
          </button>
          <button
            onClick={() => setBeadShape('circle_flat')}
            className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1 cursor-pointer ${
              beadShape === 'circle_flat' ? 'bg-slate-700 text-amber-300 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
            title="平面圆豆样式"
          >
            <Circle className="w-3.5 h-3.5" />
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

        {/* Overlays: Symbols & Grid & Coordinates */}
        <div className="flex items-center gap-1">
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

          <button
            onClick={() => setShowCoordinates(!showCoordinates)}
            className={`px-2 py-1.5 rounded-lg border transition-colors flex items-center gap-1 cursor-pointer ${
              showCoordinates
                ? 'bg-slate-800 border-slate-600 text-slate-200'
                : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
            title="显示/隐藏网格标尺坐标(A..Z / 1..N)"
          >
            <Eye className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">标尺坐标</span>
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
