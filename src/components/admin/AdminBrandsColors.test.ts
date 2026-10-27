import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRAND_NAMES, BRAND_ORDER, BRAND_PALETTES } from '../../data/palettes';
import { brandDeleteReason, colorValidation, filterBrandColors, isManagedBrandCatalog, normalizedCatalogCode,
  type ManagedBrand, type ManagedBrandCatalog } from './AdminBrandsColors.model';
import { paletteForNewConversion, projectBrandCatalog } from '../../data/brandCatalog';

function staticCatalog(): ManagedBrandCatalog {
  return { items: BRAND_ORDER.filter(code => code !== 'CUSTOM').map(code => ({ code, name: BRAND_NAMES[code],
    enabled: true, builtin: true, protected: code === 'MARD', version: 1, colorCount: BRAND_PALETTES[code].length,
    colors: BRAND_PALETTES[code].map(color => ({ id: color.id, code: color.code, name: color.name,
      hex: color.hex, screenReferenceOnly: Boolean(color.screenReferenceOnly) })) })) };
}
afterEach(() => { vi.unstubAllGlobals(); });
describe('live brand directory', () => {
  it('keeps local enabled choices with live colors while removing deleted colors from new conversion', () => {
    const active = structuredClone(BRAND_PALETTES.MARD);
    active[0].enabled = false;
    const live = structuredClone(BRAND_PALETTES.MARD).filter(color => color.code !== 'A2');
    live[0].hex = '#123456';
    const result = paletteForNewConversion(live, active, 'MARD');
    expect(result[0].enabled).toBe(false); expect(result[0].hex).toBe('#123456');
    expect(result.some(color => color.code === 'A2')).toBe(false);
    expect(active[0].hex).toBe('#FAF4C8');
    expect(paletteForNewConversion(live, active, 'CUSTOM')).toBe(active);
  });
  it('preserves every real builtin color identity, value, order, flag and default template', () => {
    const input = staticCatalog(); expect(isManagedBrandCatalog(input)).toBe(true);
    const projected = projectBrandCatalog(input);
    for (const key of BRAND_ORDER.filter(code => code !== 'CUSTOM')) {
      expect(projected.palettes[key]).toEqual(BRAND_PALETTES[key]);
      expect(projected.names[key]).toBe(BRAND_NAMES[key]);
    }
    expect(projected.palettes.CUSTOM).toHaveLength(221);
    expect(projected.palettes.CUSTOM[0].brand).toBe('CUSTOM');
    expect(projected.palettes.CUSTOM[0].id).toBe('MARD_A1');
  });
  it('uses persisted builtin edits and new brands; disabled/deleted/empty brands disappear without modifying saved snapshots', () => {
    const input = staticCatalog(), original = structuredClone(BRAND_PALETTES.MARD);
    input.items[0].colors[0].hex = '#123456'; input.items[0].name = '后台改名';
    input.items[1].enabled = false; input.items = input.items.filter(brand => brand.code !== 'COCO');
    input.items.push({ code: 'STUDIO', name: '工作室', enabled: true, builtin: false, protected: false, version: 2,
      colorCount: 1, colors: [{ id: 'color_studio', code: 'A1', name: '松绿', hex: '#ABCDEF', screenReferenceOnly: false }] });
    input.items.push({ code: 'EMPTY', name: '空品牌', enabled: true, builtin: false, protected: false, version: 1, colorCount: 0, colors: [] });
    const result = projectBrandCatalog(input);
    expect(result.names.MARD).toBe('后台改名'); expect(result.palettes.MARD[0].rgb).toEqual([18, 52, 86]);
    expect(result.palettes.STUDIO[0].brand).toBe('STUDIO');
    expect(result.palettes.MARD_291).toBeUndefined(); expect(result.palettes.COCO).toBeUndefined(); expect(result.palettes.EMPTY).toBeUndefined();
    expect(BRAND_PALETTES.MARD).toEqual(original);
  });
  it('rejects missing default, empty default, malformed HEX, duplicate brands/color codes and count mismatch', () => {
    const invalid: ManagedBrandCatalog[] = [];
    const missing = staticCatalog(); missing.items.shift(); invalid.push(missing);
    const empty = staticCatalog(); empty.items[0].colors = []; empty.items[0].colorCount = 0; invalid.push(empty);
    const badHex = staticCatalog(); badHex.items[0].colors[0].hex = 'red'; invalid.push(badHex);
    const duplicate = staticCatalog(); duplicate.items.push(duplicate.items[0]); invalid.push(duplicate);
    const duplicateCode = staticCatalog(); duplicateCode.items[0].colors[1].code = duplicateCode.items[0].colors[0].code; invalid.push(duplicateCode);
    const count = staticCatalog(); count.items[0].colorCount++; invalid.push(count);
    for (const candidate of invalid) { expect(isManagedBrandCatalog(candidate)).toBe(false); expect(() => projectBrandCatalog(candidate)).toThrow(); }
  });
  it('retains a ready directory on background failure but returns failure to block fresh conversions', async () => {
    vi.resetModules(); const store = await import('../../data/brandCatalog');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ success: true, data: staticCatalog() }))
      .mockRejectedValueOnce(new Error('directory unavailable')));
    expect(await store.refreshBrandCatalog()).toBe(true); expect(store.getBrandCatalogSnapshot().status).toBe('ready');
    const previous = store.getBrandCatalogSnapshot().palettes;
    expect(await store.refreshBrandCatalog()).toBe(false);
    expect(store.getBrandCatalogSnapshot().status).toBe('ready');
    expect(store.getBrandCatalogSnapshot().error).toBe('');
    expect(store.getBrandCatalogSnapshot().backgroundError).toContain('directory unavailable');
    expect(store.getBrandCatalogSnapshot().palettes).toBe(previous);
  });
  it('does not invent a static fallback when the system directory has not been connected', async () => {
    vi.resetModules(); const store = await import('../../data/brandCatalog');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: false, message: 'not connected' }, { status: 404 })));
    expect(await store.refreshBrandCatalog()).toBe(false); expect(store.getBrandCatalogSnapshot().status).toBe('error');
    expect(store.getBrandCatalogSnapshot().palettes).toEqual({});
  });
});
describe('brand and color management rules', () => {
  it('normalizes code case, searches actual code/name/HEX and explains brand delete protections', () => {
    expect(normalizedCatalogCode(' studio ')).toBe('STUDIO');
    const brand = staticCatalog().items[0];
    expect(filterBrandColors(brand, '#faf4c8').map(color => color.code)).toContain('A1');
    expect(filterBrandColors(brand, ' A1 ')).not.toHaveLength(0);
    expect(brandDeleteReason(brand)).toContain('默认 MARD');
    expect(brandDeleteReason({ ...brand, code: 'STUDIO', protected: false })).toContain('221');
    expect(brandDeleteReason({ ...brand, code: 'STUDIO', protected: false, colorCount: 0, colors: [] })).toBeNull();
    expect(colorValidation('a1', '松绿', '#abcdef')).toBeNull();
    expect(colorValidation('bad code', '松绿', '#ABCDEF')).toBeTruthy();
    expect(colorValidation('A1', '', '#ABCDEF')).toBeTruthy();
    expect(colorValidation('A1', '松绿', '#FFF')).toBeTruthy();
  });
});
