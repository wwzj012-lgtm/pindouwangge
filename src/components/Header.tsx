import React, { useRef } from 'react';
import {
  Grid,
  Upload,
  Download,
  FolderOpen,
  FileJson,
  Sparkles,
  Palette,
  Image as ImageIcon,
  RotateCcw,
  BookOpen,
} from 'lucide-react';
import { BrandKey, ConvertSettings } from '../types';
import { BRAND_NAMES, BOARD_PRESETS } from '../data/palettes';
import { SAMPLE_IMAGES } from '../data/samples';

interface HeaderProps {
  projectName: string;
  setProjectName: (name: string) => void;
  brand: BrandKey;
  setBrand: (brand: BrandKey) => void;
  onImageUpload: (file: File) => void;
  onLoadSample: (sampleUrl: string) => void;
  onExportJson: () => void;
  onImportJson: (jsonStr: string) => void;
  onOpenExportModal: () => void;
  onOpenPaletteModal: () => void;
  onOpenGuideModal: () => void;
  onClearCanvas: () => void;
  settings: ConvertSettings;
  setSettings: React.Dispatch<React.SetStateAction<ConvertSettings>>;
}

export const Header: React.FC<HeaderProps> = ({
  projectName,
  setProjectName,
  brand,
  setBrand,
  onImageUpload,
  onLoadSample,
  onExportJson,
  onImportJson,
  onOpenExportModal,
  onOpenPaletteModal,
  onOpenGuideModal,
  onClearCanvas,
  settings,
  setSettings,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onImageUpload(e.target.files[0]);
    }
  };

  const handleJsonChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = evt => {
        if (evt.target?.result) {
          onImportJson(evt.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-md sticky top-0 z-30">
      {/* Brand & Project Title (Fixed non-editable "豆织星格") */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl overflow-hidden bg-purple-950/60 border border-purple-500/40 flex items-center justify-center shadow-lg shadow-purple-500/20 shrink-0">
          <img
            src="/douzhixingge_logo.svg"
            alt="豆织星格图标"
            className="w-full h-full object-cover"
          />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-300 via-rose-200 to-amber-200 tracking-wide select-none">
              豆织星格
            </span>
            <span className="bg-purple-950/80 text-purple-300 border border-purple-700/60 text-[10px] font-bold px-1.5 py-0.2 rounded hidden md:inline">
              PRO
            </span>
          </div>
          <p className="text-xs text-slate-400 hidden sm:block">
            拼豆图纸网格编辑器
          </p>
        </div>
      </div>

      {/* Preset Quick Size & Brand Selector */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        {/* Brand Selector */}
        <div className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/80 rounded-lg px-2.5 py-1.5">
          <Palette className="w-3.5 h-3.5 text-pink-400" />
          <span className="text-slate-400 hidden md:inline">品牌色卡:</span>
          <select
            value={brand}
            onChange={e => {
              const newBrand = e.target.value as BrandKey;
              setBrand(newBrand);
              setSettings(s => ({ ...s, brand: newBrand }));
            }}
            className="bg-transparent text-slate-200 outline-none cursor-pointer font-medium"
          >
            {Object.entries(BRAND_NAMES).map(([key, name]) => (
              <option key={key} value={key} className="bg-slate-800 text-white">
                {name}
              </option>
            ))}
          </select>
        </div>

        {/* Quick Board Size Selector */}
        <div className="hidden lg:flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/80 rounded-lg px-2.5 py-1.5">
          <span className="text-slate-400">拼豆板:</span>
          <select
            value={`${settings.width}x${settings.height}`}
            onChange={e => {
              const preset = BOARD_PRESETS.find(p => `${p.width}x${p.height}` === e.target.value);
              if (preset) {
                setSettings(s => ({
                  ...s,
                  width: preset.width,
                  height: preset.height,
                  boardSize: preset.boardSize,
                }));
              }
            }}
            className="bg-transparent text-slate-200 outline-none cursor-pointer font-medium"
          >
            {BOARD_PRESETS.map(p => (
              <option key={p.name} value={`${p.width}x${p.height}`} className="bg-slate-800 text-white">
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={onOpenPaletteModal}
          className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
          title="管理与禁用色卡"
        >
          <Palette className="w-3.5 h-3.5 text-amber-400" />
          <span>自定义色板</span>
        </button>
      </div>

      {/* Action Buttons: Import, Samples, Save/Export */}
      <div className="flex items-center gap-2">
        {/* Operation Guide Button */}
        <button
          onClick={onOpenGuideModal}
          className="bg-purple-950/90 hover:bg-purple-900 text-purple-200 text-xs font-bold px-2.5 py-2 rounded-lg border border-purple-700/80 flex items-center gap-1.5 transition-all cursor-pointer shadow-md shadow-purple-950/40 active:scale-95"
          title="查看简体中文版拼豆设计操作指南"
        >
          <BookOpen className="w-3.5 h-3.5 text-purple-300" />
          <span>操作指南</span>
        </button>

        {/* Upload Image Button */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-md shadow-rose-600/20 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
        >
          <Upload className="w-4 h-4" />
          <span>上传图片转换</span>
        </button>

        {/* Built-in Samples Dropdown */}
        <div className="relative group">
          <button className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium px-2.5 py-2 rounded-lg border border-slate-700 flex items-center gap-1 transition-colors cursor-pointer">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">示例图案</span>
          </button>

          {/* Dropdown Menu */}
          <div className="absolute right-0 top-full mt-1.5 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-xl py-2 hidden group-hover:block z-50">
            <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              加载预设样本
            </div>
            {SAMPLE_IMAGES.map(s => (
              <button
                key={s.id}
                onClick={() => onLoadSample(s.url)}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2 transition-colors cursor-pointer"
              >
                <ImageIcon className="w-3.5 h-3.5 text-rose-400" />
                <span>{s.name}</span>
                <span className="ml-auto text-[10px] text-slate-400">{s.category}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Import JSON */}
        <input
          type="file"
          ref={jsonInputRef}
          onChange={handleJsonChange}
          accept=".json,.perler"
          className="hidden"
        />
        <button
          onClick={() => jsonInputRef.current?.click()}
          className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-2.5 py-2 rounded-lg border border-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
          title="打开保存的项目工程"
        >
          <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
          <span className="hidden md:inline">打开工程</span>
        </button>

        {/* Save JSON Project */}
        <button
          onClick={onExportJson}
          className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-2.5 py-2 rounded-lg border border-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
          title="导出.perler保存项目工程"
        >
          <FileJson className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden md:inline">保存工程</span>
        </button>

        {/* High-Res Tutorial Export */}
        <button
          onClick={onOpenExportModal}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-md shadow-emerald-600/20 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
        >
          <Download className="w-4 h-4" />
          <span>导出拼豆图纸</span>
        </button>

        {/* Clear */}
        <button
          onClick={onClearCanvas}
          className="bg-slate-800/80 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 p-2 rounded-lg border border-slate-700/80 transition-colors cursor-pointer"
          title="清空画布"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
