import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiGet,
  apiPost,
  checkApiHealth,
  clearAdminSession,
  clearApiToken,
  createAdminSession,
  getAdminSessionToken,
  getApiToken,
  setAdminSessionToken,
  setApiToken,
} from './api';
import { encodeGridOccupancy } from '../App';

function successResponse<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length(): number {
      return values.size;
    },
    clear(): void {
      values.clear();
    },
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    key(index: number): string | null {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      values.delete(key);
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
  };
}

describe('grid occupancy encoder', () => {
  it('encodes a single occupied cell MSB-first with standard padding', () => {
    expect(encodeGridOccupancy([['A']])).toEqual({
      width: 1,
      height: 1,
      occupancyBase64: 'gA==',
    });
  });

  it('encodes exactly eight cells in row-major bit order', () => {
    expect(encodeGridOccupancy([['A', null, 'B', null, null, 'C', null, 'D']])).toEqual({
      width: 8,
      height: 1,
      occupancyBase64: 'pQ==',
    });
  });

  it('pads a nine-bit tail and treats missing irregular-row cells as empty', () => {
    expect(encodeGridOccupancy([
      ['A', 'B', 'C'],
      ['D'],
      ['E', 'F', 'G'],
    ])).toEqual({
      width: 3,
      height: 3,
      occupancyBase64: '84A=',
    });
  });

  it('encodes a large grid without spread or btoa argument limits', () => {
    const grid = Array.from({ length: 512 }, () => Array<string | null>(2_048).fill('A'));
    const encoded = encodeGridOccupancy(grid);

    expect(encoded.width).toBe(2_048);
    expect(encoded.height).toBe(512);
    expect(encoded.occupancyBase64).toHaveLength(174_764);
    expect(encoded.occupancyBase64.startsWith('////////')).toBe(true);
    expect(encoded.occupancyBase64.endsWith('=')).toBe(true);
    expect(encoded.occupancyBase64.endsWith('==')).toBe(false);
  });
});

