/**
 * 批次 3：仪表盘 todo / metrics / sections 的纯解析与展示口径。
 * 后端（GET /api/admin/dashboard）缺字段或类型不符时返回 null，
 * 前端不补造、不把未知值渲染成 0。
 */

export interface DashboardTodo {
  pendingReviews: number;
  pendingReports: number;
  lowStockCodes: boolean;
  availableCodes?: number;
  lowStockThreshold?: number;
}

export interface DashboardMetrics {
  todayNewWorks: number;
  todayNewPosts: number;
  todayNewReports: number;
  registerTrend7d: TrendPoint[];
}

export interface TrendPoint { date: string; count: number }

export interface DashboardSection { available: boolean; error?: string }

function safeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** 解析 todo 分段；四个核心字段齐才可用，附加字段（可用数/阈值）可缺省。 */
export function parseDashboardTodo(value: unknown): DashboardTodo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const pendingReviews = safeCount(candidate.pendingReviews);
  const pendingReports = safeCount(candidate.pendingReports);
  if (pendingReviews === null || pendingReports === null || typeof candidate.lowStockCodes !== 'boolean') return null;
  return {
    pendingReviews,
    pendingReports,
    lowStockCodes: candidate.lowStockCodes,
    availableCodes: safeCount(candidate.availableCodes) ?? undefined,
    lowStockThreshold: safeCount(candidate.lowStockThreshold) ?? undefined,
  };
}

/** 解析 metrics 分段；趋势点缺 date/count 的样本直接丢弃，不补造。 */
export function parseDashboardMetrics(value: unknown): DashboardMetrics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const todayNewWorks = safeCount(candidate.todayNewWorks);
  const todayNewPosts = safeCount(candidate.todayNewPosts);
  const todayNewReports = safeCount(candidate.todayNewReports);
  if (todayNewWorks === null || todayNewPosts === null || todayNewReports === null) return null;
  const registerTrend7d = Array.isArray(candidate.registerTrend7d)
    ? (candidate.registerTrend7d as unknown[]).flatMap((point) => {
      if (!point || typeof point !== 'object') return [];
      const entry = point as Record<string, unknown>;
      return typeof entry.date === 'string' && safeCount(entry.count) !== null
        ? [{ date: entry.date, count: entry.count as number }]
        : [];
    })
    : [];
  return { todayNewWorks, todayNewPosts, todayNewReports, registerTrend7d };
}

/** 今日注册数 = 注册趋势最后一个点（当日 0 点起口径）；趋势缺失时为 null。 */
export function todayRegistrations(metrics: DashboardMetrics | null): number | null {
  const points = metrics?.registerTrend7d ?? [];
  return points.length > 0 ? points[points.length - 1]!.count : null;
}

/**
 * 密度改版：注册趋势柱状图的像素高度——每天一列固定 28px 柱宽，
 * 高度按值比例（峰值 = peakHeight，默认 44px，为"标题+数值标签+日期"留出
 * 整段 ≤110px 的总高预算）；零值/空趋势 3px（配合 CSS 灰柱）。
 */
export function trendBarPixelHeights(points: TrendPoint[], peakHeight = 44): number[] {
  const peak = Math.max(0, ...points.map((point) => point.count));
  if (peak === 0) return points.map(() => 3);
  return points.map((point) => Math.max(3, Math.round((Math.max(0, point.count) / peak) * peakHeight)));
}

/** 7 天注册趋势总和：非法样本按 0 处理；总和为 0 时前端不渲染图表（改一行灰字）。 */
export function registerTrendTotal(points: TrendPoint[]): number {
  return points.reduce((sum, point) => sum + (Number.isFinite(point.count) && point.count > 0 ? point.count : 0), 0);
}

/** 待办卡下钻查询参数（写入 URL，目标板块可读取预置筛选）。 */
export function todoDrillQuery(card: 'reviews' | 'reports' | 'codes'): Record<string, string> {
  if (card === 'reviews') return { preset: 'review-queue' };
  if (card === 'reports') return { preset: 'reports' };
  return { preset: 'low-stock' };
}
