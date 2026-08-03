import React, { useRef, useState } from 'react';
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
  Zap,
  Crown,
  User,
  Menu,
  X,
  ShieldCheck,
} from 'lucide-react';
import { BrandKey, ConvertSettings } from '../types';
import { BRAND_NAMES, BOARD_PRESETS } from '../data/palettes';
import { SAMPLE_IMAGES } from '../data/samples';
import { useAuth } from '../context/AuthContext';

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
  onOpenSmartReduceModal?: () => void;
  onOpenAuthModal?: () => void;
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
  onOpenSmartReduceModal,
  onOpenAuthModal,
  onClearCanvas,
  settings,
  setSettings,
}) => {
  const { currentUser, userProfile, isVip, isAdmin } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
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
    <header className="bg-slate-900 border-b border-slate-800 text-white px-3 py-2 md:px-4 md:py-2.5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2 shadow-md sticky top-0 z-30">
      {/* Top Row / Main Header Row */}
      <div className="flex items-center justify-between gap-2">
        {/* Brand & Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl overflow-hidden bg-purple-950/60 border border-purple-500/40 flex items-center justify-center shadow-md shadow-purple-500/20 shrink-0">
            <img
              src="/douzhixingge_logo.svg"
              alt="豆织星格图标"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-base md:text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-300 via-rose-200 to-amber-200 tracking-wide select-none whitespace-nowrap">
              豆织星格
            </span>
            <span className="bg-purple-950/80 text-purple-300 border border-purple-700/60 text-[9px] font-bold px-1.5 py-0.5 rounded">
              PRO
            </span>
          </div>
        </div>

        {/* Desktop & Tablet Brand Palette Selector */}
        <div className="hidden md:flex items-center gap-1.5 text-xs">
          <div className="flex items-center gap-1 bg-slate-800/90 border border-slate-700/80 rounded-lg px-2 py-1 shrink-0">
            <Palette className="w-3.5 h-3.5 text-pink-400 shrink-0" />
            <select
              value={brand}
              onChange={e => {
                const newBrand = e.target.value as BrandKey;
                setBrand(newBrand);
                setSettings(s => ({ ...s, brand: newBrand }));
              }}
              className="bg-transparent text-slate-200 outline-none cursor-pointer font-medium text-xs max-w-[120px] xl:max-w-none truncate"
            >
              {Object.entries(BRAND_NAMES).map(([key, name]) => (
                <option key={key} value={key} className="bg-slate-800 text-white">
                  {name}
                </option>
              ))}
            </select>
          </div>

          {/* Quick Board Size Selector (Desktop XL) */}
          <div className="hidden xl:flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/80 rounded-lg px-2.5 py-1 shrink-0">
            <span className="text-slate-400 text-xs whitespace-nowrap">拼豆板:</span>
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
              className="bg-transparent text-slate-200 outline-none cursor-pointer font-medium text-xs"
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
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded-lg border border-slate-700 flex items-center gap-1 transition-colors cursor-pointer shrink-0 whitespace-nowrap text-xs"
            title="管理与禁用色卡"
          >
            <Palette className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="hidden xl:inline">自定义色板</span>
            <span className="xl:hidden text-[11px]">色板</span>
          </button>
        </div>

        {/* Right Corner Controls for Mobile & All Devices */}
        <div className="flex items-center gap-1.5">
          {/* User Account & VIP Button */}
          {onOpenAuthModal && (
            <button
              onClick={onOpenAuthModal}
              className={`text-xs font-bold px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95 border ${
                isVip
                  ? 'bg-gradient-to-r from-amber-500/20 via-amber-600/30 to-amber-500/20 text-amber-300 border-amber-500/50 hover:brightness-125 shadow-md shadow-amber-500/10'
                  : currentUser
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  : 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black border-amber-400 hover:brightness-110 shadow'
              }`}
              title={currentUser ? '个人账号与VIP管理' : '登录账号解锁PRO VIP权限'}
            >
              {isVip ? (
                <>
                  <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0 fill-current" />
                  <span className="hidden sm:inline">PRO VIP</span>
                  <span className="sm:hidden text-[10px]">VIP</span>
                </>
              ) : currentUser ? (
                <>
                  <User className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                  <span className="truncate max-w-[80px] sm:max-w-none">
                    {userProfile?.displayName || '个人中心'}
                  </span>
                </>
              ) : (
                <>
                  <Crown className="w-3.5 h-3.5 shrink-0 fill-current" />
                  <span>登录/激活</span>
                </>
              )}
            </button>
          )}

          {/* Mobile Hamburger Toggle Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700 cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center active:scale-95"
            aria-label="打开导航菜单"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Action Buttons Row for Tablet & Desktop (>= md) */}
      <div className="hidden md:flex items-center justify-end gap-1.5 overflow-x-auto scrollbar-none">
        {/* Operation Guide Button */}
        <button
          onClick={onOpenGuideModal}
          className="bg-purple-950/90 hover:bg-purple-900 text-purple-200 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-purple-700/80 flex items-center gap-1 transition-all cursor-pointer shadow-sm shrink-0 whitespace-nowrap active:scale-95"
          title="查看拼豆设计操作指南"
        >
          <BookOpen className="w-3.5 h-3.5 text-purple-300 shrink-0" />
          <span className="hidden xl:inline">指南</span>
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
          className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg shadow-md shadow-rose-600/20 flex items-center gap-1 transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95"
        >
          <Upload className="w-3.5 h-3.5 shrink-0" />
          <span>上传图片</span>
        </button>

        {/* Smart Bead Reducer Studio Button */}
        {onOpenSmartReduceModal && (
          <button
            onClick={onOpenSmartReduceModal}
            className="bg-gradient-to-r from-sky-600 via-indigo-600 to-purple-600 hover:brightness-110 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg shadow-md shadow-sky-500/20 flex items-center gap-1 transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95 ring-1 ring-sky-400/40"
            title="智能扣除无用背景与降格微调，真实减少使用拼豆总数(省豆20%~50%)"
          >
            <Zap className="w-3.5 h-3.5 shrink-0 fill-current text-amber-300 animate-pulse" />
            <span>智能减粒省豆</span>
          </button>
        )}

        {/* Built-in Samples Dropdown */}
        <div className="relative group shrink-0">
          <button className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap">
            <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>示例</span>
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
                <ImageIcon className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span className="truncate">{s.name}</span>
                <span className="ml-auto text-[10px] text-slate-400 shrink-0">{s.category}</span>
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
          className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          title="打开工程"
        >
          <FolderOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="hidden xl:inline">打开工程</span>
        </button>

        {/* Save JSON Project */}
        <button
          onClick={onExportJson}
          className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          title="保存工程"
        >
          <FileJson className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="hidden xl:inline">保存工程</span>
        </button>

        {/* High-Res Tutorial Export */}
        <button
          onClick={onOpenExportModal}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-md shadow-emerald-600/20 flex items-center gap-1 transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95"
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>导出图纸</span>
        </button>

        {/* Clear */}
        <button
          onClick={onClearCanvas}
          className="bg-slate-800/80 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 p-2 rounded-lg border border-slate-700/80 transition-colors cursor-pointer shrink-0"
          title="清空画布"
        >
          <RotateCcw className="w-3.5 h-3.5 shrink-0" />
        </button>
      </div>

      {/* Mobile Drawer Navigation overlay (< md) */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col p-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-purple-950 border border-purple-500/40 flex items-center justify-center">
                <img src="/douzhixingge_logo.svg" alt="logo" className="w-full h-full" />
              </div>
              <span className="font-black text-white text-base">豆织星格 · 功能菜单</span>
            </div>
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 cursor-pointer min-h-[48px] min-w-[48px] flex items-center justify-center"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-4 space-y-3">
            {/* Brand Palette selector on Mobile */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-2">
                <Palette className="w-4 h-4 text-pink-400" />
                <span>选择色卡品牌</span>
              </label>
              <select
                value={brand}
                onChange={e => {
                  const newBrand = e.target.value as BrandKey;
                  setBrand(newBrand);
                  setSettings(s => ({ ...s, brand: newBrand }));
                }}
                className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white outline-none cursor-pointer font-bold min-h-[48px]"
              >
                {Object.entries(BRAND_NAMES).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {/* Smart Bead Reducer */}
            {onOpenSmartReduceModal && (
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onOpenSmartReduceModal();
                }}
                className="w-full p-3.5 rounded-xl bg-gradient-to-r from-sky-600 via-indigo-600 to-purple-600 text-white font-bold text-sm shadow-lg flex items-center justify-between cursor-pointer min-h-[48px] active:scale-98"
              >
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 fill-current text-amber-300 animate-pulse" />
                  <span>PRO 智能减粒省豆引擎</span>
                </div>
                <span className="text-xs bg-amber-400 text-slate-950 px-2 py-0.5 rounded font-black">
                  省豆20%~50%
                </span>
              </button>
            )}

            {/* Upload Image */}
            <button
              onClick={() => {
                setIsMobileMenuOpen(false);
                fileInputRef.current?.click();
              }}
              className="w-full p-3.5 rounded-xl bg-rose-600 text-white font-bold text-xs flex items-center gap-3 cursor-pointer min-h-[48px] active:scale-98"
            >
              <Upload className="w-5 h-5" />
              <span>上传原图并转换拼豆</span>
            </button>

            {/* Export Tutorial */}
            <button
              onClick={() => {
                setIsMobileMenuOpen(false);
                onOpenExportModal();
              }}
              className="w-full p-3.5 rounded-xl bg-emerald-600 text-white font-bold text-xs flex items-center gap-3 cursor-pointer min-h-[48px] active:scale-98"
            >
              <Download className="w-5 h-5" />
              <span>导出高清图纸与材料清单</span>
            </button>

            {/* Manage Palette */}
            <button
              onClick={() => {
                setIsMobileMenuOpen(false);
                onOpenPaletteModal();
              }}
              className="w-full p-3.5 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 font-bold text-xs flex items-center gap-3 cursor-pointer min-h-[48px] active:scale-98"
            >
              <Palette className="w-5 h-5 text-amber-400" />
              <span>自定义色板与屏蔽禁用色号</span>
            </button>

            {/* Open & Save Project */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  jsonInputRef.current?.click();
                }}
                className="p-3.5 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer min-h-[48px]"
              >
                <FolderOpen className="w-4 h-4 text-blue-400" />
                <span>打开工程</span>
              </button>

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onExportJson();
                }}
                className="p-3.5 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer min-h-[48px]"
              >
                <FileJson className="w-4 h-4 text-emerald-400" />
                <span>保存工程</span>
              </button>
            </div>

            {/* Design Guide */}
            <button
              onClick={() => {
                setIsMobileMenuOpen(false);
                onOpenGuideModal();
              }}
              className="w-full p-3.5 rounded-xl bg-purple-950/80 text-purple-200 border border-purple-700/60 font-bold text-xs flex items-center gap-3 cursor-pointer min-h-[48px]"
            >
              <BookOpen className="w-5 h-5 text-purple-300" />
              <span>拼豆设计操作指南</span>
            </button>

            {/* Clear Canvas */}
            <button
              onClick={() => {
                setIsMobileMenuOpen(false);
                onClearCanvas();
              }}
              className="w-full p-3.5 rounded-xl bg-slate-900 hover:bg-rose-950 text-slate-400 hover:text-rose-400 border border-slate-800 font-bold text-xs flex items-center gap-3 cursor-pointer min-h-[48px]"
            >
              <RotateCcw className="w-5 h-5" />
              <span>清空画布图纸</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
