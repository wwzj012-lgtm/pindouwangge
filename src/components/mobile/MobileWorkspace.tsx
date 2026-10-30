import React, { useEffect, useRef, useState } from 'react';
import type { BackgroundCleanupController } from '../../hooks/useBackgroundCleanup';
import { BackgroundCleanupPanel } from '../BackgroundCleanupPanel';
import {
  Pencil,
  PaintBucket,
  Pipette,
  Eraser,
  Undo2,
  Redo2,
  Sliders,
  BarChart3,
  LayoutGrid,
  Sparkles,
  Loader2,
  ChevronDown,
  Save,
  Plus,
  Wrench,
  Image as ImageIcon,
} from 'lucide-react';
import { BeadColor, BeadShape, ToolType, SymmetryMode, CanvasBackdrop, ConvertSettings } from '../../types';
import { SettingsPanel } from '../SettingsPanel';
import { StatsPanel } from '../StatsPanel';
import { GridCanvas } from '../GridCanvas';
import type { BoardNavApi, BoardNavState } from '../GridCanvas';
import { MobileFeatureSheet } from './MobileFeatureSheet';
import { MobileBottomNav } from './MobileBottomNav';
import type { WorkspaceEditingActions } from '../SymmetryAxisControls';
import { consumeSelectedImageFile } from '../../utils/imageFileSelection';

export interface MobileWorkspaceProps {
  backgroundCleanup?: BackgroundCleanupController;
  editorActions?: WorkspaceEditingActions;
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
  openSmartReduce: () => void;
  onConsolidateStrayBeads?: (strength: 'light' | 'standard' | 'strong') => void;
  isConverting: boolean;
  isEn: boolean;

  // Extra modals triggers & global nav
  onOpenPatternsModal: () => void;
  onOpenGuideModal: () => void;
  onOpenVipModal: () => void;
  /** 与首页「上传图片」同一个回调：转图页在没有图片时直接调起选择器。 */
  onImageUpload?: (file: File) => void;
  onOpenProfile?: () => void;
}

export type MobileTab = 'canvas' | 'settings' | 'stats';

