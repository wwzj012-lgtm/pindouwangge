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

let stored: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('brand catalog stale while revalidate', () => {
  it('uses builtin data on first offline load while merging all in-flight callers', async () => {
    const store = await import('./brandCatalog');
    const pending = deferred<Response>();
    const fetch = vi.fn(() => pending.promise); vi.stubGlobal('fetch', fetch);
    const listener = vi.fn(), unsubscribe = store.subscribeBrandCatalog(listener);
    const first = store.refreshBrandCatalog();
    for (let i = 0; i < 30; i++) expect(store.refreshBrandCatalog()).toBe(first);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.getBrandCatalogSnapshot()).toMatchObject({ status: 'ready', source: 'builtin', origin: 'offline', refreshing: true });
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
    'retains usable cached data on %s failure while reporting no live freshness, then recovers', async failure => {
      vi.useFakeTimers();
      const store = await import('./brandCatalog');
      const fetch = vi.fn().mockResolvedValueOnce(response()); vi.stubGlobal('fetch', fetch);
      await store.refreshBrandCatalog(); const previous = store.getBrandCatalogSnapshot();
      if (failure === 'network') fetch.mockRejectedValueOnce(new Error('offline'));
      if (failure === 'invalid') fetch.mockResolvedValueOnce(Response.json({ success: true, data: { items: 'invalid' } }));
      if (failure === 'http') fetch.mockResolvedValueOnce(Response.json({ success: false, message: 'offline' }, { status: 503 }));
      if (failure === 'envelope') fetch.mockResolvedValueOnce(Response.json({ data: catalog() }));
      if (failure === 'timeout') fetch.mockImplementationOnce((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => reject(new Error('timed out')), { once: true });
      }));
      const request = store.refreshBrandCatalog();
      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(10_000);
      expect(await request).toBe(false);
      expect(store.getBrandCatalogSnapshot()).toMatchObject({ status: 'ready', source: 'cache', origin: 'offline', refreshing: false, error: '' });
      expect(store.getBrandCatalogSnapshot().backgroundError).not.toBe('');
      expect(store.getBrandCatalogSnapshot().palettes).toBe(previous.palettes);
      expect(store.getBrandCatalogSnapshot().names).toBe(previous.names);
      fetch.mockResolvedValueOnce(response());
      expect(await store.refreshBrandCatalog()).toBe(true);
      expect(store.getBrandCatalogSnapshot().backgroundError).toBe('');
      expect(store.getBrandCatalogSnapshot().palettes).toBe(previous.palettes);
    });

  it('first offline load uses builtin old colors, then recovers after a synchronous fetch error', async () => {
    const store = await import('./brandCatalog');
    const fetch = vi.fn().mockImplementationOnce(() => { throw new Error('offline'); }).mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetch);
    expect(await store.refreshBrandCatalog()).toBe(false);
    expect(store.getBrandCatalogSnapshot()).toMatchObject({ status: 'ready', source: 'builtin', refreshing: false, error: '', backgroundError: 'offline' });
    expect(store.getBrandCatalogSnapshot().palettes.MARD.length).toBeGreaterThan(100);
    const retry = store.refreshBrandCatalog(); await Promise.resolve();
    expect(store.getBrandCatalogSnapshot().status).toBe('ready');
    expect(await retry).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.getBrandCatalogSnapshot().source).toBe('live');
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
    fetch.mockRejectedValueOnce(new Error('offline'));
    await store.refreshBrandCatalog();
    expect(store.getBrandCatalogSnapshot().palettes.STUDIO).toBeUndefined();
    expect(store.getBrandCatalogSnapshot().palettes.COCO).toBeUndefined();
  });

  it('persists the latest validated version and uses it offline across module reloads without adding removed builtin brands', async () => {
    let store = await import('./brandCatalog');
    const latest = catalog('#654321'); latest.items[0].version = 7; latest.items.pop();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(latest)));
    await store.refreshBrandCatalog();
    expect(stored.size).toBe(1);
    const persisted = JSON.parse([...stored.values()][0]);
    expect(persisted.version).toBe(1); expect(persisted.data.items[0].version).toBe(7);
    vi.resetModules(); store = await import('./brandCatalog');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await store.refreshBrandCatalog()).toBe(false);
    expect(store.getBrandCatalogSnapshot()).toMatchObject({ status: 'ready', source: 'cache' });
    expect(store.getBrandCatalogSnapshot().palettes.MARD[0].hex).toBe('#654321');
    expect(store.getBrandCatalogSnapshot().palettes.COCO).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(catalog('#FEDCBA'))));
    await store.refreshBrandCatalog();
    expect(store.getBrandCatalogSnapshot().palettes.MARD[0].hex).toBe('#FEDCBA');
    expect(JSON.parse([...stored.values()][0]).data.items[0].colors[0].hex).toBe('#FEDCBA');
  });

  it.each(['schema', 'structure', 'brand-version', 'json'] as const)('rejects %s-invalid persisted cache and uses isolated builtins', async invalid => {
    let store = await import('./brandCatalog');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response())); await store.refreshBrandCatalog();
    const [key, value] = [...stored.entries()][0] ?? ['', '{}']; const cached = JSON.parse(value);
    if (invalid === 'schema') cached.version = 999;
    if (invalid === 'structure') cached.data = { items: [{ code: 'MARD' }] };
    if (invalid === 'brand-version' && cached.data) cached.data.items[0].version = 0;
    stored.set(key, invalid === 'json' ? '{broken' : JSON.stringify(cached));
    vi.resetModules(); store = await import('./brandCatalog');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline'))); await store.refreshBrandCatalog();
    expect(store.getBrandCatalogSnapshot().source).toBe('builtin');
    const builtins = await import('./palettes');
    expect(store.getBrandCatalogSnapshot().palettes).toEqual(builtins.BRAND_PALETTES);
    expect(store.getBrandCatalogSnapshot().palettes.MARD).not.toBe(builtins.BRAND_PALETTES.MARD);
  });

  it.each(['empty', 'forbidden', 'deleted', 'application'] as const)('keeps %s authoritative even on later offline/reload; live recovery clears the block', async kind => {
    let store = await import('./brandCatalog');
    const fetch = vi.fn().mockResolvedValueOnce(response()); vi.stubGlobal('fetch', fetch);
    await store.refreshBrandCatalog();
    fetch.mockResolvedValueOnce(kind === 'empty' ? Response.json({ success: true, data: { items: [] } })
      : Response.json({ success: false, message: kind, code: kind === 'deleted' ? 'BRAND_DELETED' : 'FORBIDDEN' },
        { status: kind === 'forbidden' ? 403 : kind === 'deleted' ? 404 : 200 }));
    expect(await store.refreshBrandCatalog()).toBe(false);
    expect(store.getBrandCatalogSnapshot()).toMatchObject({ status: 'error', source: null, palettes: {} });
    fetch.mockRejectedValueOnce(new Error('offline')); await store.refreshBrandCatalog();
    expect(store.getBrandCatalogSnapshot().status).toBe('error');
    vi.resetModules(); store = await import('./brandCatalog');
    fetch.mockRejectedValueOnce(new Error('offline')); await store.refreshBrandCatalog();
    expect(store.getBrandCatalogSnapshot().status).toBe('error');
    fetch.mockResolvedValueOnce(response()); expect(await store.refreshBrandCatalog()).toBe(true);
    expect(store.getBrandCatalogSnapshot().source).toBe('live');
  });

  it('bounds first-load timeout and tolerates blocked browser storage', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
    const store = await import('./brandCatalog');
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const pending = store.refreshBrandCatalog(); await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe(false); expect(store.getBrandCatalogSnapshot().source).toBe('builtin');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    expect(await store.refreshBrandCatalog()).toBe(true);
  });
});
