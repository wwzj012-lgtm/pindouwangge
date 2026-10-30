import React from 'react';
import {
  Home,
  Palette,
  Compass,
  Grid2X2,
  User,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface MobileBottomNavProps {
  currentTab: 'home' | 'studio' | 'community' | 'largeCanvas' | 'assembly';
  setCurrentTab: (tab: 'home' | 'studio' | 'community' | 'largeCanvas' | 'assembly') => void;
  onOpenProfile: () => void;
  isEn?: boolean;
}

/**
 * Floating bottom navigation for the four top-level destinations.
 *
 * One visual language for all five slots: identical height, identical icon
 * size, identical 11px label. The profile slot used to be a filled pill while
 * its siblings were plain — that read as a call-to-action instead of a tab.
 */
export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentTab,
  setCurrentTab,
  onOpenProfile,
  isEn = false,
}) => {
  const { currentUser, isVip } = useAuth();

  const items = [
    { tab: 'home' as const, icon: Home, zh: '首页', en: 'Home' },
    { tab: 'studio' as const, icon: Palette, zh: '画板', en: 'Studio' },
    { tab: 'community' as const, icon: Compass, zh: '豆社', en: 'Feed' },
    { tab: 'largeCanvas' as const, icon: Grid2X2, zh: '大画板', en: 'Big' },
  ];

  return (
    <div className="pointer-events-none fixed bottom-0 left-1/2 z-40 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 sm:max-w-xl">
      <nav
        aria-label={isEn ? 'Main navigation' : '主导航'}
        className="pointer-events-auto flex items-stretch gap-0.5 rounded-2xl border border-purple-200/90 bg-white/95 px-1 py-1 shadow-2xl backdrop-blur-xl sm:justify-center sm:gap-4 sm:rounded-3xl sm:px-4 sm:py-1.5"
        style={{ marginBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
      >
        {items.map(({ tab, icon: Icon, zh, en }) => {
          const isActive = currentTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setCurrentTab(tab)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 transition-colors sm:min-w-[68px] sm:flex-none sm:px-3 ${
                isActive ? 'bg-purple-50 text-purple-700' : 'text-slate-500 active:bg-slate-100'
              }`}
            >
              <Icon
                aria-hidden="true"
                className={`h-5 w-5 ${isActive ? 'stroke-[2.4]' : ''}`}
              />
              <span className={`text-[11px] leading-none ${isActive ? 'font-black' : 'font-bold'}`}>
                {isEn ? en : zh}
              </span>
            </button>
          );
        })}

        {/* Profile slot: same geometry as a tab, avatar replaces the icon. */}
        <button
          type="button"
          onClick={onOpenProfile}
          aria-haspopup="menu"
          aria-label={
            currentUser
              ? (isEn ? 'Account and saved patterns' : '账号与我的图纸')
              : (isEn ? 'Sign in' : '登录')
          }
          className="relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-slate-500 transition-colors active:bg-slate-100 sm:min-w-[68px] sm:flex-none sm:px-3"
        >
          <span className="relative flex h-5 w-5 items-center justify-center">
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 items-center justify-center rounded-full ${
                currentUser ? 'bg-purple-100 text-purple-700' : 'bg-slate-200 text-slate-600'
              }`}
            >
              <User className="h-3.5 w-3.5" />
            </span>
            {isVip && (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 h-2 w-2 rounded-full border border-white bg-amber-400"
              />
            )}
          </span>
          <span className="text-[11px] font-bold leading-none">
            {currentUser ? (isEn ? 'Me' : '我的') : isEn ? 'Login' : '我的'}
          </span>
        </button>
      </nav>
    </div>
  );
};
