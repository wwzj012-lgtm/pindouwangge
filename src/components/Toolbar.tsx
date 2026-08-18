import React, { useEffect, useRef, useState } from 'react';
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
  Layers,
  Hand,
  Scissors,
  ChevronUp,
  ChevronDown,
  Save,
  Flame,
} from 'lucide-react';
import { BeadColor, BeadShape, ToolType, SymmetryMode, CanvasBackdrop } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { createPressRepeatController, type PressRepeatController } from '../utils/pressRepeat';

interface ToolbarProps {
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  selectedColor: BeadColor | null;
  onOpenColorPicker: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => boolean;
  onRedo: () => boolean;
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
  onClearOuterBackground: () => void;
  hasImage: boolean;
  showOverlay: boolean;
  setShowOverlay: (show: boolean) => void;
  onSavePattern: () => void;
  isSavingPattern: boolean;
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
  onClearOuterBackground,
  hasImage,
  showOverlay,
  setShowOverlay,
  onSavePattern,
  isSavingPattern,
}) => {
  const { language, t } = useLanguage();
  const isEn = language === 'en';
  const shapeButtonClass = (selected: boolean) => `min-w-0 rounded-lg px-2 py-1 text-purple-700 transition-colors hover:bg-purple-100 hover:text-purple-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1 ${
    selected ? 'bg-purple-600 text-white hover:bg-purple-700 hover:text-white' : ''
  }`;

  const [isToolsCollapsed, setIsToolsCollapsed] = useState<boolean>(false);
  const undoActionRef = useRef(onUndo);
  const redoActionRef = useRef(onRedo);
  const undoRepeatRef = useRef<PressRepeatController | null>(null);
  const redoRepeatRef = useRef<PressRepeatController | null>(null);

  useEffect(() => {
    undoActionRef.current = onUndo;
    redoActionRef.current = onRedo;
  }, [onRedo, onUndo]);

  if (!undoRepeatRef.current) {
    undoRepeatRef.current = createPressRepeatController(() => undoActionRef.current());
  }
  if (!redoRepeatRef.current) {
    redoRepeatRef.current = createPressRepeatController(() => redoActionRef.current());
  }

  useEffect(() => {
    const stopRepeatingHistory = () => {
      undoRepeatRef.current?.stop();
      redoRepeatRef.current?.stop();
    };

    window.addEventListener('blur', stopRepeatingHistory);
    return () => {
      window.removeEventListener('blur', stopRepeatingHistory);
      stopRepeatingHistory();
    };
  }, []);

  const startHistoryRepeat = (controller: PressRepeatController, event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    controller.start();
  };

  const stopHistoryRepeat = (controller: PressRepeatController) => {
    controller.stop();
  };

  const tools: { id: ToolType; label: string; icon: React.ReactNode }[] = [
    { id: 'pencil', label: isEn ? 'Pencil (P)' : '画笔 (P)', icon: <Pencil className="w-3.5 h-3.5" /> },
    { id: 'hand', label: isEn ? 'Pan / Move (H)' : '平移拖拽 (H)', icon: <Hand className="w-3.5 h-3.5" /> },
    { id: 'line', label: isEn ? 'Line' : '直线', icon: <Minus className="w-3.5 h-3.5" /> },
    { id: 'rectangle', label: isEn ? 'Rectangle' : '矩形', icon: <Square className="w-3.5 h-3.5" /> },
    { id: 'circle', label: isEn ? 'Circle' : '圆形', icon: <CircleIcon className="w-3.5 h-3.5" /> },
    { id: 'bucket', label: isEn ? 'Fill Bucket (B)' : '油漆桶 (B)', icon: <PaintBucket className="w-3.5 h-3.5" /> },
    { id: 'eyedropper', label: isEn ? 'Color Picker (I)' : '吸管 (I)', icon: <Pipette className="w-3.5 h-3.5" /> },
    { id: 'eraser', label: isEn ? 'Eraser (E)' : '橡皮擦 (E)', icon: <Eraser className="w-3.5 h-3.5" /> },
    { id: 'replace', label: isEn ? 'Replace Color (R)' : '替换全图此色 (R)', icon: <RefreshCw className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="bg-white/90 backdrop-blur-md border-b border-purple-200/80 text-purple-950 px-3 py-2 flex items-center justify-between gap-2.5 text-xs shadow-xs z-20 select-none overflow-x-auto scrollbar-none">
      {/* Left: Active Color Swatch & Middle Drawing Tools */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Active Color Swatch */}
        <button
          onClick={onOpenColorPicker}
          className="flex items-center gap-1.5 bg-purple-50 hover:bg-purple-100 border border-purple-200/90 rounded-xl px-2 py-1 sm:px-2.5 sm:py-1.5 cursor-pointer transition-colors shrink-0 shadow-2xs"
          title={isEn ? 'Click to select active bead color' : '点击选择当前涂色拼豆'}
        >
          <div
            className="w-4 h-4 sm:w-5 sm:h-5 rounded-full border border-black/20 shadow-inner flex items-center justify-center font-bold text-[8px] sm:text-[9px] shrink-0"
            style={{ backgroundColor: selectedColor ? selectedColor.hex : '#CCCCCC' }}
          >
            {selectedColor?.symbol || ''}
          </div>
          <div className="text-left shrink-0">
            <div className="font-extrabold text-purple-950 text-[11px] sm:text-xs leading-none">
              {selectedColor ? selectedColor.code : (isEn ? 'None' : '未选择')}
            </div>
            <div className="text-[9px] sm:text-[10px] text-purple-600 leading-none mt-0.5 max-w-[65px] sm:max-w-[80px] truncate">
              {selectedColor ? selectedColor.name : (isEn ? 'Select' : '选色')}
            </div>
          </div>
        </button>

        <div className="h-4 w-px bg-purple-200 shrink-0" />

        {/* Middle Drawing Operations Tools (Collapsible Block) */}
        <div className="flex items-center gap-2 shrink-0">
          {/* First Element: Fold/Unfold Toggle Button ("折叠工具") */}
          <button
            onClick={() => setIsToolsCollapsed(!isToolsCollapsed)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-bold text-[11px] border transition-all cursor-pointer shrink-0 shadow-2xs hover:scale-102 active:scale-95 ${
              isToolsCollapsed
                ? 'bg-purple-600 text-white border-purple-500 shadow-purple-600/30'
                : 'bg-purple-100/90 hover:bg-purple-200 text-purple-900 border-purple-300/80'
            }`}
            title={isToolsCollapsed ? (isEn ? 'Expand Tools' : '展开绘制工具栏') : (isEn ? 'Collapse Tools' : '折叠绘制工具栏')}
          >
            <span className="font-black">{isEn ? 'Fold Tools' : '折叠工具'}</span>
            {isToolsCollapsed ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5 text-purple-700" />
            )}
          </button>

          {/* Active Tool Badge when Collapsed */}
          {isToolsCollapsed && (
            <div className="flex items-center gap-1.5 bg-purple-50/90 px-2 py-1 rounded-xl border border-purple-200/80 text-[11px] font-bold text-purple-900 animate-in fade-in duration-200 shrink-0">
              <span className="text-purple-500 font-medium">{isEn ? 'Active:' : '当前:'}</span>
              <span className="text-purple-600">{tools.find(t => t.id === activeTool)?.icon}</span>
              <span>{tools.find(t => t.id === activeTool)?.label.split(' ')[0]}</span>
            </div>
          )}

          {/* Collapsible Tools Container with Smooth Unfolding & Shrinking Animation ("铺开和收缩") */}
          <div
            className={`flex items-center gap-2.5 transition-all duration-300 ease-in-out origin-left overflow-hidden ${
              isToolsCollapsed
                ? 'max-w-0 opacity-0 -translate-x-2 pointer-events-none'
                : 'max-w-[1400px] opacity-100 translate-x-0'
            }`}
          >
            {/* Paint & Shape Tools Buttons */}
            <div className="flex items-center bg-purple-50/90 p-0.5 rounded-xl border border-purple-200/80 shrink-0">
              {tools.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTool(t.id)}
                  className={`flex items-center gap-1 p-1.5 sm:px-2 sm:py-1.5 rounded-lg font-bold transition-all cursor-pointer shrink-0 ${
                    activeTool === t.id
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'text-purple-800 hover:text-purple-950 hover:bg-purple-100/80'
                  }`}
                  title={t.label}
                >
                  {t.icon}
                  <span className="hidden xl:inline text-[11px]">{t.label.split(' ')[0]}</span>
                </button>
              ))}
            </div>

            {/* Symmetry Selector */}
            <div className="flex items-center bg-purple-50/90 p-0.5 rounded-xl border border-purple-200/80 text-[11px] shrink-0">
              <span className="px-1.5 text-purple-700 flex items-center gap-1 font-bold">
                <Spline className="w-3 h-3 text-purple-600" />
                {isEn ? 'Symmetry:' : '对称:'}
              </span>
              <select
                value={symmetryMode}
                onChange={e => setSymmetryMode(e.target.value as SymmetryMode)}
                className="bg-white border border-purple-200 rounded-lg px-1.5 py-0.5 text-purple-900 font-bold outline-none cursor-pointer"
              >
                <option value="none">{isEn ? 'None' : '无对称'}</option>
                <option value="horizontal">{isEn ? '↔ Horizontal' : '↔ 左右镜像'}</option>
                <option value="vertical">{isEn ? '↕ Vertical' : '↕ 上下镜像'}</option>
                <option value="quad">{isEn ? '❖ 4-Axis' : '❖ 4向四轴镜像'}</option>
              </select>
            </div>

            {/* Undo / Redo */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onPointerDown={event => startHistoryRepeat(undoRepeatRef.current!, event)}
                onPointerUp={() => stopHistoryRepeat(undoRepeatRef.current!)}
                onPointerCancel={() => stopHistoryRepeat(undoRepeatRef.current!)}
                onPointerLeave={() => stopHistoryRepeat(undoRepeatRef.current!)}
                onLostPointerCapture={() => stopHistoryRepeat(undoRepeatRef.current!)}
                onClick={() => {
                  if (undoRepeatRef.current!.shouldHandleClick()) onUndo();
                }}
                disabled={!canUndo}
                className="p-1.5 rounded-lg text-purple-800 hover:text-purple-950 hover:bg-purple-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
                title={isEn ? 'Undo (Ctrl+Z)' : '撤销 (Ctrl+Z)'}
                aria-label={isEn ? 'Undo' : '撤销'}
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                onPointerDown={event => startHistoryRepeat(redoRepeatRef.current!, event)}
                onPointerUp={() => stopHistoryRepeat(redoRepeatRef.current!)}
                onPointerCancel={() => stopHistoryRepeat(redoRepeatRef.current!)}
                onPointerLeave={() => stopHistoryRepeat(redoRepeatRef.current!)}
                onLostPointerCapture={() => stopHistoryRepeat(redoRepeatRef.current!)}
                onClick={() => {
                  if (redoRepeatRef.current!.shouldHandleClick()) onRedo();
                }}
                disabled={!canRedo}
                className="p-1.5 rounded-lg text-purple-800 hover:text-purple-950 hover:bg-purple-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
                title={isEn ? 'Redo (Ctrl+Y)' : '重做 (Ctrl+Y)'}
                aria-label={isEn ? 'Redo' : '重做'}
              >
                <Redo2 className="w-4 h-4" />
              </button>
              <button
                onClick={onClearOuterBackground}
                className="p-1.5 rounded-lg text-purple-800 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                title={isEn ? 'Clear edge-connected background beads' : '清除与边缘连通的背景豆'}
              >
                <Scissors className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right: Display Overlays, Backdrop & Zoom Controls */}
      <div className="flex items-center gap-2.5 shrink-0 ml-2">
        <button
          onClick={onSavePattern}
          disabled={isSavingPattern}
          className="inline-flex items-center gap-1 rounded-xl border border-sky-300 bg-sky-600 px-2 py-1.5 text-[11px] font-bold text-white shadow-2xs transition-colors hover:bg-sky-700 disabled:cursor-wait disabled:opacity-60"
          title={isEn ? 'Save editable pattern without downloading' : '保存可编辑图纸，不下载文件'}
        >
          <Save className={`w-3.5 h-3.5 ${isSavingPattern ? 'animate-pulse' : ''}`} />
          <span className="hidden md:inline">{isSavingPattern ? (isEn ? 'Saving' : '保存中') : (isEn ? 'Save' : '保存')}</span>
        </button>

        {/* Canvas Backdrop Selector */}
        <div className="flex items-center bg-purple-50/90 p-0.5 rounded-xl border border-purple-200/80 text-[11px]">
          <span className="px-1.5 text-purple-700 flex items-center gap-1 font-bold">
            <Layers className="w-3 h-3 text-purple-600" />
            {isEn ? 'Bg:' : '背景:'}
          </span>
          <select
            value={canvasBackdrop}
            onChange={e => setCanvasBackdrop(e.target.value as CanvasBackdrop)}
            className="bg-white border border-purple-200 rounded-lg px-1.5 py-0.5 text-purple-900 font-bold outline-none cursor-pointer"
          >
            <option value="dark_grid">{isEn ? 'Dark Grid' : '深色网格'}</option>
            <option value="light_pegboard">{isEn ? 'Light Pegboard' : '白色插板'}</option>
            <option value="wood">{isEn ? 'Wood Texture' : '复古木纹'}</option>
            <option value="studio">{isEn ? 'Dark Studio' : '暗调工作台'}</option>
          </select>
        </div>

        {/* Bead Shape Style */}
        <div className="flex items-center rounded-xl border border-purple-200/80 bg-purple-50/90 p-0.5 text-[11px]" role="group" aria-label={isEn ? 'Bead display style' : '拼豆显示样式'}>
          <button
            onClick={() => setBeadShape('fuse_3d')}
            className={`flex items-center gap-1 cursor-pointer font-bold ${shapeButtonClass(beadShape === 'fuse_3d')}`}
            title={isEn ? '3D Fuse Bead' : '3D立体拼豆样式'}
            aria-label={isEn ? '3D Bead' : '3D立体豆'}
          >
            <CircleIcon className="w-3.5 h-3.5 fill-current" />
            <span className="hidden lg:inline">{isEn ? '3D Bead' : '3D立体豆'}</span>
          </button>
          <button
            onClick={() => setBeadShape('circle_flat')}
            className={`flex items-center gap-1 cursor-pointer font-bold ${shapeButtonClass(beadShape === 'circle_flat')}`}
            title={isEn ? 'Flat Round Bead' : '平面圆豆样式'}
            aria-label={isEn ? 'Flat Round' : '平面圆豆'}
          >
            <CircleIcon className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">{isEn ? 'Flat Round' : '平面圆豆'}</span>
          </button>
          <button
            onClick={() => setBeadShape('square')}
            className={`flex items-center gap-1 cursor-pointer font-bold ${shapeButtonClass(beadShape === 'square')}`}
            title={isEn ? 'Pixel Square' : '像素方块样式'}
            aria-label={isEn ? 'Pixel Square' : '像素方块'}
          >
            <Square className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">{isEn ? 'Pixel Square' : '像素方块'}</span>
          </button>
          <button
            onClick={() => setBeadShape('ironed')}
            className={`flex items-center gap-1 cursor-pointer font-bold ${shapeButtonClass(beadShape === 'ironed')}`}
            title={isEn ? 'Ironed Preview' : '熨烫预览'}
            aria-label={isEn ? 'Ironed Preview' : '熨烫预览'}
          >
            <Flame className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">{isEn ? 'Ironed' : '熨烫预览'}</span>
          </button>
        </div>

        {/* Overlays: Symbols & Overlay photo */}
        <div className="flex items-center gap-1">
          {hasImage && (
            <button
              onClick={() => setShowOverlay(!showOverlay)}
              className={`px-2 py-1.5 rounded-xl border transition-all flex items-center gap-1 cursor-pointer font-bold text-[11px] ${
                showOverlay
                  ? 'bg-amber-100 border-amber-300 text-amber-900 shadow-2xs'
                  : 'bg-purple-50/90 border-purple-200 text-purple-800 hover:text-purple-950'
              }`}
              title={isEn ? 'Toggle original image overlay' : '在网格上显示原图半透明叠影衬底'}
            >
              <Eye className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isEn ? 'Overlay' : '原图叠影'}</span>
            </button>
          )}

          <button
            onClick={() => setShowSymbols(!showSymbols)}
            className={`px-2 py-1.5 rounded-xl border transition-all flex items-center gap-1 cursor-pointer font-bold text-[11px] ${
              showSymbols
                ? 'bg-purple-100 border-purple-300 text-purple-900 shadow-2xs'
                : 'bg-purple-50/90 border-purple-200 text-purple-700 hover:text-purple-950'
            }`}
            title={isEn ? 'Toggle color code symbols' : '显示/隐藏拼豆色号标识/符号'}
          >
            <Hash className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isEn ? 'Symbols' : '色号标识'}</span>
          </button>

          <button
            onClick={() => setShowGridLines(!showGridLines)}
            className={`px-2 py-1.5 rounded-xl border transition-all flex items-center gap-1 cursor-pointer font-bold text-[11px] ${
              showGridLines
                ? 'bg-purple-100 border-purple-300 text-purple-900 shadow-2xs'
                : 'bg-purple-50/90 border-purple-200 text-purple-700 hover:text-purple-950'
            }`}
            title={isEn ? 'Toggle grid lines' : '显示/隐藏网格线'}
          >
            <Grid2x2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isEn ? 'Grid' : '网格线'}</span>
          </button>
        </div>

        <div className="h-5 w-px bg-purple-200 hidden sm:block" />

        {/* Zoom Controls */}
        <div className="flex items-center bg-purple-50/90 rounded-xl p-0.5 border border-purple-200/80">
          <button
            onClick={onZoomOut}
            className="p-1 text-purple-700 hover:text-purple-950 hover:bg-purple-100 rounded-lg cursor-pointer"
            title={isEn ? 'Zoom Out' : '缩小'}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="px-2 text-[11px] font-mono font-bold text-purple-950 min-w-[42px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={onZoomIn}
            className="p-1 text-purple-700 hover:text-purple-950 hover:bg-purple-100 rounded-lg cursor-pointer"
            title={isEn ? 'Zoom In' : '放大'}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onResetZoom}
            className="p-1 text-purple-700 hover:text-purple-950 hover:bg-purple-100 rounded-lg cursor-pointer"
            title={isEn ? 'Reset Zoom' : '适应屏幕'}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
