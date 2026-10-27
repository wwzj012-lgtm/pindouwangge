import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Circle as CircleIcon,
  Download,
  Eraser,
  Eye,
  Flame,
  Grid2x2,
  Hand,
  Hash,
  Layers,
  Minus,
  PaintBucket,
  Pencil,
  Pipette,
  Redo2,
  RefreshCw,
  Save,
  Scissors,
  Shapes,
  SlidersHorizontal,
  Spline,
  Square,
  Undo2,
  FlipHorizontal2,
  FlipVertical2,
  Timer,
  Trash2,
} from 'lucide-react';
import { BeadColor, BeadShape, ToolType, SymmetryMode, CanvasBackdrop } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { createPressRepeatController, type PressRepeatController } from '../utils/pressRepeat';
import { SymmetryAxisControls, type WorkspaceEditingActions } from './SymmetryAxisControls';

interface ToolbarProps {
  onOpenBackgroundCleanup?: () => void;
  canCleanupBackground?: boolean;
  editorActions?: WorkspaceEditingActions;
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
  overlayOpacity: number;
  setOverlayOpacity: (opacity: number) => void;
  onSavePattern: () => void;
  isSavingPattern: boolean;
  onOpenExport: () => void;
  canExport: boolean;
}

type MenuId = 'shape' | 'symmetry' | 'view' | 'assist' | 'mirror' | null;

const buttonBase = 'inline-flex min-h-8 items-center justify-center gap-1 rounded-lg border px-2 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40';
const iconButton = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-purple-800 transition-colors hover:border-purple-200 hover:bg-purple-100 hover:text-purple-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-35';

