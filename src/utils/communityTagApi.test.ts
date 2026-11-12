import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearApiToken, setApiToken } from './api';
import {
  checkCommunityModeration,
  createBannedWord,
  deleteBannedWord,
  fetchCommunityTags,
  listBannedWords,
  setBannedWordStatus,
} from './communityApi';

function successResponse<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ success: false, message }), {
    status,
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

describe('community tag dictionary and moderation API wrappers', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('VITE_WORKER_API_URL', 'https://worker.example');
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
    fetchMock.mockReset();
    clearApiToken();
    setApiToken('token-tag-api');
  });

  afterEach(() => {
    clearApiToken();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('fetches the tag dictionary with the default hot limit and passes through server order', async () => {
    fetchMock.mockResolvedValue(successResponse({
      tags: [
        { tag: '像素拼豆', name: '像素拼豆', usageCount: 12 },
        { tag: '字母 logo', name: '字母 Logo', usageCount: 0 },
      ],
    }));
    const result = await fetchCommunityTags();
    expect(result.ok).toBe(true);
    expect(result.data?.tags).toEqual([
      { tag: '像素拼豆', name: '像素拼豆', usageCount: 12 },
      { tag: '字母 logo', name: '字母 Logo', usageCount: 0 },
    ]);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(`${url.origin}${url.pathname}`).toBe('https://worker.example/api/community/tags');
    expect(url.searchParams.get('limit')).toBe('100');
  });

  it('posts the moderation pre-check with title and tags only', async () => {
    fetchMock.mockResolvedValue(successResponse({ violations: [{ field: 'tag', word: '坏词' }] }));
    const result = await checkCommunityModeration({ title: '标题', tags: ['像素拼豆'] });
    expect(result.ok).toBe(true);
    expect(result.data?.violations).toEqual([{ field: 'tag', word: '坏词' }]);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(`${url.origin}${url.pathname}`).toBe('https://worker.example/api/community/moderation/check');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ title: '标题', tags: ['像素拼豆'] });
  });

  it('surfaces a failed pre-check as a non-ok result for the caller to fall back', async () => {
    fetchMock.mockResolvedValue(errorResponse(401, '登录已失效，请重新登录'));
    const result = await checkCommunityModeration({ tags: ['x'] });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it('wraps the admin banned-words CRUD endpoints with admin credentials', async () => {
    fetchMock.mockResolvedValue(successResponse({ items: [{ id: 7, word: '坏词', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }] }));
    const list = await listBannedWords();
    expect(list.ok).toBe(true);
    expect(list.data?.items).toHaveLength(1);
    {
      const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
      expect(`${url.origin}${url.pathname}`).toBe('https://worker.example/api/admin/community/banned-words');
      expect(init.method).toBe('GET');
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toBe('Bearer token-tag-api');
    }

    fetchMock.mockResolvedValue(successResponse({ item: { id: 8, word: '黑词', status: 'active', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' } }));
    const created = await createBannedWord('  黑词  ');
    expect(created.ok).toBe(true);
    expect(created.data?.item.word).toBe('黑词');
    {
      const [url, init] = fetchMock.mock.calls[1] as [URL, RequestInit];
      expect(`${url.origin}${url.pathname}`).toBe('https://worker.example/api/admin/community/banned-words');
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ word: '  黑词  ' });
    }

    fetchMock.mockResolvedValue(successResponse({ item: { id: 8, word: '黑词', status: 'disabled', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z' } }));
    const toggled = await setBannedWordStatus(8, 'disabled');
    expect(toggled.ok).toBe(true);
    expect(toggled.data?.item.status).toBe('disabled');
    {
      const [url, init] = fetchMock.mock.calls[2] as [URL, RequestInit];
      expect(`${url.origin}${url.pathname}`).toBe('https://worker.example/api/admin/community/banned-words');
      expect(url.searchParams.get('id')).toBe('8');
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(String(init.body))).toEqual({ status: 'disabled' });
    }

    fetchMock.mockResolvedValue(successResponse({ deleted: true }));
    const removed = await deleteBannedWord(8);
    expect(removed.ok).toBe(true);
    expect(removed.data?.deleted).toBe(true);
    {
      const [url, init] = fetchMock.mock.calls[3] as [URL, RequestInit];
      expect(`${url.origin}${url.pathname}`).toBe('https://worker.example/api/admin/community/banned-words');
      expect(url.searchParams.get('id')).toBe('8');
      expect(init.method).toBe('DELETE');
    }
  });
});
