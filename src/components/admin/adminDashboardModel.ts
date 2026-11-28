/**
 * 仪表盘纯解析 / 格式化层（批次 6，analytics 重做）。
 *
 * 口径铁律（与后端 docs/admin-dashboard-architecture.md §2 一一对应）：
 * 1. 后端算比率、前端只格式化；分母为 0 时后端返回 `null`，这里一律渲染「—」，
 *    绝不把 null 变成 0、也不做二次除法。
 * 2. 空值三分法：`null`（无样本）/ `0`（真的有 0 次）/ `—`（展示层）。三者不得混用。
 * 3. 涨跌不用红绿（PRD §5 状态色语义）：涨 `▲` + 正号，跌 `▼` + 负号，颜色由 CSS 决定。
 * 4. 未知字段（后端未部署 / 老版本）→ 解析器返回 null，页面降级显示「数据暂不可用」，
 *    不补造 0、不崩。
 */

export interface DashboardTodo {
  pendingReviews: number;
  pendingReports: number;
  lowStockCodes: boolean;
  availableCodes?: number;
  lowStockThreshold?: number;
}

export interface TrendPoint { date: string; count: number }

export interface DashboardSection { available: boolean; error?: string }

/** 时间窗口（定义在 dashboard/dashboardRange.ts，主 chunk 只引那一份）。 */
export { DASHBOARD_RANGES, parseDashboardRange, type DashboardRange } from './dashboard/dashboardRange';
import type { DashboardRange } from './dashboard/dashboardRange';

function safeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 解析 todo 分段；四个核心字段齐才可用，附加字段（可用数/阈值）可缺省。 */
export function parseDashboardTodo(value: unknown): DashboardTodo | null {
  if (!isRecord(value)) return null;
  const pendingReviews = safeCount(value.pendingReviews);
  const pendingReports = safeCount(value.pendingReports);
  if (pendingReviews === null || pendingReports === null || typeof value.lowStockCodes !== 'boolean') return null;
  return {
    pendingReviews,
    pendingReports,
    lowStockCodes: value.lowStockCodes,
    availableCodes: safeCount(value.availableCodes) ?? undefined,
    lowStockThreshold: safeCount(value.lowStockThreshold) ?? undefined,
  };
}

/** 待办卡下钻查询参数（写入 URL，目标板块可读取预置筛选）。 */
export function todoDrillQuery(card: 'reviews' | 'reports' | 'codes'): Record<string, string> {
  if (card === 'reviews') return { preset: 'review-queue' };
  if (card === 'reports') return { preset: 'reports' };
  return { preset: 'low-stock' };
}

// ---------------------------------------------------------------- analytics

export interface DashboardRate { numerator: number; denominator: number; rate: number | null }

export interface DashboardSeriesPoint {
  date: string;
  newUsers: number;
  activeUsersProxy: number;
  works: number;
  posts: number;
  completions: number;
  errors: number;
  /** 当日请求数（与后端 KPI/质量口径同一个分母），后端已算好，前端不做除法。 */
  requests: number;
  /** 当日错误率**百分比值**（1.2 表示 1.2%）；无样本为 null。 */
  errorRatePct: number | null;
  avgDurationMs: number | null;
}

export interface DashboardKpis {
  todayNewCreators: number;
  todayNewCreatorsPrevSameTime: number;
  todayNewCreatorsDeltaPct: number | null;
  publishConversion: DashboardRate;
  pendingTotal: number;
  pendingBreakdown: { reviews: number; reports: number; reportsReviewing: number };
  errorRate24hProxy: { errors: number; requests: number; rate: number | null };
}

export interface DashboardCounters {
  newUsers: number;
  activeUsersProxy: number;
  works: number;
  completions: number;
  posts: number;
  errors: number;
  requests: number;
}

export interface DashboardComparison {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  current: DashboardCounters;
  previous: DashboardCounters;
  deltaPct: Record<keyof DashboardCounters, number | null>;
}

export interface DashboardFunnel {
  works: number;
  completions: number;
  posts: number;
  stepRate: { toCompletion: number | null; toPublish: number | null };
  overallRate: number | null;
  completionsAreEvents: boolean;
}

