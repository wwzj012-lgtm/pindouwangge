import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
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
} from 'lucide-react';
import { BeadColor } from '../types';
import {
  ReductionIntensity,
  ReductionOptions,
  ReductionReport,
  savingPercentToScale,
  smartReduceGrid,
  type BeadSavingPercent,
} from '../utils/smartReduceUtils';
import {
  canUseSavingTarget,
  getSmartReduceMembership,
} from '../utils/smartReduceAccess';
import { scheduleSmartReduceFallback, shouldAcceptSmartReducePreviewResult } from '../utils/smartReduceScheduler';
import {
  formatReductionChange,
  shouldResetSmartReduceSafetyOptions,
} from '../utils/smartReduceModalState';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

interface SmartBeadReducerModalProps {
  isOpen: boolean;
  onClose: () => void;
  grid: (string | null)[][];
  palette: BeadColor[];
  onApplyReducedGrid: (newGrid: (string | null)[][], savingTarget: 15 | 25 | 40) => void;
  onOpenAuthModal?: () => void;
}

const COMPLETION_MULTIPLIER: Record<15 | 25 | 40, number> = {
  15: 1.05,
  25: 1.08,
  40: 1.10,
};

// This is a local draft preview only. Credits are settled solely by the
// server-side completion request, whose quote remains authoritative.
const estimateCompletionPreviewPoints = (nonEmptyBeads: number, savingTarget: 15 | 25 | 40): number => {
  const units = Math.ceil(Math.max(0, Math.floor(nonEmptyBeads)) / 90);
  return (units / 10) * COMPLETION_MULTIPLIER[savingTarget];
};

interface SmartReduceRequest {
  id: number;
  grid: (string | null)[][];
  palette: BeadColor[];
  options: ReductionOptions;
}

interface SmartReduceRequest {
  id: number;
  grid: (string | null)[][];
  palette: BeadColor[];
  options: ReductionOptions;
}

