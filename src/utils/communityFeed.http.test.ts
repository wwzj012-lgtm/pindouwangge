import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearApiToken, setApiToken } from './api';
import {
  getCommunityPost, listCommunityPosts, listFavoriteCommunityPosts,
  publishCommunityPost, setCommunityPostVisibility, withdrawCommunityPost,
} from './communityApi';
import { createCommunityFeedStore } from './communityFeedStore';
import { invalidateCommunityFeed, subscribeCommunityFeedInvalidation } from './communityFeedEvents';

const id = 'post_1234567890abcdef';
const input = { title: '豆社作品', description: '真实简介', visibility: 'public' as const, tags: ['原创', '自定义真实标签'], workId: 'work_123' };
const dto = (tags: unknown = input.tags) => ({
  id, assetId: 'asset_1234567890abcdef', imageUrl: '/untrusted', title: input.title,
  description: input.description, visibility: 'public', tags, workId: input.workId, publishedAt: 123,
  author: { uid: 'user-a', displayName: 'Maker', photoUrl: null },
  likeCount: 3, favoriteCount: 2, liked: false, favorited: false,
});
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'Content-Type': 'application/json' } });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('real HTTP -> confirmed mutation -> feed invalidation', () => {
  const fetchMock = vi.fn();
  const cleanups: (() => void)[] = [];
  const mount = () => {
    const store = createCommunityFeedStore();
    cleanups.push(store.subscribe(() => {}));
    return store;
  };
  const getCount = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === 'GET').length;

  beforeEach(() => {
    vi.stubEnv('VITE_WORKER_API_URL', 'https://worker.test');
    vi.stubGlobal('fetch', fetchMock);
    for (const name of ['localStorage', 'sessionStorage']) {
      const values = new Map<string, string>();
      vi.stubGlobal(name, { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    }
    fetchMock.mockReset();
    clearApiToken(); setApiToken('test-session-a');
  });
  afterEach(() => { cleanups.splice(0).forEach((stop) => stop()); clearApiToken(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('passes selected real tags in publish body and refreshes cards/tags/counts only after HTTP success', async () => {
    let complete!: (value: Response) => void;
    fetchMock.mockResolvedValueOnce(response({ posts: [], nextCursor: null }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { complete = resolve; }))
      .mockResolvedValueOnce(response({ posts: [dto()], nextCursor: null }));
    const store = mount(); await store.refresh();
    const published = publishCommunityPost(input);
    expect(getCount()).toBe(1);
    expect(store.getSnapshot().posts).toEqual([]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(input);
    complete(response({ post: { id, visibility: 'public' } }, 201));
    expect((await published).ok).toBe(true);
    await tick();
    expect(getCount()).toBe(2);
    expect(store.getSnapshot()).toMatchObject({ posts: [{ id, tags: input.tags, description: input.description, likeCount: 3, favoriteCount: 2 }], error: null });
  });

  it.each([1, 20])('drains %i invalidations arriving after response commit but before request finalization', async (count) => {
    fetchMock.mockResolvedValueOnce(response({ posts: [{ ...dto(), title: 'old' }], nextCursor: null }))
      .mockResolvedValueOnce(response({ posts: [{ ...dto(), title: 'fresh' }], nextCursor: null }));
    const store = createCommunityFeedStore();
    let invalidated = false;
    cleanups.push(store.subscribe(() => {
      if (store.getSnapshot().posts[0]?.title === 'old' && !invalidated) {
        invalidated = true;
        // The request loop has exited by the time this microtask runs, while
        // running still points to its not-yet-finalized promise.
        queueMicrotask(() => { for (let i = 0; i < count; i++) invalidateCommunityFeed(); });
      }
    }));
    await store.refresh();
    expect(store.getSnapshot()).toMatchObject({ posts: [{ title: 'fresh' }], isLoading: false, isLoadingMore: false });
    expect(getCount()).toBe(2);
  });

  it.each(['public', 'private', 'withdraw'] as const)('revalidates on confirmed %s mutation using actual Worker envelopes', async (kind) => {
    fetchMock.mockResolvedValueOnce(response({ posts: [dto()], nextCursor: null }))
      .mockResolvedValueOnce(response(kind === 'withdraw' ? { withdrawn: true } : { id, visibility: kind }))
      .mockResolvedValueOnce(response({ posts: kind === 'public' ? [dto()] : [], nextCursor: null }));
    const store = mount(); await store.refresh();
    const result = kind === 'withdraw' ? await withdrawCommunityPost(id) : await setCommunityPostVisibility(id, kind);
    expect(result.ok).toBe(true); await tick();
    expect(getCount()).toBe(2);
    expect(store.getSnapshot().posts.length).toBe(kind === 'public' ? 1 : 0);
    const [url, init] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(init.method).toBe(kind === 'withdraw' ? 'DELETE' : 'PUT');
    if (kind === 'withdraw') expect(url.searchParams.get('id')).toBe(id);
    else expect(JSON.parse(init.body as string)).toEqual({ id, visibility: kind });
  });

  it('invalidates for a successful private publication without injecting it into the public feed', async () => {
    fetchMock.mockResolvedValueOnce(response({ posts: [], nextCursor: null }))
      .mockResolvedValueOnce(response({ post: { id, visibility: 'private' } }))
      .mockResolvedValueOnce(response({ posts: [], nextCursor: null }));
    const store = mount(); await store.refresh();
    await publishCommunityPost({ ...input, visibility: 'private' }); await tick();
    expect(getCount()).toBe(2); expect(store.getSnapshot().posts).toEqual([]);
  });

  it.each(['publish', 'visibility', 'withdraw'] as const)('does not invalidate or erase the current feed after failed %s', async (kind) => {
    fetchMock.mockResolvedValueOnce(response({ posts: [dto()], nextCursor: 'saved-cursor' }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, message: 'rejected' }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
    const store = mount(); await store.refresh();
    const result = kind === 'publish' ? await publishCommunityPost(input) : kind === 'visibility' ? await setCommunityPostVisibility(id, 'private') : await withdrawCommunityPost(id);
    expect(result).toMatchObject({ ok: false, error: 'rejected' }); await tick();
    expect(getCount()).toBe(1);
    expect(store.getSnapshot()).toMatchObject({ posts: [{ id, tags: input.tags }], nextCursor: 'saved-cursor' });
  });

  it.each(['publish', 'visibility', 'withdraw'] as const)('does not announce malformed success for %s', async (kind) => {
    fetchMock.mockResolvedValue(response({}));
    const listener = vi.fn(); cleanups.push(subscribeCommunityFeedInvalidation(listener));
    if (kind === 'publish') await publishCommunityPost(input);
    else if (kind === 'visibility') await setCommunityPostVisibility(id, 'private');
    else await withdrawCommunityPost(id);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ['publish', 'switch'], ['publish', 'aba'], ['visibility', 'switch'],
    ['visibility', 'aba'], ['withdraw', 'switch'], ['withdraw', 'aba'],
  ] as const)('an old successful %s cannot invalidate the next login: %s', async (mutation, kind) => {
    let complete!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { complete = resolve; }))
      .mockResolvedValueOnce(response({ posts: [], nextCursor: null }));
    const pending = mutation === 'publish' ? publishCommunityPost(input) : mutation === 'visibility' ? setCommunityPostVisibility(id, 'private') : withdrawCommunityPost(id);
    clearApiToken(); setApiToken(kind === 'aba' ? 'test-session-a' : 'test-session-b');
    const next = mount(); await next.refresh();
    const listener = vi.fn(); cleanups.push(subscribeCommunityFeedInvalidation(listener));
    complete(response(mutation === 'publish' ? { post: { id, visibility: 'public' } } : mutation === 'visibility' ? { id, visibility: 'private' } : { withdrawn: true }));
    await pending; await tick();
    expect(listener).not.toHaveBeenCalled(); expect(getCount()).toBe(1);
    expect(next.getSnapshot().posts).toEqual([]);
  });

  it.each([
    ['publish', { post: { id: 42, visibility: 'public' } }],
    ['publish', { post: { id, visibility: 'unknown' } }],
    ['visibility', { id: 'another-post', visibility: 'private' }],
    ['visibility', { id, visibility: 'public' }],
    ['withdraw', { id: 'another-post', withdrawn: true }],
    ['withdraw', { withdrawn: false }],
  ])('does not invalidate a mismatched/unconfirmed %s response', async (mutation, data) => {
    fetchMock.mockResolvedValue(response(data));
    const listener = vi.fn(); cleanups.push(subscribeCommunityFeedInvalidation(listener));
    if (mutation === 'publish') await publishCommunityPost(input);
    else if (mutation === 'visibility') await setCommunityPostVisibility(id, 'private');
    else await withdrawCommunityPost(id);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps existing cards on a publication-triggered refresh failure, then recovers on manual refresh', async () => {
    fetchMock.mockResolvedValueOnce(response({ posts: [dto()], nextCursor: 'saved' }))
      .mockResolvedValueOnce(response({ post: { id, visibility: 'public' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, message: 'unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(response({ posts: [], nextCursor: null }));
    const store = mount(); await store.refresh(); await publishCommunityPost(input); await tick();
    expect(store.getSnapshot()).toMatchObject({ posts: [{ id }], nextCursor: 'saved', error: 'unavailable' });
    await store.refresh(); expect(store.getSnapshot()).toMatchObject({ posts: [], nextCursor: null, error: null });
  });

  it.each(['list', 'favorites', 'detail'] as const)('preserves real tags/description in %s HTTP mapping and tolerates legacy/malformed tags', async (kind) => {
    const read = async (tags: unknown) => {
      fetchMock.mockResolvedValueOnce(response(kind === 'detail' ? { post: dto(tags) } : { posts: [dto(tags)], nextCursor: null }));
      if (kind === 'detail') return (await getCommunityPost(id)).data;
      return (await (kind === 'list' ? listCommunityPosts() : listFavoriteCommunityPosts())).data?.posts[0];
    };
    expect(await read([' 原创 ', '自定义真实标签', '原创'])).toMatchObject({ tags: input.tags, description: input.description, workId: input.workId });
    expect(await read(null)).toMatchObject({ tags: [] });
    expect(await read(['真实', 7, '', '真实'])).toMatchObject({ tags: ['真实'] });
  });
});