export interface DashboardQuality {
  errorRateProxy: number | null;
  errors: number;
  requests: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
  durationSamples: number;
  errorCodesTop5: { code: string; count: number }[];
  unresolvedErrors: number;
}

export interface DashboardAnalytics {
  range: DashboardRange;
  todayStartUtc: string;
  kpis: DashboardKpis;
  series: DashboardSeriesPoint[];
  comparison: DashboardComparison;
  funnel: DashboardFunnel;
  quality: DashboardQuality;
}

function parseRate(value: unknown): DashboardRate | null {
  if (!isRecord(value)) return null;
  const numerator = safeCount(value.numerator);
  const denominator = safeCount(value.denominator);
  if (numerator === null || denominator === null) return null;
  return { numerator, denominator, rate: safeNumber(value.rate) };
}

function parseCounters(value: unknown): DashboardCounters | null {
  if (!isRecord(value)) return null;
  const keys: (keyof DashboardCounters)[] = ['newUsers', 'activeUsersProxy', 'works', 'completions', 'posts', 'errors', 'requests'];
  const entries = keys.map(key => [key, safeCount(value[key])] as const);
  if (entries.some(([, parsed]) => parsed === null)) return null;
  return Object.fromEntries(entries) as unknown as DashboardCounters;
}

/** 序列点：缺字段的点整条丢弃（不补 0 —— 后端已补过 0，前端只容错）。 */
function parseSeries(value: unknown): DashboardSeriesPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((point) => {
    if (!isRecord(point) || typeof point.date !== 'string') return [];
    const newUsers = safeCount(point.newUsers);
    const activeUsersProxy = safeCount(point.activeUsersProxy);
    const works = safeCount(point.works);
    const posts = safeCount(point.posts);
    const completions = safeCount(point.completions);
    const errors = safeCount(point.errors);
    if (newUsers === null || activeUsersProxy === null || works === null || posts === null || completions === null || errors === null) return [];
    return [{
      date: point.date,
      newUsers,
      activeUsersProxy,
      works,
      posts,
      completions,
      errors,
      // 旧 Worker 不带这两个字段：requests 缺省 0、errorRatePct 缺省 null（曲线不画，
      // 而不是把"没有数据"说成"0%"）。
      requests: safeCount(point.requests) ?? 0,
      errorRatePct: safeNumber(point.errorRatePct),
      avgDurationMs: safeNumber(point.avgDurationMs),
    }];
  });
}

/**
 * 解析 `analytics` 段。任何必需块缺失/类型不符 → 返回 null（页面显示「数据暂不可用」），
 * 绝不补造。可选块（errorCodesTop5 等）缺失按空数组处理。
 */