export const SmartBeadReducerModal: React.FC<SmartBeadReducerModalProps> = ({
  isOpen,
  onClose,
  grid,
  palette,
  onApplyReducedGrid,
  onOpenAuthModal,
}) => {
  const { isVip, isPro } = useAuth();
  const { t, formatPrice, language } = useLanguage();
  const [intensity, setIntensity] = useState<ReductionIntensity>('medium');
  const [savingTarget, setSavingTarget] = useState<15 | 25 | 40>(15);
  // Background removal is destructive and must be explicitly selected.
  const [removeBackgroundBeads, setRemoveBackgroundBeads] = useState<boolean>(false);
  const [protectSaliencyAndContours, setProtectSaliencyAndContours] = useState<boolean>(true);
  const [protectVibrantColors, setProtectVibrantColors] = useState<boolean>(true);
  const [removeIsolatedNoise, setRemoveIsolatedNoise] = useState<boolean>(true);
  const [mergeMinorColors, setMergeMinorColors] = useState<boolean>(true);
  const [autoCropEmptyBorder, setAutoCropEmptyBorder] = useState<boolean>(false);

  const [report, setReport] = useState<ReductionReport | null>(null);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [calculationError, setCalculationError] = useState<'calculation-failed' | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerFailedRef = useRef(false);
  const requestIdRef = useRef(0);
  const lastRequestRef = useRef<SmartReduceRequest | null>(null);
  const fallbackCancelRef = useRef<(() => void) | null>(null);
  const fallbackRunnerRef = useRef<((request: SmartReduceRequest) => void) | null>(null);
  const safetySessionRef = useRef({ isOpen: false, grid: null as (string | null)[][] | null });
  const membership = getSmartReduceMembership(isVip, isPro);
  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length || 0;
  // Only the 40% target is reserved for Merchant VIP.
  const merchantVipRequired = savingTarget === 40;
  const canApplyCurrentTarget = !merchantVipRequired || canUseSavingTarget(40, membership);
  const footerAction = canApplyCurrentTarget ? 'apply' : 'upgrade';
  const selectSavingTarget = (target: 15 | 25 | 40) => {
    if (target === 40 && !canUseSavingTarget(40, membership)) {
      onOpenAuthModal?.();
      return;
    }
    setSavingTarget(target);
  };

  // Run before preview effects so a reopened modal never calculates once with
  // destructive choices left over from its previous session.
  useLayoutEffect(() => {
    const currentSession = { isOpen, grid };
    if (shouldResetSmartReduceSafetyOptions(safetySessionRef.current, currentSession)) {
      setRemoveBackgroundBeads(false);
      setAutoCropEmptyBorder(false);
    }
    safetySessionRef.current = currentSession;
  }, [isOpen, grid]);

  useEffect(() => {
    const scheduleFallback = (request: SmartReduceRequest) => {
      if (lastRequestRef.current?.id !== request.id || fallbackCancelRef.current) return;
      fallbackCancelRef.current = scheduleSmartReduceFallback(() => {
        fallbackCancelRef.current = null;
        if (!shouldAcceptSmartReducePreviewResult(request.id, requestIdRef.current)) return;
        try {
          setCalculationError(null);
          setReport(smartReduceGrid(request.grid, request.palette, request.options));
        } catch {
          setCalculationError('calculation-failed');
        } finally {
          setIsCalculating(false);
        }
      });
    };
    fallbackRunnerRef.current = scheduleFallback;

    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('../utils/smartReduce.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<{ id: number; report?: ReductionReport; error?: string }>) => {
        if (!shouldAcceptSmartReducePreviewResult(event.data.id, requestIdRef.current)) return;
        if (event.data.error) {
          workerFailedRef.current = true;
          if (workerRef.current === worker) workerRef.current = null;
          worker.terminate();
          setCalculationError('calculation-failed');
          const request = lastRequestRef.current;
          if (request) scheduleFallback(request);
        } else if (event.data.report) {
          setCalculationError(null);
          setReport(event.data.report);
        }
        setIsCalculating(false);
      };
      worker.onerror = () => {
        workerFailedRef.current = true;
        if (workerRef.current === worker) workerRef.current = null;
        worker?.terminate();
        const request = lastRequestRef.current;
        if (request) scheduleFallback(request);
      };
    } catch {
      workerFailedRef.current = true;
      workerRef.current = null;
    }

    return () => {
      fallbackCancelRef.current?.();
      fallbackCancelRef.current = null;
      fallbackRunnerRef.current = null;
      worker?.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, []);

  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const optCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Calculation runs off the UI thread so changing a target never blocks the modal.
  useEffect(() => {
    if (!isOpen || grid.length === 0) return;

    const id = requestIdRef.current + 1;
    requestIdRef.current = id;
    setIsCalculating(true);
    setCalculationError(null);
    setReport(null);
    const opts: ReductionOptions = {
      intensity,
      downscaleRatio: savingPercentToScale(savingTarget),
      removeBackgroundBeads,
      protectSaliencyAndContours,
      protectVibrantColors,
      removeIsolatedNoise,
      mergeMinorColors,
      autoCropEmptyBorder,
    };
    const request: SmartReduceRequest = { id, grid, palette, options: opts };
    lastRequestRef.current = request;
    fallbackCancelRef.current?.();
    fallbackCancelRef.current = null;

    const worker = workerRef.current;
    if (worker && !workerFailedRef.current) {
      try {
        worker.postMessage(request);
        return;
      } catch {
        workerFailedRef.current = true;
        workerRef.current = null;
        worker.terminate();
      }
    }
    fallbackRunnerRef.current?.(request);
  }, [
    isOpen,
    grid,
    palette,
    intensity,
    savingTarget,
    removeBackgroundBeads,
    protectSaliencyAndContours,
    protectVibrantColors,
    removeIsolatedNoise,
    mergeMinorColors,
    autoCropEmptyBorder,
  ]);

  // Refresh an informational quote after the user settles on a target. This
  // is deliberately best-effort: guests or an offline Worker still receive
  // an immediate local estimate and can continue previewing without blocking.
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

  const origH = gridHeight;
  const origW = gridWidth;
  const optH = report?.optimizedGrid.length || origH;
  const optW = report?.optimizedGrid[0]?.length || origW;
  const formatChange = (value: number) => formatReductionChange(value, language === 'zh');
  const canCropEmptyBorder = false;
  const previewNonEmptyBeads = report?.optimizedTotalBeads ?? 0;
  const estimatedCompletionPoints = estimateCompletionPreviewPoints(previewNonEmptyBeads, savingTarget);
  const formattedEstimatedCompletionPoints = estimatedCompletionPoints.toFixed(2).replace(/\.00$/, '');

  const handleApply = () => {
    if (!canApplyCurrentTarget) {
      onOpenAuthModal?.();
      return;
    }
    if (!report) return;
    onApplyReducedGrid(report.optimizedGrid, savingTarget);
    onClose();
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
                  {isPro ? (language === 'zh' ? '商家 VIP' : 'Merchant VIP') : isVip ? (language === 'zh' ? '创作者 VIP' : 'Creator VIP') : (language === 'zh' ? '积分用户' : 'Credits user')}
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
          {/* Credit pricing notice */}
          <div className="bg-gradient-to-r from-sky-950/60 via-slate-900 to-amber-950/40 border border-sky-500/30 rounded-2xl p-4 text-xs text-slate-200 space-y-1.5 shadow-lg relative overflow-hidden">
            <div className="font-bold text-sky-200 text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
              <span>{language === 'zh' ? '积分制省豆' : 'Credit-based bead saving'}</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              {language === 'zh'
                ? '省豆预览和应用草稿均免费，不会调用核价或扣除积分；积分只在最终“完成并解锁”时由服务端核算。背景移除也免费。'
                : 'Saving previews and applying a draft are free: they never quote or deduct credits. Credits are settled by the server only at final completion. Background removal is free too.'}
            </p>
            <p className="text-[11px] text-amber-200/90 leading-relaxed">
              {language === 'zh'
                ? '商家 VIP 可解锁 40% 省豆折扣及商用高级能力；其他档位不要求 VIP。'
                : 'Merchant VIP unlocks the 40% saving target and commercial benefits; other targets do not require VIP.'}
            </p>
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
                  {language === 'zh' ? `目标省豆 ${savingTarget}%` : `Target saving ${savingTarget}%`}
                </span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => selectSavingTarget(15)}
                  className={`py-2 px-2 rounded-lg text-xs font-bold border transition-all cursor-pointer text-center ${
                    savingTarget === 15
                      ? 'bg-indigo-950 border-indigo-500 text-indigo-200 shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <div>{t('reducerScale15')}</div>
                  <div className="text-[10px] text-sky-300 font-normal">{language === 'zh' ? '完成价 × 1.05' : 'Completion × 1.05'}</div>
                </button>

                <button
                  type="button"
                  onClick={() => selectSavingTarget(25)}
                  className={`py-2 px-2 rounded-lg text-xs font-bold border transition-all cursor-pointer text-center ${
                    savingTarget === 25
                      ? 'bg-purple-950 border-purple-500 text-purple-200 shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <div className="text-purple-300">{t('reducerScale25')}</div>
                  <div className="text-[10px] text-sky-300 font-normal">{language === 'zh' ? '完成价 × 1.08' : 'Completion × 1.08'}</div>
                </button>

                <button
                  type="button"
                  onClick={() => selectSavingTarget(40)}
                  aria-disabled={!canUseSavingTarget(40, membership)}
                  title={!canUseSavingTarget(40, membership) ? (language === 'zh' ? '商家 VIP 可解锁 40% 省豆' : 'Upgrade to Merchant VIP to unlock 40% saving') : undefined}
                  className={`py-2 px-2 rounded-lg text-xs font-bold border transition-all cursor-pointer text-center ${
                    savingTarget === 40
                      ? 'bg-amber-950 border-amber-500 text-amber-200'
                      : `bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 ${!canUseSavingTarget(40, membership) ? 'opacity-60' : ''}`
                  }`}
                >
                  <div className="text-amber-300">{t('reducerScale40')}</div>
                  <div className="text-[10px] text-amber-400 font-normal">{language === 'zh' ? '商家 VIP · 完成价 × 1.10' : 'Merchant VIP · Completion × 1.10'}</div>
                </button>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                {language === 'zh'
                  ? '应用只更新本地草稿；最终完成时，按当前预览的非空豆数重新服务端核价。'
                  : 'Applying only updates the local draft; final completion is re-quoted by the server from the current non-empty bead count.'}
              </p>
              <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-2.5 py-2 text-[11px]">
                <span className="text-slate-300">{language === 'zh' ? `当前预览 ${previewNonEmptyBeads} 颗的完成价估算` : `Completion estimate for ${previewNonEmptyBeads} preview beads`}</span>
                <span className="font-mono font-black text-emerald-300">≈ {formattedEstimatedCompletionPoints} {language === 'zh' ? '积分（不扣）' : 'credits (not charged)'}</span>
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
                  {language === 'zh' ? '免费功能' : 'Free feature'}
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
                  {language === 'zh' ? '智能合并相近的大面积色块，减少零碎颜色；请对照预览检查主体特征。' : 'Merge similar large color patches and review the preview for subject details.'}
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
                  disabled={!canCropEmptyBorder}
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

                {report && report.gridAreaSavedPercent > 0 && (
                  <span className="text-xs font-bold text-emerald-300 bg-emerald-950/90 border border-emerald-500/80 px-2.5 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                    <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{language === 'zh' ? `画板${formatChange(report.gridAreaSavedPercent)}` : `Canvas ${formatChange(report.gridAreaSavedPercent)}`}</span>
                  </span>
                )}
              </div>

              {/* Canvas Preview Container */}
              <div className="w-full h-80 sm:h-[400px] bg-slate-900/90 rounded-xl p-3 flex items-center justify-center overflow-hidden border border-sky-500/30 relative">
                {isCalculating ? (
                  <div className="flex flex-col items-center gap-2 text-sky-300 text-xs font-medium">
                    <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
                    <span>{language === 'zh' ? '正在计算预览…' : 'Calculating preview...'}</span>
                  </div>
                ) : calculationError ? (
                  <div className="px-4 text-center text-xs text-rose-300">{language === 'zh' ? '预览计算未完成，请调整设置后重试。' : 'Preview calculation did not finish. Adjust settings and try again.'}</div>
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
                        <>图纸调整后物料<strong className="text-amber-300 font-mono">{formatChange(report.effectiveBeadSavedPercent)}</strong>；有效豆数<strong className="text-emerald-400">{formatChange(report.savedPercent)}</strong>（不含主动去背景）</>
                      ) : (
                        <>Material usage <strong className="text-amber-300 font-mono">{formatChange(report.effectiveBeadSavedPercent)}</strong>; effective beads <strong className="text-emerald-400">{formatChange(report.savedPercent)}</strong> (excluding optional background removal).</>
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
                          {t('reducerOptScheme')} {optW}×{optH} = {report.optimizedTotalBeads} 粒拼豆 ({report.optimizedColorTypesCount}色)
                        </>
                      ) : (
                        <>
                          Original {origW}×{origH} = {report.originalTotalBeads} beads ({report.originalColorTypesCount} colors)
                          <ArrowRight className="w-3.5 h-3.5 inline mx-1.5 text-sky-400" />
                          {t('reducerOptScheme')} {optW}×{optH} = {report.optimizedTotalBeads} beads ({report.optimizedColorTypesCount} colors)
                        </>
                      )}
                    </span>
                  </div>
                  <div className="text-[11px] text-amber-200/80 font-mono flex items-center gap-1 justify-center md:justify-start">
                    <span>{language === 'zh' ? '* 备注计价基准：按市面常规 3 元 / 千粒补充包零售价测算。' : '* Pricing standard benchmark: Estimated based on $0.50 / 1000 beads packs retail price.'}</span>
                  </div>
                  <div className="text-[11px] text-sky-200/80 flex items-center gap-1 justify-center md:justify-start">
                    <span>{language === 'zh'
                      ? `目标画板面积减少 ${savingTarget}%；实际${formatChange(report.gridAreaSavedPercent)}；有效豆数${formatChange(report.savedPercent)}（不含主动去背景）`
                      : `Target canvas area reduced ${savingTarget}%; actual ${formatChange(report.gridAreaSavedPercent)}; effective beads ${formatChange(report.savedPercent)} (excluding optional background removal).`}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 text-slate-950 px-5 py-2.5 rounded-xl shrink-0 shadow-lg shadow-amber-500/25 border border-amber-300">
                  <DollarSign className="w-5 h-5 fill-current shrink-0" />
                  <div className="flex items-baseline gap-1">
                    <span className="font-black text-xs">{t('reducerSavingEst')}</span>
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
            {footerAction === 'apply' ? (
              <button
                type="button"
                onClick={handleApply}
                disabled={isCalculating || !report}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 via-indigo-600 to-purple-600 text-white font-bold text-xs hover:brightness-110 active:scale-95 shadow-lg shadow-sky-500/25 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
              >
                <Zap className="w-4 h-4 fill-current text-amber-300" />
                <span>{language === 'zh' ? '应用省豆预览 · 免费' : 'Apply saving preview · Free'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleApply}
                disabled={isCalculating || !report}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 text-slate-950 font-black text-xs hover:brightness-110 active:scale-95 shadow-lg shadow-amber-500/25 transition-all cursor-pointer flex items-center gap-2 border border-amber-300"
              >
                <Crown className="w-4 h-4 fill-current text-slate-950" />
                <span>{language === 'zh' ? '商家 VIP 解锁 40% 省豆' : 'Merchant VIP unlocks 40% saving'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
