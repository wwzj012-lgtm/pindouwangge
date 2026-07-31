import React from 'react';
import {
  Sliders,
  Sparkles,
  Link2,
  Unlink2,
  RotateCcw,
  Palette,
  LayoutGrid,
  Zap,
  Pipette,
  Wand2,
} from 'lucide-react';
import { BrandKey, ConvertSettings, DitherMode, ColorMatchAlgo } from '../types';
import { BRAND_NAMES, BOARD_PRESETS } from '../data/palettes';

interface SettingsPanelProps {
  settings: ConvertSettings;
  setSettings: React.Dispatch<React.SetStateAction<ConvertSettings>>;
  onReconvert: () => void;
  hasImage: boolean;
  onOpenImageStudio: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  setSettings,
  onReconvert,
  hasImage,
  onOpenImageStudio,
}) => {
  const updateSetting = <K extends keyof ConvertSettings>(key: K, value: ConvertSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleResetFilters = () => {
    setSettings(prev => ({
      ...prev,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      transparentCutoff: 128,
      dither: 'none',
      colorLimit: 0,
      sharpening: 0,
      outlineBoost: false,
      chromaKeyColor: null,
      colorMatchAlgo: 'ciede2000',
    }));
  };

  return (
    <div className="w-80 bg-slate-900 border-l border-slate-800 text-slate-200 p-4 flex flex-col h-full overflow-y-auto space-y-5 text-xs select-none shrink-0">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
          <Sliders className="w-4 h-4" />
          <span>拼豆转换参数设置</span>
        </div>
        <button
          onClick={handleResetFilters}
          className="text-slate-400 hover:text-white flex items-center gap-1 text-[11px] cursor-pointer"
          title="重置图像滤镜"
        >
          <RotateCcw className="w-3 h-3" />
          <span>重置</span>
        </button>
      </div>

      {/* Image Studio Workshop Launcher */}
      {hasImage && (
        <button
          onClick={onOpenImageStudio}
          className="w-full py-2 px-3 bg-gradient-to-r from-rose-600 via-pink-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-bold rounded-xl shadow-md flex items-center justify-between cursor-pointer transition-all active:scale-95"
        >
          <div className="flex items-center gap-2 text-xs">
            <Wand2 className="w-4 h-4" />
            <span>图像AI增强/抠图工作坊</span>
          </div>
          <span className="text-[10px] bg-black/20 px-1.5 py-0.5 rounded">打开</span>
        </button>
      )}

      {/* 1. Dimensions & Board Presets */}
      <div className="space-y-3">
        <label className="text-slate-300 font-bold flex items-center gap-1.5">
          <LayoutGrid className="w-3.5 h-3.5 text-sky-400" />
          <span>网格尺寸 (豆数)</span>
        </label>

        {/* Board Preset Chips */}
        <div className="grid grid-cols-2 gap-1.5">
          {BOARD_PRESETS.map(p => (
            <button
              key={p.name}
              onClick={() => {
                setSettings(prev => ({
                  ...prev,
                  width: p.width,
                  height: p.height,
                  boardSize: p.boardSize,
                }));
              }}
              className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                settings.width === p.width && settings.height === p.height
                  ? 'bg-rose-950/60 border-rose-500 text-rose-200 font-bold'
                  : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-700/60'
              }`}
            >
              <div className="text-[11px] font-semibold">{p.width} × {p.height}</div>
              <div className="text-[10px] text-slate-400 truncate">{p.name.split(' ')[1] || p.name}</div>
            </button>
          ))}
        </div>

        {/* Custom Width / Height Inputs */}
        <div className="flex items-center gap-2 pt-1">
          <div className="flex-1 space-y-1">
            <span className="text-[10px] text-slate-400">宽度 (W)</span>
            <input
              type="number"
              min={10}
              max={200}
              value={settings.width}
              onChange={e => {
                const val = parseInt(e.target.value) || 10;
                setSettings(prev => ({
                  ...prev,
                  width: val,
                  height: prev.keepAspectRatio ? val : prev.height,
                }));
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs outline-none focus:border-rose-500"
            />
          </div>

          <button
            onClick={() => updateSetting('keepAspectRatio', !settings.keepAspectRatio)}
            className={`mt-4 p-2 rounded-lg border cursor-pointer transition-colors ${
              settings.keepAspectRatio
                ? 'bg-rose-600 border-rose-500 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-500'
            }`}
            title={settings.keepAspectRatio ? '保持原图长宽比已开启' : '自由设置宽高'}
          >
            {settings.keepAspectRatio ? <Link2 className="w-4 h-4" /> : <Unlink2 className="w-4 h-4" />}
          </button>

          <div className="flex-1 space-y-1">
            <span className="text-[10px] text-slate-400">高度 (H)</span>
            <input
              type="number"
              min={10}
              max={200}
              value={settings.height}
              onChange={e => {
                const val = parseInt(e.target.value) || 10;
                setSettings(prev => ({
                  ...prev,
                  height: val,
                  width: prev.keepAspectRatio ? val : prev.width,
                }));
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs outline-none focus:border-rose-500"
            />
          </div>
        </div>
      </div>

      {/* 2. Color Matching Algorithm */}
      <div className="space-y-2 pt-2 border-t border-slate-800">
        <label className="text-slate-300 font-bold flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span>色彩匹配演算法</span>
        </label>
        <select
          value={settings.colorMatchAlgo || 'ciede2000'}
          onChange={e => updateSetting('colorMatchAlgo', e.target.value as ColorMatchAlgo)}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 text-xs outline-none focus:border-rose-500 cursor-pointer"
        >
          <option value="ciede2000">CIEDE2000 工业级精准感知匹配 (推荐)</option>
          <option value="cie76">CIE76 标准Lab空间演算法</option>
          <option value="rgb_weighted">加权RGB 快速高对比度</option>
        </select>
      </div>

      {/* 3. Sharpening & Outline Protection */}
      <div className="space-y-3 pt-2 border-t border-slate-800">
        <label className="text-slate-300 font-bold flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-rose-400" />
          <span>边缘锐化与描边保护</span>
        </label>

        {/* Sharpening Slider */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">锐化/边缘清晰度</span>
            <span className="font-mono text-rose-400 font-bold">{settings.sharpening}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={settings.sharpening}
            onChange={e => updateSetting('sharpening', parseInt(e.target.value))}
            className="w-full accent-rose-500 cursor-pointer"
          />
        </div>

        {/* Outline Protection Checkbox */}
        <label className="flex items-center gap-2 bg-slate-800/80 p-2 rounded-xl border border-slate-700/80 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.outlineBoost}
            onChange={e => updateSetting('outlineBoost', e.target.checked)}
            className="w-4 h-4 accent-rose-500 rounded cursor-pointer"
          />
          <div>
            <span className="font-bold text-slate-200 text-[11px]">暗色/黑色描边保护</span>
            <p className="text-[10px] text-slate-400 leading-none mt-0.5">
              防动漫卡通人物黑边丢失
            </p>
          </div>
        </label>
      </div>

      {/* 4. Brand Palette & Color Limit */}
      <div className="space-y-3 pt-2 border-t border-slate-800">
        <label className="text-slate-300 font-bold flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5 text-pink-400" />
          <span>品牌色卡与色彩限制</span>
        </label>

        <div className="space-y-1">
          <span className="text-[10px] text-slate-400">选用拼豆色卡</span>
          <select
            value={settings.brand}
            onChange={e => updateSetting('brand', e.target.value as BrandKey)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 text-xs outline-none focus:border-rose-500 cursor-pointer"
          >
            {Object.entries(BRAND_NAMES).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <span className="text-[10px] text-slate-400">最大使用颜色数量限制</span>
          <select
            value={settings.colorLimit}
            onChange={e => updateSetting('colorLimit', parseInt(e.target.value))}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 text-xs outline-none focus:border-rose-500 cursor-pointer"
          >
            <option value={0}>不限制 (智能全配卡)</option>
            <option value={12}>12 色套组</option>
            <option value={24}>24 色套组</option>
            <option value={36}>36 色套组</option>
            <option value={48}>48 色套组</option>
            <option value={72}>72 色精简</option>
          </select>
        </div>
      </div>

      {/* 5. Dithering Mode */}
      <div className="space-y-2 pt-2 border-t border-slate-800">
        <label className="text-slate-300 font-bold flex items-center justify-between">
          <span>抖动色彩算法 (Dithering)</span>
        </label>
        <div className="grid grid-cols-3 gap-1">
          {[
            { id: 'none', label: '无 (清晰)' },
            { id: 'floyd', label: 'Floyd 柔和' },
            { id: 'atkinson', label: 'Atkinson 复古' },
          ].map(d => (
            <button
              key={d.id}
              onClick={() => updateSetting('dither', d.id as DitherMode)}
              className={`py-1.5 px-2 rounded-lg border text-center transition-colors cursor-pointer text-[11px] ${
                settings.dither === d.id
                  ? 'bg-rose-600 border-rose-500 text-white font-bold'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* 6. Image Pre-Process Adjustments */}
      <div className="space-y-3 pt-2 border-t border-slate-800">
        <label className="text-slate-300 font-bold">基础明暗调色滤镜</label>

        {/* Brightness */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">亮度 (Brightness)</span>
            <span className="font-mono text-slate-200">{settings.brightness}</span>
          </div>
          <input
            type="range"
            min={-100}
            max={100}
            value={settings.brightness}
            onChange={e => updateSetting('brightness', parseInt(e.target.value))}
            className="w-full accent-rose-500 cursor-pointer"
          />
        </div>

        {/* Contrast */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">对比度 (Contrast)</span>
            <span className="font-mono text-slate-200">{settings.contrast}</span>
          </div>
          <input
            type="range"
            min={-100}
            max={100}
            value={settings.contrast}
            onChange={e => updateSetting('contrast', parseInt(e.target.value))}
            className="w-full accent-rose-500 cursor-pointer"
          />
        </div>

        {/* Saturation */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">饱和度 (Saturation)</span>
            <span className="font-mono text-slate-200">{settings.saturation}</span>
          </div>
          <input
            type="range"
            min={-100}
            max={100}
            value={settings.saturation}
            onChange={e => updateSetting('saturation', parseInt(e.target.value))}
            className="w-full accent-rose-500 cursor-pointer"
          />
        </div>
      </div>

      {/* Re-convert Trigger Button */}
      {hasImage && (
        <button
          onClick={onReconvert}
          className="w-full py-2.5 bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-bold rounded-xl shadow-lg shadow-rose-600/20 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95 mt-auto"
        >
          <Sparkles className="w-4 h-4" />
          <span>重新计算拼豆图纸</span>
        </button>
      )}
    </div>
  );
};

