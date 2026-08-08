// Cloudflare Pages Function proxy for /api/*
// Routes requests from stellabean.pages.dev/api/* to the stellabean-api worker

interface Env {
  WORKER_API_BASE?: string;
}

export const onRequest = async (context: { request: Request; env: Record<string, string> }) => {
  const url = new URL(context.request.url);
  const targetBase = context.env.WORKER_API_BASE || 'https://stellabean-api.wwzj012.workers.dev';
  
  const targetUrl = new URL(url.pathname + url.search, targetBase);

  // Clone headers from original request
  const headers = new Headers(context.request.headers);
  headers.set('Host', new URL(targetBase).host);

  try {
    const response = await fetch(targetUrl.toString(), {
      method: context.request.method,
      headers,
      body: ['GET', 'HEAD'].includes(context.request.method) ? undefined : context.request.body,
    });

    return response;
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Proxy request failed', details: err?.message }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
