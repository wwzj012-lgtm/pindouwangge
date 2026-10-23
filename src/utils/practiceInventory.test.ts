import { describe, expect, it } from 'vitest';
import type { BeadColor } from '../types';
import type { BeadInventory, BeadStockItem } from './beadInventory';
import { buildPracticePlan, createPracticeRestockList, filterPracticeRequirements } from './practiceInventory';

const mard: BeadColor = { id: 'MARD_A1', code: 'A1', name: '奶黄', brand: 'MARD', hex: '#FAF4C8', rgb: [250, 244, 200] };
const coco: BeadColor = { ...mard, id: 'COCO_A1', name: '雪白', brand: 'COCO' };
const red: BeadColor = { ...mard, id: 'MARD_A2', code: 'A2', name: '红色' };
const palette = new Map([mard, coco, red].map(color => [color.id, color]));
const stock = (count: number, overrides: Partial<BeadStockItem> = {}): BeadStockItem => ({ colorId: mard.id, code: mard.code, name: mard.name, hex: mard.hex, count, alertThreshold: 100, ...overrides });
const byId = (plan: ReturnType<typeof buildPracticePlan>, id: string) => plan.rows.find(row => row.id === id)!;

describe('practice requirement and inventory matching', () => {
  it('counts occupied cells, sorts shortages first and keeps missing inventory explicit', () => {
    const grid = [[mard.id, mard.id, null], [coco.id, red.id, red.id]];
    const inventory = { A1: stock(8), A2: stock(1, { colorId: red.id, code: red.code }) };
    const plan = buildPracticePlan(grid, palette, inventory, true);
    expect(plan).toMatchObject({ total: 5, colorCount: 3 });
    expect(plan.rows.map(row => row.id)).toEqual([coco.id, red.id, mard.id]);
    expect(byId(plan, mard.id)).toMatchObject({ required: 2, stock: 8, remaining: 6, shortage: 0, recorded: true });
    expect(byId(plan, coco.id)).toMatchObject({ required: 1, stock: 0, shortage: 1, recorded: false });
    expect(inventory.A1.count).toBe(8);
    expect(grid[0]).toEqual([mard.id, mard.id, null]);
  });

  it('never matches legacy stock to another brand by code, including CUSTOM legacy IDs', () => {
    const plan = buildPracticePlan([[coco.id, mard.id]], palette, {
      A1: stock(50), custom: stock(999, { colorId: 'CUSTOM_A1' }), codeOnly: stock(900, { colorId: '' }),
    }, true);
    expect(byId(plan, coco.id).stock).toBe(0);
    expect(byId(plan, mard.id).stock).toBe(50);
  });

  it('uses full colorId even when the legacy code or record key differs', () => {
    const plan = buildPracticePlan([[mard.id]], palette, { oldKey: stock(6, { code: 'old' }) }, true);
    expect(plan.rows[0]).toMatchObject({ stock: 6, recorded: true });
  });

  it('accepts brand+code fallback only within the same brand', () => {
    const plan = buildPracticePlan([[coco.id, mard.id]], palette, {
      renamed: stock(9, { colorId: 'old-name', brand: 'COCO' }),
    }, true);
    expect(byId(plan, coco.id).stock).toBe(9);
    expect(byId(plan, mard.id).stock).toBe(0);
  });

  it('rejects conflicting brand/colorId metadata', () => {
    const plan = buildPracticePlan([[coco.id, mard.id]], palette, { conflict: stock(99, { brand: 'COCO' }) }, true);
    expect(plan.rows.every(row => row.stock === 0)).toBe(true);
  });

  it('does not use code fallback to contradict a known colorId', () => {
    const plan = buildPracticePlan([[mard.id]], palette, { conflict: stock(99, { brand: 'MARD', colorId: red.id }) }, true);
    expect(plan.rows[0].stock).toBe(0);
  });

  it('does not sum duplicate legacy and branded representations of one physical stock pool', () => {
    const plan = buildPracticePlan([[mard.id]], palette, {
      A1: stock(20), MARD_A1: stock(20), renamed: stock(8, { brand: 'MARD', colorId: 'renamed' }),
    }, true);
    expect(plan.rows[0]).toMatchObject({ stock: 8, remaining: 7, inventoryConflict: true });
  });

  it('assigns a brand/code pool only once even if palette IDs alias the same physical color', () => {
    const alias = { ...mard, id: 'other-id' };
    const aliasedPalette = new Map([...palette, [alias.id, alias] as [string, BeadColor]]);
    const inventory = { first: stock(10), second: stock(10, { colorId: alias.id }) };
    const plan = buildPracticePlan([[mard.id, alias.id]], aliasedPalette, inventory, true);
    expect(plan.rows.reduce((sum, row) => sum + row.stock, 0)).toBe(10);
    expect(plan.rows.filter(row => row.recorded)).toHaveLength(1);
    expect(plan.rows.every(row => row.inventoryConflict)).toBe(true);
  });

  it('does not guess the target of ambiguous brand/code-only stock', () => {
    const alias = { ...mard, id: 'other-id' };
    const aliasedPalette = new Map([...palette, [alias.id, alias] as [string, BeadColor]]);
    const plan = buildPracticePlan([[mard.id, alias.id]], aliasedPalette, { old: stock(10, { colorId: '', brand: 'MARD' }) }, true);
    expect(plan.rows.every(row => !row.recorded && row.stock === 0)).toBe(true);
  });

  it('treats an explicit zero record as recorded and an unknown palette ID as unrecorded', () => {
    const plan = buildPracticePlan([[mard.id, 'missing']], palette, { A1: stock(0) }, true);
    expect(byId(plan, mard.id)).toMatchObject({ recorded: true, stock: 0 });
    expect(byId(plan, 'missing')).toMatchObject({ color: null, recorded: false, shortage: 1 });
  });

  it('omits every per-color field and copy payload when locked', () => {
    const plan = buildPracticePlan([[mard.id, coco.id, mard.id]], palette, { A1: stock(500) }, false);
    expect(plan).toEqual({ total: 3, colorCount: 2, rows: [] });
    expect(createPracticeRestockList(plan)).toBe('');
    expect(JSON.stringify(plan)).not.toContain('A1');
  });

  it('searches brand/name/code and copies all shortages independent of the visual filter', () => {
    const plan = buildPracticePlan([[mard.id, coco.id, red.id]], palette, { A1: stock(5) }, true);
    expect(filterPracticeRequirements(plan.rows, 'coco', true).map(row => row.id)).toEqual([coco.id]);
    expect(filterPracticeRequirements(plan.rows, '奶黄', false).map(row => row.id)).toEqual([mard.id]);
    expect(filterPracticeRequirements(plan.rows, ' a2 ', true).map(row => row.id)).toEqual([red.id]);
    const text = createPracticeRestockList(plan);
    expect(text).toContain('COCO A1 雪白：补 1 粒');
    expect(text).toContain('MARD A2 红色：补 1 粒');
    expect(text).not.toContain('MARD A1');
    expect(text).toContain('未录入');
  });

  it('handles empty works and entirely sufficient stock', () => {
    expect(buildPracticePlan([], palette, {}, true)).toEqual({ total: 0, colorCount: 0, rows: [] });
    const plan = buildPracticePlan([[mard.id]], palette, { A1: stock(3) }, true);
    expect(createPracticeRestockList(plan)).toContain('库存充足');
  });

  it('keeps different brands and material sizes in distinct stock pools', () => {
    const mini = { ...mard, id: 'ARTKAL_MINI_A1', brand: 'ARTKAL_MINI' as const };
    const small = { ...mard, id: 'ARTKAL_S_A1', brand: 'ARTKAL_S' as const };
    const ownPalette = new Map([mini, small].map(color => [color.id, color]));
    const inventory: BeadInventory = { mini: stock(20, { colorId: mini.id, brand: 'ARTKAL_MINI' }) };
    const plan = buildPracticePlan([[mini.id, small.id]], ownPalette, inventory, true);
    expect(byId(plan, small.id).stock).toBe(0);
    expect(byId(plan, mini.id).stock).toBe(20);
  });
});
