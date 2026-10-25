import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminCommunityPosts, communityQueryString } from './AdminCommunityPosts';

vi.mock('../../context/AuthContext', () => ({useAuth:()=>({currentUser:{uid:'render-test'}})}));

describe('AdminCommunityPosts', () => {
  it('builds an encoded, paged request against the real community-posts endpoint', () => {
    const path = '/api/admin/community-posts?' + communityQueryString('猫 & bead', 'blocked', 2);
    const parsed = new URL(path, 'https://admin.test');
    expect(parsed.pathname).toBe('/api/admin/community-posts');
    expect(parsed.searchParams.get('q')).toBe('猫 & bead');
    expect(parsed.searchParams.get('status')).toBe('blocked');
    expect(parsed.searchParams.get('limit')).toBe('20');
    expect(parsed.searchParams.get('offset')).toBe('40');
  });

  it('renders searchable status filters and an explicit empty state without inventing gallery works', () => {
    const html = renderToStaticMarkup(React.createElement(AdminCommunityPosts, { request: vi.fn() as never }));
    expect(html).toContain('搜索帖子、作者或标签');
    expect(html).toContain('公开可见');
    expect(html).toContain('已下架');
    expect(html).toContain('暂无成功读取结果');
    expect(html).toContain('先从左侧列表读取服务端详情');
  });
});
