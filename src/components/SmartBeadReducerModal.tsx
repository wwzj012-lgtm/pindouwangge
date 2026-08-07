import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Zap,
  Sparkles,
  Eye,
  CheckCircle2,
  TrendingDown,
  Layers,
  Scissors,
  DollarSign,
  ShieldAlert,
  Sliders,
  ArrowRight,
  Palette,
  RefreshCw,
  Minimize2,
  Crown,
  Gift,
} from 'lucide-react';
import { BeadColor } from '../types';
import {
  smartReduceGrid,
  ReductionIntensity,
  ReductionOptions,
  ReductionReport,
} from '../utils/smartReduceUtils';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

interface SmartBeadReducerModalProps {
  isOpen: boolean;
  onClose: () => void;
  grid: (string | null)[][];
  palette: BeadColor[];
  onApplyReducedGrid: (newGrid: (string | null)[][]) => void;
  onOpenAuthModal?: () => void;
}

export const SmartBeadReducerModal: React.FC<SmartBeadReducerModalProps> = ({
  isOpen,
  onClose,
  grid,
  palette,
  onApplyReducedGrid,
  onOpenAuthModal,
}) => {
  const { isVip, hasFreeTrial, consumeFreeTrial } = useAuth();
  const { t, formatPrice, language } = useLanguage();
  const [intensity, setIntensity] = useState<ReductionIntensity>('medium');
  const [downscaleRatio, setDownscaleRatio] = useState<number>(1.0); // 1.0, 0.85, 0.70
  const [removeBackgroundBeads, setRemoveBackgroundBeads] = useState<boolean>(true);
  const [protectSaliencyAndContours, setProtectSaliencyAndContours] = useState<boolean>(true);
  const [protectVibrantColors, setProtectVibrantColors] = useState<boolean>(true);
  const [removeIsolatedNoise, setRemoveIsolatedNoise] = useState<boolean>(true);
  const [mergeMinorColors, setMergeMinorColors] = useState<boolean>(true);
  const [autoCropEmptyBorder, setAutoCropEmptyBorder] = useState<boolean>(true);

  const [report, setReport] = useState<ReductionReport | null>(null);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);

  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const optCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Re-calculate optimization whenever options change
  useEffect(() => {
    if (!isOpen || grid.length === 0) return;

    setIsCalculating(true);
    const timer = setTimeout(() => {
      const opts: ReductionOptions = {
        intensity,
        downscaleRatio,
        removeBackgroundBeads,
        protectSaliencyAndContours,
        protectVibrantColors,
        removeIsolatedNoise,
        mergeMinorColors,
        autoCropEmptyBorder,
      };

      const result = smartReduceGrid(grid, palette, opts);
      setReport(result);
      setIsCalculating(false);
    }, 50);

    return () => clearTimeout(timer);
  }, [
    isOpen,
    grid,
    palette,
    intensity,
    downscaleRatio,
    removeBackgroundBeads,
    protectSaliencyAndContours,
    protectVibrantColors,
    removeIsolatedNoise,
    mergeMinorColors,
    autoCropEmptyBorder,
  ]);

  // Render Left (Original) & Right (Optimized) Canvases
  useEffect(() => {
    if (!isOpen || !report) return;

    const paletteMap = new Map<string, string>();
    palette.forEach(c => paletteMap.set(c.id, c.hex));

    const drawGridToCanvas = (
      canvas: HTMLCanvasElement | null,
      gridData: string[][]
    ) => {
      if (!canvas || !gridData || gridData.length === 0) return;
      const h = gridData.length;
      const w = gridData[0].length;
      if (w === 0 || h === 0) return;

      // Calculate high-definition cell size so canvas bitmap is crisp (600-800px wide)
      const maxDim = Math.max(w, h);
      const cellSize = Math.max(5, Math.min(14, Math.floor(640 / maxDim)));

      canvas.width = w * cellSize;
      canvas.height = h * cellSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Canvas background
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const cid = gridData[y][x];
          const px = x * cellSize;
          const py = y * cellSize;

          if (cid) {
            const hex = paletteMap.get(cid) || cid;
            ctx.fillStyle = hex;
            ctx.fillRect(px, py, cellSize, cellSize);

            if (cellSize >= 6) {
              // Subtle pixel grid gridlines for ultra clarity
              ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
              ctx.fillRect(px + cellSize - 1, py, 1, cellSize);
              ctx.fillRect(px, py + cellSize - 1, cellSize, 1);
            }
          } else {
            // Transparent checkerboard pattern for removed background beads
            ctx.fillStyle = (x + y) % 2 === 0 ? '#1E293B' : '#0F172A';
            ctx.fillRect(px, py, cellSize, cellSize);
          }
        }
      }
    };

    drawGridToCanvas(origCanvasRef.current, grid);
    drawGridToCanvas(optCanvasRef.current, report.optimizedGrid);
  }, [isOpen, report, grid, palette]);

  if (!isOpen) return null;

  const origH = grid.length;
  const origW = grid[0]?.length || 0;
  const optH = report?.optimizedGrid.length || origH;
  const optW = report?.optimizedGrid[0]?.length || origW;

  const handleApply = async () => {
    if (!isVip) {
      if (hasFreeTrial) {
        const success = await consumeFreeTrial();
        if (success && report) {
          onApplyReducedGrid(report.optimizedGrid);
          onClose();
          return;
        }
      }
      if (onOpenAuthModal) {
        onOpenAuthModal();
      }
      return;
    }

    if (report) {
      onApplyReducedGrid(report.optimizedGrid);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-4 md:p-6 overflow-y-auto">
      <div className="relative w-full max-w-7xl xl:max-w-[1400px] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[96vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-slate-950 via-amber-950/40 to-slate-950 border-b border-amber-500/30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-amber-500/20 ring-1 ring-amber-400/40">
              <Zap className="w-5 h-5 fill-current animate-bounce text-amber-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>{t('reducerTitle')}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow">
                  {t('proTag')} VIP
                </span>
              </h2>
              <p className="text-xs text-amber-200/80">
                {t('reducerDesc')}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Main Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1 custom-scrollbar">
          {/* VIP Value Comparison Callout */}
          <div className="bg-gradient-to-r from-amber-950/50 via-slate-900 to-amber-950/50 border border-amber-500/40 rounded-2xl p-4 text-xs text-amber-100/90 space-y-1.5 shadow-lg relative overflow-hidden">
            <div className="font-bold text-amber-300 text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{t('reducerCompTitle')}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] pt-1">
              <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 text-slate-300">
                <span className="text-rose-400 font-bold block mb-0.5">{t('reducerCompBadTitle')}</span>
                {t('reducerCompBadDesc')}
              </div>
              <div className="bg-amber-950/40 p-2.5 rounded-xl border border-amber-500/30 text-amber-200">
                <span className="text-amber-300 font-bold block mb-0.5">{t('reducerCompGoodTitle')}</span>
                {t('reducerCompGoodDesc')}
              </div>
            </div>
          </div>

          {/* Top Options Row: Downscaling & Background Removal */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Grid Downscaling / Resolution Adjustment */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
              <label className="text-xs font-bold text-sky-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Minimize2 className="w-4 h-4 text-sky-400" />
                  <span>{t('reducerScaleTitle')}</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {downscaleRatio === 1.0 ? t('reducerScaleKeep') : downscaleRatio === 0.85 ? t('reducerScale15') : t('reducerScale30')}
                </span>
              </label>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setDownscaleRatio(1.0)}
                  className={`py-2 px-2 rounded-lg text-xs font-bold border transition-all cursor-pointer text-center ${
                    downscaleRatio === 1.0
                      ? 'bg-sky-950 border-sky-500 text-sky-200 shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <div className="text-amber-300">{t('reducerScaleKeep')}</div>
                  <div className="text-[10px] text-slate-400 font-normal">{t('reducerScaleKeepDesc')}</div>
                </button>

                <button
                  type="button"
                  onClick={() => setDownscaleRatio(0.85)}
                  className={`py-2 px-2 rounded-lg text-xs font-bold border transition-all cursor-pointer text-center ${
                    downscaleRatio === 0.85
                      ? 'bg-indigo-950 border-indigo-500 text-indigo-200 shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <div>{t('reducerScale15')}</div>
                  <div className="text-[10px] text-emerald-400 font-normal">{t('reducerScale15Desc')}</div>
                </button>

                <button
                  type="button"
                  onClick={() => setDownscaleRatio(0.70)}
                  className={`py-2 px-2 rounded-lg text-xs font-bold border transition-all cursor-pointer text-center ${
                    downscaleRatio === 0.70
                      ? 'bg-purple-950 border-purple-500 text-purple-200 shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <div className="text-purple-300">{t('reducerScale30')}</div>
                  <div className="text-[10px] text-emerald-400 font-normal">{t('reducerScale30Desc')}</div>
                </button>
              </div>
            </div>

            {/* Smart Background Removal Toggle */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2 flex flex-col justify-between">
              <label className="text-xs font-bold text-amber-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Scissors className="w-4 h-4 text-amber-400" />
                  <span>{language === 'zh' ? '智能扣除四周无用背景拼豆' : 'Smart Background Bead Removal'}</span>
                </span>
                <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30">
                  {language === 'zh' ? '暴省拼豆' : 'Huge Savings'}
                </span>
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-slate-200">
                    {language === 'zh' ? '抠除背景色 (底色设为透明, 不铺背景豆)' : 'Remove background color (No background beads)'}
                  </div>
                  <p className="text-[10px] text-slate-400">
                    {language === 'zh' ? '自动识别人物/主体四周的单色背景，无需购买并平铺几千颗无用背景豆。' : 'Auto-detect solid backgrounds around the subject to save buying thousands of useless background beads.'}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={removeBackgroundBeads}
                  onChange={e => setRemoveBackgroundBeads(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-amber-500 w-5 h-5 cursor-pointer shrink-0 ml-2"
                />
              </label>
            </div>
          </div>

          {/* Level Selection - 3 Intensity Options */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-sky-400" />
              <span>{language === 'zh' ? '色彩区块平滑度与精简档位' : 'Color Block Smoothing & Reduction level'}</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setIntensity('light')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  intensity === 'light'
                    ? 'bg-sky-950/80 border-sky-500 shadow-md shadow-sky-500/10 text-white'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center justify-between font-bold text-sm">
                  <span className="text-sky-300">{language === 'zh' ? '1档 · 微调精炼' : 'Level 1 · Light Polish'}</span>
                  <span className="text-[10px] bg-sky-900/60 px-1.5 py-0.5 rounded text-sky-200">
                    {language === 'zh' ? '微调色块' : 'Light Merge'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  {language === 'zh' ? '保留原始所有微小阴影渐变，仅清除分散游离噪点。' : 'Keep all original shading details, only clean stray individual noise beads.'}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setIntensity('medium')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  intensity === 'medium'
                    ? 'bg-gradient-to-br from-indigo-950 to-sky-950 border-indigo-500 shadow-md shadow-indigo-500/20 text-white ring-1 ring-indigo-500/50'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center justify-between font-bold text-sm">
                  <span className="text-indigo-300 flex items-center gap-1">
                    <span>{language === 'zh' ? '2档 · 标准推荐' : 'Level 2 · Recommended'}</span>
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  </span>
                  <span className="text-[10px] bg-indigo-900/80 text-indigo-200 px-1.5 py-0.5 rounded">
                    {language === 'zh' ? '平衡高画质' : 'Balanced Quality'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 mt-1">
                  {language === 'zh' ? '智能融合相似大面积背景色块，完美保持主体表情清晰。' : 'Smart merge similar flat colors, keeping the subject\'s face perfectly clear.'}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setIntensity('strong')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  intensity === 'strong'
                    ? 'bg-purple-950/80 border-purple-500 shadow-md shadow-purple-500/20 text-white'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center justify-between font-bold text-sm">
                  <span className="text-purple-300">{language === 'zh' ? '3档 · 极简平滑' : 'Level 3 · Bold blocks'}</span>
                  <span className="text-[10px] bg-purple-900/60 px-1.5 py-0.5 rounded text-purple-200">
                    {language === 'zh' ? '块状纯色化' : 'Bold blocks'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  {language === 'zh' ? '强力合并近似颜色，图纸更具经典像素风，极速拼搭。' : 'Strong merge of close colors for a classic bold pixel art style, faster to build.'}
                </p>
              </button>
            </div>
          </div>

          {/* Layer Protection Controls Grid */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span>{language === 'zh' ? '图像通用自适应细节保护机制' : 'Adaptive Detail Protection Options'}</span>
            </span>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs text-slate-300">
              <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={protectSaliencyAndContours}
                  onChange={e => setProtectSaliencyAndContours(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-sky-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-semibold flex items-center gap-1 text-sky-200">
                  <Eye className="w-3.5 h-3.5 text-sky-400" />
                  <span>{language === 'zh' ? '五官与高反差轮廓锁死' : 'Face & Contour Lock'}</span>
                </span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={protectVibrantColors}
                  onChange={e => setProtectVibrantColors(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-sky-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-semibold text-slate-200">
                  {language === 'zh' ? '💎 核心高饱和色彩纯净保护' : '💎 Vibrant Color Protection'}
                </span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={removeIsolatedNoise}
                  onChange={e => setRemoveIsolatedNoise(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-sky-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-semibold text-slate-200">
                  {language === 'zh' ? '🧹 1-3px 悬空噪点清除' : '🧹 Remove Stray Noises'}
                </span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={mergeMinorColors}
                  onChange={e => setMergeMinorColors(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-sky-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-semibold text-slate-200">
                  {language === 'zh' ? '🎨 压缩极低频零碎色卡' : '🎨 Condense Stray Colors'}
                </span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors col-span-2 sm:col-span-1">
                <input
                  type="checkbox"
                  checked={autoCropEmptyBorder}
                  onChange={e => setAutoCropEmptyBorder(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-sky-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-semibold text-emerald-300">
                  ✂️ 自动裁切边缘无豆空白盘
                </span>
              </label>
            </div>
          </div>

          {/* Dual Side-by-Side Canvas Comparison Preview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left Box: Standard Original Scheme */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col items-center justify-between space-y-3 relative group">
              <div className="w-full flex items-center justify-between border-b border-slate-800/80 pb-2">
                <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-slate-500" />
                  <span>标准原图方案 (未减粒)</span>
                </span>
                <span className="text-[11px] font-mono text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                  {origW} × {origH} 像素
                </span>
              </div>

              {/* Canvas Preview Container */}
              <div className="w-full h-80 sm:h-[400px] bg-slate-900/90 rounded-xl p-3 flex items-center justify-center overflow-hidden border border-slate-800 relative">
                <canvas
                  ref={origCanvasRef}
                  style={{ imageRendering: 'pixelated' }}
                  className="max-w-full max-h-full object-contain shadow-lg rounded"
                />
              </div>

              {/* Stats Footer Badge */}
              <div className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-300 flex items-center justify-between">
                <div>
                  原始拼豆总数: <strong className="text-white font-mono text-sm">{report?.originalTotalBeads || 0}</strong> 粒
                </div>
                <div className="text-slate-400 font-mono">
                  使用色卡: <strong className="text-slate-200">{report?.originalColorTypesCount || 0}</strong> 种
                </div>
              </div>
            </div>

            {/* Right Box: Smart Optimized Scheme */}
            <div className="bg-gradient-to-b from-sky-950/40 via-slate-950 to-slate-950 border-2 border-sky-500/80 rounded-2xl p-4 flex flex-col items-center justify-between space-y-3 relative shadow-xl shadow-sky-500/5">
              {/* Highlight Saved Badge Header */}
              <div className="w-full flex items-center justify-between border-b border-sky-800/50 pb-2">
                <span className="text-xs font-bold text-sky-300 flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-sky-400 fill-current" />
                  <span>智能减粒方案 (实测减豆)</span>
                </span>

                {report && report.savedPercent > 0 && (
                  <span className="text-xs font-bold text-emerald-300 bg-emerald-950/90 border border-emerald-500/80 px-2.5 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                    <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
                    <span>省豆 -{report.savedPercent}%</span>
                  </span>
                )}
              </div>

              {/* Canvas Preview Container */}
              <div className="w-full h-80 sm:h-[400px] bg-slate-900/90 rounded-xl p-3 flex items-center justify-center overflow-hidden border border-sky-500/30 relative">
                {isCalculating ? (
                  <div className="flex flex-col items-center gap-2 text-sky-300 text-xs font-medium">
                    <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
                    <span>正在进行通用图像边缘分析与极速省豆计算...</span>
                  </div>
                ) : (
                  <canvas
                    ref={optCanvasRef}
                    style={{ imageRendering: 'pixelated' }}
                    className="max-w-full max-h-full object-contain shadow-lg rounded ring-1 ring-sky-500/30"
                  />
                )}
              </div>

              {/* Stats Footer Badge */}
              <div className="w-full bg-sky-950/80 border border-sky-500/40 rounded-xl p-2.5 text-xs text-sky-100 flex items-center justify-between">
                <div>
                  {language === 'zh' ? '减粒后拼豆总数: ' : 'Total beads after reduction: '}<strong className="text-amber-300 font-mono text-sm">{report?.optimizedTotalBeads || 0}</strong> {language === 'zh' ? '粒' : 'beads'}
                </div>
                <div className="text-sky-300 font-mono">
                  {language === 'zh' ? '精简色卡: ' : 'Optimized colors: '}<strong className="text-white">{report?.optimizedColorTypesCount || 0}</strong> {language === 'zh' ? '种' : 'colors'}
                </div>
              </div>
            </div>
          </div>

          {/* Precision Comparison & Savings Breakdown Card */}
          {report && (
            <div className="space-y-3">
              {/* 2-Item Clear Savings Breakdown Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {/* Item 1: Bead Material Savings */}
                <div className="bg-slate-950/90 border border-amber-500/30 rounded-xl p-3.5 flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0">
                    <Scissors className="w-5 h-5" />
                  </div>
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-xs">{language === 'zh' ? '① 抠除背景 & 连片合并 (耗材省豆)' : '① Background & Clusters (Material Saved)'}</span>
                      <span className="font-mono font-bold text-amber-300 text-sm">{language === 'zh' ? '省约' : 'Saved ~'} {formatPrice(report.beadMaterialSavedRMB)}</span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      {language === 'zh' ? (
                        <>抠除背景、合并连片，减少 <strong className="text-amber-300 font-mono">{report.savedBeadCount}</strong> 颗拼豆耗材 (物理省豆 <strong className="text-emerald-400">{report.savedPercent}%</strong>)</>
                      ) : (
                        <>Removed bg/merged clusters, reducing <strong className="text-amber-300 font-mono">{report.savedBeadCount}</strong> beads (saved <strong className="text-emerald-400">{report.savedPercent}%</strong>)</>
                      )}
                    </p>
                  </div>
                </div>

                {/* Item 2: Color Pack Savings */}
                <div className="bg-slate-950/90 border border-purple-500/30 rounded-xl p-3.5 flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 shrink-0">
                    <Palette className="w-5 h-5" />
                  </div>
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-xs">{language === 'zh' ? '② 精简杂色色卡 (整包清退)' : '② Condense Unused Colors (Packs Saved)'}</span>
                      <span className="font-mono font-bold text-purple-300 text-sm">{language === 'zh' ? '省约' : 'Saved ~'} {formatPrice(report.colorPacksSavedRMB)}</span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      {language === 'zh' ? (
                        <>色卡从 <strong className="text-slate-200">{report.originalColorTypesCount}</strong> 种精简至 <strong className="text-emerald-400">{report.optimizedColorTypesCount}</strong> 种，少购入 <strong className="text-purple-300 font-mono">{report.savedColorTypesCount}</strong> 整包杂色拼豆</>
                      ) : (
                        <>Reduced color types from <strong className="text-slate-200">{report.originalColorTypesCount}</strong> to <strong className="text-emerald-400">{report.optimizedColorTypesCount}</strong>, avoiding <strong className="text-purple-300 font-mono">{report.savedColorTypesCount}</strong> unused color packs</>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Summary Banner with Big RMB Display & Valuation Benchmark Note */}
              <div className="bg-gradient-to-r from-slate-950 via-amber-950/80 to-slate-950 border-2 border-amber-500/60 rounded-xl p-4 text-xs text-slate-200 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl">
                <div className="space-y-1.5 text-center md:text-left">
                  <div className="font-bold text-white flex items-center gap-2 justify-center md:justify-start">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>
                      {language === 'zh' ? (
                        <>
                          原图 {origW}×{origH} = {report.originalTotalBeads} 粒拼豆 ({report.originalColorTypesCount}色)
                          <ArrowRight className="w-3.5 h-3.5 inline mx-1.5 text-sky-400" />
                          PRO 减粒图纸 {optW}×{optH} = {report.optimizedTotalBeads} 粒拼豆 ({report.optimizedColorTypesCount}色)
                        </>
                      ) : (
                        <>
                          Original {origW}×{origH} = {report.originalTotalBeads} beads ({report.originalColorTypesCount} colors)
                          <ArrowRight className="w-3.5 h-3.5 inline mx-1.5 text-sky-400" />
                          PRO Optimized {optW}×{optH} = {report.optimizedTotalBeads} beads ({report.optimizedColorTypesCount} colors)
                        </>
                      )}
                    </span>
                  </div>
                  <div className="text-[11px] text-amber-200/80 font-mono flex items-center gap-1 justify-center md:justify-start">
                    <span>{language === 'zh' ? '* 备注计价基准：按市面常规 3 元 / 千粒补充包零售价测算。' : '* Pricing standard benchmark: Estimated based on $0.50 / 1000 beads packs retail price.'}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 text-slate-950 px-5 py-2.5 rounded-xl shrink-0 shadow-lg shadow-amber-500/25 border border-amber-300">
                  <DollarSign className="w-5 h-5 fill-current shrink-0" />
                  <div className="flex items-baseline gap-1">
                    <span className="font-black text-xs">{language === 'zh' ? 'PRO VIP 预计总节省：' : 'PRO VIP Est. Savings: '}</span>
                    <span className="text-xl sm:text-2xl font-black font-mono tracking-tight text-slate-950">{formatPrice(report.estimatedMoneySavedRMB)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs cursor-pointer transition-colors"
          >
            {language === 'zh' ? '取消' : 'Cancel'}
          </button>

          <div className="flex items-center gap-3">
            {isVip ? (
              <button
                type="button"
                onClick={handleApply}
                disabled={isCalculating || !report}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 via-indigo-600 to-purple-600 text-white font-bold text-xs hover:brightness-110 active:scale-95 shadow-lg shadow-sky-500/25 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
              >
                <Zap className="w-4 h-4 fill-current text-amber-300" />
                <span>{language === 'zh' ? '应用减粒图纸到当前拼豆画布' : 'Apply reduced pattern to pegboard'}</span>
              </button>
            ) : hasFreeTrial ? (
              <button
                type="button"
                onClick={handleApply}
                disabled={isCalculating || !report}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-600 to-emerald-500 text-slate-950 font-black text-xs hover:brightness-110 active:scale-95 shadow-lg shadow-emerald-500/25 transition-all cursor-pointer flex items-center gap-2 border border-emerald-300"
              >
                <Gift className="w-4 h-4 fill-current text-slate-950" />
                <span>{language === 'zh' ? '消耗 1 次新用户免费体验额度直接应用' : 'Consume 1 free trial credit to apply directly'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleApply}
                disabled={isCalculating || !report}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 text-slate-950 font-black text-xs hover:brightness-110 active:scale-95 shadow-lg shadow-amber-500/25 transition-all cursor-pointer flex items-center gap-2 border border-amber-300"
              >
                <Crown className="w-4 h-4 fill-current text-slate-950" />
                <span>{language === 'zh' ? '解锁 PRO VIP 权限 / 激活卡密应用' : 'Unlock PRO VIP or redeem code to apply'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
