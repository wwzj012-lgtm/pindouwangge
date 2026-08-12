import React, { useRef, useState } from 'react';
import {
  Upload,
  Download,
  FolderOpen,
  FileJson,
  Image as ImageIcon,
  RotateCcw,
  BookOpen,
  Zap,
  Crown,
  Store,
  User,
  Menu,
  X,
  Globe,
  Loader2,
} from 'lucide-react';
import { BRAND_NAMES } from '../data/palettes';
import { SAMPLE_IMAGES } from '../data/samples';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

interface HeaderProps {
  projectName: string;
  setProjectName: (name: string) => void;
  onImageUpload: (file: File) => void;
  onLoadSample: (sampleUrl: string) => void;
  onExportJson: () => void;
  onImportJson: (jsonStr: string) => void;
  onOpenExportModal: () => void;
  onOpenGuideModal: () => void;
  onOpenSmartReduceModal?: () => void;
  onOpenPatternsModal?: () => void;
  onOpenAuthModal?: () => void;
  onOpenVipModal?: () => void;
  onClearCanvas: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  projectName,
  setProjectName,
  onImageUpload,
  onLoadSample,
  onExportJson,
  onImportJson,
  onOpenExportModal,
  onOpenGuideModal,
  onOpenSmartReduceModal,
  onOpenPatternsModal,
  onOpenAuthModal,
  onOpenVipModal,
  onClearCanvas,
}) => {
  const { currentUser, userProfile, loading: authLoading, isVip, isPro } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const isEn = language === 'en';
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
              {t('appName')}
            </span>
            {onOpenVipModal && (
              <button
                onClick={onOpenVipModal}
                className={`border text-[9px] font-black px-1.5 py-0.5 rounded transition-colors ${
                  isPro
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/50'
                    : isVip
                    ? 'bg-purple-500/15 text-purple-300 border-purple-500/50'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
                title={isEn ? 'View membership benefits' : '查看当前会员权益'}
              >
                {isPro ? (isEn ? 'MERCHANT · 40%' : '商家VIP · 40%省豆') : isVip ? (isEn ? 'VIP · 15/25%' : 'VIP · 15/25%省豆') : (isEn ? 'FREE' : '免费版')}
              </button>
            )}
          </div>
        </div>

        {/* Right Corner Controls for Mobile & All Devices */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onOpenGuideModal}
            className="hidden md:flex p-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white"
            title={isEn ? 'Guide' : '使用指南'}
          >
            <BookOpen className="w-3.5 h-3.5" />
          </button>
          {/* Language Toggle Button */}
          <button
            onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
            className="text-xs font-bold px-2 py-1.5 sm:px-2.5 sm:py-2 rounded-xl flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all cursor-pointer shrink-0 active:scale-95"
            title={language === 'zh' ? 'Switch to English' : '切换为中文'}
          >
            <Globe className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>{language === 'zh' ? 'EN' : '中文'}</span>
          </button>

          {/* User Account & VIP Button */}
          {onOpenAuthModal && (
            <button
              onClick={onOpenAuthModal}
              className={`text-xs font-bold px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95 border ${
                isPro
                  ? 'bg-gradient-to-r from-amber-950 via-slate-900 to-amber-950 text-amber-300 border-amber-500/60 hover:brightness-125 shadow-md shadow-amber-500/20'
                  : isVip
                  ? 'bg-gradient-to-r from-amber-500/20 via-amber-600/30 to-amber-500/20 text-amber-300 border-amber-500/50 hover:brightness-125 shadow-md shadow-amber-500/10'
                  : currentUser
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  : 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black border-amber-400 hover:brightness-110 shadow'
              }`}
              title={currentUser ? '个人账号与会员中心' : '登录账号解锁 VIP / 商家Pro 权限'}
            >
              {authLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                  <span className="text-[11px] font-bold text-slate-300">{isEn ? 'Syncing...' : '账号同步中'}</span>
                </>
              ) : isPro ? (
                <>
                  <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0 fill-amber-400" />
                  <Store className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span className="hidden sm:inline font-black">{t('proMember')}</span>
                  <span className="sm:hidden text-[10px] font-black">{t('proTag')}</span>
                </>
              ) : isVip ? (
                <>
                  <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0 fill-current" />
                  <span className="hidden sm:inline">{t('vipMember')}</span>
                  <span className="sm:hidden text-[10px]">{t('vipMember')}</span>
                </>
              ) : currentUser ? (
                <>
                  <User className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                  <span className="truncate max-w-[80px] sm:max-w-none">
                    {userProfile?.displayName || t('personalCenter')}
                  </span>
                </>
              ) : (
                <>
                  <Crown className="w-3.5 h-3.5 shrink-0 fill-current" />
                  <span>{t('loginActivate')}</span>
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
        {/* Exported Pattern History Records Button */}
        {onOpenPatternsModal && (
          <button
            onClick={onOpenPatternsModal}
            className="bg-slate-800 hover:bg-slate-700 text-purple-300 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-purple-500/30 flex items-center gap-1 transition-all cursor-pointer shadow-sm shrink-0 whitespace-nowrap active:scale-95"
            title={language === 'zh' ? '查看可继续编辑的拼豆图纸记录' : 'View editable pattern history'}
          >
            <ImageIcon className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span>{language === 'zh' ? '图纸记录' : 'History'}</span>
          </button>
        )}

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
          <span>{t('uploadImage')}</span>
        </button>

        {/* Smart Bead Reducer Studio Button */}
        {onOpenSmartReduceModal && (
          <button
            onClick={onOpenSmartReduceModal}
            className="bg-gradient-to-r from-sky-600 via-indigo-600 to-purple-600 hover:brightness-110 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg shadow-md shadow-sky-500/20 flex items-center gap-1 transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95 ring-1 ring-sky-400/40"
            title={isEn ? 'Feature-preserving bead saving: VIP 15/25%, Merchant VIP 40%' : '特征保真省豆：VIP 15%/25%，商家VIP 40%'}
          >
            <Zap className="w-3.5 h-3.5 shrink-0 fill-current text-amber-300 animate-pulse" />
            <span>{t('smartReduce')}</span>
          </button>
        )}



        {/* High-Res Tutorial Export */}
        <button
          onClick={onOpenExportModal}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-md shadow-emerald-600/20 flex items-center gap-1 transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95"
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>{t('exportPattern')}</span>
        </button>

        {/* Clear */}
        <button
          onClick={onClearCanvas}
          className="bg-slate-800/80 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 p-2 rounded-lg border border-slate-700/80 transition-colors cursor-pointer shrink-0"
          title={t('clearCanvas')}
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
              <span className="font-black text-white text-base">{t('appName')} · {language === 'zh' ? '功能菜单' : 'Menu'}</span>
            </div>
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 cursor-pointer min-h-[48px] min-w-[48px] flex items-center justify-center"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-4 space-y-3">
            {/* Upload Image */}
            <button
              onClick={() => {
                setIsMobileMenuOpen(false);
                fileInputRef.current?.click();
              }}
              className="w-full p-3.5 rounded-xl bg-rose-600 text-white font-bold text-xs flex items-center gap-3 cursor-pointer min-h-[48px] active:scale-98"
            >
              <Upload className="w-5 h-5" />
              <span>{t('uploadImage')}</span>
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
                <span>{t('openProject')}</span>
              </button>

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onExportJson();
                }}
                className="p-3.5 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer min-h-[48px]"
              >
                <FileJson className="w-4 h-4 text-emerald-400" />
                <span>{t('saveProject')}</span>
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
              <span>{t('guide')}</span>
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
              <span>{t('clearCanvas')}</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
