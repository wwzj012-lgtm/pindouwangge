import React from 'react';
import {
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
  FileCode,
  FolderOpen,
  Save,
  Crown,
  ChevronRight,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Trash2,
} from 'lucide-react';
import { BeadShape, SymmetryMode, CanvasBackdrop } from '../../types';

export interface MobileFeatureSheetProps {
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
  onRequestImportJson: () => void;
  onExportJson: () => void;
  conversionSettingsContent?: React.ReactNode;
  usageContent?: React.ReactNode;
  initialTab?: 'basic' | 'parameters';

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
  onRequestImportJson,
  onExportJson,
  conversionSettingsContent,
  usageContent,
  initialTab = 'basic',
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
  const [activeTab, setActiveTab] = React.useState<'basic' | 'parameters'>(initialTab);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      {/* Backdrop tap to close */}
      <div className="flex-1" onClick={onClose} />

      {/* Sheet Container with iOS style rounded corners */}
      <div className="bg-white rounded-t-3xl shadow-2xl max-h-[85vh] overflow-y-auto p-4 pb-[calc(2rem+env(safe-area-inset-bottom))] space-y-4 border-t border-purple-100 animate-in slide-in-from-bottom-5 duration-200 select-none">
        {/* Top Drag Handle */}
        <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto" />

