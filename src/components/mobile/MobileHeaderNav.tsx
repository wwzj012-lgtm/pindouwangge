import React, { useEffect, useRef, useState } from 'react';
import {
  Crown,
  Globe,
  FolderOpen,
  BookOpen,
  ChevronLeft,
  MoreHorizontal,
  User,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { consumeSelectedImageFile } from '../../utils/imageFileSelection';
import { AnnouncementBell } from '../AnnouncementBell';

export interface MobileHeaderNavProps {
  projectName: string;
  setProjectName: (name: string) => void;
  onImageUpload: (file: File) => void;
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

/**
 * Mobile top bar.
 *
 * Layout budget on a 360-390px phone only fits ~5 tap targets, so secondary
 * destinations (VIP, language, saved patterns, guide) live in the overflow
 * menu instead of competing with the primary row. Every target is 44x44.
 */
export const MobileHeaderNav: React.FC<MobileHeaderNavProps> = ({
  projectName,
  setProjectName,
  onImageUpload,
  onOpenGuideModal,
  onOpenAnnouncements,
  hasUnreadAnnouncements,
  onOpenPatternsModal,
  onOpenAuthModal,
  onOpenUserProfileModal,
  onOpenVipModal,
  onClearCanvas,
  currentTab,
  setCurrentTab,
}) => {
  const { currentUser, userProfile, isVip } = useAuth();
  const { language, setLanguage } = useLanguage();
  const isEn = language === 'en';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false);

  // Dismiss the overflow menu on outside tap or Escape, matching native menus.
  useEffect(() => {
    if (!isOverflowMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOverflowMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOverflowMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOverflowMenuOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = consumeSelectedImageFile(e.target);
    if (file) onImageUpload(file);
  };

  const accountName = userProfile?.displayName || currentUser?.displayName || (isEn ? 'Account' : '我的');
  const photoURL = userProfile?.photoURL || currentUser?.photoURL;
  const isStudio = currentTab === 'studio';
  // The subtitle orients the user instead of repeating the brand name: the
  // pattern being edited, or the section they are currently in. The assembly
  // tab intentionally has no entry point in navigation, so it falls back.
  const title = isStudio
    ? projectName
    : isEn
      ? ({
          home: 'Bead Grid Studio',
          community: 'Community',
          largeCanvas: 'Large canvas',
        }[currentTab] ?? 'Bead Grid Studio')
      : ({
          home: '拼豆像素工作室',
          community: '豆社作品广场',
          largeCanvas: '大画板',
        }[currentTab] ?? '拼豆像素工作室');

  const closeMenuThen = (action?: () => void) => () => {
    setIsOverflowMenuOpen(false);
    action?.();
  };

  const menuItemClass =
    'flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm font-bold text-slate-800 transition-colors hover:bg-purple-50 active:bg-purple-100';

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-purple-100/90 bg-white/95 pt-[var(--safe-top)] backdrop-blur-md select-none">
      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="flex h-14 items-center justify-between gap-1 px-1.5">
        {/* Left: back (studio only) + brand / current pattern title */}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {isStudio && (
            <button
              type="button"
              onClick={() => setCurrentTab('home')}
              className="inline-flex h-11 shrink-0 items-center gap-0.5 rounded-xl px-1.5 text-purple-700 transition-colors active:bg-purple-50"
              aria-label={isEn ? 'Back to home' : '返回首页'}
              title={isEn ? 'Back to home' : '返回首页'}
            >
              <ChevronLeft className="h-5 w-5 stroke-[2.5]" aria-hidden="true" />
              <span className="text-xs font-bold">{isEn ? 'Home' : '返回'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setCurrentTab('home')}
            className="flex h-11 min-w-0 items-center gap-1.5 rounded-xl pr-1 text-left transition-transform active:scale-[0.98]"
          >
            <img
              src="/douzhixingge_logo.svg"
              alt=""
              aria-hidden="true"
              className="h-8 w-8 shrink-0 rounded-xl object-contain"
            />
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1">
                <span className="truncate text-[13px] font-black leading-tight tracking-tight text-slate-900">
                  豆织<span className="text-purple-600">星格</span>
                </span>
                {isVip && (
                  <span className="shrink-0 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 px-1 text-[10px] font-black leading-4 text-white">
                    VIP
                  </span>
                )}
              </span>
              <span className="truncate text-[11px] font-medium leading-tight text-slate-500">
                {title}
              </span>
            </span>
          </button>
        </div>

        {/* Right: notifications + overflow menu + account */}
        <div className="flex shrink-0 items-center gap-0.5">
          {onOpenAnnouncements && (
            <div className="flex h-11 w-11 items-center justify-center">
              <AnnouncementBell onClick={onOpenAnnouncements} hasUnread={hasUnreadAnnouncements} />
            </div>
          )}

          {onOpenPatternsModal && (
            <div className="relative shrink-0" ref={menuRef}>
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
                  className="absolute right-0 top-full z-40 mt-1 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-xl"
                  role="menu"
                  aria-label={isEn ? 'More actions' : '更多操作'}
                >
                  <button
                    type="button"
                    onClick={closeMenuThen(onOpenPatternsModal)}
                    className={menuItemClass}
                    role="menuitem"
                    aria-label={isEn ? 'My patterns' : '我的图纸'}
                  >
                    <FolderOpen className="h-5 w-5 shrink-0 text-purple-600" aria-hidden="true" />
                    <span>{isEn ? 'My Patterns' : '我的图纸'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={closeMenuThen(onOpenGuideModal)}
                    className={menuItemClass}
                    role="menuitem"
                  >
                    <BookOpen className="h-5 w-5 shrink-0 text-purple-600" aria-hidden="true" />
                    <span>{isEn ? 'User guide' : '使用指南'}</span>
                  </button>
                  {onOpenVipModal && (
                    <button
                      type="button"
                      onClick={closeMenuThen(onOpenVipModal)}
                      className={menuItemClass}
                      role="menuitem"
                    >
                      <Crown className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
                      <span>{isEn ? 'Membership' : '会员权益'}</span>
                    </button>
                  )}
                  <div className="my-1 h-px bg-slate-100" role="separator" />
                  <button
                    type="button"
                    onClick={closeMenuThen(() => setLanguage(language === 'zh' ? 'en' : 'zh'))}
                    className={menuItemClass}
                    role="menuitem"
                  >
                    <Globe className="h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
                    <span className="flex-1">{isEn ? 'Language' : '界面语言'}</span>
                    <span className="text-xs font-bold text-slate-400">
                      {language === 'zh' ? '中文' : 'EN'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              if (currentUser) {
                if (onOpenUserProfileModal) onOpenUserProfileModal();
                else onOpenAuthModal?.();
              } else {
                onOpenAuthModal?.();
              }
            }}
            className="inline-flex h-11 items-center gap-1 rounded-full pl-0.5 pr-2 transition-colors active:bg-purple-50"
            aria-label={
              currentUser
                ? (isEn ? `Account: ${accountName}` : `账号：${accountName}`)
                : (isEn ? 'Sign in' : '登录')
            }
          >
            {photoURL ? (
              <img
                src={photoURL}
                alt=""
                aria-hidden="true"
                className="h-8 w-8 shrink-0 rounded-full border border-purple-300 object-cover"
              />
            ) : currentUser ? (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-600 text-sm font-black text-white">
                {accountName[0]}
              </span>
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <User className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <span className="max-w-[56px] truncate text-[11px] font-bold text-slate-700">
              {currentUser ? accountName : (isEn ? 'Login' : '登录')}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
