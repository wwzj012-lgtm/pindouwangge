import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiGet,
  apiPost,
  checkApiHealth,
  clearAdminApiSecret,
  clearApiToken,
  getApiToken,
  setApiToken,
  setAdminApiSecret,
} from './api';

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

describe('Worker API client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('VITE_WORKER_API_URL', 'https://stellabean.pages.dev');
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
    fetchMock.mockReset();
    clearApiToken();
    clearAdminApiSecret();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not send the admin secret to public requests', async () => {
    setAdminApiSecret('admin-only-secret');
    fetchMock.mockResolvedValue(successResponse({ token: 'token' }));

    await apiPost('/api/auth/signin', { email: 'user@example.com', password: 'password' });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(request.headers);
    expect(headers.get('X-Worker-Secret')).toBeNull();
    expect(headers.get('Authorization')).toBeNull();
  });

  it('uses the current origin when no API URL is configured', async () => {
    vi.stubEnv('VITE_WORKER_API_URL', '');
    vi.stubGlobal('window', { location: { origin: 'https://stellabean.pages.dev' } });
    fetchMock.mockResolvedValue(successResponse({ status: 'ok' }));

    await apiGet('/api/health');

    expect(fetchMock.mock.calls[0][0]).toEqual(new URL('https://stellabean.pages.dev/api/health'));
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
