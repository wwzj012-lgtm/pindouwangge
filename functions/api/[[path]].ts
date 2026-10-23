const MAX_REQUEST_BODY_BYTES = 1_048_576;
const MAX_COMMUNITY_IMAGE_BYTES = 15 * 1024 * 1024;
const BACKEND_ORIGIN = 'https://stellabean-api.internal';

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export interface BackendApiBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface GatewayEnv {
  BACKEND_API: BackendApiBinding;
}

export interface PagesFunctionContext<Env> {
  request: Request;
  env: Env;
}

function errorResponse(status: number, message: string): Response {
  return Response.json({ success: false, message }, { status });
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function connectionHeaderTokens(headers: Headers): Set<string> {
  return new Set(
    (headers.get('connection') ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function forwardedHeaders(headers: Headers, bodyWasRead: boolean): Headers {
  const result = new Headers();
  const connectionTokens = connectionHeaderTokens(headers);

  for (const [name, value] of headers) {
    const normalizedName = name.toLowerCase();
    if (
      normalizedName === 'host'
      || HOP_BY_HOP_HEADERS.has(normalizedName)
      || connectionTokens.has(normalizedName)
      || (bodyWasRead && normalizedName === 'content-length')
    ) {
      continue;
    }
    result.append(name, value);
  }

  return result;
}

function hasRequestBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

function requestBodyLimit(request: Request, pathname: string): number {
  const type = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  return request.method === 'POST'
    && pathname === '/api/community/assets'
    && (type === 'image/png' || type === 'image/jpeg' || type === 'image/webp')
    ? MAX_COMMUNITY_IMAGE_BYTES
    : MAX_REQUEST_BODY_BYTES;
}

async function readBodyWithLimit(request: Request, maxBytes: number): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

function declaredBodyIsTooLarge(request: Request, maxBytes: number): boolean {
  const contentLength = request.headers.get('content-length');
  if (!contentLength) return false;
  const length = Number(contentLength);
  return !Number.isSafeInteger(length) || length < 0 || length > maxBytes;
}

function responseHeaders(headers: Headers): Headers {
  const result = new Headers();
  const connectionTokens = connectionHeaderTokens(headers);

  for (const [name, value] of headers) {
    const normalizedName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalizedName) || connectionTokens.has(normalizedName)) continue;
    result.append(name, value);
  }

  return result;
}

export async function handleApiGateway(request: Request, env: GatewayEnv): Promise<Response> {
  const incomingUrl = new URL(request.url);
  if (!isApiPath(incomingUrl.pathname)) {
    return errorResponse(404, 'Not found');
  }

  const method = request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return errorResponse(405, 'Method not allowed');
  }

  if (request.headers.has('upgrade') || method === 'CONNECT') {
    return errorResponse(400, 'Protocol upgrades are not supported');
  }

  const maxBytes = requestBodyLimit(request, incomingUrl.pathname);
  if (declaredBodyIsTooLarge(request, maxBytes)) {
    void request.body?.cancel().catch(() => {});
    return errorResponse(413, 'Request body is too large');
  }

  let body: ArrayBuffer | undefined;
  const bodyWasRead = hasRequestBody(method);
  if (bodyWasRead) {
    body = await readBodyWithLimit(request, maxBytes) ?? undefined;
    if (!body) {
      return errorResponse(413, 'Request body is too large');
    }
  }

  // The internal origin is fixed. The browser never controls the upstream target.
  const backendUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, BACKEND_ORIGIN);
  const headers = forwardedHeaders(request.headers, bodyWasRead);
  // Replace the untrusted incoming length with the measured payload length.
  if (body) headers.set('Content-Length', String(body.byteLength));
  const backendRequest = new Request(backendUrl, {
    method,
    headers,
    body: bodyWasRead ? body : undefined,
  });
  const backendResponse = await env.BACKEND_API.fetch(backendRequest);

  return new Response(backendResponse.body, {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
    headers: responseHeaders(backendResponse.headers),
  });
}

export const onRequest = ({ request, env }: PagesFunctionContext<GatewayEnv>): Promise<Response> => (
  handleApiGateway(request, env)
);
