import type { BeadColor } from '../types';
import type { BeadInventory } from './beadInventory';

export interface PracticeRequirement {
  id: string;
  color: BeadColor | null;
  required: number;
  stock: number;
  remaining: number;
  shortage: number;
  recorded: boolean;
  inventoryConflict: boolean;
}

export interface PracticePlan {
  total: number;
  colorCount: number;
  rows: PracticeRequirement[];
}

const normalize = (value: string) => value.trim().toUpperCase();
const colorKey = (color: BeadColor) => JSON.stringify([normalize(color.brand), normalize(color.code)]);

/** No inventory deduction. Locked plans intentionally carry no per-color details. */
export function buildPracticePlan(
  grid: (string | null)[][],
  paletteMap: Map<string, BeadColor>,
  inventory: BeadInventory,
  detailsUnlocked: boolean,
): PracticePlan {
  const counts = new Map<string, number>();
  let total = 0;
  for (const row of grid) {
    for (const id of row) {
      if (id === null) continue;
      total += 1;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  if (!detailsUnlocked) return { total, colorCount: counts.size, rows: [] };
  const rows: PracticeRequirement[] = [...counts].map(([id, required]) => ({
    id, color: paletteMap.get(id) ?? null, required,
    stock: 0, remaining: 0, shortage: required, recorded: false, inventoryConflict: false,
  }));
  const knownIds = new Map<string, BeadColor>();
  for (const [key, color] of paletteMap) {
    knownIds.set(key, color);
    knownIds.set(color.id, color);
  }
  type Candidate = { row: PracticeRequirement; count: number; exact: boolean };
  const pools = new Map<string, Candidate[]>();
  for (const item of Object.values(inventory)) {
    if (!Number.isFinite(item.count) || item.count < 0) continue;
    const brand = item.brand ? normalize(item.brand) : null;
    const known = knownIds.get(item.colorId);
    if (brand && known && normalize(known.brand) !== brand) continue;
    const exact = rows.filter(row => row.color
      && (row.id === item.colorId || row.color.id === item.colorId)
      && (!brand || normalize(row.color.brand) === brand));
    // An unbranded record never matches on code. A conflicting known ID is authoritative.
    const fallback = exact.length || !brand || (known && normalize(known.code) !== normalize(item.code))
      ? [] : rows.filter(row => row.color
        && normalize(row.color.brand) === brand && normalize(row.color.code) === normalize(item.code));
    const targets = exact.length ? exact : fallback.length === 1 ? fallback : [];
    for (const row of targets) {
      const key = colorKey(row.color!);
      const pool = pools.get(key) ?? [];
      pool.push({ row, count: Math.min(Number.MAX_SAFE_INTEGER, Math.floor(item.count)), exact: exact.length > 0 });
      pools.set(key, pool);
    }
  }
  for (const candidates of pools.values()) {
    // One physical brand/code pool is assigned once. Duplicate entries are not additive.
    candidates.sort((a, b) => Number(b.exact) - Number(a.exact) || a.row.id.localeCompare(b.row.id));
    const owner = candidates[0].row;
    owner.stock = Math.min(...candidates.map(candidate => candidate.count));
    owner.recorded = true;
    const conflict = candidates.length > 1;
    for (const { row } of candidates) row.inventoryConflict = conflict;
  }
  for (const row of rows) {
    row.remaining = Math.max(0, row.stock - row.required);
    row.shortage = Math.max(0, row.required - row.stock);
  }
  rows.sort((a, b) => Number(b.shortage > 0) - Number(a.shortage > 0)
    || b.shortage - a.shortage || (a.color?.code ?? a.id).localeCompare(b.color?.code ?? b.id));
  return { total, colorCount: counts.size, rows };
}

export function filterPracticeRequirements(rows: PracticeRequirement[], search: string, shortagesOnly: boolean) {
  const query = search.trim().toLocaleLowerCase();
  return rows.filter(row => (!shortagesOnly || row.shortage > 0)
    && (!query || [row.id, row.color?.brand, row.color?.code, row.color?.name]
      .some(value => value?.toLocaleLowerCase().includes(query))));
}

export function createPracticeRestockList(plan: PracticePlan): string {
  if (!plan.rows.length) return '';
  const missing = plan.rows.filter(row => row.shortage > 0);
  if (!missing.length) return '拼豆补货清单：当前作品库存充足。';
  return ['拼豆补货清单（仅估算，不扣库存）', ...missing.map(row => {
    const label = row.color ? `${row.color.brand} ${row.color.code} ${row.color.name}` : `未知颜色 ${row.id}`;
    return `${label}：补 ${row.shortage} 粒（需求 ${row.required} / 库存 ${row.stock}${row.recorded ? '' : '，未录入'}${row.inventoryConflict ? '，重复记录按较小值估算' : ''}）`;
  })].join('\n');
}