export function parseDashboardAnalytics(value: unknown): DashboardAnalytics | null {
  if (!isRecord(value)) return null;
  const range = value.range === 30 ? 30 : 7;
  const todayStartUtc = typeof value.todayStartUtc === 'string' ? value.todayStartUtc : '';
  const kpis = value.kpis;
  const funnel = value.funnel;
  const quality = value.quality;
  const comparison = value.comparison;
  if (!isRecord(kpis) || !isRecord(funnel) || !isRecord(quality) || !isRecord(comparison)) return null;

  const todayNewCreators = safeCount(kpis.todayNewCreators);
  const todayNewCreatorsPrevSameTime = safeCount(kpis.todayNewCreatorsPrevSameTime);
  const pendingTotal = safeCount(kpis.pendingTotal);
  const publishConversion = parseRate(kpis.publishConversion);
  const pendingBreakdown = isRecord(kpis.pendingBreakdown) ? kpis.pendingBreakdown : null;
  const errorRate24hProxy = isRecord(kpis.errorRate24hProxy) ? kpis.errorRate24hProxy : null;
  const reviews = pendingBreakdown ? safeCount(pendingBreakdown.reviews) : null;
  const reports = pendingBreakdown ? safeCount(pendingBreakdown.reports) : null;
  const errorRate24hErrors = errorRate24hProxy ? safeCount(errorRate24hProxy.errors) : null;
  const errorRate24hRequests = errorRate24hProxy ? safeCount(errorRate24hProxy.requests) : null;
  if (todayNewCreators === null || todayNewCreatorsPrevSameTime === null || pendingTotal === null
    || publishConversion === null || reviews === null || reports === null
    || errorRate24hErrors === null || errorRate24hRequests === null) return null;

  const works = safeCount(funnel.works);
  const completions = safeCount(funnel.completions);
  const posts = safeCount(funnel.posts);
  const stepRate = isRecord(funnel.stepRate) ? funnel.stepRate : null;
  if (works === null || completions === null || posts === null || stepRate === null) return null;

  const current = parseCounters(comparison.current);
  const previous = parseCounters(comparison.previous);
  if (!current || !previous) return null;
  const rawDelta = isRecord(comparison.deltaPct) ? comparison.deltaPct : {};
  const deltaPct = Object.fromEntries(
    (Object.keys(current) as (keyof DashboardCounters)[]).map(key => [key, safeNumber(rawDelta[key])]),
  ) as Record<keyof DashboardCounters, number | null>;

  const qualityRate = safeNumber(quality.errorRateProxy);
  const qualityErrors = safeCount(quality.errors);
  const qualityRequests = safeCount(quality.requests);
  const durationSamples = safeCount(quality.durationSamples);
  if (qualityErrors === null || qualityRequests === null || durationSamples === null) return null;

  return {
    range,
    todayStartUtc,
    kpis: {
      todayNewCreators,
      todayNewCreatorsPrevSameTime,
      todayNewCreatorsDeltaPct: safeNumber(kpis.todayNewCreatorsDeltaPct),
      publishConversion,
      pendingTotal,
      pendingBreakdown: {
        reviews,
        reports,
        reportsReviewing: pendingBreakdown ? safeCount(pendingBreakdown.reportsReviewing) ?? 0 : 0,
      },
      errorRate24hProxy: { errors: errorRate24hErrors, requests: errorRate24hRequests, rate: safeNumber(errorRate24hProxy!.rate) },
    },
    series: parseSeries(value.series),
    comparison: {
      from: typeof comparison.from === 'string' ? comparison.from : '',
      to: typeof comparison.to === 'string' ? comparison.to : '',
      previousFrom: typeof comparison.previousFrom === 'string' ? comparison.previousFrom : '',
      previousTo: typeof comparison.previousTo === 'string' ? comparison.previousTo : '',
      current,
      previous,
      deltaPct,
    },
    funnel: {
      works,
      completions,
      posts,
      stepRate: { toCompletion: safeNumber(stepRate.toCompletion), toPublish: safeNumber(stepRate.toPublish) },
      overallRate: safeNumber(funnel.overallRate),
      // 只有后端明确声明"完成数是事件数"时才按事件口径展示，否则不猜。
      completionsAreEvents: funnel.completionsAreEvents === true,
    },
    quality: {
      errorRateProxy: qualityRate,
      errors: qualityErrors,
      requests: qualityRequests,
      avgDurationMs: safeNumber(quality.avgDurationMs),
      maxDurationMs: safeNumber(quality.maxDurationMs),
      durationSamples,
      errorCodesTop5: Array.isArray(quality.errorCodesTop5)
        ? quality.errorCodesTop5.flatMap((item) => {
          if (!isRecord(item) || typeof item.code !== 'string') return [];
          const count = safeCount(item.count);
          return count === null ? [] : [{ code: item.code, count }];
        })
        : [],
      unresolvedErrors: safeCount(quality.unresolvedErrors) ?? 0,
    },
  };
}

// -------------------------------------------------------------- formatting

const counter = new Intl.NumberFormat('zh-CN');

/** 整数计数：null/未知 → 「—」（不是 0）。 */
export function formatCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? counter.format(Math.round(value)) : '—';
}

/** 比率 → 百分比文案；null（无样本）→ 「—」。 */
export function formatRatePercent(rate: number | null | undefined, digits = 1): string {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return '—';
  const percent = rate * 100;
  // 小于 1% 时多给一位小数：0.046% 不该被显示成 0.0%（看起来像没有错误）。
  const places = Math.abs(percent) > 0 && Math.abs(percent) < 1 ? digits + 1 : digits;
  return percent.toFixed(places) + '%';
}

