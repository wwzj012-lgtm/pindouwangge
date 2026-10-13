import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminRequest } from './adminRequest';

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const dependencies = { userToken: () => 'synthetic-user-token', sessionToken: () => 'synthetic-admin-token' };
afterEach(() => { vi.useRealTimers(); });

describe('admin request contract and recovery', () => {
  it('preserves bearer, admin session and included cookie credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ success: true, data: { items: [] } }));
    const result = await createAdminRequest({ ...dependencies, fetcher })('/api/admin/users');
    const [, init] = fetcher.mock.calls[0];
    expect(result).toMatchObject({ ok: true, status: 200, data: { items: [] } });
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-user-token');
    expect(new Headers(init?.headers).get('X-Admin-Session')).toBe('synthetic-admin-token');
  });
  it('does not send the privileged session header to session exchange', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ success: true, data: { authenticated: true } }));
    await createAdminRequest({ ...dependencies, fetcher })('/api/admin/session', { method: 'POST', body: JSON.stringify({ trustedDevice: true }) });
    const init = fetcher.mock.calls[0][1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"trustedDevice":true}');
    expect(new Headers(init?.headers).has('X-Admin-Session')).toBe(false);
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  });
  it('preserves explicitly provided authorization headers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ success: true }));
    await createAdminRequest({ ...dependencies, fetcher })('/api/admin/users', { headers: { Authorization: 'Bearer custom', 'X-Admin-Session': 'custom-admin' } });
    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer custom'); expect(headers.get('X-Admin-Session')).toBe('custom-admin');
  });
  it('does not infer permissions from a 403 response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ success: false, message: 'denied' }, 403));
    expect(await createAdminRequest({ ...dependencies, fetcher })('/api/admin/users')).toMatchObject({ ok: false, status: 403, error: 'denied' });
  });
  it('honors an unsuccessful envelope even with HTTP 200', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ success: false, message: 'rejected' }));
    expect(await createAdminRequest({ ...dependencies, fetcher })('/api/admin/users')).toMatchObject({ ok: false, status: 200, error: 'rejected' });
  });
  it('rejects malformed JSON instead of treating it as successful empty data', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>gateway error</html>'));
    expect(await createAdminRequest({ ...dependencies, fetcher })('/api/admin/dashboard')).toMatchObject({ ok: false, status: 200 });
  });
  it('returns a recoverable network result and never retries a write', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await createAdminRequest({ ...dependencies, fetcher })('/api/admin/update-user', { method: 'POST', body: '{}' })).toMatchObject({ ok: false, status: 0, error: expect.stringContaining('重试') });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('clears timeout after a completed request', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ success: true, data: [] }));
    await createAdminRequest({ ...dependencies, fetcher })('/api/admin/users');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('aborts timed-out requests and offers recovery', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })));
    const pending = createAdminRequest({ ...dependencies, fetcher, timeoutMs: 20 })('/api/admin/session');
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toMatchObject({ ok: false, status: 0, error: expect.stringContaining('超时') });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('relays caller cancellation without retrying', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })));
    const pending = createAdminRequest({ ...dependencies, fetcher })('/api/admin/users', { signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, status: 0, error: '请求已取消。' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retains legacy unwrapped payload support', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([{ uid: 'synthetic' }]));
    expect(await createAdminRequest({ ...dependencies, fetcher })('/api/admin/users')).toMatchObject({ ok: true, data: [{ uid: 'synthetic' }] });
  });
});
