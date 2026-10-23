import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGetBlob, clearApiToken, setApiToken } from './api';
import {
  listFavoriteCommunityPosts,
  listCommunityPosts,
  getCommunityPost,
  publishCommunityPost,
  reactToCommunityPost,
  uploadCommunityAsset,
} from './communityApi';

function successResponse<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length(): number { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe('community API mapping', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('VITE_WORKER_API_URL', 'https://worker.example');
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
    fetchMock.mockReset();
    clearApiToken();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('loads Worker posts and turns the asset id into a public Worker URL', async () => {
    fetchMock.mockResolvedValue(successResponse({
      posts: [{
        id: 'post_1234567890abcdef',
        assetId: 'asset_1234567890abcdef',
        imageUrl: '/api/community/assets/public?id=asset_1234567890abcdef',
        title: 'Piece',
        publishedAt: 1_700_000_000_000,
        author: { uid: 'usr_123', displayName: 'Maker', photoUrl: null },
        likeCount: 4,
        favoriteCount: 2,
        liked: false,
        favorited: false,
      }],
      nextCursor: null,
    }));

    const result = await listCommunityPosts();

    expect(fetchMock.mock.calls[0][0]).toEqual(new URL('https://worker.example/api/community/posts?limit=24'));
    expect(result.data?.posts[0]).toMatchObject({
      imageUrl: 'https://worker.example/api/community/assets/public?id=asset_1234567890abcdef',
      author: { photoUrl: null },
    });
  });

  it('uses Worker PUT and DELETE endpoints for likes and favorites', async () => {
    setApiToken('jwt');
    fetchMock.mockResolvedValue(successResponse({ active: true }));

    await reactToCommunityPost('post_1234567890abcdef', 'like', true);
    await reactToCommunityPost('post_1234567890abcdef', 'favorite', false);

    expect(fetchMock.mock.calls[0][0]).toEqual(new URL('https://worker.example/api/community/posts/like'));
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('PUT');
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify({ id: 'post_1234567890abcdef' }));
    expect(fetchMock.mock.calls[1][0]).toEqual(new URL('https://worker.example/api/community/posts/favorite?id=post_1234567890abcdef'));
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('DELETE');
  });

  it('loads the current user\'s persisted favorite posts from Worker', async () => {
    setApiToken('jwt');
    fetchMock.mockResolvedValue(successResponse({ posts: [], nextCursor: null }));

    const result = await listFavoriteCommunityPosts();

    expect(fetchMock.mock.calls[0][0]).toEqual(new URL('https://worker.example/api/community/favorites?limit=24'));
    expect(result.data).toEqual({ posts: [], nextCursor: null });
  });

  it('unwraps the Worker detail envelope and retains work ownership metadata', async () => {
    fetchMock.mockResolvedValue(successResponse({ post: {
      id: 'post_1234567890abcdef', assetId: 'asset_1234567890abcdef', title: 'Piece', publishedAt: 1,
      workId: 'work_1234567890abcdef', description: 'full grid', visibility: 'public', tags: [],
      author: { uid: 'user-1', displayName: 'Maker', photoUrl: null }, likeCount: 0, favoriteCount: 0,
      liked: false, favorited: false,
    } }));

    const result = await getCommunityPost('post_1234567890abcdef');

    expect(result).toMatchObject({ ok: true, data: {
      id: 'post_1234567890abcdef', workId: 'work_1234567890abcdef', title: 'Piece',
      imageUrl: 'https://worker.example/api/community/assets/public?id=asset_1234567890abcdef',
    } });
  });

  it('still reads the legacy unwrapped detail response', async () => {
    fetchMock.mockResolvedValue(successResponse({
      id: 'post_1234567890abcdef', assetId: 'asset_1234567890abcdef', title: 'Legacy', publishedAt: 1,
      author: { uid: 'owner', displayName: 'Maker', photoUrl: '' }, likeCount: 0, favoriteCount: 0, liked: false, favorited: false,
    }));
    expect(await getCommunityPost('post_1234567890abcdef')).toMatchObject({ ok: true, data: { title: 'Legacy', author: { photoUrl: null } } });
  });

  it('rejects malformed detail data instead of building an undefined asset URL', async () => {
    fetchMock.mockResolvedValue(successResponse({ post: {} }));
    expect(await getCommunityPost('post_1234567890abcdef')).toMatchObject({ ok: false, error: expect.stringContaining('数据无效') });
  });

  it('retains detail access errors without attempting to normalize a missing post', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, message: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
    expect(await getCommunityPost('post_1234567890abcdef')).toMatchObject({ ok: false, status: 404, error: 'Not found' });
  });

  it('can read JPEG-only legacy publications without treating them as missing assets', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([255, 216, 255]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
    const result = await apiGetBlob('/api/community/assets/public', { id: 'asset_1234567890abcdef' });
    expect(result.ok).toBe(true);
    expect(result.data?.type).toBe('image/jpeg');
  });

  it('uploads an image asset before publishing its Worker post', async () => {
    setApiToken('jwt');
    fetchMock
      .mockResolvedValueOnce(successResponse({ asset: { id: 'asset_1234567890abcdef' } }))
      .mockResolvedValueOnce(successResponse({ post: { id: 'post_1234567890abcdef' } }));
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'piece.png', { type: 'image/png' });

    const uploaded = await uploadCommunityAsset(file);
    await publishCommunityPost('Piece', uploaded.data!.asset.id);

    expect(fetchMock.mock.calls[0][0]).toEqual(new URL('https://worker.example/api/community/assets'));
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect(new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get('Content-Type')).toBe('image/png');
    expect(fetchMock.mock.calls[1][0]).toEqual(new URL('https://worker.example/api/community/posts'));
    expect((fetchMock.mock.calls[1][1] as RequestInit).body).toBe(JSON.stringify({ title: 'Piece', assetId: 'asset_1234567890abcdef' }));
  });

  it('associates a published community post with its saved work when provided', async () => {
    setApiToken('jwt');
    fetchMock.mockResolvedValue(successResponse({ post: { id: 'post_1234567890abcdef' } }));

    await publishCommunityPost('Piece', 'asset_1234567890abcdef', 'work_1234567890abcdef');

    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify({
      title: 'Piece',
      assetId: 'asset_1234567890abcdef',
      workId: 'work_1234567890abcdef',
    }));
  });
});
