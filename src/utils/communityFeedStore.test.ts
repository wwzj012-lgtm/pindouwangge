import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearApiToken, setApiToken, type ApiResult } from './api';
import type { CommunityPost } from './communityApi';
import { invalidateCommunityFeed } from './communityFeedEvents';
import { createCommunityFeedStore } from './communityFeedStore';

const list = vi.hoisted(() => vi.fn());
vi.mock('./communityApi', () => ({ listCommunityPosts: list }));
type Page = ApiResult<{ posts: CommunityPost[]; nextCursor: string | null }>;
const post = (id: string): CommunityPost => ({
  id, assetId: `asset_${id}`, imageUrl: '', title: id, publishedAt: 1,
  author: { uid: 'owner', displayName: 'Maker', photoUrl: null },
  likeCount: 0, favoriteCount: 0, liked: false, favorited: false, tags: ['真实标签'],
});
const page = (ids: string[], nextCursor: string | null = null): Page => ({ ok: true, status: 200, data: { posts: ids.map(post), nextCursor } });
const deferred = () => {
  let resolve!: (value: Page) => void;
  const promise = new Promise<Page>((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('account-scoped community feed', () => {
  const cleanups: (() => void)[] = [];
  const mount = () => {
    const store = createCommunityFeedStore();
    cleanups.push(store.subscribe(() => {}));
    return store;
  };
  beforeEach(() => {
    for (const name of ['localStorage', 'sessionStorage']) {
      const values = new Map<string, string>();
      vi.stubGlobal(name, { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    }
    clearApiToken();
    list.mockReset();
  });
  afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); vi.unstubAllGlobals(); });

  it('initializes once and coalesces subscribers, manual refresh and a mutation burst', async () => {
    list.mockResolvedValue(page(['old']));
    const store = mount();
    cleanups.push(store.subscribe(() => {}));
    await store.refresh();
    expect(list).toHaveBeenCalledTimes(1);
    list.mockResolvedValue(page(['new']));
    for (let i = 0; i < 20; i++) invalidateCommunityFeed();
    await store.refresh();
    expect(list).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().posts.map((item) => item.id)).toEqual(['new']);
  });

  it('does not commit an old first-page response after publication invalidation', async () => {
    const old = deferred();
    const fresh = deferred();
    list.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const store = mount();
    const seen: string[][] = [];
    cleanups.push(store.subscribe(() => seen.push(store.getSnapshot().posts.map((item) => item.id))));
    await flush();
    invalidateCommunityFeed(); invalidateCommunityFeed();
    old.resolve(page(['stale']));
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
    expect(seen.flat()).not.toContain('stale');
    fresh.resolve(page(['published']));
    await flush();
    expect(store.getSnapshot().posts[0].id).toBe('published');
  });

  it('drops an old pagination response and refreshes first page after withdrawal', async () => {
    const more = deferred();
    list.mockResolvedValueOnce(page(['withdrawn'], 'cursor')).mockReturnValueOnce(more.promise).mockResolvedValueOnce(page(['remaining']));
    const store = mount();
    await store.refresh();
    const pending = store.loadMore();
    await flush();
    invalidateCommunityFeed();
    more.resolve(page(['stale-more'], 'stale-cursor'));
    await pending;
    expect(list.mock.calls.map((args) => args[0])).toEqual([undefined, 'cursor', undefined]);
    expect(store.getSnapshot()).toMatchObject({ posts: [post('remaining')], nextCursor: null, isLoading: false, isLoadingMore: false });
  });

  it('manual refresh supersedes pagination even before the page request starts', async () => {
    list.mockResolvedValueOnce(page(['old'], 'cursor')).mockResolvedValueOnce(page(['new']));
    const store = mount();
    await store.refresh();
    const pending = store.loadMore();
    await store.refresh();
    await pending;
    expect(list.mock.calls.map((args) => args[0])).toEqual([undefined, undefined]);
    expect(store.getSnapshot().posts.map((item) => item.id)).toEqual(['new']);
  });

  it('deduplicates pages and shares in-flight load-more requests', async () => {
    const more = deferred();
    list.mockResolvedValueOnce(page(['one'], 'cursor')).mockReturnValueOnce(more.promise);
    const store = mount(); await store.refresh();
    const first = store.loadMore(); const second = store.loadMore();
    expect(first).toBe(second);
    await flush(); more.resolve(page(['one', 'two'])); await first;
    expect(store.getSnapshot().posts.map((item) => item.id)).toEqual(['one', 'two']);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it.each(['api', 'throw'])('preserves posts, tags, counts and cursor on %s refresh failure; retry works', async (failure) => {
    list.mockResolvedValueOnce(page(['saved'], 'cursor'));
    const store = mount(); await store.refresh();
    store.updatePost('saved', (item) => ({ ...item, likeCount: 7 }));
    if (failure === 'api') list.mockResolvedValueOnce({ ok: false, status: 503, error: 'offline' });
    else list.mockRejectedValueOnce(new Error('offline'));
    await store.refresh();
    expect(store.getSnapshot()).toMatchObject({ posts: [{ id: 'saved', tags: ['真实标签'], likeCount: 7 }], nextCursor: 'cursor', error: expect.any(String), isLoading: false });
    list.mockResolvedValueOnce(page(['retry'])); await store.refresh();
    expect(store.getSnapshot()).toMatchObject({ posts: [post('retry')], error: null });
  });

  it('a refresh started before a confirmed reaction cannot revert its updated count', async () => {
    const old = deferred();
    const updated = { ...post('one'), likeCount: 7, liked: true };
    list.mockResolvedValueOnce(page(['one'])).mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ ok: true, status: 200, data: { posts: [updated], nextCursor: null } });
    const store = mount(); await store.refresh();
    const pending = store.refresh(); await flush();
    store.updatePost('one', () => updated);
    const counts: number[] = [];
    cleanups.push(store.subscribe(() => counts.push(store.getSnapshot().posts[0].likeCount)));
    old.resolve(page(['one'])); await pending;
    expect(counts).not.toContain(0);
    expect(store.getSnapshot().posts[0]).toMatchObject({ likeCount: 7, liked: true });
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('keeps a new account empty until its own response; old account and ABA responses cannot land', async () => {
    setApiToken('account-a');
    const pending = deferred();
    list.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page(['b']));
    const old = mount(); await flush();
    clearApiToken(); setApiToken('account-a'); // ABA: same token, different login session.
    const next = mount();
    expect(next.getSnapshot().posts).toEqual([]);
    await next.refresh();
    pending.resolve(page(['private-a'])); await flush();
    expect(old.getSnapshot().posts).toEqual([]);
    expect(next.getSnapshot().posts.map((item) => item.id)).toEqual(['b']);
    await old.refresh();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not request while unmounted and revalidates on remount (including StrictMode replay)', async () => {
    list.mockResolvedValue(page(['fresh']));
    const store = createCommunityFeedStore();
    const stop = store.subscribe(() => {}); stop();
    invalidateCommunityFeed(); await flush(); expect(list).not.toHaveBeenCalled();
    const stopAgain = store.subscribe(() => {}); await flush();
    expect(list).toHaveBeenCalledTimes(1);
    stopAgain(); invalidateCommunityFeed(); await flush(); expect(list).toHaveBeenCalledTimes(1);
    cleanups.push(store.subscribe(() => {})); await flush(); expect(list).toHaveBeenCalledTimes(2);
  });
});
