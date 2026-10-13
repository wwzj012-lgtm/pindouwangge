import React from 'react';
import {
  Home,
  Palette,
  Compass,
  Grid2X2,
  Box,
  User,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface MobileBottomNavProps {
  currentTab: 'home' | 'studio' | 'community' | 'largeCanvas' | 'assembly';
  setCurrentTab: (tab: 'home' | 'studio' | 'community' | 'largeCanvas' | 'assembly') => void;
  onOpenProfile: () => void;
  isEn?: boolean;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentTab,
  setCurrentTab,
  onOpenProfile,
  isEn = false,
}) => {
  const { currentUser, isVip } = useAuth();

  return (
    <div className="fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom))] sm:bottom-5 left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-md sm:max-w-xl z-40 select-none pointer-events-auto">
      <nav className="bg-white/95 backdrop-blur-xl border border-purple-200/90 shadow-2xl sm:shadow-purple-900/20 rounded-2xl sm:rounded-3xl px-1 py-1 sm:px-5 sm:py-2 flex items-center justify-around sm:justify-center sm:gap-6 md:gap-8">
        {/* 1. 首页 Home */}
        <button
          type="button"
          onClick={() => setCurrentTab('home')}
          aria-current={currentTab === 'home' ? 'page' : undefined}
          className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 sm:min-w-[68px] sm:flex-none sm:px-3.5 rounded-xl sm:rounded-2xl transition-all cursor-pointer ${
            currentTab === 'home'
              ? 'text-purple-600 font-black bg-purple-100/90 shadow-2xs scale-102'
              : 'text-slate-500 hover:text-purple-900 font-bold'
          }`}
        >
          <Home className={`w-4 h-4 sm:w-5 sm:h-5 ${currentTab === 'home' ? 'text-purple-600 stroke-[2.5]' : 'text-slate-500'}`} />
          <span className="text-[10px] sm:text-xs leading-tight">{isEn ? 'Home' : '首页'}</span>
        </button>

        {/* 2. 画板 Studio */}
        <button
          type="button"
          onClick={() => setCurrentTab('studio')}
          aria-current={currentTab === 'studio' ? 'page' : undefined}
          className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 sm:min-w-[68px] sm:flex-none sm:px-3.5 rounded-xl sm:rounded-2xl transition-all cursor-pointer ${
            currentTab === 'studio'
              ? 'text-purple-600 font-black bg-purple-100/90 shadow-2xs scale-102'
              : 'text-slate-500 hover:text-purple-900 font-bold'
          }`}
        >
          <Palette className={`w-4 h-4 sm:w-5 sm:h-5 ${currentTab === 'studio' ? 'text-purple-600 stroke-[2.5]' : 'text-slate-500'}`} />
          <span className="text-[10px] sm:text-xs leading-tight">{isEn ? 'Studio' : '画板'}</span>
        </button>

        {/* 3. 豆社 Community */}
        <button
          type="button"
          onClick={() => setCurrentTab('community')}
          aria-current={currentTab === 'community' ? 'page' : undefined}
          className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 sm:min-w-[68px] sm:flex-none sm:px-3.5 rounded-xl sm:rounded-2xl transition-all cursor-pointer ${
            currentTab === 'community'
              ? 'text-purple-600 font-black bg-purple-100/90 shadow-2xs scale-102'
              : 'text-slate-500 hover:text-purple-900 font-bold'
          }`}
        >
          <Compass className={`w-4 h-4 sm:w-5 sm:h-5 ${currentTab === 'community' ? 'text-purple-600 stroke-[2.5]' : 'text-slate-500'}`} />
          <span className="text-[10px] sm:text-xs leading-tight">{isEn ? 'Feed' : '豆社'}</span>
        </button>

        {/* 4. 大画板 Large Canvas */}
        <button
          type="button"
          onClick={() => setCurrentTab('largeCanvas')}
          aria-current={currentTab === 'largeCanvas' ? 'page' : undefined}
          className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 sm:min-w-[68px] sm:flex-none sm:px-3.5 rounded-xl sm:rounded-2xl transition-all cursor-pointer ${
            currentTab === 'largeCanvas'
              ? 'text-purple-600 font-black bg-purple-100/90 shadow-2xs scale-102'
              : 'text-slate-500 hover:text-purple-900 font-bold'
          }`}
        >
          <Grid2X2 className={`w-4 h-4 sm:w-5 sm:h-5 ${currentTab === 'largeCanvas' ? 'text-purple-600 stroke-[2.5]' : 'text-slate-500'}`} />
          <span className="text-[10px] sm:text-xs leading-tight">{isEn ? 'Big' : '大画板'}</span>
        </button>

        {/* 5. 立体 Assembly */}
        <button
          type="button"
          onClick={() => setCurrentTab('assembly')}
          aria-current={currentTab === 'assembly' ? 'page' : undefined}
          className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 sm:min-w-[68px] sm:flex-none sm:px-3.5 rounded-xl sm:rounded-2xl transition-all cursor-pointer ${
            currentTab === 'assembly'
              ? 'text-purple-600 font-black bg-purple-100/90 shadow-2xs scale-102'
              : 'text-slate-500 hover:text-purple-900 font-bold'
          }`}
        >
          <Box className={`w-4 h-4 sm:w-5 sm:h-5 ${currentTab === 'assembly' ? 'text-purple-600 stroke-[2.5]' : 'text-slate-500'}`} />
          <span className="text-[10px] sm:text-xs leading-tight">{isEn ? '3D' : '立体'}</span>
        </button>

        {/* 6. 我的 Profile / VIP */}
        <button
          type="button"
          onClick={onOpenProfile}
          className="relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 text-slate-500 transition-all cursor-pointer hover:text-purple-900 font-bold sm:min-w-[68px] sm:flex-none sm:px-3.5 rounded-xl sm:rounded-2xl"
        >
          <div className="relative">
            <User className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" />
            {isVip && (
              <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-amber-400 border border-white" />
            )}
          </div>
          <span className="text-[10px] sm:text-xs leading-tight">
            {currentUser ? (isEn ? 'Me' : '我的') : isEn ? 'Login' : '我的'}
          </span>
        </button>
      </nav>
    </div>
  );
};
