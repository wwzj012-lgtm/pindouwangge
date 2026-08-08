/**
 * Safe fetch helper that ensures responses are JSON and status is OK
 * Prevents "Unexpected token '<', <!doctype... is not valid JSON" errors on static hosts like Cloudflare Pages
 */
export interface SafeFetchResult<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

const DEFAULT_WORKER_API_BASE = 'https://stellabean-api.wwzj012.workers.dev';

function resolveApiUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  if (url.startsWith('/api')) {
    // 1. Check custom environment variable VITE_API_BASE_URL if set
    const envApiBase = import.meta.env.VITE_API_BASE_URL;
    if (envApiBase) {
      return `${envApiBase.replace(/\/$/, '')}${url}`;
    }

    // 2. Default: relative /api path (works with Cloudflare Pages Functions in functions/api/[[path]].ts)
    return url;
  }

  return url;
}

export async function safeFetchJson<T = any>(
  url: string,
  options?: RequestInit,
  timeoutMs: number = 8000
): Promise<SafeFetchResult<T>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const targetUrl = resolveApiUrl(url);
    const combinedOptions: RequestInit = {
      ...options,
      signal: options?.signal || controller.signal,
    };

    const res = await fetch(targetUrl, combinedOptions);
    clearTimeout(timeoutId);

    const contentType = res.headers.get('content-type') || '';

    // Check if server returned HTML (e.g., 404/405 page or SPA fallback index.html)
    if (!contentType.toLowerCase().includes('application/json')) {
      return {
        ok: false,
        status: res.status,
        error: `Server returned non-JSON response (${res.status} ${res.statusText || 'Method Not Allowed / Not Found'})`
      };
    }

    const data = await res.json();
    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        data: data as T
      };
    } else {
      return {
        ok: false,
        status: res.status,
        error: data?.message || data?.error || `HTTP ${res.status}`,
        data: data as T
      };
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isTimeout = err?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      error: isTimeout ? `Request timed out (${timeoutMs}ms)` : (err?.message || 'Network request failed')
    };
  }
}

