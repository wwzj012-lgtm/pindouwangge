import { getAdminSessionToken, getApiToken } from '../../utils/api';

export interface AdminApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export type AdminRequest = <T>(path: string, init?: RequestInit) => Promise<AdminApiResult<T>>;

interface RequestDependencies {
  fetcher?: typeof fetch;
  userToken?: () => string | null;
  sessionToken?: () => string | null;
  timeoutMs?: number;
}

/** Preserve the existing bearer + admin-session contract. Never retry a write. */
export function createAdminRequest({
  fetcher = globalThis.fetch,
  userToken = getApiToken,
  sessionToken = getAdminSessionToken,
  timeoutMs = 15_000,
}: RequestDependencies = {}): AdminRequest {
  return async <T,>(path: string, init: RequestInit = {}): Promise<AdminApiResult<T>> => {
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    const timer = globalThis.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    if (init.signal?.aborted) controller.abort();
    else init.signal?.addEventListener('abort', cancel, { once: true });
    try {
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/json');
      const token = userToken();
      if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
      const creatingSession = path === '/api/admin/session' && init.method?.toUpperCase() === 'POST';
      if (path.startsWith('/api/admin/') && !creatingSession) {
        const adminSession = sessionToken();
        if (adminSession && !headers.has('X-Admin-Session')) headers.set('X-Admin-Session', adminSession);
      }
      if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      const response = await fetcher(path, { ...init, credentials: 'include', headers, signal: controller.signal });
      const payload: unknown = await response.json().catch(() => null);
      if (payload === null && response.status !== 204) {
        return { ok: false, status: response.status, error: '后台返回了无效响应，请重试。' };
      }
      const envelope = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as { success?: unknown; data?: unknown; message?: unknown }
        : null;
      return {
        ok: response.ok && envelope?.success !== false,
        status: response.status,
        data: (envelope && 'data' in envelope ? envelope.data : payload) as T | undefined,
        error: typeof envelope?.message === 'string' ? envelope.message : undefined,
      };
    } catch {
      return {
        ok: false,
        status: 0,
        error: timedOut ? '后台请求超时，请重试。' : init.signal?.aborted ? '请求已取消。' : '无法连接后台服务，请检查网络并重试。',
      };
    } finally {
      globalThis.clearTimeout(timer);
      init.signal?.removeEventListener('abort', cancel);
    }
  };
}
