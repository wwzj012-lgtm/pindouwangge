import type { AdminApiResult } from './adminRequest';

interface TrackedRequest {
  sequence: number; owner: string; key: string; path: string; query: URLSearchParams;
  method: string; mutationKey?: string; operation?: { kind: 'brand' | 'credit'; id: string };
}
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
const operationId = (value: unknown): string | null => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : null;
const brandReceipt = (data: Record<string, unknown> | null, id: string) => data?.operationId === id
  && typeof data.brandCode === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(data.brandCode)
  && Number.isSafeInteger(data.version) && Number(data.version) > 0 && (data.colorId === null || typeof data.colorId === 'string')
  && ['createBrand', 'updateBrand', 'deleteBrand', 'createColor', 'updateColor', 'deleteColor'].includes(String(data.action));
const creditReceipt = (data: Record<string, unknown> | null, id: string, operatorUid: string) => data?.idempotencyKey === id
  && data.operatorUid === operatorUid && typeof data.id === 'string' && typeof data.uid === 'string'
  && ['deltaUnits', 'beforeAvailableUnits', 'afterAvailableUnits', 'heldUnits', 'beforeVersion', 'afterVersion'].every(key => Number.isSafeInteger(data[key]));

/** Connectivity presentation only. Never modifies a module's write/recovery guards. */
export class AdminConnectionNotices {
  private sequence = 0;
  private settled = new Map<string, number>();
  private failures = new Map<string, { owner: string; message: string }>();

  begin(owner: string, path: string, init?: RequestInit): TrackedRequest {
    const sequence = ++this.sequence;
    const url = new URL(path, 'https://admin.invalid'); url.searchParams.sort();
    const method = (init?.method ?? 'GET').toUpperCase();
    let mutationKey: string | undefined;
    let operation: TrackedRequest['operation'];
    // Retain only explicit public operation identifiers, never request bodies,
    // passwords, reasons, user input or generic secret-bearing fingerprints.
    if (method !== 'GET' && ['/api/admin/brands', '/api/admin/brands/colors', '/api/admin/credits/adjust'].includes(url.pathname) && typeof init?.body === 'string') {
      let body: Record<string, unknown> | null = null;
      try { body = record(JSON.parse(init.body)); } catch { /* not an identified operation */ }
      if (url.pathname === '/api/admin/brands' || url.pathname === '/api/admin/brands/colors') {
        const id = operationId(body?.operationId); if (id) { mutationKey = `${owner}:brand:${id}`; operation = { kind: 'brand', id }; }
      } else if (url.pathname === '/api/admin/credits/adjust') {
        const id = operationId(body?.idempotencyKey); if (id) { mutationKey = `${owner}:credit:${id}`; operation = { kind: 'credit', id }; }
      }
    }
    const key = mutationKey ?? `${owner}:${method === 'GET' ? url.pathname + url.search : 'write:' + sequence}`;
    return { sequence, owner, key, path: url.pathname, query: url.searchParams, method, mutationKey, operation };
  }

  settle(request: TrackedRequest, result: Pick<AdminApiResult<unknown>, 'ok' | 'status' | 'data' | 'error'>, operatorUid: string) {
    if (request.sequence < (this.settled.get(request.key) ?? 0)) return;
    this.settled.set(request.key, request.sequence);
    if (result.status === 0) {
      this.failures.set(request.key, { owner: request.owner, message: result.error ?? '后台连接失败，请重试。' });
      return;
    }
    if (!result.ok) return;
    const data = record(result.data);
    if (!request.operation || (request.operation.kind === 'brand' ? brandReceipt(data, request.operation.id) : creditReceipt(data, request.operation.id, operatorUid))) this.failures.delete(request.key);
    if (request.method !== 'GET') return;
    let recoveredKey: string | undefined;
    if (request.path === '/api/admin/brands/mutations') {
      const id = operationId(request.query.get('id'));
      if (id && brandReceipt(data, id)) recoveredKey = `${request.owner}:brand:${id}`;
    } else if (request.path === '/api/admin/credits/adjustment') {
      const id = operationId(request.query.get('idempotencyKey')), adjustment = record(data?.adjustment);
      if (id && data?.status === 'completed' && creditReceipt(adjustment, id, operatorUid)) recoveredKey = `${request.owner}:credit:${id}`;
    }
    if (recoveredKey) {
      this.failures.delete(recoveredKey);
      this.settled.set(recoveredKey, Math.max(request.sequence, this.settled.get(recoveredKey) ?? 0));
    }
  }

  messages(): Record<string, string> {
    const grouped: Record<string, Set<string>> = {};
    for (const failure of this.failures.values()) (grouped[failure.owner] ??= new Set()).add(failure.message);
    return Object.fromEntries(Object.entries(grouped).map(([owner, messages]) => [owner, [...messages].join('；')]));
  }
}
