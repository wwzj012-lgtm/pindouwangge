import { describe, expect, it } from 'vitest';
import { BRAND_PALETTES } from '../data/palettes';
import {
  assignLegacyInventory, getBrandInventory, getInventoryColor, INVENTORY_BRANDS,
  isValidBeadCount, MAX_BEAD_COUNT, updateBrandInventory, type BeadInventory,
} from './beadInventory';
import { buildPracticePlan } from './practiceInventory';

const old = { colorId: 'MARD_A1', code: 'A1', name: '旧名称', hex: '#fff', count: 27, alertThreshold: 100 };

describe('fixed brand catalog inventory', () => {
  it('projects every real color at zero without mutating or filling storage', () => {
    const inventory: BeadInventory = {};
    for (const brand of INVENTORY_BRANDS) {
      const rows = getBrandInventory(inventory, brand);
      expect(rows.map(row => row.colorId)).toEqual(BRAND_PALETTES[brand].map(color => color.id));
      expect(rows.every(row => row.count === 0 && row.inventoryKeys.length === 0)).toBe(true);
    }
    expect(getBrandInventory(inventory, 'MARD_291').map(row => row.code)).toContain('ZG8');
    expect(getBrandInventory(inventory, 'CUSTOM')).toEqual([]);
    expect(inventory).toEqual({});
    expect(updateBrandInventory(inventory, 'MARD', ['MARD_A1'], 0)).toEqual({});
  });

  it('preserves full-ID unbranded legacy stock, unknown metadata and unmapped custom records', () => {
    const inventory = { A1: { ...old, note: 'keep' }, custom: { ...old, colorId: 'CUSTOM_A1', count: 42 } };
    expect(getBrandInventory(inventory, 'MARD')[0]).toMatchObject({ count: 27, inventoryKeys: ['A1'] });
    expect(getBrandInventory(inventory, 'COCO')[0].count).toBe(0);
    expect(getInventoryColor(inventory.custom)).toBeUndefined();
    const updated = updateBrandInventory(inventory, 'MARD', ['MARD_A1'], 29);
    expect(updated.A1).toEqual({ ...inventory.A1, count: 29 });
    expect(updated.custom).toBe(inventory.custom);
    expect(inventory.A1.count).toBe(27);
  });

  it('edits matching codes in different brands independently and keeps counts after switching', () => {
    let inventory = updateBrandInventory({}, 'MARD', ['MARD_A1'], 10);
    inventory = updateBrandInventory(inventory, 'MARD_291', ['MARD_291_A1'], 20);
    expect(getBrandInventory(inventory, 'MARD').find(row => row.code === 'A1')?.count).toBe(10);
    expect(getBrandInventory(inventory, 'MARD_291').find(row => row.code === 'A1')?.count).toBe(20);
    expect(getBrandInventory(inventory, 'COCO').find(row => row.code === 'E02')?.count).toBe(0);
  });

  it('uses authoritative full IDs, accepts branded fallback and rejects conflicting identities', () => {
    expect(getInventoryColor({ ...old, code: 'old' })?.id).toBe('MARD_A1');
    expect(getInventoryColor({ ...old, colorId: 'old', brand: 'COCO', code: 'E02' })?.id).toBe('COCO_E02');
    expect(getInventoryColor({ ...old, brand: 'COCO' })).toBeUndefined();
    expect(getInventoryColor({ ...old, colorId: 'CUSTOM_A1' })).toBeUndefined();
  });

  it('keeps batch operations scoped to selected brand colors and handles zero and saturation', () => {
    const original: BeadInventory = { legacy: old, other: { ...old, colorId: 'COCO_E02', brand: 'COCO', count: 80 } };
    const updated = updateBrandInventory(original, 'MARD', ['MARD_A1', 'COCO_E02', 'FAKE'], 50, 'delta');
    expect(updated.legacy.count).toBe(77);
    expect(updated.other).toBe(original.other);
    expect(Object.keys(updated)).toHaveLength(2);
    expect(updateBrandInventory(updated, 'MARD', ['MARD_A1'], -100, 'delta').legacy.count).toBe(0);
    const max = updateBrandInventory(updated, 'MARD', ['MARD_A1'], MAX_BEAD_COUNT);
    expect(updateBrandInventory(max, 'MARD', ['MARD_A1'], 100, 'delta').legacy.count).toBe(MAX_BEAD_COUNT);
  });

  it.each([NaN, Infinity, -Infinity, -1, 1.5, MAX_BEAD_COUNT + 1, Number.MAX_SAFE_INTEGER])('rejects invalid new quantity %s', value => {
    expect(isValidBeadCount(value)).toBe(false);
    expect(() => updateBrandInventory({}, 'MARD', ['MARD_A1'], value)).toThrow(RangeError);
  });

  it('retains preexisting counts above the editing limit until explicitly edited', () => {
    const inventory = { old: { ...old, count: MAX_BEAD_COUNT + 50 } };
    expect(getBrandInventory(inventory, 'MARD')[0].count).toBe(MAX_BEAD_COUNT + 50);
    expect(updateBrandInventory(inventory, 'COCO', ['COCO_E02'], 5).old).toBe(inventory.old);
    expect(() => updateBrandInventory(inventory, 'MARD', ['MARD_A1'], -100, 'delta')).toThrow('原库存已保留');
  });

  it('does not overwrite a legacy record whose storage key resembles a catalog ID', () => {
    const inventory = { MARD_A1: { ...old, colorId: 'CUSTOM_A1' } };
    const updated = updateBrandInventory(inventory, 'MARD', ['MARD_A1'], 5);
    expect(updated.MARD_A1).toBe(inventory.MARD_A1);
    expect(updated['MARD_A1:stock'].count).toBe(5);
  });

  it('migrates custom records only on explicit assignment, preserving count/key/metadata', () => {
    const inventory = { custom: { ...old, colorId: 'CUSTOM_A1', note: 'keep' } };
    const updated = assignLegacyInventory(inventory, 'custom', 'COCO_E02');
    expect(Object.keys(updated)).toEqual(['custom']);
    expect(updated.custom).toMatchObject({ colorId: 'COCO_E02', brand: 'COCO', count: 27, note: 'keep' });
    expect(inventory.custom.colorId).toBe('CUSTOM_A1');
    expect(() => assignLegacyInventory({ ...inventory, present: { ...old, colorId: 'COCO_E02' } }, 'custom', 'COCO_E02')).toThrow('已有库存');
  });

  it('keeps practice stock live and isolated after edit, legacy migration and batch updates', () => {
    let inventory = { old, custom: { ...old, colorId: 'CUSTOM_A1', count: 9 } };
    let updated: BeadInventory = updateBrandInventory(inventory, 'MARD', ['MARD_A1'], 45);
    updated = assignLegacyInventory(updated, 'custom', 'COCO_E02');
    updated = updateBrandInventory(updated, 'COCO', ['COCO_E02'], 5, 'delta');
    const colors = [BRAND_PALETTES.MARD[0], BRAND_PALETTES.COCO[0], BRAND_PALETTES.MARD_291[0]];
    const plan = buildPracticePlan([colors.map(color => color.id)], new Map(colors.map(color => [color.id, color])), updated, true);
    expect(plan.rows.find(row => row.id === 'MARD_A1')?.stock).toBe(45);
    expect(plan.rows.find(row => row.id === 'COCO_E02')?.stock).toBe(14);
    expect(plan.rows.find(row => row.id === 'MARD_291_A1')?.stock).toBe(0);
  });

  it('preserves duplicate keys and synchronizes explicit edits with practice conservative matching', () => {
    const inventory = { first: old, second: { ...old, count: 10, brand: 'MARD' as const } };
    expect(getBrandInventory(inventory, 'MARD')[0].count).toBe(10);
    const updated = updateBrandInventory(inventory, 'MARD', ['MARD_A1'], 50);
    expect(Object.keys(updated)).toEqual(['first', 'second']);
    expect(updated.first.count).toBe(50);
    expect(updated.second.count).toBe(50);
    expect(buildPracticePlan([['MARD_A1']], new Map([['MARD_A1', BRAND_PALETTES.MARD[0]]]), updated, true).rows[0].stock).toBe(50);
  });
});
