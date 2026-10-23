import type { BrandKey } from '../types';

export interface BeadStockItem {
  colorId: string;
  code: string;
  name: string;
  hex: string;
  count: number;
  alertThreshold: number;
  brand?: BrandKey;
}

export type BeadInventory = Record<string, BeadStockItem>;
export const INVENTORY_STORAGE_KEY = 'beadgrid_user_inventory_v1';
const INVENTORY_CHANGED_EVENT = 'beadgrid:inventory-changed';
const EMPTY_INVENTORY: BeadInventory = Object.freeze({});
let cachedRaw: string | null | undefined;
let cachedInventory = EMPTY_INVENTORY;

/** Keep the v1 record keys and optional metadata; never infer a brand from a code. */
export function parseBeadInventory(raw: string | null): BeadInventory {
  if (!raw) return EMPTY_INVENTORY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_INVENTORY;
    const entries = Object.entries(value).flatMap(([key, item]) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      if (typeof record.code !== 'string' || !record.code.trim()
        || typeof record.count !== 'number' || !Number.isFinite(record.count) || record.count < 0) return [];
      // A branded record may only have a code; unbranded legacy records need colorId.
      const colorId = typeof record.colorId === 'string' ? record.colorId : '';
      const brand = typeof record.brand === 'string' && record.brand.trim() ? record.brand : undefined;
      if (!colorId && !brand) return [];
      return [[key, {
        ...record,
        colorId,
        code: record.code,
        name: typeof record.name === 'string' ? record.name : record.code,
        hex: typeof record.hex === 'string' ? record.hex : '#888888',
        count: Math.min(Number.MAX_SAFE_INTEGER, Math.floor(record.count)),
        alertThreshold: typeof record.alertThreshold === 'number' && Number.isFinite(record.alertThreshold)
          ? Math.max(0, Math.floor(record.alertThreshold)) : 100,
        ...(brand ? { brand } : { brand: undefined }),
      }]];
    });
    return Object.fromEntries(entries) as BeadInventory;
  } catch {
    return EMPTY_INVENTORY;
  }
}

/** Stable snapshots for React.useSyncExternalStore, including malformed/empty storage. */
export function getBeadInventorySnapshot(): BeadInventory {
  try {
    const raw = window.localStorage.getItem(INVENTORY_STORAGE_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedInventory = parseBeadInventory(raw);
    }
  } catch {
    // Keep the last readable snapshot when browser storage is temporarily unavailable.
  }
  return cachedInventory;
}

export function getServerBeadInventorySnapshot(): BeadInventory {
  return EMPTY_INVENTORY;
}

/** Authorization stays with the existing inventory UI; this store has no network writes. */
export function writeBeadInventory(updated: BeadInventory): boolean {
  try {
    window.localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(INVENTORY_CHANGED_EVENT));
  return true;
}

export function subscribeBeadInventory(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === INVENTORY_STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener(INVENTORY_CHANGED_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', onChange);
  return () => {
    window.removeEventListener(INVENTORY_CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', onChange);
  };
}
