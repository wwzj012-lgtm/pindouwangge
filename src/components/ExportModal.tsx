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
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [legendPosition, setLegendPosition] = useState<LegendPosition>('right');
  const [legendScaleMode, setLegendScaleMode] = useState<LegendScaleMode>('auto');
  const [hideEmptyPegs, setHideEmptyPegs] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState<number | null>(null);

  // Tooltips and Modal States
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showVipTooltip, setShowVipTooltip] = useState(false);
  const [showFreeDownloadModal, setShowFreeDownloadModal] = useState(false);
  const [pendingDownloadType, setPendingDownloadType] = useState<'single' | 'all' | null>(null);

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
      // Force platform default watermark text if non-VIP
      setWatermarkText(isEn ? 'BeadGrid' : '豆织星格');
      setWatermarkColor('#A855F7');
      setWatermarkAngle(-25);
    }
  }, [isVip, watermarkType, isEn]);

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
    downloadCanvasImage(canvas, `${projectName}${suffix}.png`);

    // Auto archive exported pattern record for user (30 days retention)
    if (currentUser?.uid) {
      const totalBeadsCount = grid.reduce((acc, row) => acc + row.filter(cell => cell !== null).length, 0);
      saveExportedPatternRecord({
        userId: currentUser.uid,
        title: projectName || (isEn ? 'Perler Pattern' : '拼豆图纸'),
        width,
        height,
        totalBeads: totalBeadsCount,
        canvas,
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
    downloadCanvasImage(fullCanvas, isEn ? `${projectName}_FullPattern.png` : `${projectName}_完整图纸.png`);

    for (let i = 0; i < totalBoards; i++) {
      setTimeout(() => {
        const subOptions: ExportOptions = {
          ...fullOptions,
          selectedBoardIndex: i,
        };
        downloadCanvasImage(generatePatternCanvas(subOptions), isEn ? `${projectName}_Board${i + 1}.png` : `${projectName}_板${i + 1}.png`);
      }, i * 300);
    }

    // Auto archive exported pattern record for user (30 days retention)
    if (currentUser?.uid) {
      const totalBeadsCount = grid.reduce((acc, row) => acc + row.filter(cell => cell !== null).length, 0);
      saveExportedPatternRecord({
        userId: currentUser.uid,
        title: projectName || (isEn ? 'Perler Pattern' : '拼豆图纸'),
        width,
        height,
        totalBeads: totalBeadsCount,
        canvas: fullCanvas,
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
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[94vh] sm:max-h-[92vh] flex flex-col shadow-2xl text-slate-200 text-xs overflow-hidden">
        
        {/* Header */}
        <div className="p-3 sm:p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 gap-2">
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

        {/* Control Area: Watermark Section & Settings (Collapsible) */}
        {isCollapsed ? (
          <div className="px-3.5 py-2.5 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-300">
              <span className="inline-flex items-center gap-1 font-bold text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded-lg border border-purple-500/20">
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
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-300 font-bold hover:bg-purple-500/20 text-[11px] cursor-pointer shrink-0 transition-all"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              <span>{isEn ? 'Expand Details' : '展开详细设置'}</span>
            </button>
          </div>
        ) : (
          <div className="p-3.5 bg-slate-950/90 border-b border-slate-800 flex flex-col gap-3 text-xs">
            
            {/* Watermark Section Bar */}
            <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800/80 flex flex-col gap-2.5">
              
              {/* Header Title with Permission Indication */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-purple-400 shrink-0" />
                  <span className="font-bold text-slate-200">
                    {isVip
                      ? (isEn ? 'Anti-theft Watermark [VIP Can Disable]' : '防盗水印【VIP 可关闭水印】')
                      : (isEn ? 'Anti-theft Watermark [Free Version, Upgrade VIP to Remove]' : '防盗水印【免费强制开启，升级 VIP 可去除】')}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {/* VIP Quick Badge / Action */}
                  {!isVip && (
                    <button
                      onClick={() => onOpenAuthModal?.()}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500/20 to-purple-500/20 border border-amber-500/30 text-amber-300 font-bold hover:brightness-110 transition-all cursor-pointer text-[11px]"
                    >
                      <Crown className="w-3.5 h-3.5 text-amber-400 fill-amber-400/20" />
                      <span>{isEn ? 'Get VIP to Remove Watermark' : '开通 VIP 去水印'}</span>
                    </button>
                  )}

                  <button
                    onClick={() => setIsCollapsed(true)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-750 border border-slate-700/80 text-slate-300 text-[11px] font-medium transition-colors cursor-pointer"
                    title={isEn ? 'Collapse watermark panel' : '收起水印设置面板'}
                  >
                    <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                    <span className="hidden sm:inline">{isEn ? 'Collapse' : '收起'}</span>
                  </button>
                </div>
              </div>

            {/* Controls Row */}
            <div className="flex flex-wrap items-center gap-3">
              
              {/* Dropdown 1: Watermark Type */}
              <div className="relative flex items-center gap-1.5">
                <span className="text-slate-400">{isEn ? 'Style:' : '样式:'}</span>
                <div className="relative inline-block">
                  <select
                    value={watermarkType}
                    onChange={handleWatermarkTypeSelect}
                    className={`bg-slate-800 border ${
                      watermarkType === 'none' ? 'border-emerald-500/50 text-emerald-300' : 'border-purple-500/40 text-purple-200'
                    } font-medium rounded-lg px-2.5 py-1.5 text-xs outline-none cursor-pointer pr-7`}
                  >
                    <option value="double_diagonal">{isEn ? '✦ Double Diagonal Watermark' : '✦ 双重斜向水印 (全图覆盖)'}</option>
                    <option
                      value="none"
                      disabled={!isVip}
                      className={!isVip ? 'text-slate-500 bg-slate-900' : 'text-emerald-400 font-bold'}
                    >
                      {isVip
                        ? (isEn ? '✨ Watermark Free (VIP Unlocked)' : '✨ 无水印图纸 (VIP 已解锁)')
                        : (isEn ? '👑 Watermark Free (Upgrade VIP)' : '👑 无水印图纸 (升级 VIP 解锁)')}
                    </option>
                  </select>
                </div>

                {/* VIP Lock Hover Tooltip Notice */}
                {showVipTooltip && (
                  <div className="absolute top-full left-0 mt-2 z-50 bg-slate-800 border border-amber-500/50 text-amber-200 text-[11px] p-2.5 rounded-xl shadow-2xl w-64 animate-in fade-in slide-in-from-top-1">
                    <div className="flex items-start gap-2">
                      <Crown className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-amber-300 mb-0.5">{isEn ? 'VIP Exclusive' : 'VIP 专属权限'}</p>
                        <p className="text-slate-300 leading-relaxed">
                          {isEn ? 'Upgrade to VIP for watermark-free export for commercial use or sales.' : '开通 VIP 会员，解锁纯净无水印图纸导出，支持商用摆摊、图纸售卖使用'}
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

              {/* Opacity Control (Hidden when watermarkType === 'none') */}
              {watermarkType !== 'none' && (
                <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
                  <span className="text-slate-400">{isEn ? 'Opacity:' : '透明度:'}</span>
                  <select
                    value={watermarkOpacity.toString()}
                    onChange={e => setWatermarkOpacity(parseFloat(e.target.value))}
                    className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer"
                  >
                    <option value="0.1">10% ({isEn ? 'Soft' : '轻柔防盗'})</option>
                    <option value="0.18">18% ({isEn ? 'Standard' : '标准防盗 - 推荐'})</option>
                    <option value="0.25">25% ({isEn ? 'Clear' : '清晰标识'})</option>
                  </select>
                </div>
              )}

              {/* VIP Custom Watermark Features (VIP Exclusives) */}
              <div className="flex items-center gap-2 border-l border-slate-800 pl-3 flex-wrap">
                
                {/* Custom Text */}
                <div className="flex items-center gap-1">
                  <span className="text-slate-400">{isEn ? 'Text:' : '文字:'}</span>
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      disabled={!isVip}
                      value={isVip ? watermarkText : (isEn ? 'BeadGrid' : '豆织星格')}
                      onChange={e => setWatermarkText(e.target.value)}
                      placeholder={isEn ? 'Custom store name' : '自定义店铺名称'}
                      className={`px-2 py-1 rounded-lg border text-xs outline-none w-32 ${
                        isVip
                          ? 'bg-slate-800 border-slate-700 text-purple-200 focus:border-purple-500'
                          : 'bg-slate-800/50 border-slate-800 text-slate-500 cursor-not-allowed'
                      }`}
                    />
                    {!isVip && (
                      <Lock
                        className="w-3 h-3 text-amber-400/80 absolute right-2 cursor-pointer"
                        onClick={() => onOpenAuthModal?.()}
                        title={isEn ? 'VIP can customize watermark text' : 'VIP 可自定义店铺底纹'}
                      />
                    )}
                  </div>
                </div>

                {/* Custom Color Selector (VIP only) */}
                {isVip && watermarkType === 'double_diagonal' && (
                  <div className="flex items-center gap-1 border-l border-slate-800 pl-2">
                    <Palette className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <select
                      value={watermarkColor}
                      onChange={e => setWatermarkColor(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1 text-xs outline-none cursor-pointer"
                    >
                      <option value="#A855F7">{isEn ? 'Purple (#A855F7)' : '梦幻紫 (#A855F7)'}</option>
                      <option value="#F59E0B">{isEn ? 'Gold (#F59E0B)' : '尊享金 (#F59E0B)'}</option>
                      <option value="#64748B">{isEn ? 'Gray (#64748B)' : '低调灰 (#64748B)'}</option>
                      <option value="#0284C7">{isEn ? 'Sky Blue (#0284C7)' : '天空蓝 (#0284C7)'}</option>
                    </select>
                  </div>
                )}

                {/* Custom Angle Selector (VIP only) */}
                {isVip && watermarkType === 'double_diagonal' && (
                  <div className="flex items-center gap-1">
                    <RotateCw className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <select
                      value={watermarkAngle.toString()}
                      onChange={e => setWatermarkAngle(parseInt(e.target.value))}
                      className="bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1 text-xs outline-none cursor-pointer"
                    >
                      <option value="-25">{isEn ? '-25° Diagonal' : '-25° 斜向'}</option>
                      <option value="-45">{isEn ? '-45° Corner' : '-45° 角斜'}</option>
                      <option value="0">{isEn ? '0° Horizontal' : '0° 横向'}</option>
                      <option value="-60">{isEn ? '-60° Steep' : '-60° 陡斜'}</option>
                    </select>
                  </div>
                )}

              </div>

            </div>

            {/* Global Permanent Banner (Below Watermark Module) */}
            {isVip ? (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px]">
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  {isEn ? 'VIP benefits active: Watermark-free clean pattern export enabled.' : 'VIP 权益已激活，可关闭防盗水印导出纯净商用图纸，支持自定义店铺水印'}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px]">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    {isEn ? 'Free account exports include platform watermark. Upgrade to VIP for clean HD pattern export.' : '您当前为免费账号，导出图纸将添加平台防盗水印，升级 VIP 即可导出无水印高清图纸'}
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

          {/* Grid, Coordinates, and Layout Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1">
            <div className="flex items-center gap-3 flex-wrap">
              
              <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors">
                <input
                  type="checkbox"
                  checked={showSymbols}
                  onChange={e => setShowSymbols(e.target.checked)}
                  className="accent-purple-500 rounded cursor-pointer"
                />
                <span>{isEn ? 'Show Color Symbols' : '显示色号标识'}</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors">
                <input
                  type="checkbox"
                  checked={showCoordinates}
                  onChange={e => setShowCoordinates(e.target.checked)}
                  className="accent-purple-500 rounded cursor-pointer"
                />
                <span>{isEn ? 'Show Ruler Coordinates (A..Z / 1..N)' : '显示标尺坐标 (A..Z / 1..N)'}</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors border-l border-slate-800 pl-3">
                <input
                  type="checkbox"
                  checked={hideEmptyPegs}
                  onChange={e => setHideEmptyPegs(e.target.checked)}
                  className="accent-emerald-500 rounded cursor-pointer"
                />
                <span>{isEn ? 'Hide Empty Pegs' : '隐藏空位点阵 (仅导出有豆区域)'}</span>
              </label>

              {/* Legend Scale & Layout */}
              <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
                <Sliders className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-slate-400">{isEn ? 'Symbol Font Size:' : '色号字号:'}</span>
                <select
                  value={legendScaleMode}
                  onChange={e => setLegendScaleMode(e.target.value as LegendScaleMode)}
                  className="bg-slate-800 border border-slate-700 text-amber-300 font-bold rounded-lg px-2 py-1 text-xs outline-none cursor-pointer"
                >
                  <option value="auto">{isEn ? '🔥 Auto Adaptive' : '🔥 网格自适应 (推荐)'}</option>
                  <option value="1.0">{isEn ? 'Standard 1.0x' : '标准 1.0x'}</option>
                  <option value="1.5">{isEn ? 'Medium 1.5x' : '中度 1.5x'}</option>
                  <option value="2.0">{isEn ? 'Large 2.0x' : '放大 2.0x'}</option>
                  <option value="2.5">{isEn ? 'Extra Large 2.5x' : '特大 2.5x'}</option>
                </select>

                <select
                  value={legendPosition}
                  onChange={e => setLegendPosition(e.target.value as LegendPosition)}
                  className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-xs outline-none cursor-pointer"
                >
                  <option value="right">{isEn ? 'Right Sidebar' : '右侧多列侧边栏'}</option>
                  <option value="bottom">{isEn ? 'Bottom Table' : '下方横向表格'}</option>
                </select>
              </div>

            </div>

            {/* Sub Board View Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">{isEn ? 'Board View:' : '板块视角:'}</span>
              <select
                value={selectedBoard === null ? 'full' : selectedBoard.toString()}
                onChange={e => {
                  const val = e.target.value;
                  setSelectedBoard(val === 'full' ? null : parseInt(val));
                }}
                className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1 text-xs outline-none cursor-pointer"
              >
                <option value="full">{isEn ? `Full Pattern (${width}x${height})` : `全景整张图纸 (${width}x${height})`}</option>
                {Array.from({ length: totalBoards }).map((_, idx) => (
                  <option key={idx} value={idx}>
                    {isEn ? `Board #${idx + 1} Pattern` : `第 ${idx + 1} 板图纸 (29x29)`}
                  </option>
                ))}
              </select>
            </div>

          </div>

        </div>
        )}

        {/* Live Canvas Preview Canvas Container */}
        <div className="p-4 flex-1 overflow-auto bg-slate-950 flex items-center justify-center min-h-[300px]">
          <div ref={previewContainerRef} className="w-full h-full flex items-center justify-center" />
        </div>

        {/* Footer Actions */}
        <div className="p-3 sm:p-4 border-t border-slate-800 bg-slate-900 flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <div className="text-slate-400 text-[11px] text-center sm:text-left">
            {isEn ? `Export Mode: ${watermarkType === 'none' ? '✨ Clean Pattern' : '🛡️ Watermark Protected'} (${width}x${height} beads)` : `当前导出模式: ${watermarkType === 'none' ? '✨ 纯净无水印矢量图纸' : '🛡️ 防盗水印加固图纸'} (${width}x${height} 豆)`}
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
            {totalBoards > 1 && (
              <button
                onClick={() => handleDownloadClick('all')}
                className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold px-3 py-2 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Download className="w-4 h-4 text-sky-400" />
                <span>{isEn ? `Download All Board Patterns (${totalBoards + 1})` : `批量全部分板图纸 (${totalBoards + 1}张)`}</span>
              </button>
            )}

            <button
              onClick={() => handleDownloadClick('single')}
              className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span>{isEn ? 'Download HD PNG Pattern' : '下载高清 PNG 图纸'}</span>
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

    </div>
  );
};
