import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Download,
  Image as ImageIcon,
  ShieldAlert,
  Sliders,
  Crown,
  Sparkles,
  Lock,
  CheckCircle2,
  HelpCircle,
  Palette,
  RotateCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { BeadColor, BeadShape } from '../types';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { saveExportedPatternRecord } from '../utils/patternHistory';
import {
  generatePatternCanvas,
  downloadCanvasImage,
  ExportOptions,
  WatermarkType,
  LegendPosition,
  LegendScaleMode,
  SymbolDisplayType,
  ExportQuality,
} from '../utils/exportUtils';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  grid: (string | null)[][];
  paletteMap: Map<string, BeadColor>;
  width: number;
  height: number;
  boardSize: number;
  brandName: string;
  projectName: string;
  beadShape: BeadShape;
  onOpenAuthModal?: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  grid,
  paletteMap,
  width,
  height,
  boardSize,
  brandName,
  projectName,
  beadShape,
  onOpenAuthModal,
}) => {
  const { currentUser, isVip, isPro, memberType } = useAuth();
  const { language, t } = useLanguage();
  const isEn = language === 'en';

  // Watermark States
  const [watermarkType, setWatermarkType] = useState<WatermarkType>('double_diagonal');
  const [watermarkOpacity, setWatermarkOpacity] = useState<number>(0.18);
  const [watermarkText, setWatermarkText] = useState<string>(isEn ? 'BeadGrid' : '豆织星格');
  const [watermarkColor, setWatermarkColor] = useState<string>('#A855F7');
  const [watermarkAngle, setWatermarkAngle] = useState<number>(-25);

  // Layout & Display States
  const [showSymbols, setShowSymbols] = useState(true);
  const [symbolDisplayType, setSymbolDisplayType] = useState<SymbolDisplayType>('code');
  const [symbolFontScale, setSymbolFontScale] = useState<number>(1.0);
  const [exportQuality, setExportQuality] = useState<ExportQuality>('high');
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [legendPosition, setLegendPosition] = useState<LegendPosition>('right');
  const [legendScaleMode, setLegendScaleMode] = useState<LegendScaleMode>('auto');
  const [hideEmptyPegs, setHideEmptyPegs] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState<number | null>(null);

  // Tooltips and Modal States
  const [isCollapsed, setIsCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  const [showVipTooltip, setShowVipTooltip] = useState(false);
  const [showFreeDownloadModal, setShowFreeDownloadModal] = useState(false);
  const [pendingDownloadType, setPendingDownloadType] = useState<'single' | 'all' | null>(null);
  const [wechatPreviewUrl, setWechatPreviewUrl] = useState<string | null>(null);

  const previewContainerRef = useRef<HTMLDivElement>(null);

  const boardsX = Math.ceil(width / boardSize);
  const boardsY = Math.ceil(height / boardSize);
  const totalBoards = boardsX * boardsY;

  // Enforce Hard Permission Rules for Non-VIP users
  useEffect(() => {
    if (!isVip) {
      // Force watermark on if non-VIP
      if (watermarkType === 'none') {
        setWatermarkType('double_diagonal');
      }
      // Revert 4K Ultra to 2K High if non-VIP
      if (exportQuality === 'ultra') {
        setExportQuality('high');
      }
      // Force platform default watermark text if non-VIP
      setWatermarkText(isEn ? 'BeadGrid' : '豆织星格');
      setWatermarkColor('#A855F7');
      setWatermarkAngle(-25);
    }
  }, [isVip, watermarkType, exportQuality, isEn]);

  // Render Canvas Preview
  useEffect(() => {
    if (!isOpen || !previewContainerRef.current) return;

    const options: ExportOptions = {
      grid,
      paletteMap,
      width,
      height,
      boardSize,
      brandName,
      projectName,
      showSymbols,
      symbolDisplayType,
      symbolFontScale,
      exportQuality,
      showCoordinates,
      beadShape,
      selectedBoardIndex: selectedBoard,
      watermarkType,
      watermarkText: isVip ? watermarkText : (isEn ? 'BeadGrid' : '豆织星格'),
      watermarkOpacity,
      watermarkColor: isVip ? watermarkColor : '#A855F7',
      watermarkAngle: isVip ? watermarkAngle : -25,
      legendPosition,
      legendScaleMode,
      hideEmptyPegs,
      isEn,
    };

    const canvas = generatePatternCanvas(options);
    previewContainerRef.current.innerHTML = '';
    canvas.className = 'max-w-full h-auto shadow-xl rounded-lg border border-slate-700 mx-auto';
    previewContainerRef.current.appendChild(canvas);
  }, [
    isOpen,
    grid,
    paletteMap,
    width,
    height,
    boardSize,
    brandName,
    projectName,
    showSymbols,
    symbolDisplayType,
    symbolFontScale,
    exportQuality,
    showCoordinates,
    beadShape,
    selectedBoard,
    watermarkType,
    watermarkText,
    watermarkOpacity,
    watermarkColor,
    watermarkAngle,
    legendPosition,
    legendScaleMode,
    hideEmptyPegs,
    isVip,
  ]);

  if (!isOpen) return null;

  // Actual Download Execution
  const executeSingleDownload = () => {
    const options: ExportOptions = {
      grid,
      paletteMap,
      width,
      height,
      boardSize,
      brandName,
      projectName,
      showSymbols,
      symbolDisplayType,
      symbolFontScale,
      exportQuality,
      showCoordinates,
      beadShape,
      selectedBoardIndex: selectedBoard,
      watermarkType,
      watermarkText: isVip ? watermarkText : (isEn ? 'BeadGrid' : '豆织星格'),
      watermarkOpacity,
      watermarkColor: isVip ? watermarkColor : '#A855F7',
      watermarkAngle: isVip ? watermarkAngle : -25,
      legendPosition,
      legendScaleMode,
      hideEmptyPegs,
      isEn,
    };
    const canvas = generatePatternCanvas(options);
    const suffix = selectedBoard !== null
      ? (isEn ? `_Board${selectedBoard + 1}` : `_板${selectedBoard + 1}`)
      : (isEn ? '_FullPattern' : '_完整图纸');
    downloadCanvasImage(canvas, `${projectName}${suffix}.png`, (dataUrl) => setWechatPreviewUrl(dataUrl));

    // Auto archive exported pattern record for user (Free: 7 days, VIP: 30 days)
    if (currentUser?.uid) {
      const totalBeadsCount = grid.reduce((acc, row) => acc + row.filter(cell => cell !== null).length, 0);
      saveExportedPatternRecord({
        userId: currentUser.uid,
        title: projectName || (isEn ? 'Perler Pattern' : '拼豆图纸'),
        width,
        height,
        totalBeads: totalBeadsCount,
        canvas,
        isVip: Boolean(isVip || isPro || (memberType ?? 0) > 0),
      }).catch(e => console.warn('Failed to archive pattern record:', e));
    }
  };

  const executeAllBoardsDownload = () => {
    const fullOptions: ExportOptions = {
      grid,
      paletteMap,
      width,
      height,
      boardSize,
      brandName,
      projectName,
      showSymbols,
      symbolDisplayType,
      symbolFontScale,
      exportQuality,
      showCoordinates,
      beadShape,
      selectedBoardIndex: null,
      watermarkType,
      watermarkText: isVip ? watermarkText : (isEn ? 'BeadGrid' : '豆织星格'),
      watermarkOpacity,
      watermarkColor: isVip ? watermarkColor : '#A855F7',
      watermarkAngle: isVip ? watermarkAngle : -25,
      legendPosition,
      legendScaleMode,
      hideEmptyPegs,
      isEn,
    };
    const fullCanvas = generatePatternCanvas(fullOptions);
    downloadCanvasImage(fullCanvas, isEn ? `${projectName}_FullPattern.png` : `${projectName}_完整图纸.png`, (dataUrl) => setWechatPreviewUrl(dataUrl));

    for (let i = 0; i < totalBoards; i++) {
      setTimeout(() => {
        const subOptions: ExportOptions = {
          ...fullOptions,
          selectedBoardIndex: i,
        };
        downloadCanvasImage(generatePatternCanvas(subOptions), isEn ? `${projectName}_Board${i + 1}.png` : `${projectName}_板${i + 1}.png`, (dataUrl) => setWechatPreviewUrl(dataUrl));
      }, i * 300);
    }

    // Auto archive exported pattern record for user (Free: 7 days, VIP: 30 days)
    if (currentUser?.uid) {
      const totalBeadsCount = grid.reduce((acc, row) => acc + row.filter(cell => cell !== null).length, 0);
      saveExportedPatternRecord({
        userId: currentUser.uid,
        title: projectName || (isEn ? 'Perler Pattern' : '拼豆图纸'),
        width,
        height,
        totalBeads: totalBeadsCount,
        canvas: fullCanvas,
        isVip: Boolean(isVip || isPro || (memberType ?? 0) > 0),
      }).catch(e => console.warn('Failed to archive pattern record:', e));
    }
  };

  // Download Trigger Handler with VIP check
  const handleDownloadClick = (type: 'single' | 'all') => {
    if (!isVip) {
      setPendingDownloadType(type);
      setShowFreeDownloadModal(true);
    } else {
      if (type === 'single') executeSingleDownload();
      else executeAllBoardsDownload();
    }
  };

  const confirmFreeDownload = () => {
    setShowFreeDownloadModal(false);
    if (pendingDownloadType === 'single') executeSingleDownload();
    else if (pendingDownloadType === 'all') executeAllBoardsDownload();
    setPendingDownloadType(null);
  };

  const handleWatermarkTypeSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as WatermarkType;
    if (value === 'none' && !isVip) {
      setShowVipTooltip(true);
      setTimeout(() => setShowVipTooltip(false), 3500);
      return;
    }
    setWatermarkType(value);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-1 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl w-full max-w-4xl max-h-[96vh] sm:max-h-[92vh] flex flex-col shadow-2xl text-slate-200 text-xs overflow-hidden">
        
        {/* Header */}
        <div className="p-2.5 sm:p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-sm text-slate-100 truncate">
                  {isEn ? 'Export Pattern Tutorial' : '导出高清拼豆图纸教程'}
                </h3>
                {isVip ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0">
                    <Crown className="w-3 h-3 text-amber-400" />
                    {isEn ? 'VIP Export' : 'VIP尊享导出'}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 border border-slate-700 text-slate-400 shrink-0">
                    {isEn ? 'Free Pattern' : '免费版图纸'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate hidden sm:block">
                {isEn ? 'Includes scale coordinates, color symbols, and bead count checklist' : '包含标准标尺坐标、色号符号标识与拼豆用量色卡列表'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Responsive Collapsible Button across PC, Tablet, Mobile */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-medium text-xs transition-all cursor-pointer hover:text-white"
              title={isCollapsed ? (isEn ? 'Expand Settings' : '展开参数设置') : (isEn ? 'Collapse Settings' : '收起参数设置')}
            >
              {isCollapsed ? (
                <>
                  <ChevronDown className="w-4 h-4 text-purple-400 shrink-0" />
                  <span className="hidden sm:inline font-bold text-purple-300">{isEn ? 'Expand' : '展开设置'}</span>
                  <span className="sm:hidden font-bold text-purple-300">{isEn ? 'Expand' : '展开'}</span>
                </>
              ) : (
                <>
                  <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="hidden sm:inline">{isEn ? 'Collapse' : '收起设置'}</span>
                  <span className="sm:hidden">{isEn ? 'Collapse' : '收起'}</span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Control Area: Watermark & Settings (Collapsible) */}
        {isCollapsed ? (
          <div className="px-3.5 py-2.5 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-300">
              <span className="inline-flex items-center gap-1 font-bold text-purple-300 bg-purple-500/10 px-2.5 py-1 rounded-lg border border-purple-500/20">
                <ShieldAlert className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                {watermarkType === 'none'
                  ? (isEn ? '✨ Watermark Free' : '✨ 纯净无水印')
                  : (isEn ? `🛡️ Watermark: Diagonal (${Math.round(watermarkOpacity * 100)}%)` : `🛡️ 水印: 双重斜向 (${Math.round(watermarkOpacity * 100)}%)`)}
              </span>
              <span className="text-slate-700 hidden sm:inline">|</span>
              <span className="text-slate-400">
                {showCoordinates ? (isEn ? 'Ruler: ON' : '标尺: 开启') : (isEn ? 'Ruler: OFF' : '标尺: 关闭')} • {showSymbols ? (isEn ? 'Symbols: ON' : '色号: 开启') : (isEn ? 'Symbols: OFF' : '色号: 关闭')}
              </span>
              <span className="text-slate-700 hidden sm:inline">|</span>
              <span className="text-slate-400">
                {isEn ? 'View:' : '视角:'} {selectedBoard === null ? (isEn ? 'Full Pattern' : '全景整张图纸') : (isEn ? `Board #${selectedBoard + 1}` : `第 ${selectedBoard + 1} 板`)}
              </span>
            </div>
            <button
              onClick={() => setIsCollapsed(false)}
              className="flex items-center gap-1 px-3 py-1 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-300 font-bold hover:bg-purple-500/20 text-[11px] cursor-pointer shrink-0 transition-all"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              <span>{isEn ? 'Expand Details' : '展开参数设置'}</span>
            </button>
          </div>
        ) : (
          <div className="p-3.5 bg-slate-950/90 border-b border-slate-800 flex flex-col gap-3 text-xs">
            
            {/* Top Row: Two Clean Setting Group Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              
              {/* Card 1: Pattern Layout & Markers */}
              <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800/80 flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-slate-300 font-bold text-[11px]">
                  <div className="flex items-center gap-1.5 text-purple-300">
                    <Sliders className="w-3.5 h-3.5 text-purple-400" />
                    <span>{isEn ? 'Pattern & Display Options' : '图纸排版与显示'}</span>
                  </div>
                  {totalBoards > 1 && (
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 text-[10px]">{isEn ? 'Board:' : '视角:'}</span>
                      <select
                        value={selectedBoard === null ? 'full' : selectedBoard.toString()}
                        onChange={e => {
                          const val = e.target.value;
                          setSelectedBoard(val === 'full' ? null : parseInt(val));
                        }}
                        className="bg-slate-800 border border-slate-700 text-purple-200 rounded px-1.5 py-0.5 text-[11px] outline-none cursor-pointer"
                      >
                        <option value="full">{isEn ? 'Full Pattern' : '全景整图'}</option>
                        {Array.from({ length: totalBoards }).map((_, idx) => (
                          <option key={idx} value={idx}>
                            {isEn ? `Board #${idx + 1}` : `第 ${idx + 1} 板`}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5 text-[11px]">
                  {/* Color Symbol Toggle & Font Scale */}
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors">
                      <input
                        type="checkbox"
                        checked={showSymbols}
                        onChange={e => {
                          const checked = e.target.checked;
                          setShowSymbols(checked);
                          if (checked) {
                            setSymbolDisplayType('code');
                          } else {
                            setSymbolDisplayType('none');
                          }
                        }}
                        className="accent-purple-500 rounded cursor-pointer w-3.5 h-3.5"
                      />
                      <span className="font-semibold text-slate-200">{isEn ? 'Show Color Code' : '显示色号标识'}</span>
                    </label>

                    {showSymbols && (
                      <select
                        value={symbolFontScale.toString()}
                        onChange={e => setSymbolFontScale(parseFloat(e.target.value))}
                        className="bg-slate-800 border border-slate-700 text-amber-300 font-medium rounded px-1.5 py-0.5 text-[10px] outline-none cursor-pointer"
                      >
                        <option value="0.75">{isEn ? '75% Small' : '75% 偏小'}</option>
                        <option value="1.0">{isEn ? '100% Standard' : '100% 标准'}</option>
                        <option value="1.25">{isEn ? '125% Large' : '125% 放大'}</option>
                        <option value="1.5">{isEn ? '150% XL' : '150% 特大'}</option>
                      </select>
                    )}
                  </div>

                  {/* Ruler Coordinates */}
                  <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors">
                    <input
                      type="checkbox"
                      checked={showCoordinates}
                      onChange={e => setShowCoordinates(e.target.checked)}
                      className="accent-purple-500 rounded cursor-pointer w-3.5 h-3.5"
                    />
                    <span className="text-slate-300">{isEn ? 'Show Coordinates' : '显示标尺'}</span>
                  </label>

                  {/* Hide Empty Pegs */}
                  <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors">
                    <input
                      type="checkbox"
                      checked={hideEmptyPegs}
                      onChange={e => setHideEmptyPegs(e.target.checked)}
                      className="accent-emerald-500 rounded cursor-pointer w-3.5 h-3.5"
                    />
                    <span className="text-slate-300">{isEn ? 'Hide Empty Pegs' : '隐藏空位'}</span>
                  </label>

                  {/* Legend Position */}
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400">{isEn ? 'Legend:' : '图例:'}</span>
                    <select
                      value={legendPosition}
                      onChange={e => setLegendPosition(e.target.value as LegendPosition)}
                      className="bg-slate-800 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-[10px] outline-none cursor-pointer"
                    >
                      <option value="right">{isEn ? 'Right' : '右侧'}</option>
                      <option value="bottom">{isEn ? 'Bottom' : '下方'}</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Card 2: Watermark & Quality Export Options */}
              <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800/80 flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-slate-300 font-bold text-[11px]">
                  <div className="flex items-center gap-1.5 text-emerald-300">
                    <ShieldAlert className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{isEn ? 'Watermark & Resolution' : '水印防护与画质'}</span>
                  </div>

                  {/* Export Resolution */}
                  <div className="flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-emerald-400 shrink-0" />
                    <select
                      value={exportQuality}
                      onChange={e => {
                        const val = e.target.value as ExportQuality;
                        if (val === 'ultra' && !isVip) {
                          setShowVipTooltip(true);
                          return;
                        }
                        setExportQuality(val);
                      }}
                      className="bg-slate-800 border border-slate-700 text-emerald-300 font-medium rounded px-1.5 py-0.5 text-[10px] outline-none cursor-pointer"
                    >
                      <option value="high">{isEn ? '⚡ 2K HD' : '⚡ 2K 超清 (推荐)'}</option>
                      <option value="ultra">{isEn ? '💎 4K Ultra (VIP)' : '💎 4K 极清 (VIP专享)'}</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-0.5 text-[11px]">
                  {/* Style Select */}
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400">{isEn ? 'Style:' : '水印:'}</span>
                    <select
                      value={watermarkType}
                      onChange={handleWatermarkTypeSelect}
                      className={`bg-slate-800 border ${
                        watermarkType === 'none' ? 'border-emerald-500/50 text-emerald-300' : 'border-purple-500/40 text-purple-200'
                      } font-medium rounded px-2 py-0.5 text-[10px] outline-none cursor-pointer`}
                    >
                      <option value="double_diagonal">{isEn ? 'Double Diagonal' : '双重斜向水印'}</option>
                      <option
                        value="none"
                        disabled={!isVip}
                        className={!isVip ? 'text-slate-500 bg-slate-900' : 'text-emerald-400 font-bold'}
                      >
                        {isVip
                          ? (isEn ? '✨ Watermark Free' : '✨ 无水印图纸 (VIP)')
                          : (isEn ? '👑 Watermark Free (VIP)' : '👑 无水印图纸 (VIP)')}
                      </option>
                    </select>
                  </div>

                  {/* Opacity Select */}
                  {watermarkType !== 'none' && (
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">{isEn ? 'Opacity:' : '不透明:'}</span>
                      <select
                        value={watermarkOpacity.toString()}
                        onChange={e => setWatermarkOpacity(parseFloat(e.target.value))}
                        className="bg-slate-800 border border-slate-700 text-slate-300 rounded px-1.5 py-0.5 text-[10px] outline-none cursor-pointer"
                      >
                        <option value="0.1">10%</option>
                        <option value="0.18">18%</option>
                        <option value="0.25">25%</option>
                      </select>
                    </div>
                  )}

                  {/* Custom Watermark Text (VIP) */}
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400">{isEn ? 'Text:' : '底纹文字:'}</span>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        disabled={!isVip}
                        value={isVip ? watermarkText : (isEn ? 'BeadGrid' : '豆织星格')}
                        onChange={e => setWatermarkText(e.target.value)}
                        placeholder={isEn ? 'Store name' : '自定义店铺名'}
                        className={`px-1.5 py-0.5 rounded border text-[10px] outline-none w-24 ${
                          isVip
                            ? 'bg-slate-800 border-slate-700 text-purple-200 focus:border-purple-500'
                            : 'bg-slate-800/50 border-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                      />
                      {!isVip && (
                        <Lock
                          className="w-3 h-3 text-amber-400/80 absolute right-1.5 cursor-pointer"
                          onClick={() => onOpenAuthModal?.()}
                          title={isEn ? 'VIP can customize watermark text' : 'VIP 可自定义店铺底纹'}
                        />
                      )}
                    </div>
                  </div>

                  {!isVip && (
                    <button
                      onClick={() => onOpenAuthModal?.()}
                      className="ml-auto text-amber-400 hover:text-amber-300 font-bold text-[10px] flex items-center gap-0.5 cursor-pointer"
                    >
                      <Crown className="w-3 h-3" />
                      <span>{isEn ? 'Upgrade VIP' : '升级VIP'}</span>
                    </button>
                  )}
                </div>

                {/* VIP Lock Hover Tooltip Notice */}
                {showVipTooltip && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 bg-slate-800 border border-amber-500/50 text-amber-200 text-[11px] p-2.5 rounded-xl shadow-2xl w-64 animate-in fade-in slide-in-from-top-1">
                    <div className="flex items-start gap-2">
                      <Crown className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-amber-300 mb-0.5">{isEn ? 'VIP Exclusive' : 'VIP 专属权限'}</p>
                        <p className="text-slate-300 leading-relaxed">
                          {isEn ? 'Upgrade to VIP for watermark-free export for commercial use or sales.' : '开通 VIP 会员，解锁纯净无水印图纸与 4K 极清导出'}
                        </p>
                        <button
                          onClick={() => {
                            setShowVipTooltip(false);
                            onOpenAuthModal?.();
                          }}
                          className="mt-2 text-xs font-bold text-amber-400 hover:underline flex items-center gap-1"
                        >
                          {isEn ? 'Upgrade to VIP now →' : '立即升级 VIP →'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* VIP Status Permanent Banner */}
            {isVip ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px]">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>
                  {isEn ? 'VIP benefits active: Watermark-free clean pattern export enabled.' : 'VIP 权益已激活，可关闭防盗水印导出纯净商用图纸'}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px]">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>
                    {isEn ? 'Free account exports include watermark. Upgrade to VIP for clean HD pattern export.' : '免费账号导出带防盗水印，升级 VIP 可一键导出无水印超清图纸'}
                  </span>
                </div>
                <button
                  onClick={() => onOpenAuthModal?.()}
                  className="text-emerald-400 hover:text-emerald-300 font-bold underline shrink-0 cursor-pointer"
                >
                  {isEn ? 'Upgrade VIP →' : '去升级 VIP →'}
                </button>
              </div>
            )}

          </div>
        )}

        {/* Live Canvas Preview Canvas Container */}
        <div className="p-1 sm:p-4 flex-1 overflow-auto bg-slate-950 flex items-center justify-center min-h-[200px]">
          <div ref={previewContainerRef} className="w-full h-full flex items-center justify-center" />
        </div>

        {/* Footer Actions */}
        <div className="p-2 sm:p-3 border-t border-slate-800 bg-slate-900 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="text-slate-400 text-[10px] sm:text-[11px] text-center sm:text-left hidden sm:block">
            {isEn ? `Export Mode: ${watermarkType === 'none' ? '✨ Clean Pattern' : '🛡️ Watermark Protected'} (${width}x${height} beads)` : `当前导出模式: ${watermarkType === 'none' ? '✨ 纯净无水印矢量图纸' : '🛡️ 防盗水印加固图纸'} (${width}x${height} 豆)`}
          </div>

          <div className="flex flex-row items-center gap-2 w-full sm:w-auto">
            {totalBoards > 1 && (
              <button
                onClick={() => handleDownloadClick('all')}
                className="flex-1 sm:flex-none bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold px-2.5 py-2 rounded-xl flex items-center justify-center gap-1 cursor-pointer transition-colors text-xs"
              >
                <Download className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="truncate">{isEn ? `Download All (${totalBoards + 1})` : `批量全部分板 (${totalBoards + 1}张)`}</span>
              </button>
            )}

            <button
              onClick={() => handleDownloadClick('single')}
              className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-2 rounded-xl shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-1 cursor-pointer transition-all active:scale-95 text-xs whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>{isEn ? 'Download PNG' : '下载高清 PNG 图纸'}</span>
            </button>
          </div>
        </div>

      </div>

      {/* Free User Download Light Modal Confirmation (二次轻提示) */}
      {showFreeDownloadModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 max-w-sm w-full shadow-2xl flex flex-col gap-4 text-center">
            
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
              <Crown className="w-6 h-6" />
            </div>

            <div>
              <h4 className="font-bold text-base text-slate-100 mb-1.5">{isEn ? 'Notice' : '温馨提示'}</h4>
              <p className="text-xs text-slate-300 leading-relaxed px-2">
                {isEn ? 'Free exports include a watermark. Upgrade to VIP for clean commercial patterns.' : '免费版本导出图纸自带防盗水印，如需无水印商用图纸，可开通 VIP 会员'}
              </p>
            </div>

            <div className="flex flex-col gap-2 mt-1">
              <button
                onClick={() => {
                  setShowFreeDownloadModal(false);
                  onOpenAuthModal?.();
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isEn ? 'Upgrade VIP for Clean Export' : '升级 VIP 纯净导出'}</span>
              </button>

              <button
                onClick={confirmFreeDownload}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs border border-slate-700 transition-colors cursor-pointer"
              >
                {isEn ? 'Download Watermarked File' : '确认直接下载带水印文件'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* WeChat Browser Download Guide / Long-press Save Modal */}
      {wechatPreviewUrl && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-3 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 max-w-lg w-full max-h-[92vh] flex flex-col gap-3 shadow-2xl text-slate-200 relative overflow-hidden">
            <button
              onClick={() => setWechatPreviewUrl(null)}
              className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <span>微信导出保存指南</span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl">
              微信内置浏览器限制网页自动文件下载。<br />
              <strong className="text-amber-300 font-semibold">【操作说明】</strong>：请<strong className="text-white underline underline-offset-2">长按下方图片</strong>选择<span className="text-emerald-400 font-bold">【保存图片】</span>存入手机相册；或点击微信右上角<strong className="text-sky-300">【···】</strong>选择<span className="text-sky-400 font-bold">【在浏览器打开】</span>以一键批量下载。
            </p>

            <div className="flex-1 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-2 flex items-center justify-center min-h-[220px]">
              <img
                src={wechatPreviewUrl}
                alt="高清拼豆图纸"
                className="max-h-[58vh] w-auto object-contain rounded-lg shadow-lg select-none"
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 text-xs">
              <span className="text-[11px] text-slate-400">💡 提示：长按上方图纸即可直接保存相册</span>
              <button
                onClick={() => setWechatPreviewUrl(null)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all cursor-pointer text-xs"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
