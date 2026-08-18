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
  isNetworkError?: boolean;
}

export interface ApiRequestOptions {
  timeoutMs?: number;
  networkRetries?: number;
  retryDelayMs?: number;
}

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export const DEFAULT_API_TIMEOUT_MS = 8_000;
export const AUTH_API_TIMEOUT_MS = 15_000;
export const HEALTH_REQUEST_OPTIONS: Readonly<ApiRequestOptions> = {
  networkRetries: 1,
  retryDelayMs: 300,
};
export const SIGNIN_REQUEST_OPTIONS: Readonly<ApiRequestOptions> = {
  timeoutMs: AUTH_API_TIMEOUT_MS,
  networkRetries: 1,
  retryDelayMs: 400,
};
export const SIGNUP_REQUEST_OPTIONS: Readonly<ApiRequestOptions> = {
  timeoutMs: AUTH_API_TIMEOUT_MS,
  networkRetries: 0,
};

const SESSION_TOKEN_KEY = 'beadgrid_worker_jwt';
const ADMIN_SESSION_TOKEN_KEY = 'beadgrid_admin_session';
const ADMIN_SESSION_ENDPOINT = '/api/admin/session';

interface AdminSessionResponse {
  token: string;
  expiresAt: number;
}

function getLocalStorage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function getSessionStorage(): Storage | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

function removeApiToken(storage: Storage | null): void {
  try {
    storage?.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Storage can be unavailable in private browsing contexts.
  }
}

function removeAdminSession(storage: Storage | null): void {
  try {
    storage?.removeItem(ADMIN_SESSION_TOKEN_KEY);
  } catch {
    // Storage can be unavailable in private browsing contexts.
  }
}

export function setAdminSessionToken(token: string): void {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    clearAdminSession();
    return;
  }
  try {
    getSessionStorage()?.setItem(ADMIN_SESSION_TOKEN_KEY, normalizedToken);
  } catch {
    // An in-memory fallback would keep a privileged session after the tab closes.
    // Fail closed when sessionStorage is unavailable.
  }
}

export function clearAdminSession(): void {
  removeAdminSession(getSessionStorage());
}

export function getAdminSessionToken(): string | null {
  try {
    return getSessionStorage()?.getItem(ADMIN_SESSION_TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function hasAdminSession(): boolean {
  return getAdminSessionToken() !== null;
}

export function setApiToken(token: string, persist = true): void {
  const persistentStorage = getLocalStorage();
  const sessionStorage = getSessionStorage();
  const targetStorage = persist ? persistentStorage : sessionStorage;
  const otherStorage = persist ? sessionStorage : persistentStorage;

  removeApiToken(otherStorage);
  try {
    targetStorage?.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    // The in-memory auth state remains usable when Web Storage is blocked.
  }
}

export function clearApiToken(): void {
  removeApiToken(getLocalStorage());
  removeApiToken(getSessionStorage());
}

export function getApiToken(): string | null {
  try {
    return getLocalStorage()?.getItem(SESSION_TOKEN_KEY)
      ?? getSessionStorage()?.getItem(SESSION_TOKEN_KEY)
      ?? null;
  } catch {
    return null;
  }
}

export const WORKER_API_DEFAULT_URL = 'https://stellabean-api.wwzj012.workers.dev';

function apiBaseUrl(): string {
  const value = import.meta.env.VITE_WORKER_API_URL?.trim();
  const base = value || WORKER_API_DEFAULT_URL;
  return base.endsWith('/') ? base : `${base}/`;
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isFetchNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /failed to fetch|networkerror|network request failed|load failed/i.test(error.message);
}

function networkErrorMessage(error: unknown): string {
  if (isAbortError(error)) return '连接超时，请检查网络后重试';
  if (isFetchNetworkError(error)) return '无法连接后端，请检查网络或稍后重试';
  return '网络请求失败，请检查网络后重试';
}

function normalizedTimeout(timeoutMs?: number): number {
  if (timeoutMs === undefined) return DEFAULT_API_TIMEOUT_MS;
  return Math.max(1, Math.floor(timeoutMs));
}

function normalizedRetries(retries?: number): number {
  return Math.max(0, Math.floor(retries ?? 0));
}

function allowedNetworkRetries(method: ApiMethod, path: string, requestedRetries?: number): number {
  if (method === 'GET' || (method === 'POST' && path === '/api/auth/signin')) {
    return normalizedRetries(requestedRetries);
  }
  return 0;
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, Math.max(0, delayMs)));
}

async function apiRequestOnce<T>(
  method: ApiMethod,
  path: string,
  body: unknown,
  params: Record<string, string> | undefined,
  timeoutMs: number,
  adminUnlockSecret?: string,
): Promise<ApiResult<T>> {
  let url: URL;
  try {
    url = apiUrl(path, params);
  } catch (error: unknown) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : '请求配置错误',
      isNetworkError: false,
    };
  }

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers({ Accept: 'application/json' });
    const token = getApiToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (path === ADMIN_SESSION_ENDPOINT && adminUnlockSecret) {
      // The manually entered secret is sent once to exchange it for a short-lived session.
      headers.set('X-Worker-Secret', adminUnlockSecret);
    } else if (path.startsWith('/api/admin/')) {
      const adminSession = getAdminSessionToken();
      if (adminSession) headers.set('X-Admin-Session', adminSession);
    }
    if (method === 'POST' || method === 'PUT') headers.set('Content-Type', 'application/json');

    const response = await fetch(url, {
      method,
      headers,
      body: method === 'POST' || method === 'PUT' ? JSON.stringify(body ?? {}) : undefined,
      signal: controller.signal,
    });
    if (response.status === 401) {
      if (path.startsWith('/api/admin/') && path !== ADMIN_SESSION_ENDPOINT) {
        clearAdminSession();
      }
      if (path !== '/api/auth/signin' && path !== '/api/auth/signup') {
        clearApiToken();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('unauthorized'));
        }
      }
    } else if (path.startsWith('/api/admin/') && path !== ADMIN_SESSION_ENDPOINT && response.status === 403) {
      clearAdminSession();
    }
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
    const networkError = isAbortError(error) || isFetchNetworkError(error);
    return {
      ok: false,
      status: 0,
      error: networkError ? networkErrorMessage(error) : '网络请求失败，请检查网络后重试',
      isNetworkError: networkError,
    };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function apiRequest<T>(
  method: ApiMethod,
  path: string,
  body?: unknown,
  params?: Record<string, string>,
  options: ApiRequestOptions = {},
  adminUnlockSecret?: string,
): Promise<ApiResult<T>> {
  const timeoutMs = normalizedTimeout(options.timeoutMs);
  const networkRetries = allowedNetworkRetries(method, path, options.networkRetries);
  const retryDelayMs = Math.max(0, Math.floor(options.retryDelayMs ?? 300));

  for (let attempt = 0; attempt <= networkRetries; attempt += 1) {
    const result = await apiRequestOnce<T>(method, path, body, params, timeoutMs, adminUnlockSecret);
    if (!result.isNetworkError || result.status !== 0 || attempt === networkRetries) return result;
    await waitForRetry(retryDelayMs);
  }

  return { ok: false, status: 0, error: '网络请求失败，请检查网络后重试', isNetworkError: true };
}