        {/* Sheet Title */}
        <div className="flex items-center justify-between px-1">
          <div>
            <h3 className="text-base font-black text-slate-900">
              {isEn ? 'Studio Toolkit & View Controls' : '画板增强工具箱 & 视图控制'}
            </h3>
            <p className="text-[11px] font-bold text-slate-400">
              {isEn ? 'Customize rendering, shape, and quick actions' : '自定义拼豆质感、显示辅助线及核心捷径'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold flex items-center justify-center cursor-pointer hover:bg-slate-200"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label={isEn ? 'Mobile tool panels' : '移动端工具面板'}>
          <button
            id="mobile-feature-sheet-basic-tab"
            type="button"
            role="tab"
            aria-selected={activeTab === 'basic'}
            aria-controls="mobile-feature-sheet-basic-panel"
            onClick={() => setActiveTab('basic')}
            className={`min-w-0 rounded-lg px-2 py-2 text-xs font-black transition-colors cursor-pointer ${
              activeTab === 'basic' ? 'bg-white text-purple-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {isEn ? 'Basic settings' : '基础设置'}
          </button>
          <button
            id="mobile-feature-sheet-parameters-tab"
            type="button"
            role="tab"
            aria-selected={activeTab === 'parameters'}
            aria-controls="mobile-feature-sheet-parameters-panel"
            onClick={() => setActiveTab('parameters')}
            className={`min-w-0 rounded-lg px-2 py-2 text-xs font-black transition-colors cursor-pointer ${
              activeTab === 'parameters' ? 'bg-white text-purple-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {isEn ? 'Parameters' : '参数设置'}
          </button>
        </div>

        {activeTab === 'basic' ? (
          <div id="mobile-feature-sheet-basic-panel" role="tabpanel" aria-labelledby="mobile-feature-sheet-basic-tab" className="space-y-4">

        {/* 1. Bead Shape & Texture */}
        <div className="bg-purple-50/60 p-3 rounded-2xl border border-purple-100/90 space-y-2">
          <span className="text-[11px] font-black text-purple-900 flex items-center gap-1.5">
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
              <span className="text-[10px]">{isEn ? '3D Fuse' : '3D圆豆'}</span>
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
              <span className="text-[10px]">{isEn ? 'Flat' : '扁平圆'}</span>
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
              <span className="text-[10px]">{isEn ? 'Pixel' : '方块'}</span>
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
              <span className="text-[10px]">{isEn ? 'Ironed' : '融豆'}</span>
            </button>
          </div>
        </div>

        {/* 2. Visual Overlays & Display Toggles */}
        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/90 space-y-2">
          <span className="text-[11px] font-black text-slate-900 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-600" />
            {isEn ? 'Display Guides & Overlay' : '视觉辅助线与叠影'}
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setShowSymbols(!showSymbols)}
              className={`p-2.5 rounded-xl border flex items-center justify-between text-xs font-black transition-all cursor-pointer ${
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
                {showSymbols && <span className="text-[9px]">✓</span>}
              </div>
            </button>

            <button
              onClick={() => setShowGridLines(!showGridLines)}
              className={`p-2.5 rounded-xl border flex items-center justify-between text-xs font-black transition-all cursor-pointer ${
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
                {showGridLines && <span className="text-[9px]">✓</span>}
              </div>
            </button>

            <button
              onClick={() => setShowCoordinates(!showCoordinates)}
              className={`p-2.5 rounded-xl border flex items-center justify-between text-xs font-black transition-all cursor-pointer ${
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
                {showCoordinates && <span className="text-[9px]">✓</span>}
              </div>
            </button>

            {hasSourceImage && (
              <div className="space-y-2">
              <button
                onClick={() => setShowOverlay(!showOverlay)}
                className={`p-2.5 rounded-xl border flex items-center justify-between text-xs font-black transition-all cursor-pointer ${
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
                  {showOverlay && <span className="text-[9px]">✓</span>}
                </div>
              </button>
              {showOverlay && (
                <label className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">
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
          <span className="text-[11px] font-black text-slate-900 flex items-center gap-1.5">
            <Wand2 className="w-3.5 h-3.5 text-indigo-600" />
            {isEn ? 'Symmetry Drawing Mode' : '对称绘图模式'}
          </span>
          <div className="grid grid-cols-4 gap-1.5">
            {(['none', 'horizontal', 'vertical', 'quad'] as SymmetryMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setSymmetryMode(mode)}
                className={`py-2 px-1 rounded-xl border text-[11px] font-black transition-all cursor-pointer text-center ${
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
        </div>

        {/* 4. Canvas Backdrop Tone */}
        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/90 space-y-2">
          <span className="text-[11px] font-black text-slate-900">
            {isEn ? 'Board Backdrop Color' : '画板底板底色'}
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['light_pegboard', 'dark_grid', 'wood', 'studio', 'slate'] as CanvasBackdrop[]).map(b => (
              <button
                key={b}
                onClick={() => setCanvasBackdrop(b)}
                className={`flex-1 min-w-[56px] py-1.5 rounded-xl border text-[10px] font-black transition-all cursor-pointer ${
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
          <span className="text-[11px] font-black text-slate-900 flex items-center gap-1.5">
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
          <button
            onClick={() => {
              onClose();
              onOpenVipModal?.();
            }}
            className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer"
          >
            <Crown className="w-5 h-5 text-amber-500 shrink-0" />
            <div className="text-left min-w-0">
              <p>{isEn ? 'Stella VIP' : '星格会员'}</p>
              <p className="text-[9px] text-amber-700 font-medium">
                {isEn ? 'Unlock premium tools' : '解锁高级创作工具'}
              </p>
            </div>
          </button>

          <button
            onClick={() => {
              onClose();
              onOpenSmartReduce?.();
            }}
            className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer"
          >
            <Zap className="w-5 h-5 text-amber-500 fill-amber-400 shrink-0" />
            <div className="text-left">
              <p>{isEn ? 'Smart Bead Saver' : '智能精准省豆'}</p>
              <p className="text-[9px] text-amber-700 font-medium">
                {isEn ? 'Preserve features' : '合并相近过渡杂色'}
              </p>
            </div>
          </button>

          <button
            onClick={() => {
              onClose();
              onOpenPaletteModal?.();
            }}
            className="p-3 rounded-2xl bg-purple-50 border border-purple-200 text-purple-950 font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer"
          >
            <Palette className="w-5 h-5 text-purple-600 shrink-0" />
            <div className="text-left">
              <p>{isEn ? 'Color Brand Card' : '品牌色号卡库'}</p>
              <p className="text-[9px] text-purple-700 font-medium">
                {isEn ? 'MARD, Artkal, Perler' : '查看全色号清单'}
              </p>
            </div>
          </button>

          <button
            onClick={() => {
              onClose();
              onOpenPatternsModal?.();
            }}
            className="p-3 rounded-2xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer"
          >
            <ImageIcon className="w-5 h-5 text-indigo-600 shrink-0" />
            <div className="text-left">
              <p>{isEn ? 'My Pattern Cloud' : '云端图纸库'}</p>
              <p className="text-[9px] text-slate-500 font-medium">
                {isEn ? 'Saved works' : '查看历史作品'}
              </p>
            </div>
          </button>

          <button
            onClick={() => {
              onClose();
              onClearOuterBackground();
            }}
            className="p-3 rounded-2xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer"
          >
            <Scissors className="w-5 h-5 text-rose-500 shrink-0" />
            <div className="text-left">
              <p>{isEn ? 'Trim Canvas Edge' : '自动裁剪黑白边'}</p>
              <p className="text-[9px] text-slate-500 font-medium">
                {isEn ? 'Auto crop outer borders' : '消除主体周围空白'}
              </p>
            </div>
          </button>

          <button
            onClick={() => {
              onClose();
              onRequestImportJson();
            }}
            className="min-h-[44px] min-w-0 p-3 rounded-2xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-950 font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer"
          >
            <FolderOpen className="w-5 h-5 text-sky-600 shrink-0" />
            <div className="min-w-0 text-left">
              <p>{isEn ? 'Import Project JSON' : '导入项目 JSON'}</p>
              <p className="text-[9px] text-sky-700 font-medium">{isEn ? 'Open a saved project' : '打开已保存的项目文件'}</p>
            </div>
          </button>

          <button
            onClick={() => {
              onClose();
              onExportJson();
            }}
            className="min-h-[44px] min-w-0 p-3 rounded-2xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-950 font-black text-xs flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer"
          >
            <FileCode className="w-5 h-5 text-emerald-600 shrink-0" />
            <div className="min-w-0 text-left">
              <p>{isEn ? 'Export Project JSON' : '导出项目 JSON'}</p>
              <p className="text-[9px] text-emerald-700 font-medium">{isEn ? 'Save an editable project' : '保存可继续编辑的项目文件'}</p>
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
            className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <BookOpen className="w-4 h-4 text-indigo-600" />
            <span>{isEn ? 'Beginner Guide' : '新手使用指南'}</span>
          </button>

          <button
            onClick={() => {
              onClose();
              onClearCanvas();
            }}
            className="py-2.5 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer border border-rose-200"
          >
            <RotateCcw className="w-4 h-4" />
            <span>{isEn ? 'Clear Canvas' : '清空画板'}</span>
          </button>
        </div>
          </div>
        ) : (
          <div id="mobile-feature-sheet-parameters-panel" role="tabpanel" aria-labelledby="mobile-feature-sheet-parameters-tab" className="space-y-5">
            {conversionSettingsContent ? (
              <div>{conversionSettingsContent}</div>
            ) : (
              <div className="py-8 text-center text-xs font-bold text-slate-400">
                {isEn ? 'No parameters available' : '暂无可用参数'}
              </div>
            )}
            {usageContent && <div>{usageContent}</div>}
          </div>
        )}
      </div>
    </div>
  );
};
