import React, { useRef, useState } from 'react';
import {
  ChevronLeft,
  Pencil,
  PaintBucket,
  Pipette,
  Eraser,
  Undo2,
  Redo2,
  Hand,
  Sliders,
  BarChart3,
  Download,
  Save,
  Zap,
  LayoutGrid,
  X,
  Sparkles,
  Hash,
  Grid2x2,
  Eye,
  Circle as CircleIcon,
  Square,
  Flame,
  Wand2,
  Scissors,
  Loader2,
  Palette,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronDown,
  Layers,
  Check,
  Plus,
} from 'lucide-react';
import { BeadColor, BeadShape, ToolType, SymmetryMode, CanvasBackdrop, ConvertSettings } from '../../types';
import { SettingsPanel } from '../SettingsPanel';
import { StatsPanel } from '../StatsPanel';
import { GridCanvas } from '../GridCanvas';
import { MobileFeatureSheet } from './MobileFeatureSheet';
import { MobileBottomNav } from './MobileBottomNav';

export interface MobileWorkspaceProps {
  completionSummary?: React.ReactNode;
  grid: (string | null)[][];
  paletteMap: Map<string, BeadColor>;
  settings: ConvertSettings;
  setSettings: React.Dispatch<React.SetStateAction<ConvertSettings>>;
  conversionDiagnostics: any;
  handleReconvert: () => void;
  sourceImage: HTMLImageElement | null;
  setIsStudioModalOpen: (open: boolean) => void;

  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  selectedColor: BeadColor | null;
  setSelectedColor: (color: BeadColor | null) => void;
  canUndo: boolean;
  canRedo: boolean;
  handleUndo: () => boolean;
  handleRedo: () => boolean;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleResetZoom: () => void;

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

  highlightColorIds: string[];
  setHighlightColorIds: (ids: string[]) => void;
  handleToggleHighlightColorId: (id: string) => void;
  completedColorIds: string[];
  handleToggleCompletedColorId: (id: string) => void;
  setReplaceSourceColor: (color: BeadColor) => void;
  handleEraseColor: (colorId: string) => void;
  handleRestoreColor: (colorId: string) => void;
  erasedColorCoords: Map<string, [number, number][]>;

  handleCellClick: (row: number, col: number, overrideColorId?: string) => void;
  beginHistoryTransaction: () => void;
  finishHistoryTransaction: () => void;
  handleApplyShape: (tool: ToolType, r1: number, c1: number, r2: number, c2: number) => void;
  handleReferenceImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleResetCurrentCanvas: () => void;
  handleClearOuterBackground: () => void;
  openColorManagerModal: () => void;
  openSaveNameDialog: () => void;
  isSavingPattern: boolean;
  openExportModal: () => void;
  onExportJson: () => void;
  onImportJson: (jsonStr: string) => void;
  openSmartReduce: () => void;
  onConsolidateStrayBeads?: (strength: 'light' | 'standard' | 'strong') => void;
  isConverting: boolean;
  isEn: boolean;

  // Extra modals triggers & global nav
  onOpenPatternsModal: () => void;
  onOpenGuideModal: () => void;
  onOpenVipModal: () => void;
  onNavigateTab?: (tab: 'home' | 'studio' | 'community' | 'largeCanvas') => void;
  onOpenProfile?: () => void;
}

export type MobileTab = 'canvas' | 'settings' | 'stats';

