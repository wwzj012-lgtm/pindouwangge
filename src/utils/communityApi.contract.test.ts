import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearApiToken, setApiToken } from './api';
import { getCommunityPublishErrorCode, publishCommunityPost, reactToCommunityPost } from './communityApi';

describe('community publish HTTP error contract (real API normalization and parser)', () => {
  const fetchMock = vi.fn();
  const input = { title: 'Work', description: '', visibility: 'public' as const, tags: [], workId: 'work_contract' };

  beforeEach(() => {
    vi.stubEnv('VITE_WORKER_API_URL', 'https://worker.test');
    vi.stubGlobal('fetch', fetchMock);
    for (const name of ['localStorage', 'sessionStorage']) {
      const values = new Map<string, string>();
      vi.stubGlobal(name, {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      });
    }
    fetchMock.mockReset();
    clearApiToken();
  });

  afterEach(() => {
    clearApiToken();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ['Worker message-only response', 409, { message: 'WORK_ASSET_REQUIRED' }, 'WORK_ASSET_REQUIRED'],
    ['errorCode before code and message', 409, { errorCode: 'OWNERSHIP_DENIED', code: 'WORK_ASSET_REQUIRED', message: 'WORK_ASSET_REQUIRED' }, 'OWNERSHIP_DENIED'],
    ['code before message', 409, { code: 'DUPLICATE_POST', message: 'WORK_ASSET_REQUIRED' }, 'DUPLICATE_POST'],
    ['structured errorCode', 409, { errorCode: 'WORK_ASSET_REQUIRED', message: 'Asset needed' }, 'WORK_ASSET_REQUIRED'],
    ['structured code', 409, { code: 'WORK_ASSET_REQUIRED', message: 'Asset needed' }, 'WORK_ASSET_REQUIRED'],
    ['untrusted non-string codes', 409, { code: 1, errorCode: {}, message: 'WORK_ASSET_REQUIRED' }, 'WORK_ASSET_REQUIRED'],
    ['completion required', 402, { message: 'WORK_ASSET_REQUIRED' }, null],
    ['ownership denied', 403, { message: 'WORK_ASSET_REQUIRED' }, null],
    ['legacy import expired', 410, { message: 'WORK_ASSET_REQUIRED' }, null],
    ['server error', 500, { message: 'WORK_ASSET_REQUIRED' }, null],
    ['different conflict', 409, { message: 'This work already has an active community post' }, null],
    ['message prefix', 409, { message: 'Error: WORK_ASSET_REQUIRED' }, null],
    ['message suffix', 409, { message: 'WORK_ASSET_REQUIRED ' }, null],
    ['arbitrary message', 409, { message: 'Please upload a picture' }, null],
  ])('classifies %s without interpreting arbitrary messages as codes', async (_label, status, fields, expected) => {
    // This is the actual Worker error envelope, not a mocked parser result.
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, ...fields }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await publishCommunityPost(input);

    expect(result).toMatchObject({ ok: false, status, error: fields.message });
    expect(getCommunityPublishErrorCode(result)).toBe(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never treats a successful response as an error', () => {
    expect(getCommunityPublishErrorCode({ ok: true, status: 201, error: 'WORK_ASSET_REQUIRED' })).toBeNull();
  });

  it.each([
    ['favorite', true], ['favorite', false], ['like', true], ['like', false],
  ] as const)('serializes the actual fetch request for %s active=%s', async (reaction, active) => {
    const id = 'post_1234567890abcdef';
    setApiToken('local-contract-token');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { active } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const result = await reactToCommunityPost(id, reaction, active);
    expect(result).toMatchObject({ ok: true, status: 200, data: { active } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const request = new Request(url, init);
    expect(request.method).toBe(active ? 'PUT' : 'DELETE');
    expect(new URL(request.url).pathname).toBe(`/api/community/posts/${reaction}`);
    expect(new URL(request.url).searchParams.get('id')).toBe(id);
    expect(request.headers.get('Authorization')).toBe('Bearer local-contract-token');
    if (active) {
      expect(request.headers.get('Content-Type')).toBe('application/json');
      expect(await request.json()).toEqual({ id });
    } else {
      expect(await request.text()).toBe('');
    }
  });

  it.each([true, false])('preserves backend rejection of an illegal post id, active=%s', async (active) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, message: 'Invalid community post id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    }));
    const id = 'invalid&id=post_1234567890abcdef';
    const result = await reactToCommunityPost(id, 'favorite', active);
    expect(result).toMatchObject({ ok: false, status: 400, error: 'Invalid community post id' });
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.getAll('id')).toEqual([id]);
  });
});
