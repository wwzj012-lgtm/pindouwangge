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

export async function safeFetchJson<T = any>(
  url: string,
  options?: RequestInit
): Promise<SafeFetchResult<T>> {
  try {
    const res = await fetch(url, options);
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
    return {
      ok: false,
      status: 0,
      error: err?.message || 'Network request failed'
    };
  }
}
