import React from 'react';
import {
  Sliders,
  Link2,
  Unlink2,
  RotateCcw,
  Palette,
  LayoutGrid,
  Pipette,
  Wand2,
  X,
  AlertCircle,
  Crown,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { BrandKey, ConvertSettings, DitherMode } from '../types';
import { BOARD_PRESETS } from '../data/palettes';
import { useBrandCatalog } from '../hooks/useBrandCatalog';
import type { ConversionDiagnostics } from '../utils/imagePipeline';
import { resetBackgroundRemovalForNewImage } from '../utils/imageStudioControls';
import { canvasLimitForMembership } from '../utils/communityPatternAccess';

interface SettingsPanelProps {
  settings: ConvertSettings;
  setSettings: React.Dispatch<React.SetStateAction<ConvertSettings>>;
  conversionDiagnostics: ConversionDiagnostics | null;
  onReconvert: () => void;
  hasImage: boolean;
  onOpenImageStudio: () => void;
  onCloseMobile?: () => void;
  variant?: 'sidebar' | 'sheet';
  showDiagnostics?: boolean;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  setSettings,
  conversionDiagnostics,
  onReconvert,
  hasImage,
  onOpenImageStudio,
  onCloseMobile,
  variant = 'sidebar',
  showDiagnostics = true,
}) => {
  const { isVip, isPro } = useAuth();
  const { language } = useLanguage();
  const isEn = language === 'en';
  const brandCatalog = useBrandCatalog();
  const brandOptions = Object.keys(brandCatalog.palettes).map(key => ({ key,
    name: key === 'CUSTOM' && isEn ? 'Custom Palette' : brandCatalog.names[key] }));
  const clarityEnabled = settings.sharpening > 0;
  const containerClassName = variant === 'sheet'
    ? 'w-full max-w-none bg-transparent text-purple-950 px-0 py-0 flex flex-col h-auto overflow-visible space-y-5 text-xs select-none shadow-none'
    : 'w-80 max-w-[85vw] bg-white/90 backdrop-blur-md border-r border-purple-200/90 text-purple-950 p-4 flex flex-col h-full overflow-y-auto space-y-5 text-xs select-none shrink-0 shadow-sm';

  // Tier max canvas limits
  const maxCanvasLimit = canvasLimitForMembership({ isVip, isPro });
  const [limitWarning, setLimitWarning] = React.useState<string | null>(null);
  const updateSetting = <K extends keyof ConvertSettings>(key: K, value: ConvertSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleResetFilters = () => {
    setSettings(prev => ({
      ...prev,
      ...resetBackgroundRemovalForNewImage(prev),
      brightness: 0,
      contrast: 0,
      saturation: 0,
      transparentCutoff: 128,
      dither: 'none',
      colorLimit: 0,
      sharpening: 0,
      outlineBoost: false,
      chromaKeyColor: null,
      backgroundRemovalEnabled: false,
      pipelineOverride: 'auto',
      ditherStrength: 0.65,
      kmeansClustering: true,
      quantizationStrength: 28,
    }));
  };

  return (
    <div className={containerClassName}>
      <div className="flex items-center justify-between border-b border-purple-200/80 pb-3">
        <div className="flex items-center gap-2 text-purple-800 font-extrabold text-sm">
          <Sliders className="w-4 h-4 text-purple-600" />
          <span>{isEn ? 'Conversion Settings' : '拼豆转换参数设置'}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleResetFilters}
            className="text-purple-500 hover:text-purple-900 flex items-center gap-1 text-[11px] font-bold cursor-pointer transition-colors"
            title={isEn ? 'Reset image filters' : '重置图像滤镜'}
          >
            <RotateCcw className="w-3 h-3" />
            <span>{isEn ? 'Reset' : '重置'}</span>
          </button>
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="lg:hidden p-1 text-purple-500 hover:text-purple-900 rounded-lg hover:bg-purple-100 cursor-pointer"
              title={isEn ? 'Close' : '关闭'}
              aria-label={isEn ? 'Close settings' : '关闭设置'}
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Image Studio Workshop Launcher */}
      {hasImage && (
        <button
          onClick={onOpenImageStudio}
          className="w-full py-2.5 px-3 bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:to-indigo-700 text-white font-extrabold rounded-2xl shadow-sm flex items-center justify-between cursor-pointer transition-all active:scale-95"
        >
          <div className="flex items-center gap-2 text-xs">
            <Wand2 className="w-4 h-4 text-amber-300" />
            <span>{isEn ? 'Image Studio & Workshop' : '图像转换与增强工作坊'}</span>
          </div>
          <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded-lg">{isEn ? 'Open' : '打开'}</span>
        </button>
      )}

      {showDiagnostics && conversionDiagnostics && (
        <div className="-mt-3 text-[10px] font-mono text-purple-500 flex flex-wrap gap-x-2 gap-y-0.5" title="Latest conversion diagnostics">
          <span>V2 {conversionDiagnostics.pipeline.toUpperCase()}</span>
          <span>LΔ {conversionDiagnostics.lightnessBias >= 0 ? '+' : ''}{conversionDiagnostics.lightnessBias.toFixed(1)}</span>
          <span>ΔE {conversionDiagnostics.meanDeltaE.toFixed(1)}</span>
        </div>
      )}

      {/* 1. Dimensions & Board Presets */}
      <div className="space-y-3">
        <label className="text-purple-900 font-extrabold flex items-center gap-1.5">
          <LayoutGrid className="w-3.5 h-3.5 text-purple-600" />
          <span>{isEn ? 'Grid Size (Beads)' : '网格尺寸 (豆数)'}</span>
        </label>

        {/* Board Preset Chips */}
        <div className="grid grid-cols-2 gap-1.5">
          {BOARD_PRESETS.map(p => {
            const subtitle = isEn ? (p.nameEn.split('(')[1]?.replace(')', '') || p.nameEn) : (p.name.split(' ')[1] || p.name);
            return (
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
                className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                  settings.width === p.width && settings.height === p.height
                    ? 'bg-purple-600 border-purple-600 text-white shadow-xs'
                    : 'bg-purple-50/80 border-purple-200 text-purple-700 hover:bg-purple-100'
                }`}
              >
                <div className="text-[11px] font-bold">{p.width} × {p.height}</div>
                <div className={`text-[10px] truncate ${settings.width === p.width && settings.height === p.height ? 'text-purple-100' : 'text-purple-500'}`}>{subtitle}</div>
              </button>
            );
          })}
        </div>

        {/* Custom Width / Height Inputs */}
        <div className="flex items-center gap-2 pt-1">
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-purple-600 font-medium">{isEn ? 'Width (W)' : '宽度 (W)'}</span>
              <span className="text-[9px] font-mono text-purple-400">{isEn ? 'Max:' : '上限:'}{maxCanvasLimit}</span>
            </div>
            <input
              type="number"
              min={10}
              max={maxCanvasLimit}
              value={settings.width}
              onChange={e => {
                let val = parseInt(e.target.value) || 10;
                if (val > maxCanvasLimit) {
                  val = maxCanvasLimit;
                  if (!isVip) {
                    setLimitWarning(isEn ? 'Upgrade to VIP for 400x400 canvas' : '升级普通VIP解锁400×400画布');
                  } else if (!isPro) {
                    setLimitWarning(isEn ? 'Upgrade to Pro for 900x900 canvas' : '升级商家Pro解锁900×900超大画布');
                  } else {
                    setLimitWarning(isEn ? 'Pro limit reached: 900x900' : '商家Pro已达上限 900×900');
                  }
                } else {
                  setLimitWarning(null);
                }
                setSettings(prev => ({
                  ...prev,
                  width: val,
                  height: prev.keepAspectRatio ? val : prev.height,
                }));
              }}
              className="w-full bg-purple-50/80 border border-purple-200 rounded-xl px-2.5 py-1.5 text-purple-950 font-mono text-xs outline-none focus:ring-2 focus:ring-purple-400/30"
            />
          </div>

          <button
            onClick={() => updateSetting('keepAspectRatio', !settings.keepAspectRatio)}
            className={`mt-4 p-2 rounded-xl border cursor-pointer transition-all ${
              settings.keepAspectRatio
                ? 'bg-purple-600 border-purple-600 text-white shadow-xs'
                : 'bg-purple-50/80 border-purple-200 text-purple-700 hover:bg-purple-100'
            }`}
            title={settings.keepAspectRatio ? (isEn ? 'Keep aspect ratio ON' : '保持原图长宽比已开启') : (isEn ? 'Custom aspect ratio' : '自由设置宽高')}
            aria-label={settings.keepAspectRatio ? (isEn ? 'Keep aspect ratio on' : '保持原图长宽比已开启') : (isEn ? 'Custom aspect ratio' : '自由设置宽高')}
          >
            {settings.keepAspectRatio ? <Link2 className="w-4 h-4" /> : <Unlink2 className="w-4 h-4" />}
          </button>

          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-purple-600 font-medium">{isEn ? 'Height (H)' : '高度 (H)'}</span>
              <span className="text-[9px] font-mono text-purple-400">{isEn ? 'Max:' : '上限:'}{maxCanvasLimit}</span>
            </div>
            <input
              type="number"
              min={10}
              max={maxCanvasLimit}
              value={settings.height}
              onChange={e => {
                let val = parseInt(e.target.value) || 10;
                if (val > maxCanvasLimit) {
                  val = maxCanvasLimit;
                  if (!isVip) {
                    setLimitWarning(isEn ? 'Upgrade to VIP for 400x400 canvas' : '升级普通VIP解锁400×400画布');
                  } else if (!isPro) {
                    setLimitWarning(isEn ? 'Upgrade to Pro for 900x900 canvas' : '升级商家Pro解锁900×900超大画布');
                  } else {
                    setLimitWarning(isEn ? 'Pro limit reached: 900x900' : '商家Pro已达上限 900×900');
                  }
                } else {
                  setLimitWarning(null);
                }
                setSettings(prev => ({
                  ...prev,
                  height: val,
                  width: prev.keepAspectRatio ? val : prev.width,
                }));
              }}
              className="w-full bg-purple-50/80 border border-purple-200 rounded-xl px-2.5 py-1.5 text-purple-950 font-mono text-xs outline-none focus:ring-2 focus:ring-purple-400/30"
            />
          </div>
        </div>

        {limitWarning && (
          <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[10px] flex items-center gap-1.5 font-bold">
            <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span>{limitWarning}</span>
          </div>
        )}
      </div>

      <div className="space-y-2 pt-2 border-t border-purple-200/80">
        <label className="text-purple-900 font-extrabold flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
          <span>{isEn ? 'Conversion Mode' : '转换模式'}</span>
        </label>
        <div className="grid grid-cols-4 gap-1">
          {(['auto', 'cartoon', 'photo', 'logo'] as const).map((pipeline) => (
            <button
              key={pipeline}
              onClick={() => updateSetting('pipelineOverride', pipeline)}
              className={`py-1.5 px-2 rounded-xl border text-center transition-all cursor-pointer text-[11px] ${
                (settings.pipelineOverride ?? 'auto') === pipeline
                  ? 'bg-purple-600 border-purple-600 text-white font-extrabold shadow-2xs'
                  : 'bg-purple-50/80 border-purple-200 text-purple-700 hover:bg-purple-100'
              }`}
            >
              {pipeline === 'auto' ? (isEn ? 'Auto' : '自动') : pipeline === 'cartoon' ? (isEn ? 'Cartoon' : '卡通') : pipeline === 'logo' ? (isEn ? 'Logo text' : 'Logo文字') : (isEn ? 'Photo' : '照片')}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-purple-500">{isEn ? 'Cartoon keeps clean blocks; Photo keeps gradients; Logo text protects strokes without dithering.' : '卡通保留轮廓和干净色块；照片保留渐变；Logo文字关闭抖动并保护笔画。'}</div>
      </div>

      {/* 3. Quantization, background and clarity controls */}
      <div className="space-y-3 pt-2 border-t border-purple-200/80">
        <label className="text-purple-900 font-extrabold flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-purple-600" />
          <span>{isEn ? 'Image processing' : '图像处理'}</span>
        </label>

        <div className="flex items-center gap-2 bg-purple-50/80 p-2.5 rounded-2xl border border-purple-200/80">
          <div>
            <span className="font-bold text-purple-950 text-[11px]">{isEn ? 'Color quantization' : '颜色量化'}</span>
            <p className="text-[10px] text-purple-500 leading-none mt-0.5">{isEn ? 'Always enabled for Cartoon, Photo and Logo modes.' : '卡通、照片和 Logo 三种模式均默认启用。'}</p>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-purple-600 font-medium">{isEn ? 'Keep detail ↔ Merge similar' : '保留细节 ↔ 合并相似'}</span>
            <span className="font-mono text-purple-700 font-extrabold">{Math.round(settings.quantizationStrength ?? 28)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.max(0, Math.min(100, settings.quantizationStrength ?? 28))}
            onChange={e => updateSetting('quantizationStrength', parseInt(e.target.value))}
            className="w-full accent-purple-600 cursor-pointer"
          />
        </div>

        <label className="flex items-center gap-2 bg-sky-50/80 p-2.5 rounded-2xl border border-sky-200/80 cursor-pointer hover:bg-sky-100/80 transition-colors">
          <input
            type="checkbox"
            checked={settings.backgroundRemovalEnabled === true}
            onChange={e => updateSetting('backgroundRemovalEnabled', e.target.checked)}
            className="w-4 h-4 accent-sky-600 rounded cursor-pointer"
          />
          <div>
            <span className="font-bold text-purple-950 text-[11px]">{isEn ? 'Remove background' : '背景移除'}</span>
            <p className="text-[10px] text-purple-500 leading-none mt-0.5">{isEn ? 'Reuse the current edge-connected background removal.' : '复用当前边缘连通背景移除能力。'}</p>
          </div>
        </label>

        <label className="flex items-center gap-2 bg-amber-50/80 p-2.5 rounded-2xl border border-amber-200/80 cursor-pointer hover:bg-amber-100/80 transition-colors">
          <input
            type="checkbox"
            checked={clarityEnabled}
            onChange={e => setSettings(prev => ({
              ...prev,
              sharpening: e.target.checked ? Math.max(40, prev.sharpening) : 0,
            }))}
            className="w-4 h-4 accent-amber-600 rounded cursor-pointer"
          />
          <div>
            <span className="font-bold text-purple-950 text-[11px]">{isEn ? 'Clarity optimization' : '清晰优化'}</span>
            <p className="text-[10px] text-purple-500 leading-none mt-0.5">{isEn ? 'Reuse edge sharpening to keep small details clear.' : '复用边缘锐化，让缩小后的细节更加清晰。'}</p>
          </div>
        </label>

        <label className="flex items-center gap-2 bg-purple-50/80 p-2.5 rounded-2xl border border-purple-200/80 cursor-pointer hover:bg-purple-100/80 transition-colors">
          <input
            type="checkbox"
            checked={settings.outlineBoost}
            onChange={e => updateSetting('outlineBoost', e.target.checked)}
            className="w-4 h-4 accent-purple-600 rounded cursor-pointer"
          />
          <div>
            <span className="font-bold text-purple-950 text-[11px]">{isEn ? 'Connected outline protection' : '连续边缘保护'}</span>
            <p className="text-[10px] text-purple-500 leading-none mt-0.5">{isEn ? 'Optional: connect dark outline cells around silhouettes and strong joins.' : '可选：将人物外轮廓、头身和手臂连接处生成连续深色描边。'}</p>
          </div>
        </label>
      </div>

      {/* 4. Brand Palette & Color Limit */}
      <div className="space-y-3 pt-2 border-t border-purple-200/80">
        <label className="text-purple-900 font-extrabold flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5 text-purple-600" />
          <span>{isEn ? 'Brand Palette & Color Limit' : '品牌色卡与色彩限制'}</span>
        </label>

        <div className="space-y-1">
          <span className="text-[10px] text-purple-600 font-medium">{isEn ? 'Selected Palette' : '选用拼豆色卡'}</span>
          <select
            value={settings.brand}
            disabled={brandCatalog.status !== 'ready'}
            onChange={e => updateSetting('brand', e.target.value as BrandKey)}
            className="w-full bg-purple-50/80 border border-purple-200 rounded-xl px-2.5 py-1.5 text-purple-950 text-xs outline-none focus:ring-2 focus:ring-purple-400/30 cursor-pointer font-bold"
          >
            {!brandOptions.some(option => option.key === settings.brand) && <option value={settings.brand} disabled>{settings.brand} · 当前图纸快照</option>}
            {brandOptions.map(({ key, name }) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
          {settings.brand === 'MARD_291' && (
            <div className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-800">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span>
                {isEn
                  ? 'P/Q/R/T/Y/ZG special materials use screen-reference colors only; pearl, fluorescent, and glow effects are not physically reproduced.'
                  : 'P/Q/R/T/Y/ZG 为特殊材质，珠光、荧光、夜光仅按屏幕参考匹配，不能代表实物效果。'}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <span className="text-[10px] text-purple-600 font-medium">{isEn ? 'Max Color Limit' : '最大使用颜色数量限制'}</span>
          <select
            value={settings.colorLimit}
            onChange={e => updateSetting('colorLimit', parseInt(e.target.value))}
            className="w-full bg-purple-50/80 border border-purple-200 rounded-xl px-2.5 py-1.5 text-purple-950 text-xs outline-none focus:ring-2 focus:ring-purple-400/30 cursor-pointer font-bold"
          >
            <option value={0}>{isEn ? 'Unlimited (Full Palette)' : '不限制 (智能全配卡)'}</option>
            <option value={12}>{isEn ? '12 Color Set' : '12 色套组'}</option>
            <option value={24}>{isEn ? '24 Color Set' : '24 色套组'}</option>
            <option value={36}>{isEn ? '36 Color Set' : '36 色套组'}</option>
            <option value={48}>{isEn ? '48 Color Set' : '48 色套组'}</option>
            <option value={72}>{isEn ? '72 Color Streamlined' : '72 色精简'}</option>
          </select>
        </div>
      </div>

      {/* 5. Dithering Mode */}
      <div className="space-y-2 pt-2 border-t border-purple-200/80">
        <label className="text-purple-900 font-extrabold flex items-center justify-between">
          <span>{isEn ? 'Dithering Algorithm' : '抖动色彩算法 (Dithering)'}</span>
        </label>
        <div className="grid grid-cols-2 gap-1">
          {[
            { id: 'none', label: isEn ? 'None (Clean)' : '无 (清晰)' },
            { id: 'floyd', label: isEn ? 'Floyd Soft' : 'Floyd 柔和' },
          ].map(d => (
            <button
              key={d.id}
              onClick={() => updateSetting('dither', d.id as DitherMode)}
              className={`py-1.5 px-2 rounded-xl border text-center transition-all cursor-pointer text-[11px] ${
                settings.dither === d.id
                  ? 'bg-purple-600 border-purple-600 text-white font-extrabold shadow-2xs'
                  : 'bg-purple-50/80 border-purple-200 text-purple-700 hover:bg-purple-100'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="space-y-1 pt-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-purple-600 font-medium">{isEn ? 'Floyd Strength' : 'Floyd 强度'}</span>
            <span className="font-mono text-purple-700 font-bold">{Math.round((settings.ditherStrength ?? 0.65) * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((settings.ditherStrength ?? 0.65) * 100)}
            onChange={e => updateSetting('ditherStrength', parseInt(e.target.value) / 100)}
            className="w-full accent-purple-600 cursor-pointer"
          />
        </div>
      </div>

      {/* Re-convert Trigger Button */}
      {hasImage && (
        <button
          onClick={onReconvert}
          className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-extrabold rounded-2xl shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95 mt-auto"
        >
          <Sparkles className="w-4 h-4 text-amber-300 fill-amber-300" />
          <span>{isEn ? 'Recompute Pattern' : '重新计算拼豆图纸'}</span>
        </button>
      )}
    </div>
  );
};
