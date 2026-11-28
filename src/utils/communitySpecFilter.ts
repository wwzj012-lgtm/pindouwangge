/**
 * 社区作品「规格筛选」（按豆子数量）的纯逻辑。
 *
 * 语义：**累计上限**。标签 `≤2k` 的意思是「2000 颗及以下」，`≤8k` 必须包含 `≤2k`
 * 的全部作品——每个标签都是「0 ~ N」的上限桶，桶与桶之间是包含关系，不是互斥区间。
 *
 * 历史 Bug（2026-11-27 用户反馈「小于 8k 的没有包含小于 2k 的」）：旧实现把每个
 * 标签当成互斥区间（如 `le2000 → 1000 < n ≤ 2000`），于是点 `≤8k` 只得到
 * `5000 < n ≤ 8000` 的作品，2000 颗以下的作品全部消失。区间桶是错的，本模块是
 * 唯一实现，`CommunityView` 不再各写一份区间判断。
 *
 * 缺失规格（`specs` 未回填 / 旧数据）的作品只出现在 `all` 桶里：它们无法判断大小，
 * 塞进任何上限桶都会骗人。
 */

/**
 * 规格筛选桶。`all` = 不筛；`le*` = 上限包含；`gt8000` = 大于 8000。
 *
 * 2026-11-28 用户要求「去掉小于 500 这个选项」：`le500` 桶已删除（7 个 chip）。
 * 首桶从 1k 起——小于 1k 的作品由 `≤1k` 覆盖，信息不丢失。
 */
export type SpecFilter =
  | 'all'
  | 'le1000'
  | 'le2000'
  | 'le3000'
  | 'le5000'
  | 'le8000'
  | 'gt8000';

export interface SpecFilterOption {
  value: SpecFilter;
  label: string;
}

/**
 * 规格 chips 的顺序与文案（UI 与筛选逻辑共用，避免两处漂移）。
 * `readonly` + `as const`：调用方只读，不会顺手 map 出一个新数组改顺序。
 */
export const SPEC_FILTER_OPTIONS: readonly SpecFilterOption[] = [
  { value: 'all', label: '全部' },
  { value: 'le1000', label: '≤1k' },
  { value: 'le2000', label: '≤2k' },
  { value: 'le3000', label: '≤3k' },
  { value: 'le5000', label: '≤5k' },
  { value: 'le8000', label: '≤8k' },
  { value: 'gt8000', label: '>8k' },
];

/**
 * 每个「≤」桶的上限值（累计上限）。新增桶只需在这张表里加一行，
 * `matchesSpecFilter` 无需改动。
 */
const SPEC_UPPER_BOUND: Record<Exclude<SpecFilter, 'all' | 'gt8000'>, number> = {
  le1000: 1_000,
  le2000: 2_000,
  le3000: 3_000,
  le5000: 5_000,
  le8000: 8_000,
};

/**
 * 判断一份作品是否命中某个规格桶。
 *
 * @param beadCount 作品豆子数量（来自后端 `specs.beadCount` 快照）；旧数据为 `undefined`。
 * @param filter 当前选中的规格桶。
 * @returns 命中返回 true。`all` 恒为 true；其余桶在 `beadCount` 缺失时为 false。
 */
export function matchesSpecFilter(beadCount: number | undefined | null, filter: SpecFilter): boolean {
  if (filter === 'all') return true;
  // 规格缺失 / 非法值：不进任何非全量桶（保持既有行为，绝不猜测大小）。
  if (beadCount == null || !Number.isFinite(beadCount)) return false;
  if (filter === 'gt8000') return beadCount > SPEC_UPPER_BOUND.le8000;
  // 累计上限：`≤N` 就是 `beadCount <= N`，天然包含所有更小的桶。
  return beadCount <= SPEC_UPPER_BOUND[filter];
}