export const MobileWorkspace: React.FC<MobileWorkspaceProps> = ({
  backgroundCleanup,
  editorActions,
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
  openSmartReduce,
  onConsolidateStrayBeads,
  isConverting,
  isEn,
  onOpenPatternsModal,
  onOpenGuideModal,
  onOpenVipModal,
  onImageUpload,
  onOpenProfile,
}) => {
  const [currentTab, setCurrentTab] = useState<MobileTab>('canvas');
  const [isFeatureSheetOpen, setIsFeatureSheetOpen] = useState(false);
  const [isColorTrayOpen, setIsColorTrayOpen] = useState(false);
  const imageFileInputRef = useRef<HTMLInputElement>(null);

  // Board switching is driven from a docked strip, so the canvas owns the
  // geometry and the workspace owns the chrome. `boardNav` mirrors the canvas
  // state, `boardApiRef` reaches back into it.
  const [boardNav, setBoardNav] = useState<BoardNavState>({ focusedBoard: null, totalBoards: 1 });
  const boardApiRef = useRef<BoardNavApi | null>(null);
  const boardStripRef = useRef<HTMLDivElement>(null);
  const activeBoardChipRef = useRef<HTMLButtonElement>(null);

  // Collapse the used-color tray whenever the active tab changes
  useEffect(() => {
    setIsColorTrayOpen(false);
  }, [currentTab]);

  // Keep the active board chip visible without ever scrolling the page itself
  // (scrollIntoView on a nested strip can drag the document on iOS).
  useEffect(() => {
    const chip = activeBoardChipRef.current;
    const strip = boardStripRef.current;
    if (!chip || !strip) return;
    const stripRect = strip.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    const delta = (chipRect.left + chipRect.width / 2) - (stripRect.left + stripRect.width / 2);
    if (Math.abs(delta) < 4) return;
    strip.scrollTo({ left: Math.max(0, strip.scrollLeft + delta), behavior: 'smooth' });
  }, [boardNav.focusedBoard, boardNav.totalBoards, currentTab]);

  /** 转图页唯一的提交动作：按当前参数重算图纸，然后回到画板看结果。 */
  const applyConversionSettings = () => {
    handleReconvert();
    setCurrentTab('canvas');
  };

  /**
    * 还没有图片时，那个常驻按钮就是「上传图片」本身——直接唤起系统选择器，
    * 走和首页「上传图片」完全相同的链路（App.handleImageUpload），
    * 而不是把用户甩回首页再自己找入口。
    */
  const handleImageFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = consumeSelectedImageFile(event.currentTarget);
    if (file) onImageUpload?.(file);
  };

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
      {/* 转图页「先上传图片」直接唤起这个选择器，和首页的「上传图片」走同一条链路 */}
      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleImageFileInputChange}
      />
      {/* Main Screen View Area */}
      {backgroundCleanup?.preview && <BackgroundCleanupPanel control={backgroundCleanup} isEn={isEn} />}
      <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
        {/* Tab 1: Immersive Fullscreen Mobile Canvas */}
        <div
          className={`w-full h-full relative ${currentTab === 'canvas' ? 'block' : 'hidden'}`}
          onPointerDownCapture={() => setIsColorTrayOpen(false)}
        >
          <GridCanvas
            cleanupPreview={backgroundCleanup?.preview}
            symmetryAxes={editorActions?.axes}
            onSymmetryAxesChange={editorActions?.isPracticeMode ? undefined : editorActions?.onAxesChange}
            interactionProfile="touch"
            grid={grid}
            paletteMap={paletteMap}
            width={settings.width}
            height={settings.height}
            boardSize={settings.boardSize}
            activeTool={editorActions?.isPracticeMode ? 'hand' : activeTool}
            setActiveTool={setActiveTool}
            selectedColor={selectedColor}
            highlightColorIds={highlightColorIds}
            highlightColorId={highlightColorIds.length === 1 ? highlightColorIds[0] : null}
            completedColorIds={editorActions?.isPracticeMode ? [] : completedColorIds}
            beadShape={beadShape}
            showSymbols={showSymbols}
            showGridLines={showGridLines}
            showCoordinates={showCoordinates}
            canvasBackdrop={canvasBackdrop}
            symmetryMode={editorActions?.isPracticeMode ? 'none' : symmetryMode}
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
            boardNavApiRef={boardApiRef}
            onBoardNavStateChange={setBoardNav}
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

        {/* Tab 2: 转图与算法设置。
            它是底部的三个 tab 之一，不是被 push 出来的子页面，所以这里不再放
            「返回画板」——底栏的「画布」就是返回，再加一个只会让人在两个返回键之间犹豫。
            参数列表很长，真正的主操作（生成图纸）固定贴在底栏上方，永远不用滑到底。 */}
        <div className={`h-full w-full bg-white ${currentTab === 'settings' ? 'flex flex-col' : 'hidden'}`}>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <SettingsPanel
              settings={settings}
              setSettings={setSettings}
              conversionDiagnostics={conversionDiagnostics}
              variant="sheet"
              onReconvert={applyConversionSettings}
              hasImage={sourceImage !== null}
              onOpenImageStudio={() => setIsStudioModalOpen(true)}
              hideFooterAction
            />
          </div>
          <div className="shrink-0 border-t border-purple-100 bg-white px-3 py-2">
            <button
              type="button"
              onClick={() => {
                if (sourceImage) applyConversionSettings();
                else imageFileInputRef.current?.click();
              }}
              disabled={isConverting}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-purple-600 text-sm font-black text-white shadow-sm transition-colors active:bg-purple-700 disabled:opacity-60"
            >
              {sourceImage ? (
                <>
                  <Sparkles className="h-4 w-4 text-amber-300" aria-hidden="true" />
                  <span>{isEn ? 'Generate Pattern' : '生成图纸'}</span>
                </>
              ) : (
                <>
                  <ImageIcon className="h-4 w-4" aria-hidden="true" />
                  <span>{isEn ? 'Upload an image' : '先上传图片'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tab 3: 用量与色号。同样是一个 tab 而不是子页面：不设返回键，不做重复标题，
            面板自带「豆数用量统计与色卡清单」标题，底栏的「画布」就是返回。 */}
        <div className={`h-full w-full bg-white overflow-y-auto ${currentTab === 'stats' ? 'block' : 'hidden'}`}>
          <div className="p-3">
            {completionSummary}
            <StatsPanel
              grid={grid}
              paletteMap={paletteMap}
              width={settings.width}
              height={settings.height}
              boardSize={settings.boardSize}
              variant="sheet"
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
            />
          </div>
        </div>
      </div>

      {/* Board strip: the phone equivalent of the split-board export. Docked,
          never floating — the old pill sat on top of the grid's top-left corner
          and reaching board 5 meant four taps. Here every board is one tap away
          and the whole strip lives in the thumb zone. */}
      {currentTab === 'canvas' && !editorActions?.isPracticeMode && boardNav.totalBoards > 1 && (
        <div className="shrink-0 border-t border-purple-100 bg-white">
          <div className="flex items-center gap-1.5 px-2 py-1.5">
            <button
              type="button"
              onClick={() => boardApiRef.current?.showWholePattern()}
              aria-pressed={boardNav.focusedBoard === null}
              className={`inline-flex h-11 shrink-0 items-center gap-1 rounded-xl border px-2.5 text-xs font-black transition-colors ${
                boardNav.focusedBoard === null
                  ? 'border-purple-600 bg-purple-600 text-white shadow-xs'
                  : 'border-purple-200 bg-white text-purple-800'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isEn ? 'All' : '全图'}</span>
            </button>
            <div
              ref={boardStripRef}
              className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none"
              role="group"
              aria-label={isEn ? 'Pegboards' : '拼豆板'}
            >
              {Array.from({ length: boardNav.totalBoards }, (_, index) => {
                const isActive = boardNav.focusedBoard === index;
                return (
                  <button
                    key={index}
                    ref={isActive ? activeBoardChipRef : undefined}
                    type="button"
                    onClick={() => boardApiRef.current?.focusBoard(index)}
                    aria-pressed={isActive}
                    aria-label={isEn ? `Board ${index + 1}` : `第 ${index + 1} 板`}
                    className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-sm font-black tabular-nums transition-colors ${
                      isActive
                        ? 'border-purple-600 bg-purple-600 text-white shadow-xs'
                        : 'border-purple-200 bg-purple-50/60 text-purple-900 active:bg-purple-100'
                    }`}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Unified Mobile Bottom Workstation (所有按钮集中在底部) */}
      {editorActions?.isPracticeMode && <div className="max-h-[40dvh] shrink-0 overflow-y-auto border-t border-emerald-200 bg-white">{editorActions.practicePanel}</div>}
      <div className="pb-safe shrink-0 relative z-20 flex flex-col border-t border-purple-100 bg-white select-none">
        {/* Collapsible Used-Color Tray (已用色号快捷托盘，默认收起) */}
        {currentTab === 'canvas' && !editorActions?.isPracticeMode && (
          <div
            className={`absolute bottom-full left-0 right-0 overflow-hidden border-b border-purple-100/90 bg-purple-50/97 backdrop-blur-md shadow-lg transition-[max-height] duration-200 ease-out ${
              isColorTrayOpen ? 'max-h-[60px]' : 'max-h-0'
            }`}
          >
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none px-2 py-2">
              {usedColorIds.map(colorId => {
                const bead = paletteMap.get(colorId);
                if (!bead) return null;
                const isSelected = selectedColor?.code === bead.code;
                return (
                  <button
                    key={bead.code}
                    type="button"
                    onClick={() => setSelectedColor(bead)}
                    aria-pressed={isSelected}
                    className={`inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-2.5 transition-colors ${
                      isSelected
                        ? 'border-purple-600 bg-purple-600 font-black text-white'
                        : 'border-purple-200 bg-white font-bold text-purple-800'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 shrink-0 rounded-full border border-black/20"
                      style={{ backgroundColor: bead.hex }}
                    />
                    <span className="text-xs leading-none">{bead.code}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setIsColorTrayOpen(false);
                  openColorManagerModal();
                }}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-purple-200 bg-white px-2.5 text-xs font-bold text-purple-800"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{isEn ? 'All' : '全色库'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Row 1: Tool dock. One segmented switch for the four drawing tools
            instead of four separate outlined boxes — fewer borders, and the
            current tool reads as a selected segment rather than a button. */}
        {currentTab === 'canvas' && !editorActions?.isPracticeMode && (
          <div className="flex h-[56px] items-center gap-1.5 px-2">
            {/* Current Color Chip - toggles the used-color tray */}
            <button
              type="button"
              onClick={() => setIsColorTrayOpen(open => !open)}
              className={`inline-flex h-11 w-[52px] max-[359px]:w-11 shrink-0 flex-col items-center justify-center rounded-xl border shadow-xs transition-colors active:scale-95 ${
                isColorTrayOpen
                  ? 'border-purple-600 bg-purple-50 text-purple-900'
                  : 'border-purple-200 bg-white text-purple-800'
              }`}
              aria-expanded={isColorTrayOpen}
              aria-label={
                selectedColor
                  ? (isEn ? `Current color ${selectedColor.code}, show used colors` : `当前色号 ${selectedColor.code}，展开已用色号`)
                  : (isEn ? 'Choose a bead color' : '选择拼豆色号')
              }
            >
              <span className="flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/20"
                  style={{ backgroundColor: selectedColor?.hex || 'transparent' }}
                />
                <ChevronDown
                  aria-hidden="true"
                  className={`h-3 w-3 text-purple-600 transition-transform ${isColorTrayOpen ? 'rotate-180' : ''}`}
                />
              </span>
              <span className="mt-0.5 max-w-full truncate text-xs font-black leading-none">
                {selectedColor ? selectedColor.code : isEn ? 'Color' : '色号'}
              </span>
            </button>

            <div
              role="group"
              aria-label={isEn ? 'Drawing tools' : '绘制工具'}
              className="flex h-[46px] min-w-0 flex-1 items-stretch overflow-hidden rounded-xl border border-purple-200 bg-white shadow-xs"
            >
              {[
                { tool: 'pencil' as ToolType, icon: Pencil, zh: '画笔', en: 'Pencil' },
                { tool: 'bucket' as ToolType, icon: PaintBucket, zh: '油漆桶', en: 'Fill' },
                { tool: 'eyedropper' as ToolType, icon: Pipette, zh: '吸管', en: 'Pick' },
                { tool: 'eraser' as ToolType, icon: Eraser, zh: '橡皮', en: 'Eraser' },
              ].map(({ tool, icon: Icon, zh, en }, index) => {
                const isActive = activeTool === tool;
                return (
                  <button
                    key={tool}
                    type="button"
                    onClick={() => setActiveTool(tool)}
                    aria-pressed={isActive}
                    aria-label={isEn ? en : zh}
                    className={`inline-flex min-w-10 flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
                      index > 0 ? 'border-l border-purple-100' : ''
                    } ${
                      isActive
                        ? 'bg-purple-600 text-white'
                        : 'text-purple-700 active:bg-purple-50'
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    <span className="text-xs font-bold leading-none">{isEn ? en : zh}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex h-[46px] shrink-0 items-stretch overflow-hidden rounded-xl border border-purple-200 bg-white shadow-xs">
              <button
                type="button"
                onClick={handleUndo}
                disabled={!canUndo}
                aria-label={isEn ? 'Undo' : '撤销'}
                className="inline-flex w-11 items-center justify-center border-r border-purple-100 text-purple-800 transition-colors active:bg-purple-50 disabled:opacity-30"
              >
                <Undo2 className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={!canRedo}
                aria-label={isEn ? 'Redo' : '重做'}
                className="inline-flex w-11 items-center justify-center text-purple-800 transition-colors active:bg-purple-50 disabled:opacity-30"
              >
                <Redo2 className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Row 2: View switcher + the single primary action (save). */}
        <nav
          aria-label={isEn ? 'Studio views' : '画板视图'}
          className="flex h-14 items-center gap-1 border-t border-purple-100 px-1.5"
        >
          <div role="tablist" aria-label={isEn ? 'Studio views' : '画板视图'} className="flex flex-1 items-center gap-1">
            {[
              { tab: 'canvas' as MobileTab, icon: LayoutGrid, zh: '画布', en: 'Canvas' },
              { tab: 'settings' as MobileTab, icon: Sliders, zh: '转图', en: 'Convert' },
              { tab: 'stats' as MobileTab, icon: BarChart3, zh: '用量', en: 'Usage' },
            ].map(({ tab, icon: Icon, zh, en }) => {
              const isActive = currentTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setCurrentTab(tab)}
                  className={`inline-flex h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
                    isActive ? 'bg-purple-50 text-purple-700' : 'text-slate-500 active:bg-slate-100'
                  }`}
                >
                  <Icon className={`h-[18px] w-[18px] ${isActive ? 'stroke-[2.4]' : ''}`} aria-hidden="true" />
                  <span className={`text-xs leading-none ${isActive ? 'font-black' : 'font-bold'}`}>
                    {isEn ? en : zh}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setIsFeatureSheetOpen(true)}
            className="inline-flex h-11 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl text-slate-500 transition-colors active:bg-slate-100"
            aria-label={isEn ? 'Board toolkit' : '画板工具箱'}
          >
            <Wrench className="h-[18px] w-[18px]" aria-hidden="true" />
            <span className="text-xs font-bold leading-none">{isEn ? 'Tools' : '工具箱'}</span>
          </button>

          <button
            type="button"
            onClick={openSaveNameDialog}
            disabled={isSavingPattern}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-purple-600 px-3.5 text-xs font-black text-white shadow-sm transition-colors active:bg-purple-700 disabled:opacity-50"
          >
            {isSavingPattern ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{isEn ? 'Save' : '保存'}</span>
          </button>
        </nav>
      </div>

      {/* Feature Sheet Modal Drawer */}
      <MobileFeatureSheet
        editorActions={editorActions}
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
        onOpenExportModal={() => {
          setIsFeatureSheetOpen(false);
          openExportModal();
        }}
        onTogglePractice={editorActions ? editorActions.onTogglePractice : undefined}
        isPracticeMode={editorActions?.isPracticeMode ?? false}
        onOpenResidualCleanup={
          backgroundCleanup
            ? () => {
                setCurrentTab('canvas');
                setIsColorTrayOpen(false);
                backgroundCleanup.open();
              }
            : undefined
        }
        residualCleanupDisabled={!backgroundCleanup?.canOpen}
        onSelectRegionClear={() => {
          setCurrentTab('canvas');
          setActiveTool('region_clear');
        }}
        isRegionClearActive={activeTool === 'region_clear'}
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