export const Toolbar: React.FC<ToolbarProps> = ({
  onOpenBackgroundCleanup,
  canCleanupBackground = false,
  editorActions,
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
  overlayOpacity,
  setOverlayOpacity,
  onSavePattern,
  isSavingPattern,
  onOpenExport,
  canExport,
}) => {
  const { language } = useLanguage();
  const isEn = language === 'en';
  const [openMenu, setOpenMenu] = useState<MenuId>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const menuTriggerRefs = useRef<Record<Exclude<MenuId, null>, HTMLButtonElement | null>>({ shape: null, symmetry: null, view: null, assist: null, mirror: null });
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
    const stopHistoryRepeat = () => {
      undoRepeatRef.current?.stop();
      redoRepeatRef.current?.stop();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !openMenu) return;
      event.preventDefault();
      const menu = openMenu;
      setOpenMenu(null);
      window.setTimeout(() => menuTriggerRefs.current[menu]?.focus(), 0);
    };
    const closeOutside = (event: PointerEvent) => {
      if (openMenu && event.target instanceof Node && !toolbarRef.current?.contains(event.target)) setOpenMenu(null);
    };

    window.addEventListener('blur', stopHistoryRepeat);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', closeOutside);
    return () => {
      window.removeEventListener('blur', stopHistoryRepeat);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', closeOutside);
      stopHistoryRepeat();
    };
  }, [openMenu]);

  const startHistoryRepeat = (controller: PressRepeatController, event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    controller.start();
  };

  const stopHistoryRepeat = (controller: PressRepeatController) => controller.stop();
  const toggleMenu = (menu: Exclude<MenuId, null>) => setOpenMenu(current => current === menu ? null : menu);
  const closeMenu = () => setOpenMenu(null);

  const tools: { id: ToolType; label: string; icon: React.ReactNode }[] = [
    { id: 'pencil', label: isEn ? 'Pencil (P)' : '画笔 (P)', icon: <Pencil className="h-3.5 w-3.5" /> },
    { id: 'hand', label: isEn ? 'Pan / Move (H)' : '平移拖拽 (H)', icon: <Hand className="h-3.5 w-3.5" /> },
    { id: 'bucket', label: isEn ? 'Fill Bucket (B)' : '油漆桶 (B)', icon: <PaintBucket className="h-3.5 w-3.5" /> },
    { id: 'eraser', label: isEn ? 'Eraser (E)' : '橡皮擦 (E)', icon: <Eraser className="h-3.5 w-3.5" /> },
    { id: 'eyedropper', label: isEn ? 'Color Picker (I)' : '吸管 (I)', icon: <Pipette className="h-3.5 w-3.5" /> },
    { id: 'region_clear', label: isEn ? 'Clear Region (U)' : '区域清除 (U)', icon: <Trash2 className="h-3.5 w-3.5" /> },
  ];
  const shapeTools: { id: ToolType; label: string; icon: React.ReactNode }[] = [
    { id: 'line', label: isEn ? 'Line' : '直线', icon: <Minus className="h-3.5 w-3.5" /> },
    { id: 'rectangle', label: isEn ? 'Rectangle' : '矩形', icon: <Square className="h-3.5 w-3.5" /> },
    { id: 'circle', label: isEn ? 'Circle' : '圆形', icon: <CircleIcon className="h-3.5 w-3.5" /> },
  ];
  const shapeTool = shapeTools.find(tool => tool.id === activeTool);
  const symmetryLabel = {
    none: isEn ? 'None' : '无对称',
    horizontal: isEn ? 'Horizontal' : '左右镜像',
    vertical: isEn ? 'Vertical' : '上下镜像',
    quad: isEn ? '4-axis' : '四轴镜像',
  }[symmetryMode];

  const toolButton = (tool: { id: ToolType; label: string; icon: React.ReactNode }) => (
    <button
      key={tool.id}
      type="button"
      onClick={() => setActiveTool(tool.id)}
      aria-label={tool.label}
      aria-pressed={activeTool === tool.id}
      title={tool.label}
      className={`${buttonBase} ${activeTool === tool.id
        ? 'border-purple-600 bg-purple-600 text-white shadow-sm hover:bg-purple-700'
        : 'border-transparent text-purple-800 hover:border-purple-200 hover:bg-purple-100 hover:text-purple-950'}`}
    >
      {tool.icon}
      <span className="hidden min-[1180px]:inline">{tool.label.split(' ')[0]}</span>
    </button>
  );

  const menuButton = (menu: Exclude<MenuId, null>, icon: React.ReactNode, label: string) => (
    <button
      ref={element => { menuTriggerRefs.current[menu] = element; }}
      type="button"
      onClick={() => toggleMenu(menu)}
      aria-haspopup="menu"
      aria-label={label}
      title={label}
      aria-expanded={openMenu === menu}
      aria-controls={`toolbar-${menu}-menu`}
      className={`${buttonBase} ${openMenu === menu ? 'border-purple-300 bg-purple-100 text-purple-950' : 'border-purple-200 bg-white/70 text-purple-800 hover:bg-purple-100'}`}
    >
      {icon}
      <span className="hidden min-[1100px]:inline">{label}</span>
      <ChevronDown className={`h-3 w-3 transition-transform ${openMenu === menu ? 'rotate-180' : ''}`} />
    </button>
  );

  return (
    <div ref={toolbarRef} className="relative z-20 isolate shrink-0 border-b border-purple-200/80 bg-white/95 px-2.5 py-1.5 text-purple-950 shadow-sm select-none">
      <div className="flex flex-nowrap items-center gap-1.5 overflow-visible">
        <div className="flex shrink-0 flex-nowrap items-center gap-1 rounded-xl border border-purple-100 bg-purple-50/70 p-0.5" role="group" aria-label={isEn ? 'Drawing tools' : '绘图工具'}>
          {tools.map(toolButton)}
        </div>

        <div className="relative">
          {menuButton('shape', shapeTool?.icon ?? <Shapes className="h-3.5 w-3.5" />, isEn ? (shapeTool?.label ?? 'Shapes') : (shapeTool?.label ?? '形状'))}
          {openMenu === 'shape' && (
            <div id="toolbar-shape-menu" role="menu" className="absolute left-0 top-full mt-1 flex min-w-max gap-1 rounded-xl border border-purple-200 bg-white p-1.5 shadow-lg">
              {shapeTools.map(tool => (
                <button key={tool.id} type="button" role="menuitemradio" aria-checked={activeTool === tool.id} onClick={() => { setActiveTool(tool.id); closeMenu(); }} className={`${buttonBase} ${activeTool === tool.id ? 'border-purple-600 bg-purple-600 text-white' : 'border-transparent text-purple-800 hover:bg-purple-100'}`}>
                  {tool.icon}<span>{tool.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          {menuButton('symmetry', <Spline className="h-3.5 w-3.5" />, isEn ? `Symmetry: ${symmetryLabel}` : `对称：${symmetryLabel}`)}
          {openMenu === 'symmetry' && (
            <div id="toolbar-symmetry-menu" role="menu" className="absolute left-0 top-full mt-1 grid min-w-[180px] gap-1 rounded-xl border border-purple-200 bg-white p-1.5 shadow-lg">
              {(['none', 'horizontal', 'vertical', 'quad'] as SymmetryMode[]).map(mode => (
                <button key={mode} type="button" role="menuitemradio" aria-checked={symmetryMode === mode} onClick={() => { setSymmetryMode(mode); closeMenu(); }} className={`flex min-h-8 items-center justify-between rounded-lg px-2 text-left text-[11px] font-bold ${symmetryMode === mode ? 'bg-purple-100 text-purple-950' : 'text-purple-800 hover:bg-purple-50'}`}>
                  <span>{{ none: isEn ? 'None' : '无对称', horizontal: isEn ? '↔ Horizontal' : '↔ 左右镜像', vertical: isEn ? '↕ Vertical' : '↕ 上下镜像', quad: isEn ? '❖ 4-axis' : '❖ 四轴镜像' }[mode]}</span>
                  {symmetryMode === mode && <span aria-hidden="true">✓</span>}
                </button>
              ))}
              <SymmetryAxisControls actions={editorActions} mode={symmetryMode} isEn={isEn} />
            </div>
          )}
        </div>

        <div className="relative">
          {menuButton('view', <SlidersHorizontal className="h-3.5 w-3.5" />, isEn ? 'View' : '视图')}
          {openMenu === 'view' && (
            <div id="toolbar-view-menu" role="menu" className="absolute left-0 top-full mt-1 grid min-w-[245px] gap-1.5 rounded-xl border border-purple-200 bg-white p-2 shadow-lg">
              <label className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-[11px] font-bold text-purple-900 hover:bg-purple-50">
                <span className="inline-flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" />{isEn ? 'Backdrop' : '画布背景'}</span>
                <select value={canvasBackdrop} onChange={event => setCanvasBackdrop(event.target.value as CanvasBackdrop)} className="rounded-md border border-purple-200 bg-white px-1.5 py-1 text-[10px] font-bold text-purple-900 outline-none focus-visible:ring-2 focus-visible:ring-purple-500">
                  <option value="dark_grid">{isEn ? 'Dark Grid' : '深色网格'}</option>
                  <option value="light_pegboard">{isEn ? 'Light Pegboard' : '白色插板'}</option>
                  <option value="wood">{isEn ? 'Wood Texture' : '复古木纹'}</option>
                  <option value="studio">{isEn ? 'Dark Studio' : '暗调工作台'}</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-purple-100 bg-purple-50/50 p-1" role="group" aria-label={isEn ? 'Bead display style' : '拼豆显示样式'}>
                {([
                  ['fuse_3d', <CircleIcon className="h-3.5 w-3.5 fill-current" />, isEn ? '3D' : '3D豆'],
                  ['circle_flat', <CircleIcon className="h-3.5 w-3.5" />, isEn ? 'Flat' : '平面圆'],
                  ['square', <Square className="h-3.5 w-3.5" />, isEn ? 'Pixel' : '像素方'],
                  ['ironed', <Flame className="h-3.5 w-3.5" />, isEn ? 'Ironed' : '熨烫'],
                ] as [BeadShape, React.ReactNode, string][]).map(([shape, icon, label]) => (
                  <button key={shape} type="button" aria-pressed={beadShape === shape} onClick={() => setBeadShape(shape)} className={`inline-flex min-h-8 items-center justify-center gap-1 rounded-md px-1.5 text-[10px] font-bold ${beadShape === shape ? 'bg-purple-600 text-white' : 'text-purple-800 hover:bg-purple-100'}`}>
                    {icon}{label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1">
                <button type="button" aria-pressed={showSymbols} onClick={() => setShowSymbols(!showSymbols)} className={`${buttonBase} ${showSymbols ? 'border-purple-300 bg-purple-100 text-purple-950' : 'border-purple-100 bg-white text-purple-800'}`}><Hash className="h-3.5 w-3.5" />{isEn ? 'Symbols' : '色号'}</button>
                <button type="button" aria-pressed={showGridLines} onClick={() => setShowGridLines(!showGridLines)} className={`${buttonBase} ${showGridLines ? 'border-purple-300 bg-purple-100 text-purple-950' : 'border-purple-100 bg-white text-purple-800'}`}><Grid2x2 className="h-3.5 w-3.5" />{isEn ? 'Grid' : '网格'}</button>
                <button type="button" aria-pressed={showCoordinates} onClick={() => setShowCoordinates(!showCoordinates)} className={`${buttonBase} ${showCoordinates ? 'border-purple-300 bg-purple-100 text-purple-950' : 'border-purple-100 bg-white text-purple-800'}`}>{isEn ? 'Coords' : '坐标'}</button>
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          {menuButton('assist', <Eye className="h-3.5 w-3.5" />, isEn ? 'Assist' : '辅助')}
          {openMenu === 'assist' && (
            <div id="toolbar-assist-menu" role="menu" className="absolute left-0 top-full mt-1 grid min-w-[220px] gap-1.5 rounded-xl border border-purple-200 bg-white p-2 shadow-lg">
              <button type="button" onClick={onClearOuterBackground} className={`${buttonBase} w-full justify-start border-rose-100 bg-white text-rose-700 hover:bg-rose-50`}><Scissors className="h-3.5 w-3.5" />{isEn ? 'Clear edge background' : '清除边缘背景'}</button>
              {onOpenBackgroundCleanup && <button type="button" onClick={() => { closeMenu(); onOpenBackgroundCleanup(); }} disabled={!canCleanupBackground}
                className={`${buttonBase} min-h-11 w-full justify-start border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100`}>
                <Scissors className="h-3.5 w-3.5" />{isEn ? 'Preview residual cleanup' : '清理残点（先预览）'}
              </button>}
              <button type="button" onClick={() => { setActiveTool('replace'); closeMenu(); }} aria-pressed={activeTool === 'replace'} className={`${buttonBase} w-full justify-start ${activeTool === 'replace' ? 'border-purple-600 bg-purple-600 text-white' : 'border-purple-100 bg-white text-purple-800 hover:bg-purple-50'}`}><RefreshCw className="h-3.5 w-3.5" />{isEn ? 'Replace color (R)' : '替换全图此色'}</button>
              {hasImage && (
                <div className="rounded-lg border border-purple-100 bg-purple-50/50 p-1">
                  <button type="button" aria-pressed={showOverlay} onClick={() => setShowOverlay(!showOverlay)} className={`${buttonBase} w-full justify-start ${showOverlay ? 'border-amber-300 bg-amber-100 text-amber-950' : 'border-transparent text-purple-800 hover:bg-purple-100'}`}><Eye className="h-3.5 w-3.5" />{isEn ? 'Original overlay' : '原图叠影'}</button>
                  {showOverlay && <label className="flex items-center gap-2 px-2 py-1 text-[10px] font-bold text-purple-800"><span>{isEn ? 'Opacity' : '透明度'}</span><input type="range" min="10" max="70" step="5" value={Math.round(overlayOpacity * 100)} onChange={event => setOverlayOpacity(Number(event.target.value) / 100)} className="min-w-0 flex-1 accent-amber-500" aria-label={isEn ? 'Overlay opacity' : '原图叠底透明度'} /></label>}
                </div>
              )}
            </div>
          )}
        </div>

        <button type="button" onClick={onOpenColorPicker} className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-2 text-left transition-colors hover:bg-purple-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1" title={isEn ? 'Click to select active bead color' : '点击选择当前涂色拼豆'}>
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-black/20 text-[9px] font-black shadow-inner" style={{ backgroundColor: selectedColor ? selectedColor.hex : '#CCCCCC' }}>{selectedColor?.symbol || ''}</span>
          <span className="min-w-0"><span className="block text-[11px] font-black leading-none text-purple-950">{selectedColor ? selectedColor.code : (isEn ? 'None' : '未选择')}</span><span className="mt-0.5 block max-w-[72px] truncate text-[9px] leading-none text-purple-600">{selectedColor ? selectedColor.name : (isEn ? 'Select color' : '选色')}</span></span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-purple-100 bg-white/70 p-0.5" role="group" aria-label={isEn ? 'History controls' : '历史操作'}>
          <button type="button" onPointerDown={event => startHistoryRepeat(undoRepeatRef.current!, event)} onPointerUp={() => stopHistoryRepeat(undoRepeatRef.current!)} onPointerCancel={() => stopHistoryRepeat(undoRepeatRef.current!)} onPointerLeave={() => stopHistoryRepeat(undoRepeatRef.current!)} onLostPointerCapture={() => stopHistoryRepeat(undoRepeatRef.current!)} onClick={() => { if (undoRepeatRef.current!.shouldHandleClick()) onUndo(); }} disabled={!canUndo} className={iconButton} title={isEn ? 'Undo (Ctrl+Z)' : '撤销 (Ctrl+Z)'} aria-label={isEn ? 'Undo' : '撤销'}><Undo2 className="h-4 w-4" /></button>
          <button type="button" onPointerDown={event => startHistoryRepeat(redoRepeatRef.current!, event)} onPointerUp={() => stopHistoryRepeat(redoRepeatRef.current!)} onPointerCancel={() => stopHistoryRepeat(redoRepeatRef.current!)} onPointerLeave={() => stopHistoryRepeat(redoRepeatRef.current!)} onLostPointerCapture={() => stopHistoryRepeat(redoRepeatRef.current!)} onClick={() => { if (redoRepeatRef.current!.shouldHandleClick()) onRedo(); }} disabled={!canRedo} className={iconButton} title={isEn ? 'Redo (Ctrl+Y)' : '重做 (Ctrl+Y)'} aria-label={isEn ? 'Redo' : '重做'}><Redo2 className="h-4 w-4" /></button>
        </div>
        {editorActions && <div className="relative shrink-0">
          {menuButton('mirror', <FlipHorizontal2 className="h-3.5 w-3.5" />, isEn ? 'Mirror' : '镜像翻转')}
          {openMenu === 'mirror' && <div id="toolbar-mirror-menu" role="menu" className="absolute right-0 top-full mt-1 grid min-w-[170px] gap-1 rounded-xl border border-purple-200 bg-white p-2 shadow-lg">
            <button type="button" disabled={editorActions.isPracticeMode} className={buttonBase} onClick={() => { editorActions.onMirrorFlip('horizontal'); closeMenu(); }}><FlipHorizontal2 size={14} />{isEn ? 'Flip left/right' : '整图左右翻转'}</button>
            <button type="button" disabled={editorActions.isPracticeMode} className={buttonBase} onClick={() => { editorActions.onMirrorFlip('vertical'); closeMenu(); }}><FlipVertical2 size={14} />{isEn ? 'Flip top/bottom' : '整图上下翻转'}</button>
          </div>}
        </div>}
        {editorActions && <button type="button" aria-pressed={editorActions.isPracticeMode} onClick={editorActions.onTogglePractice}
          className={`${buttonBase} shrink-0 ${editorActions.isPracticeMode ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          <Timer size={14} />{isEn ? 'Practice' : '拼豆实操'}
        </button>}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button type="button" onClick={onSavePattern} disabled={isSavingPattern} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-sky-300 bg-sky-600 px-2.5 text-[11px] font-black text-white shadow-sm transition-colors hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60" title={isEn ? 'Save editable pattern without downloading' : '保存可编辑图纸，不下载文件'}>
            <Save className={`h-3.5 w-3.5 ${isSavingPattern ? 'animate-pulse' : ''}`} />{isEn ? (isSavingPattern ? 'Saving' : 'Save') : (isSavingPattern ? '保存中' : '保存')}
          </button>
          <button type="button" onClick={onOpenExport} disabled={!canExport} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-600 px-2.5 text-[11px] font-black text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-45" title={canExport ? (isEn ? 'Export pattern and materials list' : '导出图纸与用量清单') : (isEn ? 'Add beads to the canvas before exporting' : '请先导入图片或在画布上绘制拼豆')}>
            <Download className="h-3.5 w-3.5" />{isEn ? 'Export' : '导出'}
          </button>
        </div>
      </div>


    </div>
  );
};
