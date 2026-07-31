import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Sparkles,
  Pipette,
  Scissors,
  Wand2,
  RefreshCw,
  Eye,
  Sliders,
  Check,
  Zap,
  RotateCw,
  FlipHorizontal,
} from 'lucide-react';
import { BeadColor, ConvertSettings, ColorMatchAlgo } from '../types';
import { imageToGrid } from '../utils/colorUtils';

interface ImageStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceImage: HTMLImageElement | null;
  settings: ConvertSettings;
  setSettings: React.Dispatch<React.SetStateAction<ConvertSettings>>;
  activePalette: BeadColor[];
  onApplyConversion: (newGrid: (string | null)[][]) => void;
}

export const ImageStudioModal: React.FC<ImageStudioModalProps> = ({
  isOpen,
  onClose,
  sourceImage,
  settings,
  setSettings,
  activePalette,
  onApplyConversion,
}) => {
  const [localSettings, setLocalSettings] = useState<ConvertSettings>(settings);
  const [rotation, setRotation] = useState<number>(0); // 0, 90, 180, 270
  const [flipH, setFlipH] = useState<boolean>(false);
  const [isPickingColor, setIsPickingColor] = useState<boolean>(false);
  const [pickedChromaColor, setPickedChromaColor] = useState<string | null>(
    settings.chromaKeyColor
  );

  const [previewGrid, setPreviewGrid] = useState<(string | null)[][]>([]);
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Palette map lookup
  const paletteMap = React.useMemo(() => {
    return new Map((activePalette || []).map(c => [c.id, c]));
  }, [activePalette]);

  // Sync state when modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings);
      setPickedChromaColor(settings.chromaKeyColor);
    }
  }, [isOpen, settings]);

  // Render preview grid to canvas with exact 1:1 aspect ratio
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || previewGrid.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rows = previewGrid.length;
    const cols = previewGrid[0]?.length || 0;
    if (cols === 0 || rows === 0) return;

    const cellSize = Math.max(3, Math.min(10, Math.floor(600 / Math.max(cols, rows))));
    canvas.width = cols * cellSize;
    canvas.height = rows * cellSize;

    // Dark canvas background
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cellId = previewGrid[y][x];
        const px = x * cellSize;
        const py = y * cellSize;

        if (cellId) {
          const bead = paletteMap.get(cellId);
          ctx.fillStyle = bead ? bead.hex : '#CCCCCC';
          if (cellSize >= 4) {
            ctx.beginPath();
            ctx.arc(px + cellSize / 2, py + cellSize / 2, (cellSize / 2) * 0.9, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#00000033';
            ctx.lineWidth = 0.5;
            ctx.stroke();
          } else {
            ctx.fillRect(px, py, cellSize, cellSize);
          }
        } else {
          // Transparent checker pattern
          ctx.fillStyle = (x + y) % 2 === 0 ? '#1E293B' : '#0F172A';
          ctx.fillRect(px, py, cellSize, cellSize);
        }
      }
    }
  }, [previewGrid, paletteMap]);

  // Update transformed source image canvas
  useEffect(() => {
    if (!isOpen || !sourceImage) return;

    const canvas = imageCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sw = sourceImage.naturalWidth || sourceImage.width;
    const sh = sourceImage.naturalHeight || sourceImage.height;

    const isRotated = rotation === 90 || rotation === 270;
    canvas.width = isRotated ? sh : sw;
    canvas.height = isRotated ? sw : sh;

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    if (flipH) ctx.scale(-1, 1);
    ctx.drawImage(sourceImage, -sw / 2, -sh / 2);
    ctx.restore();

    // Generate preview pixel grid using current local settings
    const newGrid = imageToGrid(canvas, localSettings, activePalette || []);
    setPreviewGrid(newGrid);
  }, [isOpen, sourceImage, localSettings, rotation, flipH, activePalette]);

  if (!isOpen || !sourceImage) return null;

  // Handle clicking on image to pick Chroma Key background color
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPickingColor) return;

    const canvas = imageCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pixelData = ctx.getImageData(x, y, 1, 1).data;
    const hex = `#${((1 << 24) + (pixelData[0] << 16) + (pixelData[1] << 8) + pixelData[2])
      .toString(16)
      .slice(1)
      .toUpperCase()}`;

    setPickedChromaColor(hex);
    setLocalSettings(s => ({ ...s, chromaKeyColor: hex }));
    setIsPickingColor(false);
  };

  // Apply Presets
  const applyPreset = (preset: 'vivid' | 'anime' | 'photo' | 'pixel' | 'clean') => {
    if (preset === 'vivid') {
      setLocalSettings(s => ({
        ...s,
        colorMatchAlgo: 'ciede2000_vivid',
        sharpening: 50,
        outlineBoost: true,
        contrast: 15,
        saturation: 20,
        dither: 'none',
      }));
    } else if (preset === 'anime') {
      setLocalSettings(s => ({
        ...s,
        colorMatchAlgo: 'ciede2000_vivid',
        sharpening: 70,
        outlineBoost: true,
        contrast: 20,
        saturation: 15,
        dither: 'none',
      }));
    } else if (preset === 'photo') {
      setLocalSettings(s => ({
        ...s,
        colorMatchAlgo: 'ciede2000_vivid',
        sharpening: 25,
        outlineBoost: false,
        contrast: 10,
        saturation: 10,
        dither: 'floyd',
      }));
    } else if (preset === 'pixel') {
      setLocalSettings(s => ({
        ...s,
        colorMatchAlgo: 'rgb_weighted',
        sharpening: 90,
        outlineBoost: true,
        contrast: 30,
        dither: 'none',
      }));
    } else if (preset === 'clean') {
      setLocalSettings(s => ({
        ...s,
        brightness: 0,
        contrast: 0,
        saturation: 0,
        sharpening: 0,
        outlineBoost: false,
        chromaKeyColor: null,
        dither: 'none',
      }));
      setPickedChromaColor(null);
    }
  };

  const handleApply = () => {
    setSettings(localSettings);
    onApplyConversion(previewGrid);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-2 sm:p-4 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col h-[90vh] max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-rose-500 to-amber-500 text-white shadow-lg shadow-rose-500/20">
              <Wand2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>高级图像增强与转换工作坊</span>
                <span className="px-2 py-0.5 text-[10px] bg-rose-500/20 text-rose-300 rounded-full border border-rose-500/30">
                  AI & 算法优化
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                针对高精度拼豆修正模糊、粗糙、背景杂色与边缘失真问题
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 flex flex-col xl:flex-row overflow-hidden min-h-0">
          {/* Left Preview Section: Original Image + Converted Grid Side-by-Side */}
          <div className="flex-1 p-3 sm:p-6 flex flex-col gap-4 overflow-y-auto bg-slate-950/50 min-h-0">
            {/* Action Presets bar */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs scrollbar-none shrink-0">
              <span className="text-slate-400 font-medium shrink-0 flex items-center gap-1 whitespace-nowrap">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                智能预设:
              </span>
              <button
                onClick={() => applyPreset('vivid')}
                className="px-2.5 py-1 rounded-lg bg-amber-950/80 border border-amber-500/80 text-amber-200 hover:bg-amber-900 cursor-pointer transition-all shrink-0 font-bold shadow-sm whitespace-nowrap text-[11px] sm:text-xs"
              >
                🔥 鲜艳高饱满 (防发白)
              </button>
              <button
                onClick={() => applyPreset('anime')}
                className="px-2.5 py-1 rounded-lg bg-rose-950/60 border border-rose-600/50 text-rose-300 hover:bg-rose-900/80 cursor-pointer transition-all shrink-0 font-medium whitespace-nowrap text-[11px] sm:text-xs"
              >
                🎨 动漫/卡通立绘
              </button>
              <button
                onClick={() => applyPreset('photo')}
                className="px-2.5 py-1 rounded-lg bg-sky-950/60 border border-sky-600/50 text-sky-300 hover:bg-sky-900/80 cursor-pointer transition-all shrink-0 font-medium whitespace-nowrap text-[11px] sm:text-xs"
              >
                📷 真实照片
              </button>
              <button
                onClick={() => applyPreset('pixel')}
                className="px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-600/50 text-emerald-300 hover:bg-emerald-900/80 cursor-pointer transition-all shrink-0 font-medium whitespace-nowrap text-[11px] sm:text-xs"
              >
                🕹️ 8-Bit像素
              </button>
              <button
                onClick={() => applyPreset('clean')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 cursor-pointer transition-all shrink-0 whitespace-nowrap text-[11px] sm:text-xs"
              >
                <RotateCw className="w-3 h-3 inline mr-1" /> 重置
              </button>
            </div>

            {/* Canvas Display Dual Box */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-[300px]">
              {/* Box 1: Pre-processed Source Image Canvas */}
              <div className="flex flex-col bg-slate-900/80 border border-slate-800 rounded-xl p-3 relative group">
                <div className="flex items-center justify-between mb-2 text-xs font-semibold text-slate-300 shrink-0">
                  <span className="flex items-center gap-1">
                    <Scissors className="w-3.5 h-3.5 text-sky-400" />
                    原图变换与抠图预览
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setRotation(r => (r + 90) % 360)}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                      title="旋转 90 度"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setFlipH(f => !f)}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                      title="水平镜像翻转"
                    >
                      <FlipHorizontal className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setIsPickingColor(p => !p)}
                      className={`p-1 px-2 rounded flex items-center gap-1 text-[11px] cursor-pointer transition-colors ${
                        isPickingColor
                          ? 'bg-rose-600 text-white animate-pulse'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      }`}
                      title="点击原图吸取背景色扣除"
                    >
                      <Pipette className="w-3.5 h-3.5" />
                      <span>{isPickingColor ? '点击图片扣色' : '吸除背景'}</span>
                    </button>
                  </div>
                </div>

                <div className="flex-1 flex items-center justify-center overflow-hidden bg-slate-950 rounded-lg border border-slate-800/80 p-2 relative">
                  <canvas
                    ref={imageCanvasRef}
                    onClick={handleCanvasClick}
                    className={`max-w-full max-h-[320px] object-contain rounded ${
                      isPickingColor ? 'cursor-crosshair ring-2 ring-rose-500' : ''
                    }`}
                  />
                  {isPickingColor && (
                    <div className="absolute top-2 left-2 bg-rose-600/90 text-white text-[11px] px-2 py-1 rounded-md shadow backdrop-blur pointer-events-none">
                      点击图像上的任何背景位置以直接扣除该颜色
                    </div>
                  )}
                </div>
              </div>

              {/* Box 2: Live Converted Pixel Bead Preview */}
              <div className="flex flex-col bg-slate-900/80 border border-slate-800 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2 text-xs font-semibold text-slate-300 shrink-0">
                  <span className="flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5 text-rose-400" />
                    转换后拼豆效果 ({localSettings.width} × {localSettings.height})
                  </span>
                  <span className="text-[11px] text-slate-400">
                    像素颗粒数: {localSettings.width * localSettings.height}
                  </span>
                </div>

                <div className="flex-1 flex items-center justify-center overflow-hidden bg-slate-950 rounded-lg border border-slate-800/80 p-2">
                  {previewGrid.length > 0 ? (
                    <canvas
                      ref={previewCanvasRef}
                      className="max-w-full max-h-[320px] object-contain rounded shadow-lg"
                    />
                  ) : (
                    <div className="text-slate-500 text-xs">正在计算高精度像素...</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Control Drawer: Advanced Sliders */}
          <div className="w-full xl:w-80 bg-slate-900 border-t xl:border-t-0 xl:border-l border-slate-800 p-4 sm:p-5 overflow-y-auto space-y-5 text-xs select-none shrink-0 min-h-0">
            {/* Section 0: Grid Target Dimensions */}
            <div className="space-y-2">
              <label className="text-slate-200 font-bold flex items-center justify-between text-xs">
                <span>转换拼豆目标尺寸</span>
                <span className="text-[11px] text-amber-400 font-mono">
                  {localSettings.width} x {localSettings.height} 豆
                </span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-slate-400">宽度 (W)</span>
                  <input
                    type="number"
                    min={10}
                    max={300}
                    value={localSettings.width}
                    onChange={e => {
                      const newW = Math.max(10, parseInt(e.target.value) || 29);
                      setLocalSettings(s => ({
                        ...s,
                        width: newW,
                        height: s.keepAspectRatio && sourceImage ? Math.round((newW * (sourceImage.naturalHeight || sourceImage.height)) / (sourceImage.naturalWidth || sourceImage.width)) : s.height
                      }));
                    }}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 font-mono rounded px-2 py-1 text-xs outline-none"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-400">高度 (H)</span>
                  <input
                    type="number"
                    min={10}
                    max={300}
                    value={localSettings.height}
                    onChange={e => {
                      const newH = Math.max(10, parseInt(e.target.value) || 29);
                      setLocalSettings(s => ({
                        ...s,
                        height: newH,
                        width: s.keepAspectRatio && sourceImage ? Math.round((newH * (sourceImage.naturalWidth || sourceImage.width)) / (sourceImage.naturalHeight || sourceImage.height)) : s.width
                      }));
                    }}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 font-mono rounded px-2 py-1 text-xs outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Section 1: Color Match Engine */}
            <div className="space-y-2 pt-3 border-t border-slate-800">
              <label className="text-slate-200 font-bold flex items-center gap-1.5 text-xs">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>色彩匹配引擎 (Color Engine)</span>
              </label>
              <div className="space-y-1.5">
                {[
                  {
                    id: 'ciede2000_vivid',
                    name: 'CIEDE2000 鲜艳饱满 (防发白)',
                    desc: '优先匹配饱和色彩，强力防止发白变淡 (推荐)',
                  },
                  {
                    id: 'ciede2000',
                    name: 'CIEDE2000 工业标准柔和',
                    desc: '符合人眼标准感知，渐变平滑自然',
                  },
                  {
                    id: 'cie76',
                    name: 'CIE76 标准Lab演算法',
                    desc: '速度快，色差均匀',
                  },
                  {
                    id: 'rgb_weighted',
                    name: '加权RGB 快速高对比',
                    desc: '锐利强对比，适合二次元/图标',
                  },
                ].map(algo => (
                  <button
                    key={algo.id}
                    onClick={() =>
                      setLocalSettings(s => ({
                        ...s,
                        colorMatchAlgo: algo.id as ColorMatchAlgo,
                      }))
                    }
                    className={`w-full p-2 rounded-xl border text-left transition-colors cursor-pointer ${
                      localSettings.colorMatchAlgo === algo.id
                        ? 'bg-rose-950/80 border-rose-500 text-rose-200'
                        : 'bg-slate-800/80 border-slate-700/80 text-slate-400 hover:bg-slate-700/60'
                    }`}
                  >
                    <div className="font-bold text-[11px] text-slate-100">{algo.name}</div>
                    <div className="text-[10px] text-slate-400 leading-tight">{algo.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Section 2: Sharpening & Outline Protection */}
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <label className="text-slate-200 font-bold flex items-center gap-1.5 text-xs">
                <Sliders className="w-4 h-4 text-sky-400" />
                <span>图像边缘与锐化处理</span>
              </label>

              {/* Sharpening Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-300">锐化与边缘增强</span>
                  <span className="font-mono text-rose-400 font-bold">
                    {localSettings.sharpening}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={localSettings.sharpening}
                  onChange={e =>
                    setLocalSettings(s => ({
                      ...s,
                      sharpening: parseInt(e.target.value),
                    }))
                  }
                  className="w-full accent-rose-500 cursor-pointer"
                />
                <p className="text-[10px] text-slate-400">
                  提升因缩小造成的线条模糊，使像素小点边缘清晰无比。
                </p>
              </div>

              {/* Outline Protection Checkbox */}
              <label className="flex items-center gap-2 bg-slate-800/80 p-2 rounded-xl border border-slate-700/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localSettings.outlineBoost}
                  onChange={e =>
                    setLocalSettings(s => ({ ...s, outlineBoost: e.target.checked }))
                  }
                  className="w-4 h-4 accent-rose-500 rounded cursor-pointer"
                />
                <div>
                  <span className="font-bold text-slate-200">暗色/黑色描边强保护</span>
                  <p className="text-[10px] text-slate-400">
                    防止卡通/游戏主图的角色黑边在缩小时丢失
                  </p>
                </div>
              </label>
            </div>

            {/* Section 3: Background Chroma Key */}
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <label className="text-slate-200 font-bold flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <Pipette className="w-4 h-4 text-pink-400" />
                  <span>背景抠图与去色 (Chroma Key)</span>
                </span>
                {pickedChromaColor && (
                  <button
                    onClick={() => {
                      setPickedChromaColor(null);
                      setLocalSettings(s => ({ ...s, chromaKeyColor: null }));
                    }}
                    className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                  >
                    清除扣色
                  </button>
                )}
              </label>

              <div className="flex items-center gap-3 bg-slate-800 p-2 rounded-xl border border-slate-700">
                <div
                  className="w-7 h-7 rounded-lg border border-slate-600 shadow-inner shrink-0"
                  style={{ backgroundColor: pickedChromaColor || 'transparent' }}
                />
                <div className="flex-1">
                  <div className="text-[11px] font-bold text-slate-200">
                    {pickedChromaColor ? `扣除颜色: ${pickedChromaColor}` : '未选择背景色'}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    使用左侧吸管或直接输入Hex色号
                  </div>
                </div>
              </div>

              {pickedChromaColor && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-300">抠色容差 (Tolerance)</span>
                    <span className="font-mono text-rose-400">
                      {localSettings.chromaKeyTolerance}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={localSettings.chromaKeyTolerance}
                    onChange={e =>
                      setLocalSettings(s => ({
                        ...s,
                        chromaKeyTolerance: parseInt(e.target.value),
                      }))
                    }
                    className="w-full accent-rose-500 cursor-pointer"
                  />
                </div>
              )}
            </div>

            {/* Section 4: Filters (Brightness, Contrast, Saturation) */}
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <label className="text-slate-200 font-bold text-xs">基础明暗调色</label>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">亮度 (Brightness)</span>
                  <span className="font-mono text-slate-200">{localSettings.brightness}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={localSettings.brightness}
                  onChange={e =>
                    setLocalSettings(s => ({
                      ...s,
                      brightness: parseInt(e.target.value),
                    }))
                  }
                  className="w-full accent-rose-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">对比度 (Contrast)</span>
                  <span className="font-mono text-slate-200">{localSettings.contrast}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={localSettings.contrast}
                  onChange={e =>
                    setLocalSettings(s => ({
                      ...s,
                      contrast: parseInt(e.target.value),
                    }))
                  }
                  className="w-full accent-rose-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">饱和度 (Saturation)</span>
                  <span className="font-mono text-slate-200">{localSettings.saturation}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={localSettings.saturation}
                  onChange={e =>
                    setLocalSettings(s => ({
                      ...s,
                      saturation: parseInt(e.target.value),
                    }))
                  }
                  className="w-full accent-rose-500 cursor-pointer"
                />
              </div>
            </div>

            {/* Section 5: Color Limit & Dithering */}
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <label className="text-slate-200 font-bold text-xs">用色精简与抖动采样</label>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">抖动算法 (Dither)</span>
                </div>
                <select
                  value={localSettings.dither}
                  onChange={e => setLocalSettings(s => ({ ...s, dither: e.target.value as any }))}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded px-2 py-1.5 text-xs outline-none cursor-pointer"
                >
                  <option value="none">无抖动 (保持边缘清晰洁净)</option>
                  <option value="floyd">Floyd-Steinberg 误差扩散抖动 (平滑渐变)</option>
                  <option value="atkinson">Atkinson 经典像素风抖动 (细腻复古)</option>
                </select>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">用色种类上限</span>
                </div>
                <select
                  value={localSettings.colorLimit}
                  onChange={e => setLocalSettings(s => ({ ...s, colorLimit: parseInt(e.target.value) }))}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded px-2 py-1.5 text-xs outline-none cursor-pointer"
                >
                  <option value={0}>不设限 (自动匹配色板全色彩)</option>
                  <option value={8}>最多 8 色 (超简复古)</option>
                  <option value={12}>最多 12 色</option>
                  <option value={16}>最多 16 色 (经典16色)</option>
                  <option value={24}>最多 24 色</option>
                  <option value={32}>最多 32 色</option>
                  <option value={48}>最多 48 色</option>
                  <option value={64}>最多 64 色</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 border-t border-slate-800 flex items-center justify-between bg-slate-900/90 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleApply}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 flex items-center gap-2 cursor-pointer transition-all active:scale-95"
          >
            <Check className="w-4 h-4" />
            <span>应用增强参数并生成拼豆图纸</span>
          </button>
        </div>
      </div>
    </div>
  );
};
