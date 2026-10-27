import type { BeadColor } from '../types';
import { isManagedBrandCatalog, type ManagedBrandCatalog } from '../components/admin/AdminBrandsColors.model';

export interface BrandCatalogSnapshot {
  status: 'loading' | 'ready' | 'error'; error: string;
  refreshing: boolean; backgroundError: string;
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
  return { status: 'ready', error: '', refreshing: false, backgroundError: '', palettes, names };
}

/** Keep local enabled choices while resolving live values; removed catalog colors cannot return. */
export function paletteForNewConversion(live: BeadColor[], active: BeadColor[], brand: string): BeadColor[] {
  if (brand === 'CUSTOM') return active;
  const enabled = new Map(active.map(color => [color.id, color.enabled]));
  return [...live.map(color => enabled.has(color.id) ? { ...color, enabled: enabled.get(color.id) } : color),
    ...active.filter(color => color.id.startsWith('custom_') && color.brand === brand)];
}

let snapshot: BrandCatalogSnapshot = { status: 'loading', error: '', refreshing: false, backgroundError: '', palettes: {}, names: {} };
let inFlight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();
export function getBrandCatalogSnapshot(): BrandCatalogSnapshot { return snapshot; }
export function subscribeBrandCatalog(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(next: BrandCatalogSnapshot) { snapshot = next; for (const listener of listeners) listener(); }
/** Background reads retain usability; conversions must also require a successful result. */
export function refreshBrandCatalog(): Promise<boolean> {
  if (inFlight) return inFlight;
  // Assign the shared promise before notifying subscribers or invoking fetch.
  inFlight = Promise.resolve().then(async () => {
    publish({ ...snapshot, status: snapshot.status === 'ready' ? 'ready' : 'loading', error: '', refreshing: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch('/api/brands/catalog', { headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
      const envelope = await response.json() as { success?: boolean; data?: unknown; message?: string };
      if (!response.ok || envelope.success !== true) throw new Error(envelope.message || `品牌目录读取失败（${response.status}）。`);
      const next = projectBrandCatalog(envelope.data);
      // Unchanged responses must not rerun palette effects and reset local choices.
      const unchanged = JSON.stringify(next.palettes) === JSON.stringify(snapshot.palettes)
        && JSON.stringify(next.names) === JSON.stringify(snapshot.names);
      publish(unchanged ? { ...next, palettes: snapshot.palettes, names: snapshot.names } : next);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法读取品牌目录。';
      publish(snapshot.status === 'ready'
        ? { ...snapshot, refreshing: false, backgroundError: message }
        : { ...snapshot, status: 'error', refreshing: false, error: message });
      return false;
    } finally { clearTimeout(timer); inFlight = null; }
  });
  return inFlight;
}