export function apiGet<T>(
  path: string,
  params?: Record<string, string>,
  options?: ApiRequestOptions,
): Promise<ApiResult<T>> {
  return apiRequest<T>('GET', path, undefined, params, options);
}

export function apiPost<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<ApiResult<T>> {
  return apiRequest<T>('POST', path, body, undefined, options);
}

export function apiPut<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<ApiResult<T>> {
  return apiRequest<T>('PUT', path, body, undefined, options);
}

export function apiDelete<T>(path: string, params?: Record<string, string>, options?: ApiRequestOptions): Promise<ApiResult<T>> {
  return apiRequest<T>('DELETE', path, undefined, params, options);
}

/** Builds a public Worker API URL without exposing storage binding details to the client. */
export function apiPublicUrl(path: string, params?: Record<string, string>): string {
  return apiUrl(path, params).toString();
}

/** Posts a known-size image Blob to the Worker community asset endpoint. */
export async function apiPostBlob<T>(
  path: string,
  body: Blob,
  contentType: string,
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
): Promise<ApiResult<T>> {
  let url: URL;
  try {
    url = apiUrl(path);
  } catch (error: unknown) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : '请求配置错误' };
  }

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), normalizedTimeout(timeoutMs));
  try {
    const headers = new Headers({ Accept: 'application/json', 'Content-Type': contentType });
    const token = getApiToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    // Browsers set Content-Length for a known-size Blob; script code may not set that forbidden header.
    const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    if (response.status === 401) {
      clearApiToken();
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('unauthorized'));
    }
    const contentTypeHeader = response.headers.get('Content-Type') ?? '';
    if (!contentTypeHeader.toLowerCase().includes('application/json')) {
      return { ok: false, status: response.status, error: `后端返回了非 JSON 响应 (${response.status})` };
    }
    const payload: unknown = await response.json();
    if (!isApiResp<T>(payload)) return { ok: false, status: response.status, error: '后端响应格式不正确' };
    if (!response.ok || !payload.success) {
      return { ok: false, status: response.status, error: payload.message ?? `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status, data: payload.data };
  } catch (error: unknown) {
    return { ok: false, status: 0, error: networkErrorMessage(error), isNetworkError: true };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function createAdminSession(secret: string): Promise<ApiResult<AdminSessionResponse>> {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    return { ok: false, status: 0, error: '请输入管理员密钥' };
  }

  const result = await apiRequest<AdminSessionResponse>(
    'POST',
    ADMIN_SESSION_ENDPOINT,
    {},
    undefined,
    { timeoutMs: AUTH_API_TIMEOUT_MS, networkRetries: 0 },
    normalizedSecret,
  );
  const token = result.data?.token?.trim();
  if (!result.ok || !token || !Number.isFinite(result.data?.expiresAt)) {
    if (result.ok) return { ok: false, status: result.status, error: '后台会话响应无效' };
    return result;
  }

  setAdminSessionToken(token);
  return result;
}

/** Fetches an authenticated binary response without serializing the body into JSON. */
export async function apiGetBlob(path: string, params?: Record<string, string>, timeoutMs = DEFAULT_API_TIMEOUT_MS): Promise<ApiResult<Blob>> {
  let url: URL;
  try {
    url = apiUrl(path, params);
  } catch (error: unknown) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : '请求配置错误' };
  }
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), normalizedTimeout(timeoutMs));
  try {
    const headers = new Headers({ Accept: 'image/webp, image/png' });
    const token = getApiToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (response.status === 401) {
      clearApiToken();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('unauthorized'));
      }
    }
    const type = response.headers.get('Content-Type')?.split(';', 1)[0]?.toLowerCase();
    if (!response.ok || (type !== 'image/webp' && type !== 'image/png')) {
      return { ok: false, status: response.status, error: `预览图不可用 (${response.status})` };
    }
    return { ok: true, status: response.status, data: await response.blob() };
  } catch (error: unknown) {
    return { ok: false, status: 0, error: networkErrorMessage(error), isNetworkError: true };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function checkApiHealth(): Promise<boolean> {
  const result = await apiGet<{ status: string }>('/api/health', undefined, HEALTH_REQUEST_OPTIONS);
  return result.ok && result.data?.status === 'ok';
}