/** 耗时：null（无样本）→ 「—」；否则整数毫秒 + 单位。 */
export function formatDurationMs(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return counter.format(Math.max(0, Math.round(value))) + ' ms';
}

/**
 * 后端已经算好的**百分比值**（1.2 表示 1.2%）→ 文案。前端不做除法。
 * 最多两位小数并去掉多余的 0：1.20 → 1.2%，0.05 → 0.05%，12.00 → 12%。
 */
export function formatPercentValue(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const text = value.toFixed(digits).replace(/\.?0+$/, '');
  return (text === '' ? '0' : text) + '%';
}

export type DeltaTone = 'up' | 'down' | 'flat' | 'none';

/** 环比方向：只表达方向，颜色交给 CSS（禁止红涨绿跌）。 */
export function deltaTone(value: number | null | undefined): DeltaTone {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'none';
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

/** 环比文案：`▲ +20.0%` / `▼ -3.5%` / `0.0%` / `—`（无基线）。 */
export function formatDeltaPercent(value: number | null | undefined, digits = 1): string {
  const tone = deltaTone(value);
  if (tone === 'none') return '—';
  const magnitude = Math.abs(value as number).toFixed(digits) + '%';
  if (tone === 'flat') return magnitude;
  return (tone === 'up' ? '▲ +' : '▼ -') + magnitude;
}

/** 转化率文案（漏斗/发布转化率共用）：先判无样本，再判口径不可比，最后才是百分比。 */
export function conversionLabel(rate: number | null | undefined, denominator: number): string {
  if (denominator <= 0 || typeof rate !== 'number' || !Number.isFinite(rate)) return '本期无样本';
  if (rate > 1) return '—（口径不可比）';
  return formatRatePercent(rate);
}

/** 发布转化率是否口径不可比（前端只提示，不钳位、不改写比率）。 */
export function conversionIsIncomparable(rate: number | null | undefined): boolean {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 1;
}

// ------------------------------------------------------------- chart rows

export interface DashboardChartRow {
  date: string;
  /** X 轴刻度：MM-DD */
  label: string;
  /** 悬浮提示标题：M月D日 */
  title: string;
  newUsers: number;
  activeUsersProxy: number;
  works: number;
  posts: number;
  completions: number;
  errors: number;
  /** 当日请求数（tooltip 副行用：错误 N 次 / 请求 M 次）。 */
  requests: number;
  /** 当日错误率百分比值（曲线用，后端算好）。 */
  errorRatePct: number | null;
  avgDurationMs: number | null;
}

/** series → 图表行（只做 X 轴文案派生；数值不动、不重排）。 */
export function dashboardChartRows(series: readonly DashboardSeriesPoint[]): DashboardChartRow[] {
  return series.map(point => ({
    date: point.date,
    label: point.date.length >= 10 ? point.date.slice(5) : point.date,
    title: trendTooltipDate(point.date),
    newUsers: point.newUsers,
    activeUsersProxy: point.activeUsersProxy,
    works: point.works,
    posts: point.posts,
    completions: point.completions,
    errors: point.errors,
    requests: point.requests,
    errorRatePct: point.errorRatePct,
    avgDurationMs: point.avgDurationMs,
  }));
}

/** 主趋势图三条序列是否全 0（全 0 时后端已补 0，前端只给一行灰字说明）。 */
export function trendIsEmpty(rows: readonly DashboardChartRow[]): boolean {
  return rows.length === 0 || rows.every(row => row.newUsers === 0 && row.activeUsersProxy === 0 && row.works === 0);
}

/** 质量图是否无任何样本（错误与耗时都没有）。 */
export function qualityIsEmpty(rows: readonly DashboardChartRow[]): boolean {
  return rows.length === 0 || rows.every(row => row.errors === 0 && row.avgDurationMs === null);
}

/**
 * 坐标轴整数刻度（3–4 档）：给定最大值生成从 0 到 niceMax 的等距整数刻度。
 * 人数不出现 0.5 —— 小数步长一律向上取整到 1。
 */
export function axisTicks(max: number, count = 4): number[] {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const step = Math.max(1, Math.ceil(safeMax / Math.max(1, count - 1)));
  const top = step * Math.max(1, count - 1);
  return Array.from({ length: count }, (_value, index) => index * step).map(value => Math.min(value, top));
}

// ------------------------------------------------------------- funnel losses

export interface FunnelLoss {
  key: 'toCompletion' | 'toPublish';
  /** 形如「创建 → 完成」。 */
  label: string;
  /** 流失数量（上一步 − 下一步）。 */
  lost: number;
  /** 流失占上一步的百分比；上一步为 0 → null。 */
  sharePct: number | null;
  /** 流失为负：完成事件含修订时第二步可能大于第一步，口径不可比。 */
  incomparable: boolean;
}

const roundOne = (value: number): number => Math.round(value * 10) / 10;

/** 漏斗两步流失（纯函数，供卡片逐行展示与结论选择）。 */
export function funnelLosses(funnel: DashboardFunnel | null): FunnelLoss[] {
  if (!funnel) return [];
  const build = (
    key: FunnelLoss['key'],
    label: string,
    previous: number,
    next: number,
  ): FunnelLoss => {
    const lost = previous - next;
    return {
      key,
      label,
      lost,
      sharePct: previous > 0 ? roundOne((lost / previous) * 100) : null,
      incomparable: lost < 0,
    };
  };
  return [
    build('toCompletion', '创建 → 完成', funnel.works, funnel.completions),
    build('toPublish', '完成 → 发布', funnel.completions, funnel.posts),
  ];
}

/**
 * 一句话结论：按「流失占比」挑最大的一段，给出可执行建议。
 * 口径不可比 / 无样本时如实说明，不硬编一个建议。
 */
export function funnelConclusion(funnel: DashboardFunnel | null): string {
  if (!funnel || funnel.works <= 0) return '本期无样本：窗口内没有图纸创建，无法判断流失环节。';
  const losses = funnelLosses(funnel);
  const comparable = losses.filter(loss => !loss.incomparable && loss.lost > 0);
  if (comparable.length === 0) {
    if (losses.every(loss => loss.incomparable)) {
      return '完成事件含修订，第二步可能大于第一步（口径不可比），请结合原始图纸数判读。';
    }
    return '各环节没有流失：创建 → 完成 → 发布链路完整。';
  }
  const worst = comparable.reduce((best, loss) =>
    ((loss.sharePct ?? 0) > (best.sharePct ?? 0) || ((loss.sharePct ?? 0) === (best.sharePct ?? 0) && loss.lost > best.lost) ? loss : best));
  const share = worst.sharePct === null ? '' : '，占上一步 ' + worst.sharePct + '%';
  return worst.key === 'toCompletion'
    ? `主要流失在「创建 → 完成」：流失 ${worst.lost} 个${share}。建议加强完成引导（断点续画提示、降低单图复杂度）。`
    : `主要流失在「完成 → 发布」：流失 ${worst.lost} 个${share}。建议放宽发布门槛或简化发布流程（这一步决定社区供给）。`;
}

const tooltipNumber = new Intl.NumberFormat('zh-CN');

/**
 * 趋势悬浮提示的日期文案：服务端 "2025-11-11" 口径 → "11月11日"（有语义）。
 * 7 天趋势窗口内不会跨年，年份省略；月日超出真实日历区间（或格式非法）时
 * 原样返回，不猜——"2025-13-45"、"2025-02-30" 都不是合法日期。
 */
export function trendTooltipDate(date: string): string {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date.trim());
  if (!match) return date;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return date;
  // 走一遍真实日历回读：JS Date 会把 2月30日 归一化成 3月2日，
  // 回读月份/日期不一致即说明该月日在真实日历中不存在。
  const parsed = new Date(Date.UTC(Number(match[1]), month - 1, day));
  if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return date;
  return String(month) + '月' + String(day) + '日';
}

/** 趋势悬浮提示的数值文案：类型词 + 千分位数量 → "新建 1 个"。 */
export function trendTooltipValue(action: string, count: number): string {
  return action + ' ' + tooltipNumber.format(Math.max(0, count)) + ' 个';
}
