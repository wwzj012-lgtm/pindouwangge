export interface ManagedBrandColor {
  id: string; code: string; name: string; hex: string; screenReferenceOnly: boolean;
}
export interface ManagedBrand {
  code: string; name: string; builtin: boolean; enabled: boolean; protected: boolean;
  version: number; colorCount: number; colors: ManagedBrandColor[];
}
export interface ManagedBrandCatalog { items: ManagedBrand[] }
export interface BrandMutationReceipt {
  operationId: string; brandCode: string; version: number; colorId: string | null;
  action: 'createBrand' | 'updateBrand' | 'deleteBrand' | 'createColor' | 'updateColor' | 'deleteColor';
}
export const BRAND_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;
export const COLOR_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_.-]{0,63}$/;
export function normalizedCatalogCode(value: string): string { return value.trim().toUpperCase(); }
export function colorValidation(code: string, name: string, hex: string): string | null {
  if (!COLOR_CODE_PATTERN.test(normalizedCatalogCode(code))) return '色号限 1–64 位字母、数字、下划线、小数点或连字符。';
  if (!name.trim() || name.trim().length > 100) return '颜色名称须为 1–100 字。';
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex.trim())) return 'HEX 须为 #RRGGBB，例如 #A3B18A。';
  return null;
}
export function brandDeleteReason(brand: ManagedBrand): string | null {
  if (brand.protected || brand.code === 'MARD') return '默认 MARD 须保持可用，不能删除。';
  if (brand.colorCount > 0) return `该品牌含 ${brand.colorCount} 个颜色，请先删除子颜色，或禁用品牌以停止前台选用。`;
  return null;
}
export function filterBrandColors(brand: ManagedBrand, query: string): ManagedBrandColor[] {
  const needle = query.trim().toLowerCase();
  return brand.colors.filter(color => !needle || [color.code, color.name, color.hex].some(value => value.toLowerCase().includes(needle)));
}
/** Validate the entire directory before accepting it; never turn malformed data into an empty success. */
export function isManagedBrandCatalog(value: unknown): value is ManagedBrandCatalog {
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items) || value.items.length > 256) return false;
  const brands = new Set<string>(), colorIds = new Set<string>();
  for (const raw of value.items) {
    if (!raw || typeof raw !== 'object') return false;
    const item = raw as ManagedBrand;
    if (typeof item.code !== 'string' || !BRAND_CODE_PATTERN.test(item.code) || item.code === 'CUSTOM' || brands.has(item.code)
      || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100
      || typeof item.enabled !== 'boolean' || typeof item.builtin !== 'boolean' || typeof item.protected !== 'boolean'
      || !Number.isSafeInteger(item.version) || item.version < 1 || !Array.isArray(item.colors) || item.colors.length > 1023
      || item.colorCount !== item.colors.length || item.protected !== (item.code === 'MARD')) return false;
    brands.add(item.code);
    const codes = new Set<string>();
    for (const color of item.colors) {
      if (!color || typeof color !== 'object' || typeof color.id !== 'string' || !color.id || color.id.length > 128 || colorIds.has(color.id)
        || typeof color.code !== 'string' || !COLOR_CODE_PATTERN.test(color.code) || codes.has(color.code)
        || typeof color.name !== 'string' || !color.name.trim() || color.name.length > 100
        || typeof color.hex !== 'string' || !/^#[0-9A-F]{6}$/.test(color.hex) || typeof color.screenReferenceOnly !== 'boolean') return false;
      codes.add(color.code); colorIds.add(color.id);
    }
  }
  return value.items.some((brand: ManagedBrand) => brand.code === 'MARD' && brand.enabled && brand.colors.length > 0);
}
export function isBrandMutationReceipt(value: unknown, operationId: string): value is BrandMutationReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as BrandMutationReceipt;
  return receipt.operationId === operationId && typeof receipt.brandCode === 'string' && BRAND_CODE_PATTERN.test(receipt.brandCode)
    && Number.isSafeInteger(receipt.version) && receipt.version > 0
    && (receipt.colorId === null || typeof receipt.colorId === 'string')
    && ['createBrand', 'updateBrand', 'deleteBrand', 'createColor', 'updateColor', 'deleteColor'].includes(receipt.action);
}
