import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminRequest } from './adminRequest';
import { AdminCommunityTagDictionary, tagDictionaryQuery, tagUpdateBody, type TagDictionaryItem } from './AdminCommunityTagDictionary';

const item = (tag: string, status: 'active' | 'hidden' = 'active', usageCount = 3): TagDictionaryItem => ({
  tag, name: tag, usageCount, status, createdAt: '2025-06-01T00:00:00Z',
});

const okRequest: AdminRequest = async <T,>() => ({
  ok: true,
  status: 200,
  data: { items: [item('花'), item('海豚', 'hidden', 9)], total: 2, limit: 500, offset: 0 } as unknown as T,
});

describe('tag dictionary query contract', () => {
  it('serializes bounded list queries including hidden rows by default', () => {
    expect(tagDictionaryQuery()).toBe('?status=all&limit=500&offset=0');
    expect(tagDictionaryQuery('hidden', 100, 20)).toBe('?status=hidden&limit=100&offset=20');
  });
  it('builds update bodies with at least one field', () => {
    expect(tagUpdateBody('花', { name: '花朵' })).toEqual({ tag: '花', name: '花朵' });
    expect(tagUpdateBody('花', { status: 'hidden' })).toEqual({ tag: '花', status: 'hidden' });
    expect(tagUpdateBody('花', {})).toEqual({ tag: '花' });
  });
});

describe('AdminCommunityTagDictionary', () => {
  it('renders the dictionary table with hidden rows and inline rename inputs', () => {
    const html = renderToStaticMarkup(React.createElement(AdminCommunityTagDictionary, { request: okRequest, initialItems: [item('花'), item('海豚', 'hidden', 9)] }));
    expect(html).toContain('标签字典');
    expect(html).toContain('data-tag-row="花"');
    expect(html).toContain('data-tag-row="海豚"');
    expect(html).toContain('data-tag-name="花"');
    expect(html).toContain('data-tag-rename="花"');
    expect(html).toContain('data-tag-toggle="海豚"');
    expect(html).toContain('已隐藏');
    expect(html).toContain('9');
  });

  it('keeps the hidden toggle behind a confirm dialog', () => {
    const html = renderToStaticMarkup(React.createElement(AdminCommunityTagDictionary, { request: okRequest, initialItems: [item('花')] }));
    // 未触发前确认弹窗不渲染。
    expect(html).not.toContain('确认隐藏');
  });

  it('renders empty state when the dictionary is empty', () => {
    const html = renderToStaticMarkup(React.createElement(AdminCommunityTagDictionary, { request: okRequest, initialItems: [] }));
    expect(html).toContain('data-admin-empty="tag-dictionary"');
    expect(html).toContain('标签字典为空');
  });

  it('never renders a fake empty table before a successful read', () => {
    const failingRequest: AdminRequest = async <T,>() => ({ ok: false, status: 403, error: '拒绝访问' } as unknown as T);
    const html = renderToStaticMarkup(React.createElement(AdminCommunityTagDictionary, { request: failingRequest }));
    // 失败未当作空字典：SSR 首帧是无数据的提示空态，读取失败后由 effect 阶段转错误态。
    expect(html).toContain('尚无成功读取结果');
    expect(html).not.toContain('data-tag-row');
  });
});
