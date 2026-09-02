export interface ApiResp<T> {
  success: boolean;
  data?: T;
  message?: string;
  code?: string;
  errorCode?: string;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  code?: string;
  errorCode?: string;
  isNetworkError?: boolean;
  /** Stable classification for callers that need to branch on an HTTP error. */
  errorKind?: 'unauthorized' | 'insufficient_credits' | 'conflict' | 'validation' | 'http' | 'network';
}

export interface ApiRequestOptions {
  timeoutMs?: number;
  networkRetries?: number;
  retryDelayMs?: number;
  /** Optional idempotency key for mutation requests. Existing callers are unaffected. */
  idempotencyKey?: string;
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
  // Production Pages deployments expose a same-origin `/api` proxy backed by
  // the Worker service binding.  Prefer it so browsers (especially on
  // networks that cannot reliably reach `workers.dev`) never need to make a
  // cross-origin request for authentication or health checks.  An explicitly
  // configured non-Workers URL still wins for self-hosted deployments.
  const configured = value || '';
  const browserOrigin = typeof window !== 'undefined' ? window.location?.origin : '';
  const browserHostname = typeof window !== 'undefined' ? window.location?.hostname : '';
  const isPagesHost = Boolean(
    browserHostname
      && (browserHostname === 'pages.dev' || browserHostname.endsWith('.pages.dev')),
  );
  const configuredIsWorkerOrigin = /^https:\/\/stellabean-api\.[^/]+\.workers\.dev\/?$/i.test(configured);
  // `.env.local` is intentionally used for local development and may contain
  // 127.0.0.1:8787. Vite also loads it during production builds, so never let
  // that development endpoint leak into a deployed Pages bundle.
  const configuredIsLocalDevOrigin = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/i.test(configured);
  const base = isPagesHost && browserOrigin && (!configured || configuredIsWorkerOrigin || configuredIsLocalDevOrigin)
    ? browserOrigin
    : (configured || WORKER_API_DEFAULT_URL);
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

type UntrustedApiResp<T> = Omit<ApiResp<T>, 'code' | 'errorCode'> & {
  code?: unknown;
  errorCode?: unknown;
};

function isApiResp<T>(value: unknown): value is UntrustedApiResp<T> {
  return Boolean(
    value
      && typeof value === 'object'
      && 'success' in value
      && typeof (value as { success?: unknown }).success === 'boolean',
  );
}

function apiErrorCodes(payload: UntrustedApiResp<unknown>): Pick<ApiResult<never>, 'code' | 'errorCode'> {
  const result: Pick<ApiResult<never>, 'code' | 'errorCode'> = {};
  if (typeof payload.code === 'string') result.code = payload.code;
  if (typeof payload.errorCode === 'string') result.errorCode = payload.errorCode;
  return result;
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

function classifyCreditError(status: number): ApiResult<never>['errorKind'] {
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'insufficient_credits';
  if (status === 409) return 'conflict';
  if (status === 422) return 'validation';
  return 'http';
}

async function apiRequestOnce<T>(
  method: ApiMethod,
  path: string,
  body: unknown,
  params: Record<string, string> | undefined,
  timeoutMs: number,
  adminUnlockSecret?: string,
  idempotencyKey?: string,
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
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
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
      return {
        ok: false,
        status: response.status,
        error: `后端返回了非 JSON 响应 (${response.status})`,
        errorKind: classifyCreditError(response.status),
      };
    }

    const payload: unknown = await response.json();
    if (!isApiResp<T>(payload)) {
      return { ok: false, status: response.status, error: '后端响应格式不正确', errorKind: classifyCreditError(response.status) };
    }
    if (!response.ok || !payload.success) {
      return {
        ok: false,
        status: response.status,
        error: payload.message ?? `HTTP ${response.status}`,
        errorKind: classifyCreditError(response.status),
        ...apiErrorCodes(payload),
      };
    }
    // The credits quote endpoint has existed in two compatible response
    // shapes during rollout: `{ success, data: { ...quote } }` and
    // `{ success, units, points, ... }`. Normalize the latter here so UI
    // callers can use the same typed result without a second request.
    const responseData = payload.data !== undefined
      ? payload.data
      : path === '/api/credits/quote'
        ? payload
        : undefined;
    return { ok: true, status: response.status, data: responseData as T | undefined };
  } catch (error: unknown) {
    const networkError = isAbortError(error) || isFetchNetworkError(error);
    return {
      ok: false,
      status: 0,
      error: networkError ? networkErrorMessage(error) : '网络请求失败，请检查网络后重试',
      isNetworkError: networkError,
      errorKind: networkError ? 'network' : 'http',
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
    const result = await apiRequestOnce<T>(method, path, body, params, timeoutMs, adminUnlockSecret, options.idempotencyKey);
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

/**
 * Credit/economy response models. Unknown fields are retained by the Worker so
 * callers can roll out optional accounting details without a client release.
 */
export interface CreditSummary {
  balanceUnits: number;
  availableUnits?: number;
  heldUnits?: number;
  expiringUnits?: number;
  purchasedUnits?: number;
  checkinUnits?: number;
  membershipUnits?: number;
  nextExpiryAt?: number | null;
  checkin?: {
    eligible: boolean;
    completed?: boolean;
    rewardUnits?: number;
    nextRewardUnits?: number;
    nextRewardPoints?: number;
    streakDay?: number;
    checkedInAt?: number | null;
    nextAvailableAt?: number | null;
  };
  [key: string]: unknown;
}

export interface CreditQuoteInput {
  width: number;
  height: number;
  quality?: 'standard' | 'hd';
  hd?: boolean;
  smartSaving?: boolean;
  operation?: string;
  [key: string]: unknown;
}

export interface CreditQuote {
  units?: number;
  points?: number;
  quoteHash?: string;
  expiresAt?: number;
  totalUnits: number;
  totalPoints?: number;
  baseUnits?: number;
  multiplier?: number;
  free?: boolean;
  [key: string]: unknown;
}

export interface CreditCheckinResult {
  grantedUnits: number;
  balanceUnits?: number;
  streakDay?: number;
  nextAvailableAt?: number | null;
  alreadyClaimed?: boolean;
  [key: string]: unknown;
}

/**
 * Stable identity supplied when a pattern is quoted or marked complete.
 * Pricing is deliberately absent: the Worker is the sole source of all
 * monetary values and entitlement decisions.
 */
export interface PatternCompletionInput {
  workKey: string;
  sourceHash: string;
  width: number;
  height: number;
  /** Canonical padded Base64; cells are packed MSB-first, one occupancy bit per cell. */
  occupancyBase64: string;
  savingTarget: 0 | 15 | 25 | 40;
}

export type PatternCompletionEntitlementStatus =
  | 'unpaid'
  | 'paid'
  | 'pending_top_up'
  | (string & {});

/** Server-owned record of the completion entitlement for this work identity. */
export interface PatternCompletionEntitlement {
  status: PatternCompletionEntitlementStatus;
  paidNonEmptyBeads?: number;
  [key: string]: unknown;
}

/**
 * A Worker-calculated completion price. Values may be fractional; clients
 * must render these fields as returned and must not recompute totals.
 */
export interface PatternCompletionQuote {
  base: number;
  multiplier: number;
  discount: number;
  paid: number;
  additional: number;
  total: number;
  entitlement: PatternCompletionEntitlement;
  [key: string]: unknown;
}

/** Stable identity for one pre-entitlement local pattern. */
export interface LegacyPatternImportItem {
  workKey: string;
  sourceHash: string;
  gridHash: string;
  nonEmptyBeads: number;
}

export interface LegacyPatternImportResultItem {
  workKey: string;
  sourceHash: string;
  gridHash: string;
  entitlementId?: string;
  status: 'IMPORTED' | 'ALREADY_REGISTERED';
}

export interface LegacyPatternImportResult {
  batchId: string;
  requestedCount: number;
  importedCount: number;
  cumulativeImportedCount: number;
  remainingImports: number;
  eligibleUntil: number;
  results: LegacyPatternImportResultItem[];
}

function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to a non-cryptographic, collision-resistant browser key.
  }
  return `credit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function creditRequestOptions(options?: ApiRequestOptions): ApiRequestOptions {
  return {
    ...options,
    idempotencyKey: options?.idempotencyKey?.trim() || newIdempotencyKey(),
  };
}

/** Fetches the authenticated user's current credit balance and expiry details. */
export function apiGetCreditsSummary(options?: ApiRequestOptions): Promise<ApiResult<CreditSummary>> {
  return apiGet<CreditSummary>('/api/credits/summary', undefined, creditRequestOptions(options));
}

/** Requests a server-calculated quote before applying, saving, or exporting work. */
export function apiQuoteCredits(
  input: CreditQuoteInput,
  options?: ApiRequestOptions,
): Promise<ApiResult<CreditQuote>> {
  return apiPost<CreditQuote>('/api/credits/quote', input, creditRequestOptions(options));
}

/** Claims the daily credit check-in reward (idempotent on retries/double clicks). */
export function apiCheckinCredits(options?: ApiRequestOptions): Promise<ApiResult<CreditCheckinResult>> {
  return apiPost<CreditCheckinResult>('/api/credits/checkin', {}, creditRequestOptions(options));
}

/**
 * Gets the authoritative price and entitlement state for completing a pattern.
 * This request never derives prices from bead counts on the client.
 */
export function apiQuotePatternCompletion(
  input: PatternCompletionInput,
  options?: ApiRequestOptions,
): Promise<ApiResult<PatternCompletionQuote>> {
  return apiPost<PatternCompletionQuote>('/api/credits/completion/quote', input, options);
}

/**
 * Applies the completion charge or top-up and refreshes its entitlement.
 * Every call carries an Idempotency-Key, including callers that do not supply
 * one explicitly, so a retry cannot create an additional debit.
 */
export function apiCompletePattern(
  input: PatternCompletionInput,
  options?: ApiRequestOptions,
): Promise<ApiResult<PatternCompletionQuote>> {
  return apiPost<PatternCompletionQuote>(
    '/api/credits/completion/complete',
    input,
    creditRequestOptions(options),
  );
}

/**
 * Offers a bounded batch of old local patterns to the Worker for legacy
 * entitlement. Account age and migration eligibility remain server-owned.
 */
export function apiImportLegacyPatterns(
  items: readonly LegacyPatternImportItem[],
  options?: ApiRequestOptions,
): Promise<ApiResult<LegacyPatternImportResult>> {
  if (items.length === 0 || items.length > 50) {
    return Promise.resolve({
      ok: false,
      status: 422,
      error: '旧作品迁移每次必须包含 1 到 50 项',
      errorKind: 'validation',
    });
  }
  return apiPost<LegacyPatternImportResult>(
    '/api/credits/completion/legacy-import',
    { items: [...items] },
    creditRequestOptions(options),
  );
}

// Descriptive aliases for UI/account integrations.
export const getCreditSummary = apiGetCreditsSummary;
export const quoteCredits = apiQuoteCredits;
export const checkinCredits = apiCheckinCredits;

export async function checkApiHealth(): Promise<boolean> {
  const result = await apiGet<{ status: string }>('/api/health', undefined, HEALTH_REQUEST_OPTIONS);
  return result.ok && result.data?.status === 'ok';
}
