import type { BeadColor } from '../types';
import { isManagedBrandCatalog, type ManagedBrandCatalog } from '../components/admin/AdminBrandsColors.model';
import { BRAND_NAMES, BRAND_PALETTES } from './palettes';

export interface BrandCatalogSnapshot {
  status: 'loading' | 'ready' | 'error'; error: string;
  source: 'live' | 'cache' | 'builtin' | null;
  origin: 'live' | 'offline' | null;
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
  return { status: 'ready', source: 'live', origin: 'live', error: '', refreshing: false, backgroundError: '', palettes, names };
}

/** Keep local enabled choices while resolving live values; removed catalog colors cannot return. */
export function paletteForNewConversion(live: BeadColor[], active: BeadColor[], brand: string): BeadColor[] {
  if (brand === 'CUSTOM') return active;
  const enabled = new Map(active.map(color => [color.id, color.enabled]));
  return [...live.map(color => enabled.has(color.id) ? { ...color, enabled: enabled.get(color.id) } : color),
    ...active.filter(color => color.id.startsWith('custom_') && color.brand === brand)];
}

export function conversionPalette(snapshot: BrandCatalogSnapshot, brand: string, active: BeadColor[]): BeadColor[] | null {
  if (snapshot.status !== 'ready') return null;
  const available = snapshot.palettes[brand];
  return available?.length ? paletteForNewConversion(available, active, brand) : null;
}

export class BrandCatalogUnavailableError extends Error {
  constructor(message = '品牌目录无法使用，或该品牌已禁用/删除。请另选可用品牌；已有图纸与颜色快照保留。') {
    super(message);
    this.name = 'BrandCatalogUnavailableError';
  }
}

const CACHE_KEY = 'beadgrid:brand-catalog:v1';
const BACKGROUND_COOLDOWN_MS = 30_000;
let snapshot: BrandCatalogSnapshot = { status: 'loading', source: null, origin: null, error: '', refreshing: false, backgroundError: '', palettes: {}, names: {} };
let inFlight: Promise<boolean> | null = null;
let lastFinishedAt = -Infinity;
let fallback: BrandCatalogSnapshot | null = null;
let cacheLoaded = false;
let blockedReason = '';
const listeners = new Set<() => void>();
export function getBrandCatalogSnapshot(): BrandCatalogSnapshot { return snapshot; }
export function subscribeBrandCatalog(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(next: BrandCatalogSnapshot) { snapshot = next; for (const listener of listeners) listener(); }

function saveCache(value: object) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 1, ...value })); }
  catch { /* Private browsing/storage policy cannot block a conversion. */ }
}

function loadFallback() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    if (cached?.version !== 1) return;
    if (cached.blocked === true) {
      blockedReason = typeof cached.reason === 'string' && cached.reason ? cached.reason : '品牌目录无法使用。';
    } else if (Number.isSafeInteger(cached.savedAt) && cached.savedAt > 0 && isManagedBrandCatalog(cached.data)) {
      fallback = { ...projectBrandCatalog(cached.data), source: 'cache', origin: 'offline' };
    }
  } catch { /* Invalid JSON, old schema and storage errors are not trusted. */ }
}

function offlineCatalog(message: string): BrandCatalogSnapshot {
  loadFallback();
  if (blockedReason) {
    return { ...snapshot, status: 'error', source: null, origin: null, error: blockedReason, refreshing: false,
      backgroundError: '', palettes: {}, names: {} };
  }
  if (!fallback) {
    const palettes = Object.fromEntries(Object.entries(BRAND_PALETTES).map(([brand, colors]) =>
      [brand, colors.map(color => ({ ...color, rgb: [...color.rgb] as [number, number, number] }))]));
    fallback = { status: 'ready', source: 'builtin', origin: 'offline', error: '', refreshing: false,
      backgroundError: '', palettes, names: { ...BRAND_NAMES } };
  }
  return { ...fallback, status: 'ready', source: fallback.source === 'builtin' ? 'builtin' : 'cache',
    origin: 'offline', refreshing: false, error: '', backgroundError: message };
}

/** Return true for a successful live response; offline-ready data is separately exposed in the snapshot. */
export function refreshBrandCatalog(options: { background?: boolean; force?: boolean } = {}): Promise<boolean> {
  if (inFlight) return inFlight;
  if (options.background && !options.force && Date.now() - lastFinishedAt < BACKGROUND_COOLDOWN_MS) return Promise.resolve(snapshot.source === 'live');
  loadFallback();
  // Assign the shared promise before notifying subscribers or invoking fetch.
  inFlight = Promise.resolve().then(async () => {
    publish({ ...(snapshot.status === 'loading' ? offlineCatalog('') : snapshot), refreshing: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch('/api/brands/catalog', { headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
      let envelope: { success?: boolean; data?: unknown; message?: string; code?: string };
      try { envelope = await response.json(); }
      catch (error) {
        if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
          throw new BrandCatalogUnavailableError();
        }
        throw error;
      }
      const message = typeof envelope?.message === 'string' ? envelope.message : '品牌目录读取失败（' + response.status + '）。';
      const authoritativeCode = ['BRAND_DISABLED', 'BRAND_DELETED', 'FORBIDDEN', 'UNAUTHORIZED', 'PERMISSION_DENIED', 'ACCESS_DENIED']
        .includes(envelope?.code ?? '');
      const authoritativeStatus = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status);
      if (authoritativeCode || authoritativeStatus || (response.ok && envelope?.success === false)) {
        throw new BrandCatalogUnavailableError(message);
      }
      if (!response.ok || envelope?.success !== true) throw new Error(message);
      const data = envelope.data as { items?: unknown } | null;
      if (Array.isArray(data?.items) && data.items.length === 0) {
        throw new BrandCatalogUnavailableError('在线品牌目录为空，暂无可用品牌；已有图纸与颜色快照保留。');
      }
      const next = projectBrandCatalog(envelope.data);
      // Unchanged responses must not rerun palette effects and reset local choices.
      const unchanged = JSON.stringify(next.palettes) === JSON.stringify(snapshot.palettes)
        && JSON.stringify(next.names) === JSON.stringify(snapshot.names);
      fallback = unchanged ? { ...next, source: 'live', origin: 'live', palettes: snapshot.palettes, names: snapshot.names } : next;
      cacheLoaded = true;
      blockedReason = '';
      saveCache({ savedAt: Date.now(), data: envelope.data });
      publish(fallback);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法读取品牌目录。';
      if (error instanceof BrandCatalogUnavailableError) {
        blockedReason = message;
        cacheLoaded = true;
        fallback = null;
        saveCache({ blocked: true, reason: message });
      }
      publish(offlineCatalog(message));
      return false;
    } finally { clearTimeout(timer); lastFinishedAt = Date.now(); inFlight = null; }
  });
  return inFlight;
}
