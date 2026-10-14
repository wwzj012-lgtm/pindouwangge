import React, { useRef, useState } from 'react';
import {
  Sparkles,
  BookOpen,
  Crown,
  Globe,
  Upload,
  FolderOpen,
  FileJson,
  RotateCcw,
  Palette,
  LayoutGrid,
  Zap,
  Image as ImageIcon,
  ChevronRight,
  ChevronLeft,
  User,
  Share2,
  HelpCircle,
  Settings2,
  MoreHorizontal,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { consumeSelectedImageFile } from '../../utils/imageFileSelection';
import { AnnouncementBell } from '../AnnouncementBell';

export interface MobileHeaderNavProps {
  projectName: string;
  setProjectName: (name: string) => void;
  onImageUpload: (file: File) => void;
  onExportJson: () => void;
  onImportJson: (jsonStr: string) => void;
  onOpenGuideModal: () => void;
  onOpenAnnouncements?: () => void;
  hasUnreadAnnouncements?: boolean;
  onOpenSmartReduceModal?: () => void;
  onOpenPatternsModal?: () => void;
  onOpenPaletteModal?: () => void;
  onOpenAuthModal?: () => void;
  onOpenUserProfileModal?: () => void;
  onOpenVipModal?: () => void;
  onClearCanvas: () => void;
  currentTab: 'home' | 'community' | 'studio' | 'largeCanvas' | 'assembly';
  setCurrentTab: (tab: 'home' | 'community' | 'studio' | 'largeCanvas' | 'assembly') => void;
}

export const MobileHeaderNav: React.FC<MobileHeaderNavProps> = ({
  projectName,
  setProjectName,
  onImageUpload,
  onExportJson,
  onImportJson,
  onOpenGuideModal,
  onOpenAnnouncements,
  hasUnreadAnnouncements,
  onOpenSmartReduceModal,
  onOpenPatternsModal,
  onOpenPaletteModal,
  onOpenAuthModal,
  onOpenUserProfileModal,
  onOpenVipModal,
  onClearCanvas,
  currentTab,
  setCurrentTab,
}) => {
  const { currentUser, userProfile, isVip } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const isEn = language === 'en';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = consumeSelectedImageFile(e.target);
    if (file) onImageUpload(file);
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
      e.target.value = '';
    }
  };

  const accountName = userProfile?.displayName || currentUser?.displayName || (isEn ? 'Account' : '我的');
  const photoURL = userProfile?.photoURL || currentUser?.photoURL;

  return (
    <header className="sticky top-0 z-30 bg-white/98 backdrop-blur-md border-b border-purple-100/90 shadow-2xs select-none">
      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={jsonInputRef}
        type="file"
        accept=".json"
        onChange={handleJsonChange}
        className="hidden"
      />

      {/* Top Main Row */}
      <div className="flex items-center justify-between px-2.5 py-1.5 gap-1.5">
        {/* Left Side: Back Button (only for studio) & Brand Logo */}
        <div className="flex items-center gap-1 shrink-0">
          {currentTab === 'studio' && (
            <button
              type="button"
              onClick={() => setCurrentTab('home')}
              className="flex items-center gap-0.5 px-2 py-1 rounded-xl bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-900 font-black text-[11px] cursor-pointer active:scale-95 transition-all shrink-0 shadow-2xs"
              title={isEn ? 'Back to Home' : '返回首页'}
            >
              <ChevronLeft className="w-3.5 h-3.5 text-purple-700 stroke-[2.5]" />
              <span>{isEn ? 'Home' : '返回'}</span>
            </button>
          )}

          <div
            onClick={() => setCurrentTab('home')}
            className="flex items-center gap-1.5 cursor-pointer active:scale-95 transition-transform shrink-0"
          >
            <img
              src="/douzhixingge_logo.svg"
              alt="豆织星格 Logo"
              className="w-8 h-8 rounded-xl object-contain shadow-2xs shrink-0"
            />
            <div className={`flex flex-col ${currentTab === 'studio' ? 'max-[439px]:hidden' : ''}`}>
              <div className="flex items-center gap-1">
                <span className="text-xs sm:text-sm font-black text-slate-900 tracking-tight leading-none">
                  豆织<span className="text-purple-600">星格</span>
                </span>
                {isVip && (
                  <span className="px-1 py-0.2 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 text-white font-black text-[7px] shadow-2xs">
                    VIP
                  </span>
                )}
              </div>
              <span className="text-[8px] text-purple-600/80 font-bold leading-tight">
                {currentTab === 'studio'
                  ? (isEn ? 'Pixel Studio' : '拼豆画板')
                  : (isEn ? 'Bead Grid Studio' : '拼豆像素工作室')}
              </span>
            </div>
          </div>
        </div>

        {/* Right Corner: Quick Actions, Language & User Profile Avatar */}
        <div className="flex items-center gap-1.5 shrink-0">
          {onOpenAnnouncements && <AnnouncementBell onClick={onOpenAnnouncements} hasUnread={hasUnreadAnnouncements} />}
          <button
            onClick={() => onOpenVipModal?.()}
            className="flex items-center gap-1 px-2 py-1 rounded-full bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/80 text-amber-900 font-black text-[10px] shadow-2xs active:scale-95 cursor-pointer"
          >
            <Crown className="w-3 h-3 text-amber-500 fill-amber-400" />
            <span>VIP</span>
          </button>

          <button
            onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
            className="px-1.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-[10px] flex items-center justify-center cursor-pointer border border-slate-200 min-w-[28px]"
            title="Switch Language"
          >
            {language === 'zh' ? 'EN' : '中'}
          </button>

          {onOpenPatternsModal && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setIsOverflowMenuOpen(isOpen => !isOpen)}
                className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-full p-1 text-slate-700 transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2"
                aria-label={isEn ? 'Open more actions' : '打开更多操作'}
                aria-haspopup="menu"
                aria-expanded={isOverflowMenuOpen}
              >
                <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-100 transition-colors group-hover:bg-slate-200">
                  <MoreHorizontal className="h-5 w-5" />
                </span>
              </button>

              {isOverflowMenuOpen && (
                <div
                  className="absolute right-0 top-full z-40 mt-1 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                  role="menu"
                  aria-label={isEn ? 'More actions' : '更多操作'}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setIsOverflowMenuOpen(false);
                      onOpenPatternsModal();
                    }}
                    className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm font-bold text-slate-800 transition-colors hover:bg-purple-50 active:bg-purple-100"
                    role="menuitem"
                    aria-label={isEn ? 'My patterns' : '我的图纸'}
                  >
                    <FolderOpen className="h-5 w-5 shrink-0 text-purple-600" />
                    <span>{isEn ? 'My Patterns' : '我的图纸'}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => {
              if (currentUser) {
                if (onOpenUserProfileModal) onOpenUserProfileModal();
                else onOpenAuthModal?.();
              } else {
                onOpenAuthModal?.();
              }
            }}
            className="flex items-center gap-1 bg-purple-50 hover:bg-purple-100 border border-purple-200/80 p-0.5 pr-2 rounded-full cursor-pointer transition-all active:scale-95 shadow-2xs"
          >
            {photoURL ? (
              <img
                src={photoURL}
                alt="Avatar"
                className="w-5 h-5 rounded-full object-cover border border-purple-300 shrink-0"
              />
            ) : (
              <div className="w-5 h-5 rounded-full bg-purple-600 text-white font-black text-[9px] flex items-center justify-center shrink-0">
                {accountName[0]}
              </div>
            )}
            <span className="text-[10px] font-black text-purple-950 max-w-[48px] truncate">
              {accountName}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
