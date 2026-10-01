import React from 'react';
import { BeadColor, BeadShape, ToolType, SymmetryMode, CanvasBackdrop, ConvertSettings } from '../../types';
import { Toolbar } from '../Toolbar';
import { SettingsPanel } from '../SettingsPanel';
import { StatsPanel, type StrayBeadConsolidationStrength } from '../StatsPanel';
import { GridCanvas } from '../GridCanvas';
import type { ConversionDiagnostics } from '../../utils/imagePipeline';
import { FolderOpen, Sparkles } from 'lucide-react';

export interface DesktopWorkspaceProps {
  completionSummary?: React.ReactNode;
  // Canvas & Grid State
  grid: (string | null)[][];
  paletteMap: Map<string, BeadColor>;
  settings: ConvertSettings;
  setSettings: React.Dispatch<React.SetStateAction<ConvertSettings>>;
  conversionDiagnostics: any;
  handleReconvert: () => void;
  sourceImage: HTMLImageElement | null;
  setIsStudioModalOpen: (open: boolean) => void;

  // Tools & Interaction
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

  // View & Render options
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

  // Highlighting & Stats
  highlightColorIds: string[];
  setHighlightColorIds: (ids: string[]) => void;
  handleToggleHighlightColorId: (id: string) => void;
  completedColorIds: string[];
  handleToggleCompletedColorId: (id: string) => void;
  setReplaceSourceColor: (color: BeadColor) => void;
  handleEraseColor: (colorId: string) => void;
  handleRestoreColor: (colorId: string) => void;
  erasedColorCoords: Map<string, [number, number][]>;
  onConsolidateStrayBeads?: (strength: StrayBeadConsolidationStrength) => void;

  // Callbacks
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
  isConverting: boolean;
  isEn: boolean;
  onOpenPatternsModal: () => void;
}

export const DesktopWorkspace: React.FC<DesktopWorkspaceProps> = ({
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
  onConsolidateStrayBeads,
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
  isConverting,
  isEn,
  onOpenPatternsModal,
}) => {
  const canExport = grid.some(row => row.some(colorId => colorId !== null));

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-slate-100">
      {/* Top Desktop Toolbar */}
      <div className="relative shrink-0">
        <Toolbar
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          selectedColor={selectedColor}
          onOpenColorPicker={openColorManagerModal}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          zoom={zoom}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={handleResetZoom}
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
          onClearOuterBackground={handleClearOuterBackground}
          hasImage={sourceImage !== null}
          showOverlay={showOverlay}
          overlayOpacity={overlayOpacity}
          setShowOverlay={setShowOverlay}
          setOverlayOpacity={setOverlayOpacity}
          onSavePattern={openSaveNameDialog}
          isSavingPattern={isSavingPattern}
          onOpenExport={openExportModal}
          canExport={canExport}
        />
        <button
          type="button"
          onClick={onOpenPatternsModal}
          title="我的图纸"
          aria-label="我的图纸"
          className="absolute right-3 top-1/2 z-10 flex h-9 w-9 shrink-0 -translate-y-1/2 items-center justify-center rounded-md border border-purple-200 bg-white text-purple-700 shadow-sm transition-colors hover:bg-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2"
        >
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Main 3-Column Desktop Work Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar: Image Conversion & Canvas Dimension Settings */}
        <aside className="h-full z-20 shrink-0 border-r border-purple-200/80 bg-white/90 shadow-sm flex flex-col">
          <SettingsPanel
            settings={settings}
            setSettings={setSettings}
            conversionDiagnostics={conversionDiagnostics}
            onReconvert={handleReconvert}
            hasImage={sourceImage !== null}
            onOpenImageStudio={() => setIsStudioModalOpen(true)}
          />
        </aside>

        {/* Center Main Canvas Viewport */}
        <main className="flex-1 h-full relative min-w-0 bg-slate-100 flex flex-col overflow-hidden">
          <GridCanvas
            interactionProfile="desktop"
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

          {/* Loading Animation Overlay */}
          {isConverting && (
            <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-xs z-30 flex flex-col items-center justify-center gap-3 transition-opacity duration-200">
              <div className="relative flex items-center justify-center">
                <div className="w-14 h-14 rounded-full border-4 border-indigo-600/20 border-t-indigo-600 animate-spin" />
                <div
                  className="w-8 h-8 rounded-full border-2 border-indigo-400/30 border-b-indigo-400 animate-spin absolute"
                  style={{ animationDirection: 'reverse', animationDuration: '0.8s' }}
                />
                <Sparkles className="w-5 h-5 text-indigo-600 absolute animate-pulse" />
              </div>
              <div className="text-xs font-bold text-slate-800 flex items-center gap-2 bg-white/95 border border-slate-200 px-4 py-2 rounded-full shadow-md">
                <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
                <span>{isEn ? 'Quantizing beads & matching colors...' : '✨ 正在精准计算拼豆像素与色卡匹配...'}</span>
              </div>
            </div>
          )}
        </main>

        {/* Right Sidebar: Color Palette & Quantity Statistics */}
        <aside className="h-full z-20 shrink-0 border-l border-purple-200/80 bg-white/90 shadow-sm flex flex-col">
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
            onSelectColor={color => setSelectedColor(color)}
            onEraseColor={handleEraseColor}
            onRestoreColor={handleRestoreColor}
            erasedColorCoords={erasedColorCoords}
            onConsolidateStrayBeads={onConsolidateStrayBeads}
          />
        </aside>
      </div>
    </div>
  );
};