export const MobileWorkspace: React.FC<MobileWorkspaceProps> = ({
  completionSummary,
  grid,
  paletteMap,
  settings,
  setSettings,
  conversionDiagnostics,
  handleReconvert,
  sourceImage,
  setIsStudioModalOpen,
  activeTool,
  setActiveTool,
  selectedColor,
  setSelectedColor,
  canUndo,
  canRedo,
  handleUndo,
  handleRedo,
  zoom,
  setZoom,
  handleZoomIn,
  handleZoomOut,
  handleResetZoom,
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
  highlightColorIds,
  setHighlightColorIds,
  handleToggleHighlightColorId,
  completedColorIds,
  handleToggleCompletedColorId,
  setReplaceSourceColor,
  handleEraseColor,
  handleRestoreColor,
  erasedColorCoords,
  handleCellClick,
  beginHistoryTransaction,
  finishHistoryTransaction,
  handleApplyShape,
  handleReferenceImageUpload,
  handleResetCurrentCanvas,
  handleClearOuterBackground,
  openColorManagerModal,
  openSaveNameDialog,
  isSavingPattern,
  openExportModal,
  onExportJson,
  onImportJson,
  openSmartReduce,
  onConsolidateStrayBeads,
  isConverting,
  isEn,
  onOpenPatternsModal,
  onOpenGuideModal,
  onOpenVipModal,
  onNavigateTab,
  onOpenProfile,
}) => {
  const [currentTab, setCurrentTab] = useState<MobileTab>('canvas');
  const [isFeatureSheetOpen, setIsFeatureSheetOpen] = useState(false);
  const [jsonImportError, setJsonImportError] = useState<string | null>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);

  const handleJsonFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    try {
      onImportJson(await file.text());
    } catch {
      setJsonImportError(isEn ? 'Unable to read the project JSON file. Please try again.' : '无法读取项目 JSON 文件，请重试。');
    } finally {
      input.value = '';
    }
  };

  const handleRequestImportJson = () => {
    setJsonImportError(null);
    jsonFileInputRef.current?.click();
  };

  const conversionSettingsContent = (
    <SettingsPanel
      settings={settings}
      setSettings={setSettings}
      conversionDiagnostics={conversionDiagnostics}
      variant="sheet"
      showDiagnostics={false}
      onReconvert={() => {
        setIsFeatureSheetOpen(false);
        handleReconvert();
      }}
      hasImage={sourceImage !== null}
      onOpenImageStudio={() => {
        setIsFeatureSheetOpen(false);
        setIsStudioModalOpen(true);
      }}
      onCloseMobile={() => setIsFeatureSheetOpen(false)}
    />
  );

  // Extract unique used colors from current grid for quick bottom carousel
  const usedColorIds = React.useMemo(() => {
    const set = new Set<string>();
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const id = grid[r][c];
        if (id) set.add(id);
      }
    }
    return Array.from(set);
  }, [grid]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative bg-slate-100">
      <input
        ref={jsonFileInputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleJsonFileInputChange}
      />
      {jsonImportError && (
        <div role="alert" className="absolute top-3 left-3 right-3 z-40 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 shadow-sm">
          {jsonImportError}
        </div>
      )}
      {/* Main Screen View Area */}
      <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
        {/* Tab 1: Immersive Fullscreen Mobile Canvas */}
        <div className={`w-full h-full relative ${currentTab === 'canvas' ? 'block' : 'hidden'}`}>
          <GridCanvas
            interactionProfile="touch"
            grid={grid}
            paletteMap={paletteMap}
            width={settings.width}
            height={settings.height}
            boardSize={settings.boardSize}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            selectedColor={selectedColor}
            highlightColorIds={highlightColorIds}
            highlightColorId={highlightColorIds.length === 1 ? highlightColorIds[0] : null}
            completedColorIds={completedColorIds}
            beadShape={beadShape}
            showSymbols={showSymbols}
            showGridLines={showGridLines}
            showCoordinates={showCoordinates}
            canvasBackdrop={canvasBackdrop}
            symmetryMode={symmetryMode}
            sourceImage={sourceImage}
            keepImageAspectRatio={settings.keepAspectRatio}
            showOverlay={showOverlay}
            overlayOpacity={overlayOpacity}
            zoom={zoom}
            setZoom={setZoom}
            onCellClick={handleCellClick}
            onHistoryTransactionStart={beginHistoryTransaction}
            onHistoryTransactionEnd={finishHistoryTransaction}
            onApplyShape={handleApplyShape}
            onEyedropColor={color => setSelectedColor(color)}
            onReferenceImageUpload={handleReferenceImageUpload}
            onResetCanvas={handleResetCurrentCanvas}
          />

          {/* Converting Spinner */}
          {isConverting && (
            <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-xs z-30 flex flex-col items-center justify-center gap-3 transition-opacity duration-200">
              <div className="relative flex items-center justify-center">
                <div className="w-12 h-12 rounded-full border-4 border-purple-600/20 border-t-purple-600 animate-spin" />
                <Sparkles className="w-5 h-5 text-purple-600 absolute animate-pulse" />
              </div>
              <div className="text-xs font-bold text-slate-800 flex items-center gap-2 bg-white/95 border border-slate-200 px-3 py-1.5 rounded-full shadow-md">
                <span className="w-2 h-2 rounded-full bg-purple-600 animate-ping" />
                <span>{isEn ? 'Calculating beads...' : '正在精准计算拼豆匹配...'}</span>
              </div>
            </div>
          )}
        </div>

        {/* Tab 2: Dedicated Mobile Image Studio & Conversion Settings */}
        <div className={`w-full h-full bg-white overflow-y-auto ${currentTab === 'settings' ? 'block' : 'hidden'}`}>
          <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-purple-100 px-3.5 py-2.5 flex items-center justify-between shadow-2xs">
            <button
              type="button"
              onClick={() => setCurrentTab('canvas')}
              className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-purple-200 bg-white px-2.5 text-xs font-black text-purple-700 shadow-sm active:scale-95"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>{isEn ? 'Back to Canvas' : '返回画板'}</span>
            </button>
            <span className="text-xs font-black text-slate-800">{isEn ? 'Convert Settings' : '转图与算法设置'}</span>
            <button
              type="button"
              onClick={() => {
                handleReconvert();
                setCurrentTab('canvas');
              }}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-purple-600 px-3 text-xs font-black text-white shadow-sm active:scale-95"
            >
              {isEn ? 'Apply' : '应用'}
            </button>
          </div>
          <div className="p-3 pb-24">
            <SettingsPanel
              settings={settings}
              setSettings={setSettings}
              conversionDiagnostics={conversionDiagnostics}
              onReconvert={() => {
                handleReconvert();
                setCurrentTab('canvas');
              }}
              hasImage={sourceImage !== null}
              onOpenImageStudio={() => setIsStudioModalOpen(true)}
              onCloseMobile={() => setCurrentTab('canvas')}
            />
          </div>
        </div>

        {/* Tab 3: Dedicated Mobile Stats & Bead Palette List */}
        <div className={`w-full h-full bg-white overflow-y-auto ${currentTab === 'stats' ? 'block' : 'hidden'}`}>
          <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-purple-100 px-3.5 py-2.5 flex items-center justify-between shadow-2xs">
            <button
              type="button"
              onClick={() => setCurrentTab('canvas')}
              className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-purple-200 bg-white px-2.5 text-xs font-black text-purple-700 shadow-sm active:scale-95"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>{isEn ? 'Back to Canvas' : '返回画板'}</span>
            </button>
            <span className="text-xs font-black text-slate-800">{isEn ? 'Bead Usage & Colors' : '拼豆用量与色号'}</span>
            <button
              type="button"
              onClick={() => setCurrentTab('canvas')}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-purple-200 bg-white px-2.5 text-xs font-black text-purple-700 shadow-sm active:scale-95"
            >
              {isEn ? 'Done' : '完成'}
            </button>
          </div>
          <div className="p-3 pb-24">
            {completionSummary}
            <StatsPanel
              grid={grid}
              paletteMap={paletteMap}
              width={settings.width}
              height={settings.height}
              boardSize={settings.boardSize}
              highlightColorIds={highlightColorIds}
              highlightColorId={highlightColorIds.length === 1 ? highlightColorIds[0] : null}
              onSetHighlightColorIds={setHighlightColorIds}
              onToggleHighlightColorId={handleToggleHighlightColorId}
              onSetHighlightColorId={id => setHighlightColorIds(id ? [id] : [])}
              completedColorIds={completedColorIds}
              onToggleCompletedColorId={handleToggleCompletedColorId}
              onOpenReplaceModal={color => setReplaceSourceColor(color)}
              onSelectColor={color => {
                setSelectedColor(color);
                setCurrentTab('canvas');
              }}
              onEraseColor={handleEraseColor}
              onRestoreColor={handleRestoreColor}
              erasedColorCoords={erasedColorCoords}
              onConsolidateStrayBeads={onConsolidateStrayBeads}
              onCloseMobile={() => setCurrentTab('canvas')}
            />
          </div>
        </div>
      </div>

      {/* Unified Mobile Bottom Workstation (所有按钮集中在底部) */}
      <div className="shrink-0 bg-white/98 backdrop-blur-md border-t border-purple-200/90 shadow-2xl flex flex-col z-20 select-none">
        {/* Row 1: Quick Swatch & Color Selector Bar (Only on canvas tab) */}
        {currentTab === 'canvas' && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-purple-100/90 overflow-x-auto scrollbar-none bg-purple-50/40">
            {/* Active Color Picker Trigger */}
            <button
              type="button"
              onClick={openColorManagerModal}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-purple-200 bg-white px-2 text-purple-700 shadow-sm active:scale-95"
              title="点击打开全色库选色"
            >
              <div
                className="w-4 h-4 rounded-full border border-black/20 shadow-xs shrink-0"
                style={{ backgroundColor: selectedColor?.hex || '#transparent' }}
              />
              <div className="flex flex-col text-left">
                <span className="text-[10px] font-black text-purple-950 leading-tight">
                  {selectedColor ? selectedColor.code : isEn ? 'Palette' : '色号'}
                </span>
              </div>
              <ChevronDown className="w-3 h-3 text-purple-600" />
            </button>

            <div className="w-px h-5 bg-purple-200/70 shrink-0 mx-0.5" />

            {/* Quick Used Colors List */}
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
              {usedColorIds.map(colorId => {
                const bead = paletteMap.get(colorId);
                if (!bead) return null;
                const isSelected = selectedColor?.code === bead.code;
                return (
                  <button
                    key={bead.code}
                    type="button"
                    onClick={() => setSelectedColor(bead)}
                    className={`inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border px-2 text-[9px] ${isSelected ? 'scale-105 border-purple-500 bg-purple-600 font-black text-white' : 'border-purple-200 bg-white font-bold text-purple-700'}`}
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full border border-black/20 shrink-0"
                      style={{ backgroundColor: bead.hex }}
                    />
                    <span className="text-[9px]">{bead.code}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={openColorManagerModal}
                className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-purple-200 bg-white px-2 text-[9px] font-bold text-purple-700"
              >
                <Plus className="w-2.5 h-2.5" />
                <span>{isEn ? 'More' : '选色'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Row 2: Main Tool Dock (Pencil, Bucket, Pipette, Eraser, Pan, Undo, Redo, Zoom, Tools) */}
        {currentTab === 'canvas' && (
          <div className="grid grid-cols-5 gap-1 border-b border-purple-100/90 bg-white px-2 py-1.5">
            <button
              type="button"
              onClick={() => setActiveTool('pencil')}
              className={`inline-flex h-11 min-w-0 w-full items-center justify-center rounded-lg border p-0 ${activeTool === 'pencil' ? 'border-purple-500 bg-purple-600 text-white shadow-sm' : 'border-purple-200 bg-white text-purple-700'}`}
              title={isEn ? 'Pencil' : '画笔'}
              aria-label={isEn ? 'Pencil' : '画笔'}
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setActiveTool('bucket')}
              className={`inline-flex h-11 min-w-0 w-full items-center justify-center rounded-lg border p-0 ${activeTool === 'bucket' ? 'border-purple-500 bg-purple-600 text-white shadow-sm' : 'border-purple-200 bg-white text-purple-700'}`}
              title={isEn ? 'Bucket Fill' : '油漆桶'}
              aria-label={isEn ? 'Bucket Fill' : '油漆桶'}
            >
              <PaintBucket className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setActiveTool('eyedropper')}
              className={`inline-flex h-11 min-w-0 w-full items-center justify-center rounded-lg border p-0 ${activeTool === 'eyedropper' ? 'border-purple-500 bg-purple-600 text-white shadow-sm' : 'border-purple-200 bg-white text-purple-700'}`}
              title={isEn ? 'Eyedropper' : '吸管'}
              aria-label={isEn ? 'Eyedropper' : '吸管'}
            >
              <Pipette className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setActiveTool('eraser')}
              className={`inline-flex h-11 min-w-0 w-full items-center justify-center rounded-lg border p-0 ${activeTool === 'eraser' ? 'border-purple-500 bg-purple-600 text-white shadow-sm' : 'border-purple-200 bg-white text-purple-700'}`}
              title={isEn ? 'Eraser' : '橡皮擦'}
              aria-label={isEn ? 'Eraser' : '橡皮擦'}
            >
              <Eraser className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setActiveTool('pan')}
              className={`inline-flex h-11 min-w-0 w-full items-center justify-center rounded-lg border p-0 ${activeTool === 'pan' ? 'border-purple-500 bg-purple-600 text-white shadow-sm' : 'border-purple-200 bg-white text-purple-700'}`}
              title={isEn ? 'Hand/Pan' : '抓手'}
              aria-label={isEn ? 'Hand/Pan' : '抓手'}
            >
              <Hand className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleUndo}
              disabled={!canUndo}
              className="inline-flex h-11 min-w-0 w-full items-center justify-center rounded-lg border border-purple-200 bg-white p-0 text-purple-700 disabled:opacity-30 active:scale-95"
              title={isEn ? 'Undo' : '撤销'}
              aria-label={isEn ? 'Undo' : '撤销'}
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={!canRedo}
              className="inline-flex h-11 min-w-0 w-full items-center justify-center rounded-lg border border-purple-200 bg-white p-0 text-purple-700 disabled:opacity-30 active:scale-95"
              title={isEn ? 'Redo' : '重做'}
              aria-label={isEn ? 'Redo' : '重做'}
            >
              <Redo2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="inline-flex h-11 min-w-0 w-full items-center justify-center rounded-lg border border-purple-200 bg-white p-0 text-purple-700 active:scale-95"
              title={isEn ? 'Zoom in' : '放大'}
              aria-label={isEn ? 'Zoom in' : '放大'}
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              className="inline-flex h-11 min-w-0 w-full items-center justify-center rounded-lg border border-purple-200 bg-white p-0 text-purple-700 active:scale-95"
              title={isEn ? 'Zoom out' : '缩小'}
              aria-label={isEn ? 'Zoom out' : '缩小'}
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsFeatureSheetOpen(true)}
              className="inline-flex h-11 min-w-0 w-full items-center justify-center rounded-lg border border-purple-200 bg-purple-50 p-0 text-purple-700 active:scale-95"
              title={isEn ? 'More tools and view settings' : '更多工具与视图设置'}
              aria-label={isEn ? 'More tools and view settings' : '更多工具与视图设置'}
            >
              <Sliders className="w-4 h-4 text-purple-600" />
            </button>
          </div>
        )}

        {/* Row 3: Main Action Navigation Bar (画布 / 转图 / 用量 / 省豆 / 保存 / 导出) */}
        <nav className="bg-white px-2 py-1.5 sm:px-6 sm:py-2 flex items-center justify-around sm:justify-center sm:gap-6 md:gap-10 text-[10px] sm:text-xs border-t border-purple-100">
          <button
            type="button"
            onClick={() => setCurrentTab('canvas')}
            className={`inline-flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-1 ${currentTab === 'canvas' ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-700 hover:bg-purple-50'} sm:min-h-14 sm:min-w-16 sm:px-3`}
          >
            <LayoutGrid className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>{isEn ? 'Canvas' : '画布'}</span>
          </button>

          <button
            type="button"
            onClick={() => setCurrentTab('settings')}
            className={`inline-flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-1 ${currentTab === 'settings' ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-700 hover:bg-purple-50'} sm:min-h-14 sm:min-w-16 sm:px-3`}
          >
            <Sliders className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>{isEn ? 'Convert' : '转图'}</span>
          </button>

          <button
            type="button"
            onClick={() => setCurrentTab('stats')}
            className={`inline-flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-1 ${currentTab === 'stats' ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-700 hover:bg-purple-50'} sm:min-h-14 sm:min-w-16 sm:px-3`}
          >
            <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>{isEn ? 'Stats' : '用量'}</span>
          </button>

          <button
            type="button"
            onClick={openSmartReduce}
            className="inline-flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-lg border border-amber-200 bg-amber-50 px-1.5 py-1 font-black text-amber-700 sm:min-h-14 sm:min-w-16 sm:px-3"
            title={isEn ? 'Feature-preserving bead saver' : '特征保真智能省豆'}
          >
            <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600 fill-amber-500" />
            <span>{isEn ? 'Reduce' : '省豆'}</span>
          </button>

          <button
            type="button"
            onClick={openSaveNameDialog}
            disabled={isSavingPattern}
            className="inline-flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-lg bg-emerald-600 px-1.5 py-1 font-black text-white shadow-sm disabled:opacity-50 active:scale-95 sm:min-h-14 sm:min-w-16 sm:px-3"
          >
            {isSavingPattern ? <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" /> : <Save className="w-4 h-4 sm:w-5 sm:h-5" />}
            <span>{isEn ? 'Save' : '保存'}</span>
          </button>

          <button
            type="button"
            onClick={openExportModal}
            className="inline-flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-black text-emerald-700 active:scale-95 sm:min-h-14 sm:min-w-16 sm:px-4"
          >
            <Download className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>{isEn ? 'Export' : '导出'}</span>
          </button>
        </nav>
      </div>

      {/* Feature Sheet Modal Drawer */}
      <MobileFeatureSheet
        isOpen={isFeatureSheetOpen}
        onClose={() => setIsFeatureSheetOpen(false)}
        onOpenSmartReduce={openSmartReduce}
        onOpenPaletteModal={openColorManagerModal}
        onOpenPatternsModal={onOpenPatternsModal}
        onOpenGuideModal={onOpenGuideModal}
        onOpenVipModal={onOpenVipModal}
        onClearCanvas={handleResetCurrentCanvas}
        onClearOuterBackground={handleClearOuterBackground}
        onResetZoom={handleResetZoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onRequestImportJson={handleRequestImportJson}
        onExportJson={onExportJson}
        conversionSettingsContent={conversionSettingsContent}
        initialTab="basic"
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
        showOverlay={showOverlay}
        setShowOverlay={setShowOverlay}
        overlayOpacity={overlayOpacity}
        setOverlayOpacity={setOverlayOpacity}
        hasSourceImage={sourceImage !== null}
        isEn={isEn}
      />
    </div>
  );
};
