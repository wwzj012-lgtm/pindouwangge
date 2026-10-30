import React from 'react';
import {
  X,
  Sparkles,
  Zap,
  Palette,
  Image as ImageIcon,
  BookOpen,
  RotateCcw,
  Sliders,
  Scissors,
  Hash,
  Grid2x2,
  Eye,
  Circle as CircleIcon,
  Square,
  Flame,
  Wand2,
  Download,
  Share2,
  Save,
  Crown,
  ChevronRight,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Trash2,
  Timer,
} from 'lucide-react';
import { BeadShape, SymmetryMode, CanvasBackdrop } from '../../types';
import { SymmetryAxisControls, type WorkspaceEditingActions } from '../SymmetryAxisControls';

export interface MobileFeatureSheetProps {
  editorActions?: WorkspaceEditingActions;
  isOpen: boolean;
  onClose: () => void;
  // Feature actions
  onOpenSmartReduce?: () => void;
  onOpenPaletteModal?: () => void;
  onOpenPatternsModal?: () => void;
  onOpenGuideModal: () => void;
  onOpenVipModal?: () => void;
  onClearCanvas: () => void;
  onClearOuterBackground: () => void;
  onResetZoom: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onOpenExportModal?: () => void;
  onTogglePractice?: () => void;
  isPracticeMode?: boolean;
  onOpenResidualCleanup?: () => void;
  residualCleanupDisabled?: boolean;
  onSelectRegionClear?: () => void;
  isRegionClearActive?: boolean;

  // View states
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
  showOverlay: boolean;
  setShowOverlay: (show: boolean) => void;
  overlayOpacity: number;
  setOverlayOpacity: (opacity: number) => void;
  hasSourceImage: boolean;

  isEn: boolean;
}

