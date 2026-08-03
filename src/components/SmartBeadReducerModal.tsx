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
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { BeadColor } from '../types';
import {
  smartReduceGrid,
  ReductionIntensity,
  ReductionOptions,
  ReductionReport,
} from '../utils/smartReduceUtils';

interface SmartBeadReducerModalProps {
  isOpen: boolean;
  onClose: () => void;
  grid: (string | null)[][];
  palette: BeadColor[];
  onApplyReducedGrid: (newGrid: (string | null)[][]) => void;
}

export const SmartBeadReducerModal: React.FC<SmartBeadReducerModalProps> = ({
  isOpen,
  onClose,
  grid,
  palette,
  onApplyReducedGrid,
}) => {
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

    // Render Original Canvas
    const origCanvas = origCanvasRef.current;
    if (origCanvas && grid.length > 0) {
      const h = grid.length;
      const w = grid[0].length;
      origCanvas.width = w;
      origCanvas.height = h;
      const ctx = origCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, w, h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const cid = grid[y][x];
            if (cid) {
              ctx.fillStyle = paletteMap.get(cid) || cid;
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
      }
    }

    // Render Optimized Canvas
    const optCanvas = optCanvasRef.current;
    if (optCanvas && report.optimizedGrid.length > 0) {
      const optGrid = report.optimizedGrid;
      const h = optGrid.length;
      const w = optGrid[0].length;
      optCanvas.width = w;
      optCanvas.height = h;
      const ctx = optCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, w, h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const cid = optGrid[y][x];
            if (cid) {
              ctx.fillStyle = paletteMap.get(cid) || cid;
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
      }
    }
  }, [isOpen, report, grid, palette]);

  if (!isOpen) return null;

  const origH = grid.length;
  const origW = grid[0]?.length || 0;
  const optH = report?.optimizedGrid.length || origH;
  const optW = report?.optimizedGrid[0]?.length || origW;

  const handleApply = () => {
    if (report) {
      onApplyReducedGrid(report.optimizedGrid);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-5 overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-slate-950 via-amber-950/40 to-slate-950 border-b border-amber-500/30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-amber-500/20 ring-1 ring-amber-400/40">
              <Zap className="w-5 h-5 fill-current animate-bounce text-amber-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>👑 VIP 专属 · 显著性智能省豆与精纯优化引擎</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow">
                  PRO VIP 权限
                </span>
              </h2>
              <p className="text-xs text-amber-200/80">
                保持主图 100% 五官与细节原汁原味：抠除无用背景 + 净化悬空杂豆 + 连片色块平滑，省豆 20%~50%！
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
              <span>为什么远胜于简单调节网格宽高尺寸？(PRO 专属核心算法)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] pt-1">
              <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 text-slate-300">
                <span className="text-rose-400 font-bold block mb-0.5">❌ 普通直接调节宽高尺寸：</span>
                等比例强制缩放整个盘面，会导致人物眼睛、眉毛、表情、高光与精致线稿变模糊失真甚至直接消失。
              </div>
              <div className="bg-amber-950/40 p-2.5 rounded-xl border border-amber-500/30 text-amber-200">
                <span className="text-amber-300 font-bold block mb-0.5">✅ VIP 显著性智能省豆引擎：</span>
                保持图纸 <b>100% 原始网格像素与细节不变</b>，通过 Sobel 边缘锁死五官，自动抠除四周无用背景豆（背景变 0 豆）、净化 1-3px 悬空杂豆，真正做到物超所值！
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
                  <span>图纸网格度数 (可选微调缩放)</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {downscaleRatio === 1.0 ? '保持 100% 原尺寸度数' : downscaleRatio === 0.85 ? '精简 -15% 尺寸' : '极致 -30% 尺寸'}
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
                  <div className="text-amber-300">100% 原网格</div>
                  <div className="text-[10px] text-slate-400 font-normal">画质零损失</div>
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
                  <div>精简 -15% 度数</div>
                  <div className="text-[10px] text-emerald-400 font-normal">拼豆数直降 ~28%</div>
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
                  <div className="text-purple-300">极致 -30% 度数</div>
                  <div className="text-[10px] text-emerald-400 font-normal">拼豆数直降 ~50%</div>
                </button>
              </div>
            </div>

            {/* Smart Background Removal Toggle */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2 flex flex-col justify-between">
              <label className="text-xs font-bold text-amber-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Scissors className="w-4 h-4 text-amber-400" />
                  <span>智能扣除四周无用背景拼豆</span>
                </span>
                <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30">
                  暴省拼豆
                </span>
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-slate-200">
                    抠除背景色 (底色设为透明, 不铺背景豆)
                  </div>
                  <p className="text-[10px] text-slate-400">
                    自动识别人物/主体四周的单色背景，无需购买并平铺几千颗无用背景豆。
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
              <span>色彩区块平滑度与精简档位</span>
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
                  <span className="text-sky-300">1档 · 微调精炼</span>
                  <span className="text-[10px] bg-sky-900/60 px-1.5 py-0.5 rounded text-sky-200">
                    微调色块
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  保留原始所有微小阴影渐变，仅清除分散游离噪点。
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
                    <span>2档 · 标准推荐</span>
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  </span>
                  <span className="text-[10px] bg-indigo-900/80 text-indigo-200 px-1.5 py-0.5 rounded">
                    平衡高画质
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 mt-1">
                  智能融合相似大面积背景色块，完美保持主体表情清晰。
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
                  <span className="text-purple-300">3档 · 极简平滑</span>
                  <span className="text-[10px] bg-purple-900/60 px-1.5 py-0.5 rounded text-purple-200">
                    块状纯色化
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  强力合并近似颜色，图纸更具经典像素风，极速拼搭。
                </p>
              </button>
            </div>
          </div>

          {/* Layer Protection Controls Grid */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span>图像通用自适应细节保护机制</span>
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
                  <span>五官与高反差轮廓锁死</span>
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
                  💎 核心高饱和色彩纯净保护
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
                  🧹 1-3px 悬空噪点清除
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
                  🎨 压缩极低频零碎色卡
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
              <div className="w-full h-64 sm:h-72 bg-slate-900/90 rounded-xl p-2 flex items-center justify-center overflow-hidden border border-slate-800 relative">
                <canvas
                  ref={origCanvasRef}
                  className="max-w-full max-h-full object-contain image-rendering-pixelated shadow-lg rounded"
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
              <div className="w-full h-64 sm:h-72 bg-slate-900/90 rounded-xl p-2 flex items-center justify-center overflow-hidden border border-sky-500/30 relative">
                {isCalculating ? (
                  <div className="flex flex-col items-center gap-2 text-sky-300 text-xs font-medium">
                    <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
                    <span>正在进行通用图像边缘分析与极速省豆计算...</span>
                  </div>
                ) : (
                  <canvas
                    ref={optCanvasRef}
                    className="max-w-full max-h-full object-contain image-rendering-pixelated shadow-lg rounded ring-1 ring-sky-500/30"
                  />
                )}
              </div>

              {/* Stats Footer Badge */}
              <div className="w-full bg-sky-950/80 border border-sky-500/40 rounded-xl p-2.5 text-xs text-sky-100 flex items-center justify-between">
                <div>
                  减粒后拼豆总数: <strong className="text-amber-300 font-mono text-sm">{report?.optimizedTotalBeads || 0}</strong> 粒
                </div>
                <div className="text-sky-300 font-mono">
                  精简色卡: <strong className="text-white">{report?.optimizedColorTypesCount || 0}</strong> 种
                </div>
              </div>
            </div>
          </div>

          {/* Precision Comparison & Savings Breakdown Card */}
          {report && (
            <div className="space-y-3">
              {/* Detailed Stage Savings Breakdown Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 flex flex-col justify-between">
                  <span className="text-slate-400 text-[11px] flex items-center gap-1">
                    <Scissors className="w-3.5 h-3.5 text-amber-400" />
                    <span>抠除单色背景</span>
                  </span>
                  <div className="font-mono font-bold text-amber-300 text-sm mt-1">
                    省 {report.bgBeadsSaved} 粒
                  </div>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 flex flex-col justify-between">
                  <span className="text-slate-400 text-[11px] flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                    <span>净化悬空噪点</span>
                  </span>
                  <div className="font-mono font-bold text-sky-300 text-sm mt-1">
                    省 {report.noiseBeadsSaved} 粒
                  </div>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 flex flex-col justify-between">
                  <span className="text-slate-400 text-[11px] flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5 text-indigo-400" />
                    <span>平滑连片合并</span>
                  </span>
                  <div className="font-mono font-bold text-indigo-300 text-sm mt-1">
                    省 {report.patchMergedBeadsSaved} 粒
                  </div>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 flex flex-col justify-between">
                  <span className="text-slate-400 text-[11px] flex items-center gap-1">
                    <Palette className="w-3.5 h-3.5 text-purple-400" />
                    <span>少用杂色袋清退</span>
                  </span>
                  <div className="font-mono font-bold text-purple-300 text-sm mt-1">
                    少买 {report.savedColorTypesCount} 包色料
                  </div>
                </div>
              </div>

              {/* Summary Banner */}
              <div className="bg-gradient-to-r from-slate-950 via-sky-950/90 to-slate-950 border border-amber-500/50 rounded-xl p-3.5 px-4 text-xs text-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
                <div className="space-y-1 text-center sm:text-left">
                  <div className="font-bold text-white flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>
                      原图 {origW}×{origH} = {report.originalTotalBeads} 粒拼豆 ({report.originalColorTypesCount}色)
                      <ArrowRight className="w-3.5 h-3.5 inline mx-1.5 text-sky-400" />
                      PRO 减粒图纸 {optW}×{optH} = {report.optimizedTotalBeads} 粒拼豆 ({report.optimizedColorTypesCount}色)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 font-mono">
                    累计削减 <strong className="text-amber-300 text-xs">{report.savedBeadCount}</strong> 颗拼豆（物理省豆 <strong className="text-emerald-400">{report.savedPercent}%</strong>，画质五官零失真）
                  </p>
                </div>

                <div className="flex items-center gap-2 bg-gradient-to-r from-amber-950 to-amber-900 border border-amber-500/60 px-4 py-2 rounded-xl shrink-0 shadow">
                  <DollarSign className="w-4 h-4 text-amber-300" />
                  <span className="text-amber-200 font-bold text-xs">
                    预计为买家省材料费 <span className="text-amber-300 text-base font-mono font-black">¥{report.estimatedMoneySavedRMB}</span> 元
                  </span>
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
            取消
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleApply}
              disabled={isCalculating || !report}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 via-indigo-600 to-purple-600 text-white font-bold text-xs hover:brightness-110 active:scale-95 shadow-lg shadow-sky-500/25 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <Zap className="w-4 h-4 fill-current" />
              <span>应用减粒图纸到当前拼豆画布</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
