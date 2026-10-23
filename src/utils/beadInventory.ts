import type { BeadColor, BrandKey } from '../types';
import { BRAND_ORDER, BRAND_PALETTES } from '../data/palettes';

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
export const MAX_BEAD_COUNT = 1_000_000;
export const INVENTORY_BRANDS = BRAND_ORDER.filter(brand => brand !== 'CUSTOM');
const catalogById = new Map(INVENTORY_BRANDS.flatMap(brand => BRAND_PALETTES[brand]).map(color => [color.id, color]));
const normalizeIdentity = (value: string) => value.trim().toUpperCase();
const catalogByBrandCode = new Map([...catalogById.values()].map(color => [
  JSON.stringify([normalizeIdentity(color.brand), normalizeIdentity(color.code)]), color,
]));

/** Full catalog IDs are authoritative. Never assign CUSTOM/unbranded codes by guesswork. */
export function getInventoryColor(item: BeadStockItem): BeadColor | undefined {
  const known = catalogById.get(item.colorId);
  const brand = item.brand ? normalizeIdentity(item.brand) : undefined;
  if (known) return !brand || normalizeIdentity(known.brand) === brand ? known : undefined;
  if (!brand) return undefined;
  return catalogByBrandCode.get(JSON.stringify([brand, normalizeIdentity(item.code)]));
}

export interface CatalogStockItem extends BeadStockItem {
  inventoryKeys: string[];
}

/** Read-only projection: every real catalog color exists visually, absent quantities are zero. */
export function getBrandInventory(inventory: BeadInventory, brand: BrandKey): CatalogStockItem[] {
  const pools = new Map<string, Array<[string, BeadStockItem]>>();
  for (const entry of Object.entries(inventory)) {
    const color = getInventoryColor(entry[1]);
    if (!color || color.brand !== brand) continue;
    const pool = pools.get(color.id) ?? [];
    pool.push(entry);
    pools.set(color.id, pool);
  }
  return (brand === 'CUSTOM' ? [] : BRAND_PALETTES[brand]).map(color => {
    const entries = pools.get(color.id) ?? [];
    return {
      colorId: color.id, code: color.code, name: color.name, hex: color.hex, brand,
      // Match practice's conservative policy for duplicate records; do not sum physical stock twice.
      count: entries.length ? Math.min(...entries.map(([, item]) => item.count)) : 0,
      alertThreshold: entries[0]?.[1].alertThreshold ?? 100,
      inventoryKeys: entries.map(([key]) => key),
    };
  });
}

export function isValidBeadCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_BEAD_COUNT;
}

/** Edits only explicitly selected real colors; retains all unrelated and legacy records. */
export function updateBrandInventory(
  inventory: BeadInventory, brand: BrandKey, colorIds: readonly string[], value: number, mode: 'set' | 'delta' = 'set',
): BeadInventory {
  if (mode === 'set' ? !isValidBeadCount(value) : !isValidBeadCount(Math.abs(value))) {
    throw new RangeError(`数量必须是 0–${MAX_BEAD_COUNT} 的整数`);
  }
  const selected = new Set(colorIds);
  const updated = { ...inventory };
  for (const row of getBrandInventory(inventory, brand)) {
    if (!selected.has(row.colorId)) continue;
    if (mode === 'delta' && row.count > MAX_BEAD_COUNT) {
      throw new RangeError('该旧库存超过当前数量上限，请直接设置数量；原库存已保留');
    }
    const count = mode === 'set' ? value : Math.min(MAX_BEAD_COUNT, Math.max(0, row.count + value));
    if (count === row.count && !row.inventoryKeys.length) continue;
    if (row.inventoryKeys.length) {
      for (const key of row.inventoryKeys) updated[key] = { ...inventory[key], count };
    } else {
      let key = row.colorId;
      while (Object.hasOwn(updated, key)) key += ':stock';
      const { inventoryKeys: _keys, ...item } = row;
      updated[key] = { ...item, count };
    }
  }
  return updated;
}

/** Explicit user-confirmed migration keeps the old key, count, and additional metadata. */
export function assignLegacyInventory(inventory: BeadInventory, key: string, colorId: string): BeadInventory {
  const item = inventory[key];
  const color = catalogById.get(colorId);
  if (!item || getInventoryColor(item) || !color) throw new Error('请选择待确认旧库存与真实色号');
  if (Object.values(inventory).some(record => getInventoryColor(record)?.id === color.id)) {
    throw new Error('目标色号已有库存，请选择未录入的色号，避免覆盖原库存');
  }
  return { ...inventory, [key]: { ...item, colorId: color.id, brand: color.brand, code: color.code, name: color.name, hex: color.hex } };
}
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
          ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(record.alertThreshold))) : 100,
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
  if (Object.values(updated).some(item => !Number.isSafeInteger(item.count) || item.count < 0
    || !Number.isSafeInteger(item.alertThreshold) || item.alertThreshold < 0)) return false;
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
