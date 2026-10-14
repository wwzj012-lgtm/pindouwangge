import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Header } from './Header';
import { MobileHeaderNav } from './mobile/MobileHeaderNav';
import { MobileBottomNav } from './mobile/MobileBottomNav';

const state = vi.hoisted(() => ({ language: 'zh' }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: null, userProfile: null, isVip: false }),
}));
vi.mock('../context/LanguageContext', () => ({
  useLanguage: () => ({
    language: state.language,
    setLanguage: vi.fn(),
    t: (key: string) => key === 'assembly' ? '立体拼豆' : key,
  }),
}));

describe('public navigation hides assembly entry points without removing other tools', () => {
  it.each(['zh', 'en'])('hides assembly across desktop and mobile navigation in %s', language => {
    state.language = language;
    for (const currentTab of ['home', 'community', 'studio', 'largeCanvas', 'assembly'] as const) {
      const props = {
        currentTab,
        projectName: '本机测试',
        setProjectName: vi.fn(),
        onImageUpload: vi.fn(),
        onLoadSample: vi.fn(),
        onExportJson: vi.fn(),
        onImportJson: vi.fn(),
        onOpenExportModal: vi.fn(),
        onOpenGuideModal: vi.fn(),
        onOpenPatternsModal: vi.fn(),
        onClearCanvas: vi.fn(),
        setCurrentTab: vi.fn(),
      };
      for (const component of [Header, MobileHeaderNav]) {
        const markup = renderToStaticMarkup(React.createElement(component, props));
        expect(markup).not.toMatch(/立体|3D Fuse Bead|lucide-box/);
        expect(markup).toContain('豆织');
      }
      const bottom = renderToStaticMarkup(React.createElement(MobileBottomNav, {
        currentTab,
        setCurrentTab: vi.fn(),
        onOpenProfile: vi.fn(),
        isEn: language === 'en',
      }));
      expect(bottom).not.toMatch(/立体|>3D<|lucide-box/);
      expect((bottom.match(/<button\b/g) ?? []).length).toBe(5);
      expect(bottom).toContain(language === 'en' ? 'Studio' : '画板');
      expect(bottom).toContain(language === 'en' ? 'Feed' : '豆社');
    }
  });
});
