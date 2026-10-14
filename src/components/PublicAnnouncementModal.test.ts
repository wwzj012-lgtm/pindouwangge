import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AnnouncementBell } from './AnnouncementBell';
import { PublicAnnouncementModal, safeAnnouncementUrl } from './PublicAnnouncementModal';
import { createAnnouncementStore, type PublicAnnouncementItem } from '../utils/announcementStore';

const item: PublicAnnouncementItem = { id: 'old', title: '<img src=x onerror=alert(1)>', content: '<script>window.xss=true</script>\n' + 'A'.repeat(500), pinned: false, publishAt: 1000, expireAt: 1 };
const props = { onClose: vi.fn(), onRetry: vi.fn(), onSelect: vi.fn(), onBack: vi.fn(), onLoadMore: vi.fn() };
const render = (state: ReturnType<ReturnType<typeof createAnnouncementStore>['getSnapshot']>) => renderToStaticMarkup(React.createElement(PublicAnnouncementModal, { ...props, state }));

describe('accessible public announcement center markup', () => {
  it('renders no modal when closed', () => { expect(render(createAnnouncementStore().getSnapshot())).toBe(''); });
  it('renders genuine historical rows, escaped text, expired labels and read state', () => {
    const state = { ...createAnnouncementStore().getSnapshot(), open: true, historyState: 'ready' as const, history: [item] };
    const html = render(state);
    expect(html).toContain('role="dialog"'); expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="public-announcement-title"');
    expect(html).toContain('历史公告列表'); expect(html).toContain('已结束'); expect(html).toContain('未读');
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img src=x');
  });
  it('detail is plain text with a back-to-history action, not HTML', () => {
    const html = render({ ...createAnnouncementStore().getSnapshot(), open: true, view: 'detail', selected: item });
    expect(html).toContain('返回历史公告'); expect(html).toContain('仅供历史回看');
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>window.xss');
  });
  it('history error retains existing rows and provides retry; loading and empty remain explicit', () => {
    const state = { ...createAnnouncementStore().getSnapshot(), open: true };
    expect(render({ ...state, history: [item], historyState: 'error', historyError: '请重试' })).toContain('重试加载');
    expect(render({ ...state, historyState: 'loading' })).toContain('正在加载公告');
    expect(render({ ...state, historyState: 'ready' })).toContain('暂无公开历史公告');
  });
  it('bell has dialog semantics, 36px visual, 44px target and an unread indicator', () => {
    const html = renderToStaticMarkup(React.createElement(AnnouncementBell, { onClick: vi.fn(), hasUnread: true }));
    expect(html).toContain('aria-haspopup="dialog"'); expect(html).toContain('查看历史公告');
    expect(html).toContain('h-11 w-11'); expect(html).toContain('h-9 w-9'); expect(html).toContain('有未读公告');
  });
});

describe('safe announcement action URLs', () => {
  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:evil', 'file:///private', 'java\nscript:alert(1)'])('rejects active/non-web URL %s', value => { expect(safeAnnouncementUrl(value, 'http://localhost')).toBeNull(); });
  it('allows http(s) and safe same-origin paths', () => {
    expect(safeAnnouncementUrl('/workspace?tab=studio', 'http://localhost')).toBe('/workspace?tab=studio');
    expect(safeAnnouncementUrl('https://example.invalid/notice', 'http://localhost')).toBe('https://example.invalid/notice');
  });
});
