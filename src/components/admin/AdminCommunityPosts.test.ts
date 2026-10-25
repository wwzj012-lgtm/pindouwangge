import { describe, expect, it } from 'vitest';
import {
  communityDetailPath,
  communityEvidenceStatus,
  communityModerationBody,
  communityModerationPath,
  communityQueryString,
  communityStatusLabel,
} from './AdminCommunityPosts';

describe('AdminCommunityPosts request contract', () => {
  it('uses the server pagination/filter contract without inventing fields', () => {
    expect(communityQueryString('  post_一号  ', 'blocked', 2)).toBe('limit=20&offset=40&status=blocked&q=post_%E4%B8%80%E5%8F%B7');
    expect(communityQueryString('', 'all', 0)).toBe('limit=20&offset=0&status=all');
  });

  it('keeps exact community handler paths and URL-encodes detail IDs', () => {
    expect(communityDetailPath('post_a/b')).toBe('/api/admin/community-posts/detail?id=post_a%2Fb');
    expect(communityModerationPath('takedown')).toBe('/api/admin/community-posts/takedown');
    expect(communityModerationPath('restore')).toBe('/api/admin/community-posts/restore');
  });

  it('submits the server CAS version and trimmed reason for confirmation', () => {
    expect(communityModerationBody({ id: 'post_123', publicationToken: 'observed-token', moderation: { state: 'visible', version: 7, reason: '' } }, '  reason  ')).toEqual({
      id: 'post_123', reason: 'reason', expectedVersion: 7, expectedPublicationToken: 'observed-token',
    });
  });

  it('states exactly which evidence is absent without claiming a preview was viewed', () => {
    const post: Parameters<typeof communityEvidenceStatus>[0]['post'] = { id: 'post_123', publicationToken: null, title: '测试', publishedAt: 1, withdrawnAt: null, visibility: 'public', publiclyVisible: true, author: { uid: 'owner' }, work: { id: 'work-1', status: 1, width: 1, height: 1, totalBeads: 1 }, moderation: { state: 'visible', version: 0, reason: '' } };
    expect(communityEvidenceStatus({ post, asset: null, snapshot: null })).toBe('缺少图纸证据，当前仅记录审核');
    expect(communityEvidenceStatus({ post: { ...post, work: null }, asset: null, snapshot: null })).toBe('缺少图片证据，当前仅记录审核');
    expect(communityEvidenceStatus({ post, asset: { content_type: 'image/png' }, snapshot: {} })).toContain('预览未加载');
  });

  it('labels every supported filter state in Chinese', () => {
    expect((['all', 'public', 'private', 'blocked', 'withdrawn'] as const).map(communityStatusLabel)).toEqual([
      '全部状态', '公开可见', '私有未撤回', '已下架', '已撤回',
    ]);
  });
});
