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
  Cpu,
  Palette,
  LayoutGrid,
  Search,
  Coins,
  Gift,
} from 'lucide-react';
import { BRAND_NAMES } from '../data/palettes';
import { SAMPLE_IMAGES } from '../data/samples';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { consumeSelectedImageFile } from '../utils/imageFileSelection';

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
  onOpenPaletteModal?: () => void;
  onOpenAuthModal?: () => void;
  onOpenUserProfileModal?: () => void;
  onOpenVipModal?: () => void;
  onClearCanvas: () => void;
  currentTab?: 'home' | 'community' | 'studio' | 'largeCanvas' | 'assembly';
  setCurrentTab?: (tab: 'home' | 'community' | 'studio' | 'largeCanvas' | 'assembly') => void;
  onImportPattern?: () => void;
}

interface HeaderAccountTriggerProps {
  isAuthenticated: boolean;
  displayName: string | null;
  photoURL: string | null;
  onOpenAuthModal?: () => void;
  onOpenUserProfileModal?: () => void;
  loginLabel: string;
}

export const HeaderAccountTrigger: React.FC<HeaderAccountTriggerProps> = ({
  isAuthenticated,
  displayName,
  photoURL,
  onOpenAuthModal,
  onOpenUserProfileModal,
  loginLabel,
}) => {
  if (!isAuthenticated) {
    return (
      <button
        onClick={onOpenAuthModal}
        className="flex items-center gap-1.5 rounded-full bg-purple-100/90 px-2 py-1 text-xs font-bold text-purple-950 border border-purple-200/80 transition-all cursor-pointer shadow-2xs hover:bg-purple-200 hover:scale-102 active:scale-95 sm:px-3"
        title={loginLabel}
      >
        <User className="w-4 h-4 shrink-0" />
        <span className="hidden sm:inline">{loginLabel}</span>
      </button>
    );
  }

  const accountName = displayName?.trim() || '账户';
  return (
    <button
      onClick={() => {
        if (onOpenUserProfileModal) onOpenUserProfileModal();
        else onOpenAuthModal?.();
      }}
      className="flex items-center gap-1.5 rounded-full bg-purple-100/90 px-2 py-1 text-xs font-bold text-purple-950 border border-purple-200/80 transition-all cursor-pointer shadow-2xs hover:bg-purple-200 hover:scale-102 active:scale-95 sm:px-3"
      title="点击进入个人中心"
    >
      {photoURL ? (
        <img src={photoURL} alt="Avatar" className="w-5 h-5 rounded-full object-cover border border-purple-300 shrink-0" />
      ) : (
        <div className="w-5 h-5 rounded-full bg-purple-600 text-white font-black text-[10px] flex items-center justify-center shrink-0">
          {accountName[0]}
        </div>
      )}
      <span className="hidden max-w-[95px] truncate font-extrabold sm:inline">{accountName}</span>
    </button>
  );
};

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
  onOpenPaletteModal,
  onOpenAuthModal,
  onOpenUserProfileModal,
  onOpenVipModal,
  onClearCanvas,
  currentTab = 'home',
  setCurrentTab,
  onImportPattern,
}) => {
  const {
    currentUser,
    userProfile,
    loading: authLoading,
    isVip,
    isPro,
    creditSummary,
    refreshCreditSummary,
    checkinCredits,
  } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const isEn = language === 'en';
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [headerSearchQuery, setHeaderSearchQuery] = useState('');
  const [checkinPending, setCheckinPending] = useState(false);
  const [checkinMessage, setCheckinMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

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
    }
  };

  // The Worker returns the spendable balance as `availableUnits` (with
  // `heldUnits` reported separately). Keep the legacy fields as a fallback so
  // an older deployment does not make a signed-in account appear empty.
  const availableCreditUnits = creditSummary
    ? Number.isFinite(creditSummary.availableUnits)
      ? Math.max(0, Number(creditSummary.availableUnits))
      : Math.max(0, Number(creditSummary.balanceUnits ?? 0) - Number(creditSummary.heldUnits ?? 0))
    : 0;
  const availablePoints = (availableCreditUnits / 10).toFixed(1);
  const checkin = creditSummary?.checkin;
  const nextRewardUnits = Number(checkin?.nextRewardUnits ?? creditSummary?.nextCheckinUnits ?? 0);
  const checkinPoints = creditSummary ? (Number.isFinite(nextRewardUnits) ? (nextRewardUnits / 10).toFixed(1) : '0.0') : '0.0';
  const checkinAvailable = Boolean(creditSummary && (checkin?.eligible ?? checkin?.completed !== true));

  const handleCheckin = async (): Promise<void> => {
    if (!currentUser) {
      onOpenAuthModal?.();
      return;
    }
    if (checkinPending) {
      return;
    }
    if (!creditSummary) {
      setCheckinMessage('积分信息加载中');
      void refreshCreditSummary();
      window.setTimeout(() => setCheckinMessage(null), 2400);
      return;
    }
    if (!checkinAvailable) {
      setCheckinMessage('今日已签到');
      return;
    }
    setCheckinPending(true);
    setCheckinMessage(null);
    try {
      const result = await checkinCredits();
      if (result.success) {
        const granted = typeof result.grantedUnits === 'number'
          ? ` +${(result.grantedUnits / 10).toFixed(1)} 积分`
          : '';
        setCheckinMessage(`签到成功${granted}`);
      } else if (result.alreadyCheckedIn) {
        setCheckinMessage('今日已签到');
      } else {
        const message = result.message || '签到失败，请稍后重试';
        setCheckinMessage(message);
        if (message.includes('登录')) onOpenAuthModal?.();
      }
    } catch {
      setCheckinMessage('签到失败，请检查网络');
    } finally {
      setCheckinPending(false);
      window.setTimeout(() => setCheckinMessage(null), 3200);
    }
  };

  return (
    <header className="sticky top-0 z-30 overflow-x-clip border-b border-purple-200/80 bg-white/95 px-2.5 py-2.5 text-purple-950 shadow-2xs backdrop-blur-md transition-all select-none sm:px-4 md:px-8 md:py-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="flex w-full min-w-0 items-center justify-between gap-1.5 sm:gap-3 md:gap-6">
        
        {/* Left: Logo & Brand Name */}
        <div className="flex min-w-0 shrink items-center gap-2 sm:gap-4">
          <div
            onClick={() => setCurrentTab?.('home')}
            className="flex min-w-0 items-center gap-2.5 cursor-pointer group"
          >
            <img
              src="/douzhixingge_logo.svg"
              alt="豆织星格"
              className="h-8 w-8 shrink-0 object-contain transition-transform group-hover:scale-105 sm:h-9 sm:w-9"
            />
            <div className="flex min-w-0 flex-col max-[359px]:hidden">
              <span className="flex items-center gap-1 whitespace-nowrap text-base font-black leading-none tracking-tight text-purple-950 sm:text-lg md:text-xl">
                豆织<span className="text-purple-600">星格</span>
              </span>
              <span className="hidden text-[10px] font-bold tracking-wider text-purple-400 sm:block">BEADGRID STUDIO</span>
            </div>
          </div>

          {/* Main Navigation Tabs */}
          <nav className="hidden md:flex items-center gap-1.5 ml-3">
            <button
              onClick={() => setCurrentTab?.('home')}
              className={`px-3.5 py-1.5 rounded-xl text-sm font-extrabold transition-all cursor-pointer relative ${
                currentTab === 'home'
                  ? 'text-purple-900 bg-purple-100/80 shadow-2xs'
                  : 'text-purple-700 hover:text-purple-950 hover:bg-purple-50'
              }`}
            >
              {t('home')}
              {currentTab === 'home' && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-purple-600 rounded-full" />
              )}
            </button>

            <button
              onClick={() => setCurrentTab?.('community')}
              className={`px-3.5 py-1.5 rounded-xl text-sm font-extrabold transition-all cursor-pointer relative ${
                currentTab === 'community'
                  ? 'text-purple-900 bg-purple-100/80 shadow-2xs'
                  : 'text-purple-700 hover:text-purple-950 hover:bg-purple-50'
              }`}
            >
              {t('community')}
              {currentTab === 'community' && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-purple-600 rounded-full" />
              )}
            </button>

            <button
              onClick={() => setCurrentTab?.('studio')}
              className={`px-3.5 py-1.5 rounded-xl text-sm font-extrabold transition-all cursor-pointer relative ${
                currentTab === 'studio'
                  ? 'text-purple-900 bg-purple-100/80 shadow-2xs'
                  : 'text-purple-700 hover:text-purple-950 hover:bg-purple-50'
              }`}
            >
              {t('studio')}
              {currentTab === 'studio' && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-purple-600 rounded-full" />
              )}
            </button>

            <button
              onClick={() => setCurrentTab?.('largeCanvas')}
              className={`px-3.5 py-1.5 rounded-xl text-sm font-extrabold transition-all cursor-pointer relative ${
                currentTab === 'largeCanvas'
                  ? 'text-purple-900 bg-purple-100/80 shadow-2xs'
                  : 'text-purple-700 hover:text-purple-950 hover:bg-purple-50'
              }`}
            >
              {t('largeCanvas')}
              {currentTab === 'largeCanvas' && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-purple-600 rounded-full" />}
            </button>

            <button
              onClick={() => setCurrentTab?.('assembly')}
              className={`px-3.5 py-1.5 rounded-xl text-sm font-extrabold transition-all cursor-pointer relative ${
                currentTab === 'assembly'
                  ? 'text-purple-900 bg-purple-100/80 shadow-2xs'
                  : 'text-purple-700 hover:text-purple-950 hover:bg-purple-50'
              }`}
            >
              {t('assembly')}
              {currentTab === 'assembly' && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-purple-600 rounded-full" />}
            </button>
          </nav>
        </div>

        {/* Right Corner: Search bar, Guide, VIP, User badge & Actions */}
        <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-3">
          {/* Header Search Input Bar */}
          <div className="hidden lg:flex items-center relative w-48 xl:w-56">
            <input
              type="text"
              value={headerSearchQuery}
              onChange={e => setHeaderSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  setCurrentTab?.('community');
                }
              }}
              placeholder={t('searchPlaceholder')}
              className="w-full pl-8 pr-3 py-1.5 rounded-full bg-purple-50/80 border border-purple-200/80 text-purple-950 placeholder-purple-400 font-medium text-xs focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all"
            />
            <Search className="w-3.5 h-3.5 absolute left-2.5 text-purple-500 pointer-events-none" />
          </div>

          {onOpenSmartReduceModal && (
            <button
              onClick={onOpenSmartReduceModal}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors cursor-pointer"
              title={isEn ? 'Feature-preserving bead saver' : '特征保真智能省豆'}
            >
              <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
              <span>{isEn ? 'Save Beads' : '智能省豆'}</span>
            </button>
          )}

          {/* Guide Modal Trigger */}
          <button
            onClick={onOpenGuideModal}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-purple-800 hover:bg-purple-100/60 transition-all cursor-pointer"
            title="拼豆新手指导与功能说明"
          >
            <BookOpen className="w-3.5 h-3.5 text-purple-600" />
            <span>{t('guideAction')}</span>
          </button>

          {/* VIP Perks */}
          {onOpenVipModal && (
            <button
              onClick={onOpenVipModal}
              className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 text-xs font-bold transition-all cursor-pointer"
            >
              <Crown className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
              <span>{t('vip')}</span>
            </button>
          )}

          {/* Language Toggle Button */}
          <button
            onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
            aria-label={language === 'zh' ? '切换为英文' : 'Switch to Chinese'}
            aria-pressed={language === 'en'}
            className="text-xs font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1 bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200/80 transition-all cursor-pointer shrink-0"
            title={language === 'zh' ? 'Switch to English' : '切换为中文'}
          >
            <Globe className="w-3.5 h-3.5 text-purple-600 shrink-0" />
            <span className="max-[359px]:hidden">{language === 'zh' ? 'EN' : '中文'}</span>
          </button>

          {/* Account entry */}
          {currentUser ? (
            <div className="relative flex min-w-0 items-center gap-1">
              <div
                className="flex min-h-8 items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2 text-[11px] font-extrabold text-purple-900 sm:px-2.5"
                title={`可用积分 ${availablePoints}`}
                aria-label={`可用积分 ${availablePoints}`}
              >
                <Coins className="h-3.5 w-3.5 shrink-0 text-purple-600" />
                <span className="tabular-nums">{availablePoints}</span>
                <span className="hidden sm:inline">{t('points')}</span>
              </div>
              <button
                type="button"
                onClick={handleCheckin}
                disabled={checkinPending || !creditSummary}
                className={`flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-extrabold transition-colors sm:px-2.5 ${
                  checkinAvailable
                    ? 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100'
                    : 'cursor-default border-purple-200 bg-white text-purple-400'
                }`}
                title={!creditSummary ? '正在加载积分信息' : checkinAvailable ? `每日签到 +${checkinPoints} 积分` : '今日已签到'}
                aria-label={!creditSummary ? '正在加载积分信息' : checkinAvailable ? `每日签到，领取 ${checkinPoints} 积分` : '今日已签到'}
              >
                {checkinPending || !creditSummary ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gift className="h-3.5 w-3.5 shrink-0" />}
                <span className="hidden sm:inline">{!creditSummary ? t('loading') : checkinAvailable ? t('checkin') : t('checkedIn')}</span>
              </button>
              {checkinMessage && (
                <span
                  role="status"
                  aria-live="polite"
                  className="absolute right-0 top-full z-40 mt-1 max-w-[180px] truncate rounded-lg border border-purple-200 bg-white px-2 py-1 text-[10px] font-bold text-purple-800 shadow-lg"
                >
                  {checkinMessage}
                </span>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleCheckin}
              className="flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 text-[11px] font-extrabold text-amber-900 transition-colors hover:bg-amber-100 sm:px-2.5"
              title="登录后每日签到领取积分"
              aria-label="登录后每日签到领取积分"
            >
              <Gift className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">{t('loginCheckin')}</span>
            </button>
          )}
          <div className="min-w-0 shrink-0">
            <HeaderAccountTrigger
              isAuthenticated={Boolean(currentUser)}
              displayName={userProfile?.displayName ?? currentUser?.displayName ?? null}
              photoURL={userProfile?.photoURL ?? currentUser?.photoURL ?? null}
              onOpenAuthModal={onOpenAuthModal}
              onOpenUserProfileModal={onOpenUserProfileModal}
              loginLabel={isEn ? 'Log in' : '登录'}
            />
          </div>

          {/* Mobile Hamburger Toggle Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="flex min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-purple-200 bg-purple-100 p-2 text-purple-900 hover:bg-purple-200 active:scale-95 md:hidden"
            aria-label="打开导航菜单"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Navigation overlay (< lg) */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-purple-950/40 backdrop-blur-md flex flex-col p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-5 border border-purple-200 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-purple-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-purple-100 border border-purple-300 flex items-center justify-center p-0.5">
                  <img src="/douzhixingge_logo.svg" alt="logo" className="w-full h-full rounded-lg" />
                </div>
                <span className="font-black text-purple-950 text-base">{t('appName')} · 功能导航</span>
              </div>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 text-purple-600 hover:bg-purple-100 rounded-xl cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Navigation Jump List */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onOpenSmartReduceModal?.();
                }}
                className="p-3 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 text-amber-900 font-bold text-xs flex items-center gap-2 cursor-pointer shadow-2xs"
              >
                <Zap className="w-4 h-4 text-amber-500 fill-amber-400 animate-pulse" />
                <span>智能省豆</span>
              </button>

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onOpenPaletteModal?.();
                }}
                className="p-3 rounded-2xl bg-purple-50 border border-purple-200 text-purple-900 font-bold text-xs flex items-center gap-2 cursor-pointer shadow-2xs"
              >
                <Palette className="w-4 h-4 text-purple-600" />
                <span>品牌色板</span>
              </button>

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onOpenPatternsModal?.();
                }}
                className="p-3 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-900 font-bold text-xs flex items-center gap-2 cursor-pointer shadow-2xs"
              >
                <ImageIcon className="w-4 h-4 text-indigo-600" />
                <span>我的图纸</span>
              </button>

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setCurrentTab?.('studio');
                }}
                className="p-3 rounded-2xl bg-purple-50 border border-purple-200 text-purple-900 font-bold text-xs flex items-center gap-2 cursor-pointer shadow-2xs"
              >
                <Palette className="w-4 h-4 text-purple-600" />
                <span>主画板</span>
              </button>

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setCurrentTab?.('largeCanvas');
                }}
                className="p-3 rounded-2xl bg-violet-50 border border-violet-200 text-violet-900 font-bold text-xs flex items-center gap-2 cursor-pointer shadow-2xs"
              >
                <LayoutGrid className="w-4 h-4 text-violet-600" />
                <span>大画板</span>
              </button>

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onOpenVipModal?.();
                }}
                className="p-3 rounded-2xl bg-purple-50 border border-purple-200 text-purple-900 font-bold text-xs flex items-center gap-2 cursor-pointer shadow-2xs"
              >
                <Crown className="w-4 h-4 text-amber-500" />
                <span>会员特权</span>
              </button>
            </div>

            <div className="space-y-2 pt-2 border-t border-purple-100">
              {/* Upload Image */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  fileInputRef.current?.click();
                }}
                className="w-full p-3.5 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-98"
              >
                <Upload className="w-4 h-4" />
                <span>{t('uploadImage')}</span>
              </button>

              {/* Open & Save Project */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    jsonInputRef.current?.click();
                  }}
                  className="p-3 rounded-2xl bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-purple-600" />
                  <span>{t('openProject')}</span>
                </button>

                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onExportJson();
                  }}
                  className="p-3 rounded-2xl bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <FileJson className="w-4 h-4 text-emerald-600" />
                  <span>{t('saveProject')}</span>
                </button>
              </div>

              {/* Design Guide */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onOpenGuideModal();
                }}
                className="w-full p-3 rounded-2xl bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <BookOpen className="w-4 h-4 text-purple-600" />
                <span>{t('guide')}</span>
              </button>

              {/* Clear Canvas */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onClearCanvas();
                }}
                className="w-full p-3 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>{t('clearCanvas')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
