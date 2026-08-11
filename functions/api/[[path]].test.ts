import { describe, expect, it, vi } from 'vitest';
import { handleApiGateway, type BackendApiBinding } from './[[path]]';

function backend(response: Response): BackendApiBinding {
  return { fetch: vi.fn().mockResolvedValue(response) };
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://stellabean.pages.dev${path}`, init);
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
});