export const MobileFeatureSheet: React.FC<MobileFeatureSheetProps> = ({
  editorActions,
  isOpen,
  onClose,
  onOpenSmartReduce,
  onOpenPaletteModal,
  onOpenPatternsModal,
  onOpenGuideModal,
  onOpenVipModal,
  onClearCanvas,
  onClearOuterBackground,
  onResetZoom,
  onZoomIn,
  onZoomOut,
  onOpenExportModal,
  onTogglePractice,
  isPracticeMode = false,
  onOpenResidualCleanup,
  residualCleanupDisabled = false,
  onSelectRegionClear,
  isRegionClearActive = false,
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
  showOverlay,
  setShowOverlay,
  overlayOpacity,
  setOverlayOpacity,
  hasSourceImage,
  isEn,
}) => {

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      {/* Backdrop tap to close */}
      <div className="flex-1" onClick={onClose} />

      {/* Sheet Container with iOS style rounded corners */}
      <div className="bg-white rounded-t-3xl shadow-2xl max-h-[85dvh] overflow-y-auto p-4 pb-[calc(1.5rem+var(--safe-bottom))] space-y-4 border-t border-purple-100 animate-in slide-in-from-bottom-5 duration-200 select-none">
        {/* Top Drag Handle */}
        <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto" />

        {/* Sheet Title */}
        <div className="flex items-start justify-between gap-3 px-1">
          <div>
            <h3 className="text-base font-black text-slate-900">
              {isEn ? 'Board Toolkit' : '画板工具箱'}
            </h3>
            <p className="mt-0.5 text-xs font-bold text-slate-500">
              {isEn ? 'Customize rendering, shape, and quick actions' : '自定义拼豆质感、显示辅助线及核心捷径'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={isEn ? 'Close' : '关闭'}
            className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-700 transition-colors active:bg-slate-200"
          >
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100">
              <X className="h-4 w-4" aria-hidden="true" />
            </span>
          </button>
        </div>

        <div className="space-y-4">

        {/* 1. Bead Shape & Texture */}
        <div className="bg-purple-50/60 p-3 rounded-2xl border border-purple-100/90 space-y-2">
          <span className="text-xs font-black text-purple-900 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-purple-600" />
            {isEn ? 'Bead Rendering Texture' : '拼豆形状与渲染质感'}
          </span>
          <div className="grid grid-cols-4 gap-1.5">
            <button
              onClick={() => setBeadShape('fuse_3d')}
              className={`p-2 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                beadShape === 'fuse_3d'
                  ? 'bg-purple-600 border-purple-600 text-white font-black shadow-xs'
                  : 'bg-white border-purple-200 text-slate-700 font-bold hover:bg-purple-50'
              }`}
            >
              <CircleIcon className="w-4 h-4" />
              <span className="text-xs">{isEn ? '3D Fuse' : '3D圆豆'}</span>
            </button>
            <button
              onClick={() => setBeadShape('circle_flat')}
              className={`p-2 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                beadShape === 'circle_flat'
                  ? 'bg-purple-600 border-purple-600 text-white font-black shadow-xs'
                  : 'bg-white border-purple-200 text-slate-700 font-bold hover:bg-purple-50'
              }`}
            >
              <CircleIcon className="w-4 h-4" />
              <span className="text-xs">{isEn ? 'Flat' : '扁平圆'}</span>
            </button>
            <button
              onClick={() => setBeadShape('square')}
              className={`p-2 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                beadShape === 'square'
                  ? 'bg-purple-600 border-purple-600 text-white font-black shadow-xs'
                  : 'bg-white border-purple-200 text-slate-700 font-bold hover:bg-purple-50'
              }`}
            >
              <Square className="w-4 h-4" />
              <span className="text-xs">{isEn ? 'Pixel' : '方块'}</span>
            </button>
            <button
              onClick={() => setBeadShape('ironed')}
              className={`p-2 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                beadShape === 'ironed'
                  ? 'bg-purple-600 border-purple-600 text-white font-black shadow-xs'
                  : 'bg-white border-purple-200 text-slate-700 font-bold hover:bg-purple-50'
              }`}
            >
              <Flame className="w-4 h-4" />
              <span className="text-xs">{isEn ? 'Ironed' : '融豆'}</span>
            </button>
          </div>
        </div>

        {/* 2. Visual Overlays & Display Toggles */}
        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/90 space-y-2">
          <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-600" />
            {isEn ? 'Display Guides & Overlay' : '视觉辅助线与叠影'}
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setShowSymbols(!showSymbols)}
              className={`min-h-11 p-2.5 rounded-xl border flex items-center justify-between text-xs font-black transition-all cursor-pointer ${
                showSymbols
                  ? 'bg-purple-100/90 border-purple-300 text-purple-950'
                  : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <Hash className="w-4 h-4 text-purple-600" />
                <span>{isEn ? 'Color Code' : '色号代码标识'}</span>
              </div>
              <div
                className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                  showSymbols ? 'bg-purple-600 border-purple-600 text-white' : 'border-slate-300'
                }`}
              >
                {showSymbols && <span className="text-xs">✓</span>}
              </div>
            </button>

            <button
              onClick={() => setShowGridLines(!showGridLines)}
              className={`min-h-11 p-2.5 rounded-xl border flex items-center justify-between text-xs font-black transition-all cursor-pointer ${
                showGridLines
                  ? 'bg-purple-100/90 border-purple-300 text-purple-950'
                  : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <Grid2x2 className="w-4 h-4 text-purple-600" />
                <span>{isEn ? 'Pegboard Grid' : '板格分界网格'}</span>
              </div>
              <div
                className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                  showGridLines ? 'bg-purple-600 border-purple-600 text-white' : 'border-slate-300'
                }`}
              >
                {showGridLines && <span className="text-xs">✓</span>}
              </div>
            </button>

            <button
              onClick={() => setShowCoordinates(!showCoordinates)}
              className={`min-h-11 p-2.5 rounded-xl border flex items-center justify-between text-xs font-black transition-all cursor-pointer ${
                showCoordinates
                  ? 'bg-purple-100/90 border-purple-300 text-purple-950'
                  : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-purple-600 font-mono text-sm">#</span>
                <span>{isEn ? 'Coordinates' : '行列标尺刻度'}</span>
              </div>
              <div
                className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                  showCoordinates ? 'bg-purple-600 border-purple-600 text-white' : 'border-slate-300'
                }`}
              >
                {showCoordinates && <span className="text-xs">✓</span>}
              </div>
            </button>

            {hasSourceImage && (
              <div className="space-y-2">
              <button
                onClick={() => setShowOverlay(!showOverlay)}
                className={`min-h-11 p-2.5 rounded-xl border flex items-center justify-between text-xs font-black transition-all cursor-pointer ${
                  showOverlay
                    ? 'bg-amber-100/90 border-amber-300 text-amber-950'
                    : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-amber-600" />
                  <span>{isEn ? 'Source Overlay' : '原图对比叠影'}</span>
                </div>
                <div
                  className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                    showOverlay ? 'bg-amber-600 border-amber-600 text-white' : 'border-slate-300'
                  }`}
                >
                  {showOverlay && <span className="text-xs">✓</span>}
                </div>
              </button>
              {showOverlay && (
                <label className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                  <span className="shrink-0">{isEn ? 'Opacity' : '叠底透明度'}</span>
                  <input type="range" min="10" max="70" step="5" value={Math.round(overlayOpacity * 100)} onChange={event => setOverlayOpacity(Number(event.target.value) / 100)} className="min-w-0 flex-1 accent-amber-500" aria-label={isEn ? 'Overlay opacity' : '原图叠底透明度'} />
                  <span className="w-9 text-right">{Math.round(overlayOpacity * 100)}%</span>
                </label>
              )}
              </div>
            )}
          </div>
        </div>

        {/* 3. Symmetry Drawing Mode */}
        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/90 space-y-2">
          <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
            <Wand2 className="w-3.5 h-3.5 text-indigo-600" />
            {isEn ? 'Symmetry Drawing Mode' : '对称绘图模式'}
          </span>
          <div className="grid grid-cols-4 gap-1.5">
            {(['none', 'horizontal', 'vertical', 'quad'] as SymmetryMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setSymmetryMode(mode)}
                className={`min-h-11 py-2 px-1 rounded-xl border text-xs font-black transition-all cursor-pointer text-center ${
                  symmetryMode === mode
                    ? 'bg-purple-600 border-purple-600 text-white shadow-xs'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-purple-50'
                }`}
              >
                {mode === 'none'
                  ? isEn ? 'Off' : '无对称'
                  : mode === 'horizontal'
                  ? isEn ? 'Horizontal' : '左右水平'
                  : mode === 'vertical'
                  ? isEn ? 'Vertical' : '上下垂直'
                  : isEn ? '4-Way' : '四向对称'}
              </button>
            ))}
          </div>
          <SymmetryAxisControls actions={editorActions} mode={symmetryMode} isEn={isEn}/>
        </div>

        {editorActions && <div className="rounded-2xl border border-purple-200 bg-purple-50 p-3">
          <p className="mb-2 text-xs font-bold text-purple-950">{isEn ? 'Mirror entire pattern' : '镜像翻转整张图纸'}</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={editorActions.isPracticeMode} onClick={() => {editorActions.onMirrorFlip('horizontal');onClose();}} className="min-h-11 rounded-xl border border-purple-200 bg-white text-xs font-bold text-purple-800 disabled:opacity-40">{isEn ? 'Flip left/right' : '左右翻转'}</button>
            <button type="button" disabled={editorActions.isPracticeMode} onClick={() => {editorActions.onMirrorFlip('vertical');onClose();}} className="min-h-11 rounded-xl border border-purple-200 bg-white text-xs font-bold text-purple-800 disabled:opacity-40">{isEn ? 'Flip top/bottom' : '上下翻转'}</button>
          </div>
        </div>}

        {/* 4. Canvas Backdrop Tone */}
        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/90 space-y-2">
          <span className="text-xs font-black text-slate-900">
            {isEn ? 'Board Backdrop Color' : '画板底板底色'}
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['light_pegboard', 'dark_grid', 'wood', 'studio', 'slate'] as CanvasBackdrop[]).map(b => (
              <button
                key={b}
                onClick={() => setCanvasBackdrop(b)}
                className={`flex-1 min-w-[56px] min-h-11 py-1.5 rounded-xl border text-xs font-black transition-all cursor-pointer ${
                  canvasBackdrop === b
                    ? 'bg-purple-600 border-purple-600 text-white shadow-xs'
                    : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                {b === 'light_pegboard'
                  ? isEn ? 'Pegboard' : '洞洞板'
                  : b === 'dark_grid'
                  ? isEn ? 'Dark' : '深色网格'
                  : b === 'wood'
                  ? isEn ? 'Wood' : '木纹'
                  : b === 'studio'
                  ? isEn ? 'Studio' : '专业台'
                  : isEn ? 'Slate' : '岩板'}
              </button>
            ))}
          </div>
        </div>

        {/* 5. View Zoom Controls */}
        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/90 space-y-2">
          <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-indigo-600" />
            {isEn ? 'Canvas Zoom' : '画板缩放'}
          </span>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={onZoomOut}
              title={isEn ? 'Zoom out' : '缩小画板'}
              aria-label={isEn ? 'Zoom out' : '缩小画板'}
              className="h-11 min-w-11 rounded-xl border border-slate-200 bg-white text-slate-700 flex items-center justify-center transition-colors hover:bg-slate-100 active:scale-95 cursor-pointer"
            >
              <ZoomOut className="w-5 h-5" />
            </button>
            <button
              onClick={onResetZoom}
              title={isEn ? 'Reset zoom' : '重置缩放'}
              aria-label={isEn ? 'Reset zoom' : '重置缩放'}
              className="h-11 min-w-11 rounded-xl border border-slate-200 bg-white text-slate-700 flex items-center justify-center transition-colors hover:bg-slate-100 active:scale-95 cursor-pointer"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            <button
              onClick={onZoomIn}
              title={isEn ? 'Zoom in' : '放大画板'}
              aria-label={isEn ? 'Zoom in' : '放大画板'}
              className="h-11 min-w-11 rounded-xl border border-slate-200 bg-white text-slate-700 flex items-center justify-center transition-colors hover:bg-slate-100 active:scale-95 cursor-pointer"
            >
              <ZoomIn className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 6. Shortcuts & Tools Grid */}
        <div className="grid grid-cols-2 gap-2 pt-2">
          {onOpenExportModal && (
            <button
              onClick={() => {
                onClose();
                onOpenExportModal();
              }}
              className="min-h-12 min-w-0 p-3 rounded-2xl bg-purple-600 border border-purple-600 text-white font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer"
            >
              <Download className="w-5 h-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 text-left">
                <p>{isEn ? 'Export pattern' : '导出图纸'}</p>
                <p className="text-xs text-purple-100 font-medium">
                  {isEn ? 'PNG / PDF / BOM' : '图片、图纸与物料单'}
                </p>
              </div>
            </button>
          )}

          {onTogglePractice && (
            <button
              onClick={() => {
                onClose();
                onTogglePractice();
              }}
              aria-pressed={isPracticeMode}
              className={`min-h-12 min-w-0 p-3 rounded-2xl border font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer ${
                isPracticeMode
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-950'
              }`}
            >
              <Timer className={`w-5 h-5 shrink-0 ${isPracticeMode ? 'text-white' : 'text-emerald-600'}`} aria-hidden="true" />
              <div className="min-w-0 text-left">
                <p>{isEn ? 'Practice mode' : '实操模式'}</p>
                <p className={`text-xs font-medium ${isPracticeMode ? 'text-emerald-50' : 'text-emerald-700'}`}>
                  {isPracticeMode ? (isEn ? 'On — tap to exit' : '已开启 · 点击退出') : (isEn ? 'Track bead progress' : '按色号逐步打卡')}
                </p>
              </div>
            </button>
          )}

          {onSelectRegionClear && (
            <button
              onClick={() => {
                onClose();
                onSelectRegionClear();
              }}
              aria-pressed={isRegionClearActive}
              className={`min-h-12 min-w-0 p-3 rounded-2xl border font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer ${
                isRegionClearActive
                  ? 'bg-rose-600 border-rose-600 text-white'
                  : 'bg-rose-50 border-rose-200 text-rose-950'
              }`}
            >
              <Trash2 className={`w-5 h-5 shrink-0 ${isRegionClearActive ? 'text-white' : 'text-rose-600'}`} aria-hidden="true" />
              <div className="min-w-0 text-left">
                <p>{isEn ? 'Clear region' : '区域清除'}</p>
                <p className={`text-xs font-medium ${isRegionClearActive ? 'text-rose-50' : 'text-rose-700'}`}>
                  {isRegionClearActive ? (isEn ? 'Active — tap canvas' : '已开启 · 点击画布生效') : (isEn ? 'Remove linked same color' : '清除连通同色区域')}
                </p>
              </div>
            </button>
          )}

          {onOpenResidualCleanup && (
            <button
              onClick={() => {
                onClose();
                onOpenResidualCleanup();
              }}
              disabled={residualCleanupDisabled}
              className="min-h-12 min-w-0 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer disabled:opacity-40"
            >
              <Scissors className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />
              <div className="min-w-0 text-left">
                <p>{isEn ? 'Residual cleanup' : '清理残点'}</p>
                <p className="text-xs text-amber-700 font-medium">
                  {isEn ? 'Review before removing' : '先预览，再批量清除'}
                </p>
              </div>
            </button>
          )}

          <button
            onClick={() => {
              onClose();
              onOpenVipModal?.();
            }}
            className="min-h-12 min-w-0 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer"
          >
            <Crown className="w-5 h-5 text-amber-500 shrink-0" />
            <div className="min-w-0 text-left">
              <p>{isEn ? 'Stella VIP' : '星格会员'}</p>
              <p className="text-xs text-amber-700 font-medium">
                {isEn ? 'Unlock premium tools' : '解锁高级创作工具'}
              </p>
            </div>
          </button>

          <button
            onClick={() => {
              onClose();
              onOpenSmartReduce?.();
            }}
            className="min-h-12 min-w-0 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer"
          >
            <Zap className="w-5 h-5 text-amber-500 fill-amber-400 shrink-0" />
            <div className="min-w-0 text-left">
              <p>{isEn ? 'Smart Bead Saver' : '智能精准省豆'}</p>
              <p className="text-xs text-amber-700 font-medium">
                {isEn ? 'Preserve features' : '合并相近过渡杂色'}
              </p>
            </div>
          </button>

          <button
            onClick={() => {
              onClose();
              onOpenPaletteModal?.();
            }}
            className="min-h-12 min-w-0 p-3 rounded-2xl bg-purple-50 border border-purple-200 text-purple-950 font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer"
          >
            <Palette className="w-5 h-5 text-purple-600 shrink-0" />
            <div className="min-w-0 text-left">
              <p>{isEn ? 'Color Brand Card' : '品牌色号卡库'}</p>
              <p className="text-xs text-purple-700 font-medium">
                {isEn ? 'MARD, Artkal, Perler' : '查看全色号清单'}
              </p>
            </div>
          </button>

          <button
            onClick={() => {
              onClose();
              onOpenPatternsModal?.();
            }}
            className="min-h-12 min-w-0 p-3 rounded-2xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer"
          >
            <ImageIcon className="w-5 h-5 text-indigo-600 shrink-0" />
            <div className="min-w-0 text-left">
              <p>{isEn ? 'My Pattern Cloud' : '云端图纸库'}</p>
              <p className="text-xs text-slate-600 font-medium">
                {isEn ? 'Saved works' : '查看历史作品'}
              </p>
            </div>
          </button>

          <button
            onClick={() => {
              onClose();
              onClearOuterBackground();
            }}
            className="col-span-2 min-h-12 min-w-0 p-3 rounded-2xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer"
          >
            <Scissors className="w-5 h-5 text-rose-500 shrink-0" />
            <div className="min-w-0 text-left">
              <p>{isEn ? 'Trim Canvas Edge' : '自动裁剪黑白边'}</p>
              <p className="text-xs text-slate-600 font-medium">
                {isEn ? 'Auto crop outer borders' : '消除主体周围空白'}
              </p>
            </div>
          </button>
        </div>

        {/* 7. Guide & Clear Canvas */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
          <button
            onClick={() => {
              onClose();
              onOpenGuideModal();
            }}
            className="flex-1 min-h-11 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <BookOpen className="w-4 h-4 text-indigo-600" />
            <span>{isEn ? 'Beginner Guide' : '新手使用指南'}</span>
          </button>

          <button
            onClick={() => {
              onClose();
              onClearCanvas();
            }}
            className="min-h-11 py-2.5 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer border border-rose-200"
          >
            <RotateCcw className="w-4 h-4" />
            <span>{isEn ? 'Clear Canvas' : '清空画板'}</span>
          </button>
        </div>
        </div>
      </div>
    </div>
  );
};
