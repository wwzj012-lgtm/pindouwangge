import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MobileHeaderNav, type MobileHeaderNavProps } from './MobileHeaderNav';

const state = vi.hoisted(() => ({ language: 'zh' }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: null, userProfile: null, isVip: false }),
}));
vi.mock('../../context/LanguageContext', () => ({
  useLanguage: () => ({ language: state.language, setLanguage: vi.fn(), t: (key: string) => key }),
}));

const props: MobileHeaderNavProps = {
  currentTab: 'home',
  projectName: '本机测试',
  setProjectName: vi.fn(),
  onImageUpload: vi.fn(),
  onOpenGuideModal: vi.fn(),
  onOpenPatternsModal: vi.fn(),
  onClearCanvas: vi.fn(),
  setCurrentTab: vi.fn(),
};

describe('mobile more-actions trigger', () => {
  it.each(['zh', 'en'])('uses a 36px visual inside a 44px touch target in %s', language => {
    state.language = language;
    const markup = renderToStaticMarkup(React.createElement(MobileHeaderNav, props));
    const label = language === 'en' ? 'Open more actions' : '打开更多操作';
    const trigger = markup.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>[\\s\\S]*?</button>`))?.[0];
    expect(trigger).toBeDefined();
    expect(trigger).toMatch(/class="[^"]*\bh-11\b[^" ]* [^"]*\bw-11\b/);
    expect(trigger).toContain('aria-haspopup="menu"');
    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).toMatch(/<span[^>]*class="[^"]*\bh-9\b[^" ]* [^"]*\bw-9\b/);
    expect(trigger).toContain('focus-visible:ring-2');
    expect(trigger).toContain('lucide-ellipsis');
  });

  it('does not add an inert trigger when the patterns action is unavailable', () => {
    state.language = 'zh';
    const markup = renderToStaticMarkup(React.createElement(MobileHeaderNav, { ...props, onOpenPatternsModal: undefined }));
    expect(markup).not.toContain('aria-haspopup="menu"');
  });
});
