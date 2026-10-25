import type { BeadColor } from '../types';
import { isManagedBrandCatalog, type ManagedBrandCatalog } from '../components/admin/AdminBrandsColors.model';

export interface BrandCatalogSnapshot {
  status: 'loading' | 'ready' | 'error'; error: string;
  palettes: Record<string, BeadColor[]>; names: Record<string, string>;
}
export function projectBrandCatalog(payload: unknown): BrandCatalogSnapshot {
  if (!isManagedBrandCatalog(payload)) throw new Error('品牌目录结构不完整或默认 MARD 不可用。');
  const palettes: Record<string, BeadColor[]> = {}, names: Record<string, string> = {};
  for (const brand of (payload as ManagedBrandCatalog).items) {
    if (!brand.enabled || !brand.colors.length) continue;
    names[brand.code] = brand.name;
    palettes[brand.code] = brand.colors.map(color => {
      const number = Number.parseInt(color.hex.slice(1), 16);
      return { id: color.id, code: color.code, name: color.name, hex: color.hex,
        rgb: [(number >> 16) & 255, (number >> 8) & 255, number & 255], brand: brand.code,
        symbol: color.code, enabled: true, ...(color.screenReferenceOnly ? { screenReferenceOnly: true } : {}) };
    });
  }
  // CUSTOM is the existing per-user template, never an admin-managed brand.
  palettes.CUSTOM = palettes.MARD.map(color => ({ ...color, brand: 'CUSTOM', rgb: [...color.rgb] }));
  names.CUSTOM = '自定义色卡';
  return { status: 'ready', error: '', palettes, names };
}

/** Keep local enabled choices while resolving live values; removed catalog colors cannot return. */
export function paletteForNewConversion(live: BeadColor[], active: BeadColor[], brand: string): BeadColor[] {
  if (brand === 'CUSTOM') return active;
  const enabled = new Map(active.map(color => [color.id, color.enabled]));
  return [...live.map(color => enabled.has(color.id) ? { ...color, enabled: enabled.get(color.id) } : color),
    ...active.filter(color => color.id.startsWith('custom_') && color.brand === brand)];
}

let snapshot: BrandCatalogSnapshot = { status: 'loading', error: '', palettes: {}, names: {} };
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();
export function getBrandCatalogSnapshot(): BrandCatalogSnapshot { return snapshot; }
export function subscribeBrandCatalog(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(next: BrandCatalogSnapshot) { snapshot = next; for (const listener of listeners) listener(); }
export function refreshBrandCatalog(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    // Keep the last catalog for labels/snapshots, but do not permit new conversions while checking.
    publish({ ...snapshot, status: 'loading', error: '' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch('/api/brands/catalog', { headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
      const envelope = await response.json() as { success?: boolean; data?: unknown; message?: string };
      if (!response.ok || envelope.success !== true) throw new Error(envelope.message || `品牌目录读取失败（${response.status}）。`);
      publish(projectBrandCatalog(envelope.data));
    } catch (error) {
      publish({ ...snapshot, status: 'error', error: error instanceof Error ? error.message : '无法读取品牌目录。' });
    } finally { clearTimeout(timer); inFlight = null; }
  })();
  return inFlight;
}
