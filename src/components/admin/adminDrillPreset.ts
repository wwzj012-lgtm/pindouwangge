/**
 * 仪表盘待办卡「下钻预置筛选」的单一契约（QA B11）。
 *
 * 生产端：`adminDashboardModel.todoDrillQuery()` 把 `preset=review-queue|reports|low-stock`
 * 写进 URL（AdminConsole.performAction）。
 * 消费端：本模块把 preset 翻译成目标页的初始页签/筛选——**两端都只认这里的映射**，
 * 所以「点了没反应」这类回归可以用纯函数单测钉住，不需要 DOM。
 *
 * 生命周期：preset 只在**首次进入**时生效（刷新仍生效）；用户一旦自己切换页签/筛选，
 * 就调用 `clearDrillPreset()` 把 URL 上的 preset 抹掉，避免之后刷新又被劫持。
 */

/** 目前只有三张待办卡会下钻。 */
export type DrillPreset = 'review-queue' | 'reports' | 'low-stock';

/** URL 参数名（与 todoDrillQuery 产出的 key 一致）。 */
export const DRILL_PRESET_PARAM = 'preset';

/** 校验并归一化 preset；未知值一律返回 null（不猜、不落到默认页签以外的地方）。 */
export function parseDrillPreset(value: string | null | undefined): DrillPreset | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw === 'review-queue' || raw === 'reports' || raw === 'low-stock' ? raw as DrillPreset : null;
}

/** 从查询串（`?preset=...`）里读 preset；不依赖 window，便于单测。 */
export function readDrillPreset(search: string | null | undefined): DrillPreset | null {
  if (typeof search !== 'string' || search.length === 0) return null;
  return parseDrillPreset(new URLSearchParams(search.replace(/^\?/, '')).get(DRILL_PRESET_PARAM));
}

/** 浏览器环境读取当前地址栏（SSR / 无 window 时返回 null，绝不抛错）。 */
export function drillPresetFromLocation(): DrillPreset | null {
  return typeof window === 'undefined' || !window.location ? null : readDrillPreset(window.location.search);
}

/** 用户自己切换了页签/筛选：把 preset 从 URL 抹掉（不动 history 长度）。 */
export function clearDrillPreset(): void {
  if (typeof window === 'undefined' || !window.history || !window.location) return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(DRILL_PRESET_PARAM)) return;
  url.searchParams.delete(DRILL_PRESET_PARAM);
  window.history.replaceState(window.history.state, '', url);
}

/** preset → 社区内容页初始页签：审核队列 / 举报；其余（含 null）返回 null。 */
export function communityTabFromPreset(preset: DrillPreset | null): 'queue' | 'reports' | null {
  if (preset === 'review-queue') return 'queue';
  if (preset === 'reports') return 'reports';
  return null;
}

/**
 * preset → 兑换码页初始状态筛选。
 * 「低库存」的**数字**是「全部可用库存」（`used=0 AND delete_pending_at IS NULL`），
 * 与列表 `status=available` 的 SQL 谓词完全一致，所以列表总数与待办卡数字同口径；
 * 阈值只决定是否标红（后端没有、也不需要额外的 low-stock 过滤分支）。
 */
export function codeStatusFromPreset(preset: DrillPreset | null): 'available' | null {
  return preset === 'low-stock' ? 'available' : null;
}
