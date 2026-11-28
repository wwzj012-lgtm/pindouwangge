import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminCommunityPosts } from './AdminCommunityPosts';
import { AdminLogsCodes } from './AdminLogsCodes';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ currentUser: { uid: 'drill-test' } }) }));

/**
 * B11 端到端（服务端渲染版）：URL 上带 `preset=...` 时，目标模块的**初始渲染**就必须
 * 落在正确的页签/筛选上。不依赖真实浏览器：只临时给 globalThis 挂一个 window.location。
 */
const originalWindow = (globalThis as { window?: unknown }).window;

function withSearch(search: string): void {
  (globalThis as { window?: unknown }).window = { location: { search } };
}

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
});

const selectedTabs = (html: string): string[] =>
  Array.from(html.matchAll(/aria-selected="true"[^>]*>([^<]*)</g)).map(match => match[1] ?? '');

describe('drill-down preset lands on the right initial view (QA B11)', () => {
  it('opens 举报 tab when the reports card drilled here', () => {
    withSearch('?section=community&preset=reports');
    const html = renderToStaticMarkup(React.createElement(AdminCommunityPosts, { request: vi.fn() as never }));
    expect(selectedTabs(html)).toEqual(['举报']);
  });

  it('opens 审核队列 tab when the review card drilled here', () => {
    withSearch('?section=community&preset=review-queue');
    const html = renderToStaticMarkup(React.createElement(AdminCommunityPosts, { request: vi.fn() as never }));
    expect(selectedTabs(html)).toEqual(['审核队列']);
  });

  it('keeps the default 帖子 tab when there is no preset', () => {
    withSearch('?section=community');
    const html = renderToStaticMarkup(React.createElement(AdminCommunityPosts, { request: vi.fn() as never }));
    expect(selectedTabs(html)).toEqual(['帖子列表']);
  });

  it('filters the codes list to 可用 when the stock card drilled here', () => {
    withSearch('?section=codes&preset=low-stock');
    const html = renderToStaticMarkup(React.createElement(AdminLogsCodes, { mode: 'codes', request: vi.fn() as never }));
    // 状态下拉的初值应该是「可用」：SSR 会把选中的 option 标成 selected。
    expect(html).toContain('<option value="available" selected');
  });

  it('leaves the codes status on 全部 without the preset', () => {
    withSearch('?section=codes');
    const html = renderToStaticMarkup(React.createElement(AdminLogsCodes, { mode: 'codes', request: vi.fn() as never }));
    expect(html).toContain('<option value="all" selected');
  });
});
