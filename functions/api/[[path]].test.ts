import { describe, expect, it, vi } from 'vitest';
import { handleApiGateway, type BackendApiBinding } from './[[path]]';

function backend(response: Response): BackendApiBinding {
  return { fetch: vi.fn().mockResolvedValue(response) };
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://stellabean.pages.dev${path}`, init);
}

function uploadStream(path: string, type: string, size: number, length?: string, open = false, method = 'POST') {
  let sent = 0;
  let cancelled = false;
  const payload = type === 'application/json'
    ? new TextEncoder().encode(`{"data":"${'x'.repeat(size - 11)}"}`)
    : new Uint8Array(size);
  if (type === 'image/png') payload.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent < size) {
        const end = Math.min(sent + 64 * 1024, size);
        controller.enqueue(payload.subarray(sent, end));
        sent = end;
      } else if (!open) controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const headers = new Headers({ 'Content-Type': type });
  if (length !== undefined) headers.set('Content-Length', length);
  return {
    request: request(path, { method, headers, body, duplex: 'half' } as RequestInit),
    cancelled: () => cancelled,
    bytesRead: () => sent,
  };
}

describe('Pages API gateway', () => {
  it('forwards health GET requests to the fixed backend service', async () => {
    const BACKEND_API = backend(new Response('{"success":true}', { status: 200 }));

    const response = await handleApiGateway(request('/api/health'), { BACKEND_API });

    expect(response.status).toBe(200);
    expect(BACKEND_API.fetch).toHaveBeenCalledOnce();
    const [forwarded] = vi.mocked(BACKEND_API.fetch).mock.calls[0];
    expect(forwarded).toBeInstanceOf(Request);
    expect((forwarded as Request).url).toBe('https://stellabean-api.internal/api/health');
    expect((forwarded as Request).method).toBe('GET');
  });

  it('forwards sign-in body, query, JWT, and the runtime admin secret', async () => {
    const BACKEND_API = backend(new Response('{"success":true}', { status: 200 }));
    const response = await handleApiGateway(request('/api/auth/signin?source=pages', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer user-token',
        'Content-Type': 'application/json',
        'X-Worker-Secret': 'runtime-admin-secret',
      },
      body: JSON.stringify({ email: 'user@example.com', password: 'password' }),
    }), { BACKEND_API });

    expect(response.status).toBe(200);
    const [forwarded] = vi.mocked(BACKEND_API.fetch).mock.calls[0];
    const backendRequest = forwarded as Request;
    expect(backendRequest.url).toBe('https://stellabean-api.internal/api/auth/signin?source=pages');
    expect(backendRequest.headers.get('Authorization')).toBe('Bearer user-token');
    expect(backendRequest.headers.get('Content-Type')).toBe('application/json');
    expect(backendRequest.headers.get('X-Worker-Secret')).toBe('runtime-admin-secret');
    await expect(backendRequest.json()).resolves.toEqual({ email: 'user@example.com', password: 'password' });
  });

  it('forwards OPTIONS for backend CORS compatibility', async () => {
    const BACKEND_API = backend(new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' },
    }));

    const response = await handleApiGateway(request('/api/auth/signin', { method: 'OPTIONS' }), { BACKEND_API });

    expect(response.status).toBe(204);
    const [forwarded] = vi.mocked(BACKEND_API.fetch).mock.calls[0];
    expect((forwarded as Request).method).toBe('OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
  });

  it('preserves upstream errors and strips hop-by-hop response headers', async () => {
    const BACKEND_API = backend(new Response('{"success":false,"message":"denied"}', {
      status: 401,
      headers: {
        Connection: 'keep-alive, X-Internal-Hop',
        'Keep-Alive': 'timeout=5',
        'X-Internal-Hop': 'secret',
        'X-Trace-Id': 'trace-1',
      },
    }));

    const response = await handleApiGateway(request('/api/private'), { BACKEND_API });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ success: false, message: 'denied' });
    expect(response.headers.get('X-Trace-Id')).toBe('trace-1');
    expect(response.headers.get('Keep-Alive')).toBeNull();
    expect(response.headers.get('X-Internal-Hop')).toBeNull();
  });

  it('rejects non-api paths without calling the backend', async () => {
    const BACKEND_API = backend(new Response(null, { status: 200 }));

    const response = await handleApiGateway(request('/assets/app.js'), { BACKEND_API });

    expect(response.status).toBe(404);
    expect(BACKEND_API.fetch).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods, protocol upgrades, and bodies over 1 MiB', async () => {
    const BACKEND_API = backend(new Response(null, { status: 200 }));
    const unsupportedMethod = await handleApiGateway(request('/api/health', { method: 'BREW' }), { BACKEND_API });
    const protocolUpgrade = await handleApiGateway(request('/api/health', { headers: { Upgrade: 'websocket' } }), { BACKEND_API });
    const largeBody = await handleApiGateway(request('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Length': '1048577' },
      body: 'x',
    }), { BACKEND_API });
    const streamedLargeBody = await handleApiGateway(request('/api/auth/signin', {
      method: 'POST',
      body: 'x'.repeat(1_048_577),
    }), { BACKEND_API });

    expect(unsupportedMethod.status).toBe(405);
    expect(protocolUpgrade.status).toBe(400);
    expect(largeBody.status).toBe(413);
    expect(streamedLargeBody.status).toBe(413);
    expect(BACKEND_API.fetch).not.toHaveBeenCalled();
  });

  for (const { path, type, limit } of [
    { path: '/api/auth/signin', type: 'application/json', limit: 1024 * 1024 },
    { path: '/api/community/assets', type: 'image/png', limit: 15 * 1024 * 1024 },
  ]) {
    for (const length of [undefined, '1']) {
      for (const delta of [-1, 0, 1]) {
        it(`${type}: enforces actual ${limit}${delta < 0 ? '' : '+'}${delta} bytes with length ${length ?? 'absent'}`, async () => {
          const size = limit + delta;
          const input = uploadStream(path, type, size, length, delta > 0);
          const fetch = vi.fn(async (forwarded: Request) => {
            const bytes = new Uint8Array(await forwarded.arrayBuffer());
            // Match the backend upload contract using the actual Request body.
            expect(forwarded.headers.get('Content-Length')).toBe(String(bytes.byteLength));
            expect(bytes.byteLength).toBe(size);
            if (type === 'image/png') expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
            else expect(JSON.parse(new TextDecoder().decode(bytes)).data.length).toBe(size - 11);
            return new Response(null, { status: 201 });
          });
          const response = await handleApiGateway(input.request, { BACKEND_API: { fetch } as BackendApiBinding });
          expect(response.status).toBe(delta > 0 ? 413 : 201);
          expect(fetch).toHaveBeenCalledTimes(delta > 0 ? 0 : 1);
          expect(input.cancelled()).toBe(delta > 0);
          expect(input.request.body?.locked).toBe(false);
        });
      }
    }
  }

  it('cancels a declared overflow before reading any bytes', async () => {
    for (const [path, type, limit] of [
      ['/api/auth/signin', 'application/json', 1024 * 1024],
      ['/api/community/assets', 'image/png', 15 * 1024 * 1024],
    ] as const) {
      const input = uploadStream(path, type, 128, String(limit + 1), true);
      const BACKEND_API = backend(new Response());
      expect((await handleApiGateway(input.request, { BACKEND_API })).status).toBe(413);
      expect(input.cancelled()).toBe(true);
      expect(input.bytesRead()).toBe(0);
      expect(BACKEND_API.fetch).not.toHaveBeenCalled();
    }
  });

  it('keeps JSON, other routes, and other methods at 1 MiB even with an image MIME', async () => {
    for (const [path, type, method] of [
      ['/api/community/assets', 'application/json', 'POST'],
      ['/api/community/assets', 'application/octet-stream', 'POST'],
      ['/api/auth/signin', 'image/png', 'POST'],
      ['/api/community/assets/extra', 'image/png', 'POST'],
      ['/api/community/assets', 'image/png', 'PUT'],
    ]) {
      const input = uploadStream(path, type, 1024 * 1024 + 1, '1', true, method);
      const BACKEND_API = backend(new Response());
      expect((await handleApiGateway(input.request, { BACKEND_API })).status).toBe(413);
      expect(input.cancelled()).toBe(true);
      expect(BACKEND_API.fetch).not.toHaveBeenCalled();
    }
  });

  it('allows JPEG/WebP uploads beyond 1 MiB and handles Blob body lengths', async () => {
    for (const type of ['image/jpeg', 'image/webp', 'image/png']) {
      const blob = new Blob([new Uint8Array(1024 * 1024 + 1)], { type });
      const fetch = vi.fn(async (forwarded: Request) => {
        expect(forwarded.headers.get('Content-Length')).toBe(String(blob.size));
        expect((await forwarded.arrayBuffer()).byteLength).toBe(blob.size);
        return new Response(null, { status: 201 });
      });
      const response = await handleApiGateway(request('/api/community/assets?source=pages', {
        method: 'POST', body: blob,
      }), { BACKEND_API: { fetch } as BackendApiBinding });
      expect(response.status).toBe(201);
      expect(fetch).toHaveBeenCalledOnce();
    }
  });

  it('rebuilds measured length even when Connection nominates Content-Length for removal', async () => {
    const BACKEND_API = backend(new Response());
    await handleApiGateway(request('/api/community/assets', {
      method: 'POST', body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      headers: { 'Content-Type': 'image/png', 'Content-Length': '1', Connection: 'Content-Length, X-Hop', 'X-Hop': 'remove' },
    }), { BACKEND_API });
    const forwarded = vi.mocked(BACKEND_API.fetch).mock.calls[0][0] as Request;
    expect(forwarded.headers.get('Content-Length')).toBe('8');
    expect(forwarded.headers.get('Connection')).toBeNull();
    expect(forwarded.headers.get('X-Hop')).toBeNull();
  });
});
