import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeadInventory } from './beadInventory';

const stock: BeadInventory = {
  A1: { colorId: 'MARD_A1', code: 'A1', name: '浅黄', hex: '#FAF4C8', count: 12, alertThreshold: 100 },
};

describe('shared v1 bead inventory', () => {
  let store: typeof import('./beadInventory');
  let target: EventTarget & { localStorage: Storage };
  beforeEach(async () => {
    vi.resetModules();
    const records = new Map<string, string>();
    const localStorage = {
      getItem: vi.fn((key: string) => records.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { records.set(key, value); }),
      removeItem: vi.fn((key: string) => { records.delete(key); }),
      clear: vi.fn(() => records.clear()),
    } as unknown as Storage;
    target = Object.assign(new EventTarget(), { localStorage });
    vi.stubGlobal('window', target);
    store = await import('./beadInventory');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads the exact existing key and preserves legacy identities without inventing brand or stock', () => {
    target.localStorage.setItem('beadgrid_user_inventory_v1', JSON.stringify(stock));
    const snapshot = store.getBeadInventorySnapshot();
    expect(snapshot).toEqual(stock);
    expect(snapshot.A1.brand).toBeUndefined();
    expect(store.getBeadInventorySnapshot()).toBe(snapshot);
    expect(target.localStorage.getItem).toHaveBeenCalledWith('beadgrid_user_inventory_v1');
  });

  it.each([null, '', '{', 'null', '[]', '42', '{"A1":null}', '{"A1":{"code":"A1","count":-1}}'])('does not fabricate records for %s', raw => {
    expect(store.parseBeadInventory(raw)).toEqual({});
  });

  it('rejects invalid quantities and code-only unbranded records while retaining branded code records', () => {
    const parsed = store.parseBeadInventory(JSON.stringify({
      bad: { ...stock.A1, count: '500' },
      unsafe: { code: 'A1', count: 999 },
      brand: { brand: 'COCO', code: 'A1', count: 5.9 },
      good: { ...stock.A1, customMetadata: 'preserved' },
    }));
    expect(Object.keys(parsed)).toEqual(['brand', 'good']);
    expect(parsed.brand.count).toBe(5);
    expect(parsed.good).toMatchObject({ customMetadata: 'preserved' });
  });

  it('notifies same-window subscribers synchronously and unregisters correctly', () => {
    const callback = vi.fn(() => expect(store.getBeadInventorySnapshot()).toEqual(stock));
    const unsubscribe = store.subscribeBeadInventory(callback);
    expect(store.writeBeadInventory(stock)).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.writeBeadInventory(stock);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('refreshes on cross-window write, deletion, clear and focus, ignoring unrelated keys', () => {
    const callback = vi.fn();
    const unsubscribe = store.subscribeBeadInventory(callback);
    store.getBeadInventorySnapshot();
    target.localStorage.setItem(store.INVENTORY_STORAGE_KEY, JSON.stringify(stock));
    target.dispatchEvent(Object.assign(new Event('storage'), { key: store.INVENTORY_STORAGE_KEY }));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(store.getBeadInventorySnapshot()).toEqual(stock);
    target.dispatchEvent(Object.assign(new Event('storage'), { key: 'unrelated' }));
    expect(callback).toHaveBeenCalledTimes(1);
    target.localStorage.removeItem(store.INVENTORY_STORAGE_KEY);
    target.dispatchEvent(Object.assign(new Event('storage'), { key: store.INVENTORY_STORAGE_KEY }));
    expect(store.getBeadInventorySnapshot()).toEqual({});
    target.dispatchEvent(Object.assign(new Event('storage'), { key: null }));
    target.dispatchEvent(new Event('focus'));
    expect(callback).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it('reports failed writes without publishing unpersisted inventory', () => {
    const callback = vi.fn();
    const unsubscribe = store.subscribeBeadInventory(callback);
    vi.mocked(target.localStorage.setItem).mockImplementation(() => { throw new Error('quota'); });
    expect(store.writeBeadInventory(stock)).toBe(false);
    expect(callback).not.toHaveBeenCalled();
    expect(store.getBeadInventorySnapshot()).toEqual({});
    unsubscribe();
  });

  it('returns stable server snapshots and tolerates storage access failure', () => {
    vi.mocked(target.localStorage.getItem).mockImplementation(() => { throw new Error('blocked'); });
    expect(store.getBeadInventorySnapshot()).toEqual({});
    expect(store.getServerBeadInventorySnapshot()).toBe(store.getServerBeadInventorySnapshot());
  });
});
