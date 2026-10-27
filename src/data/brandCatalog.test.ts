import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function catalog(hex = '#123456') {
  return { items: [{ code: 'MARD', name: 'MARD', enabled: true, builtin: true, protected: true,
    version: 1, colorCount: 2, colors: [
      { id: 'MARD_A1', code: 'A1', name: '颜色一', hex, screenReferenceOnly: false },
      { id: 'MARD_A2', code: 'A2', name: '颜色二', hex: '#ABCDEF', screenReferenceOnly: false },
    ] }, { code: 'STUDIO', name: '工作室', enabled: true, builtin: false, protected: false,
    version: 1, colorCount: 1, colors: [
      { id: 'STUDIO_A1', code: 'A1', name: '工作室颜色', hex: '#ABCDEF', screenReferenceOnly: false },
    ] }] };
}
const response = (data = catalog()) => Response.json({ success: true, data });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('brand catalog stale while revalidate', () => {
  it('keeps first load blocking, merges all in-flight callers and publishes only one request', async () => {
    const store = await import('./brandCatalog');
    const pending = deferred<Response>();
    const fetch = vi.fn(() => pending.promise); vi.stubGlobal('fetch', fetch);
    const listener = vi.fn(), unsubscribe = store.subscribeBrandCatalog(listener);
    const first = store.refreshBrandCatalog();
    for (let i = 0; i < 30; i++) expect(store.refreshBrandCatalog()).toBe(first);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.getBrandCatalogSnapshot()).toMatchObject({ status: 'loading', refreshing: true, palettes: {} });
    pending.resolve(response());
    expect(await first).toBe(true);
    expect(store.getBrandCatalogSnapshot()).toMatchObject({ status: 'ready', refreshing: false, backgroundError: '' });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    await store.refreshBrandCatalog();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('preserves ready state and palette/name references throughout unchanged refreshes', async () => {
    const store = await import('./brandCatalog');
    const pending = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response()).mockReturnValueOnce(pending.promise));
    await store.refreshBrandCatalog();
    const previous = store.getBrandCatalogSnapshot();
    const active = previous.palettes.MARD.map(color => ({ ...color, enabled: false }));
    const refreshing = store.refreshBrandCatalog(); await Promise.resolve();
    expect(store.getBrandCatalogSnapshot()).toMatchObject({ status: 'ready', refreshing: true, error: '' });
    expect(store.getBrandCatalogSnapshot().palettes).toBe(previous.palettes);
    pending.resolve(response()); expect(await refreshing).toBe(true);
    expect(store.getBrandCatalogSnapshot().palettes).toBe(previous.palettes);
    expect(store.getBrandCatalogSnapshot().names).toBe(previous.names);
    expect(store.paletteForNewConversion(previous.palettes.MARD, active, 'MARD').every(color => !color.enabled)).toBe(true);
  });

  it.each(['network', 'invalid', 'http', 'envelope', 'timeout'] as const)(
    'retains ready data on %s failure but explicitly rejects freshness for new conversions, then recovers', async failure => {
      vi.useFakeTimers();
      const store = await import('./brandCatalog');
      const fetch = vi.fn().mockResolvedValueOnce(response()); vi.stubGlobal('fetch', fetch);
      await store.refreshBrandCatalog(); const previous = store.getBrandCatalogSnapshot();
      if (failure === 'network') fetch.mockRejectedValueOnce(new Error('offline'));
      if (failure === 'invalid') fetch.mockResolvedValueOnce(response({ items: [] }));
      if (failure === 'http') fetch.mockResolvedValueOnce(Response.json({ success: false, message: 'offline' }, { status: 503 }));
      if (failure === 'envelope') fetch.mockResolvedValueOnce(Response.json({ success: false, data: catalog() }));
      if (failure === 'timeout') fetch.mockImplementationOnce((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => reject(new Error('timed out')), { once: true });
      }));
      const request = store.refreshBrandCatalog();
      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(10_000);
      expect(await request).toBe(false);
      expect(store.getBrandCatalogSnapshot()).toMatchObject({ status: 'ready', refreshing: false, error: '' });
      expect(store.getBrandCatalogSnapshot().backgroundError).not.toBe('');
      expect(store.getBrandCatalogSnapshot().palettes).toBe(previous.palettes);
      expect(store.getBrandCatalogSnapshot().names).toBe(previous.names);
      fetch.mockResolvedValueOnce(response());
      expect(await store.refreshBrandCatalog()).toBe(true);
      expect(store.getBrandCatalogSnapshot().backgroundError).toBe('');
      expect(store.getBrandCatalogSnapshot().palettes).toBe(previous.palettes);
    });

  it('first failure stays closed without a static fallback, and retries recover even after a synchronous fetch error', async () => {
    const store = await import('./brandCatalog');
    const fetch = vi.fn().mockImplementationOnce(() => { throw new Error('offline'); }).mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetch);
    expect(await store.refreshBrandCatalog()).toBe(false);
    expect(store.getBrandCatalogSnapshot()).toMatchObject({ status: 'error', refreshing: false, error: 'offline', backgroundError: '', palettes: {}, names: {} });
    const retry = store.refreshBrandCatalog(); await Promise.resolve();
    expect(store.getBrandCatalogSnapshot().status).toBe('loading');
    expect(await retry).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['disable', 'delete'] as const)('applies actual color/name edits and brand %s only to live data while saved snapshots remain unchanged', async action => {
    const store = await import('./brandCatalog');
    const fetch = vi.fn().mockResolvedValueOnce(response()); vi.stubGlobal('fetch', fetch);
    await store.refreshBrandCatalog();
    const previous = store.getBrandCatalogSnapshot(), oldWork = structuredClone(previous.palettes);
    const edited = catalog('#654321'); edited.items[0].name = '新品牌名称';
    edited.items[0].colors.pop(); edited.items[0].colorCount = 1;
    if (action === 'disable') edited.items[1].enabled = false;
    else edited.items.pop();
    fetch.mockResolvedValueOnce(response(edited));
    expect(await store.refreshBrandCatalog()).toBe(true);
    const latest = store.getBrandCatalogSnapshot();
    expect(latest.palettes).not.toBe(previous.palettes);
    expect(latest.names.MARD).toBe('新品牌名称');
    expect(latest.palettes.STUDIO).toBeUndefined();
    expect(latest.palettes.MARD).toHaveLength(1);
    expect(latest.palettes.MARD[0].hex).toBe('#654321');
    expect(latest.palettes.MARD[0].rgb).toEqual([101, 67, 33]);
    expect(previous.palettes).toEqual(oldWork);
    expect(store.paletteForNewConversion(latest.palettes.MARD, previous.palettes.MARD, 'MARD')).toHaveLength(1);
  });
});
