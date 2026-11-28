/**
 * 仪表盘时间窗口常量与解析（极小程序，单独成文件的原因见下）。
 *
 * AdminConsole（主 chunk）只需要 `range` 的解析；如果它直接 import
 * `adminDashboardModel`，rollup 会把整个解析/格式化模块放进**主 chunk**，
 * 懒加载就没有意义了。所以把这两行逻辑拆成独立小模块：
 * 主 chunk 只吃这 300 字节，模型与图表都留在仪表盘 chunk 里。
 */

/** 仪表盘时间窗口（天）。非法值一律回落 7。 */
export type DashboardRange = 7 | 30;

export const DASHBOARD_RANGES: readonly DashboardRange[] = [7, 30];

/** 解析 `?range=`：只认 '30'，其余（含 null/''/'abc'/'030'）回落 7。 */
export function parseDashboardRange(raw: string | null | undefined): DashboardRange {
  return typeof raw === 'string' && raw.trim() === '30' ? 30 : 7;
}
