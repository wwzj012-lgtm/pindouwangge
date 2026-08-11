export interface ApiResp<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

const SESSION_TOKEN_KEY = 'beadgrid_worker_jwt';
let adminApiSecret: string | null = null;

export function setAdminApiSecret(secret: string): void {
  const normalizedSecret = secret.trim();
  adminApiSecret = normalizedSecret || null;
}

export function clearAdminApiSecret(): void {
  adminApiSecret = null;
}

export function hasAdminApiSecret(): boolean {
  return adminApiSecret !== null;
}

export function setApiToken(token: string): void {
  localStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearApiToken(): void {
  localStorage.removeItem(SESSION_TOKEN_KEY);
}

export function getApiToken(): string | null {
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

function apiBaseUrl(): string {
  const value = import.meta.env.VITE_WORKER_API_URL?.trim();
  if (!value) throw new Error('缺少 VITE_WORKER_API_URL 配置');
  return value.endsWith('/') ? value : `${value}/`;
}

function apiUrl(path: string, params?: Record<string, string>): URL {
  if (!path.startsWith('/api/')) throw new Error('只允许请求后端 /api 接口');
  const url = new URL(path, apiBaseUrl());
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

function isApiResp<T>(value: unknown): value is ApiResp<T> {
  return Boolean(
    value
      && typeof value === 'object'
      && 'success' in value
      && typeof (value as { success?: unknown }).success === 'boolean',
  );
}

async function apiRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  params?: Record<string, string>,
  timeoutMs = 8000,
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers({ Accept: 'application/json' });
    const token = getApiToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (path.startsWith('/api/admin/') && adminApiSecret) {
      headers.set('X-Worker-Secret', adminApiSecret);
    }
    if (method === 'POST') headers.set('Content-Type', 'application/json');

    const response = await fetch(apiUrl(path, params), {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      signal: controller.signal,
    });
    const contentType = response.headers.get('Content-Type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return { ok: false, status: response.status, error: `后端返回了非 JSON 响应 (${response.status})` };
    }

    const payload: unknown = await response.json();
    if (!isApiResp<T>(payload)) {
      return { ok: false, status: response.status, error: '后端响应格式不正确' };
    }
    if (!response.ok || !payload.success) {
      return { ok: false, status: response.status, error: payload.message ?? `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status, data: payload.data };
  } catch (error: unknown) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      error: timedOut
        ? `请求超时 (${timeoutMs}ms)`
        : error instanceof Error
          ? error.message
          : '网络请求失败',
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function apiGet<T>(path: string, params?: Record<string, string>): Promise<ApiResult<T>> {
  return apiRequest<T>('GET', path, undefined, params);
}

export function apiPost<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  return apiRequest<T>('POST', path, body);
}

export async function checkApiHealth(): Promise<boolean> {
  const result = await apiGet<{ status: string }>('/api/health');
  return result.ok && result.data?.status === 'ok';
}