describe('Worker API client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('VITE_WORKER_API_URL', 'https://stellabean.pages.dev');
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
    fetchMock.mockReset();
    clearApiToken();
    clearAdminSession();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends the unlock secret only to the admin session exchange', async () => {
    fetchMock.mockResolvedValue(successResponse({ token: 'token' }));

    await apiPost('/api/auth/signin', { email: 'user@example.com', password: 'password' });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(request.headers);
    expect(headers.get('X-Worker-Secret')).toBeNull();
    expect(headers.get('Authorization')).toBeNull();
  });

  it('stores the short-lived admin session in sessionStorage only', () => {
    setAdminSessionToken('short-lived-admin-session');

    expect(getAdminSessionToken()).toBe('short-lived-admin-session');
    expect(sessionStorage.getItem('beadgrid_admin_session')).toBe('short-lived-admin-session');
    expect(localStorage.getItem('beadgrid_admin_session')).toBeNull();
  });

  it('exchanges the static secret once and uses the returned session for admin APIs', async () => {
    fetchMock
      .mockResolvedValueOnce(successResponse({ token: 'short-lived-admin-session', expiresAt: Date.now() + 1_800_000 }))
      .mockResolvedValueOnce(successResponse([]));

    await expect(createAdminSession('admin-only-secret')).resolves.toMatchObject({ ok: true });
    await apiGet('/api/admin/users');

    const unlockHeaders = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
    expect(unlockHeaders.get('X-Worker-Secret')).toBe('admin-only-secret');
    expect(unlockHeaders.get('X-Admin-Session')).toBeNull();

    const adminHeaders = new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers);
    expect(adminHeaders.get('X-Worker-Secret')).toBeNull();
    expect(adminHeaders.get('X-Admin-Session')).toBe('short-lived-admin-session');
    expect(localStorage.getItem('beadgrid_admin_session')).toBeNull();
  });

  it('clears the admin session after an admin authorization failure', async () => {
    setAdminSessionToken('expired-admin-session');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, message: 'expired' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));

    await apiGet('/api/admin/users');

    expect(getAdminSessionToken()).toBeNull();
  });

  it('uses default worker API URL when no API URL is configured', async () => {
    vi.stubEnv('VITE_WORKER_API_URL', '');
    fetchMock.mockResolvedValue(successResponse({ status: 'ok' }));

    await apiGet('/api/health');

    expect(fetchMock.mock.calls[0][0]).toEqual(new URL('https://stellabean-api.wwzj012.workers.dev/api/health'));
  });

  it('uses the same-origin Pages API from a Pages preview deployment', async () => {
    vi.stubEnv('VITE_WORKER_API_URL', 'https://stellabean.pages.dev');
    vi.stubGlobal('window', {
      location: {
        origin: 'https://ff02bb0e.stellabean.pages.dev',
        hostname: 'ff02bb0e.stellabean.pages.dev',
      },
    });
    fetchMock.mockResolvedValue(successResponse({ status: 'ok' }));

    await apiGet('/api/health');

    expect(fetchMock.mock.calls[0][0]).toEqual(new URL('https://ff02bb0e.stellabean.pages.dev/api/health'));
  });

  it('clears token and dispatches unauthorized event on HTTP 401', async () => {
    setApiToken('expired-jwt');
    const unauthorizedListener = vi.fn();
    const mockWindow = new EventTarget();
    vi.stubGlobal('window', mockWindow);
    mockWindow.addEventListener('unauthorized', unauthorizedListener);

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));

    await apiGet('/api/user-profile');

    expect(getApiToken()).toBeNull();
    expect(unauthorizedListener).toHaveBeenCalled();
  });

  it('preserves a structured 409 error code for callers that need to upload an asset first', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: false,
      message: '请先上传作品资源',
      code: 'WORK_ASSET_REQUIRED',
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(apiPost('/api/community/publish', {})).resolves.toMatchObject({
      ok: false,
      status: 409,
      error: '请先上传作品资源',
      code: 'WORK_ASSET_REQUIRED',
    });
  });

  it('retains errorCode alongside code so callers can prefer errorCode when both are present', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: false,
      message: '重复发布',
      code: 'LEGACY_DUPLICATE',
      errorCode: 'WORK_ALREADY_PUBLISHED',
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(apiPost('/api/community/publish', {})).resolves.toMatchObject({
      ok: false,
      status: 409,
      error: '重复发布',
      code: 'LEGACY_DUPLICATE',
      errorCode: 'WORK_ALREADY_PUBLISHED',
    });
  });

  it('ignores non-string structured error codes without rejecting a valid error response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: false,
      message: '参数无效',
      code: { value: 'NOT_SAFE' },
      errorCode: 422,
    }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await apiPost('/api/community/publish', {});

    expect(result).toMatchObject({ ok: false, status: 422, error: '参数无效' });
    expect(result.code).toBeUndefined();
    expect(result.errorCode).toBeUndefined();
  });

  it('stores remembered tokens in localStorage only', () => {
    setApiToken('persistent-token', true);

    expect(getApiToken()).toBe('persistent-token');
    expect(localStorage.getItem('beadgrid_worker_jwt')).toBe('persistent-token');
    expect(sessionStorage.getItem('beadgrid_worker_jwt')).toBeNull();
  });

  it('stores non-remembered tokens in sessionStorage only', () => {
    localStorage.setItem('beadgrid_worker_jwt', 'old-persistent-token');
    setApiToken('session-token', false);

    expect(getApiToken()).toBe('session-token');
    expect(localStorage.getItem('beadgrid_worker_jwt')).toBeNull();
    expect(sessionStorage.getItem('beadgrid_worker_jwt')).toBe('session-token');
  });

  it('retries sign-in exactly once after a network failure', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(successResponse({ token: 'token' }));

    const result = await apiPost(
      '/api/auth/signin',
      { email: 'user@example.com', password: 'password' },
      { timeoutMs: 15_000, networkRetries: 1, retryDelayMs: 0 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: true, status: 200 });
  });

  it('does not retry sign-up after a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await apiPost(
      '/api/auth/signup',
      { email: 'user@example.com', password: 'password' },
      { timeoutMs: 15_000, networkRetries: 1, retryDelayMs: 0 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      status: 0,
      isNetworkError: true,
      error: '无法连接后端，请检查网络或稍后重试',
    });
  });

  it('retries the health check once after a network failure', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(successResponse({ status: 'ok' }));

    await expect(checkApiHealth()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps request aborts to a clear Chinese timeout error', async () => {
    fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      })
    ));

    const result = await apiGet('/api/health', undefined, { timeoutMs: 5 });

    expect(result).toMatchObject({
      ok: false,
      status: 0,
      isNetworkError: true,
      error: '连接超时，请检查网络后重试',
    });
  });
});
