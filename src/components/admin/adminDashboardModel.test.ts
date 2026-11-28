import { describe, expect, it } from 'vitest';
import {
  axisTicks, conversionIsIncomparable, conversionLabel, dashboardChartRows, deltaTone, formatCount,
  formatDeltaPercent, formatDurationMs, formatRatePercent, parseDashboardAnalytics, parseDashboardRange,
  formatPercentValue, funnelConclusion, funnelLosses, parseDashboardTodo, qualityIsEmpty, todoDrillQuery,
  trendIsEmpty, trendTooltipDate, trendTooltipValue, type DashboardSeriesPoint,
} from './adminDashboardModel';

/** 一份结构完整的最小 analytics（造数基准；各用例只改自己要断言的字段）。 */
function analyticsFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    range: 7,
    todayStartUtc: '2025-11-11T00:00:00.000Z',
    kpis: {
      todayNewCreators: 12,
      todayNewCreatorsPrevSameTime: 10,
      todayNewCreatorsDeltaPct: 20,
      publishConversion: { numerator: 140, denominator: 412, rate: 140 / 412 },
      pendingTotal: 5,
      pendingBreakdown: { reviews: 3, reports: 2, reportsReviewing: 1 },
      errorRate24hProxy: { errors: 8, requests: 640, rate: 8 / 648 },
    },
    series: [
      { date: '2025-11-10', newUsers: 0, activeUsersProxy: 3, works: 2, posts: 1, completions: 1, errors: 0, avgDurationMs: null },
      { date: '2025-11-11', newUsers: 5, activeUsersProxy: 4, works: 3, posts: 2, completions: 2, errors: 1, avgDurationMs: 142 },
    ],
    comparison: {
      from: '2025-11-05', to: '2025-11-11', previousFrom: '2025-10-29', previousTo: '2025-11-05',
      current: { newUsers: 55, activeUsersProxy: 180, works: 412, completions: 268, posts: 140, errors: 21, requests: 4200 },
      previous: { newUsers: 49, activeUsersProxy: 165, works: 366, completions: 240, posts: 145, errors: 15, requests: 3900 },
      deltaPct: { works: 12.57, posts: -3.45, errors: 40, newUsers: 12.24, activeUsersProxy: 9.09, completions: 11.67, requests: 7.69 },
    },
    funnel: {
      works: 412, completions: 268, posts: 140,
      stepRate: { toCompletion: 268 / 412, toPublish: 140 / 268 },
      overallRate: 140 / 412, completionsAreEvents: true,
    },
    quality: {
      errorRateProxy: 8 / 648, errors: 8, requests: 640, avgDurationMs: 142, maxDurationMs: 980, durationSamples: 640,
      errorCodesTop5: [{ code: 'HTTP_500', count: 5 }], unresolvedErrors: 3,
    },
    ...overrides,
  };
}

describe('dashboard range parsing', () => {
  it('accepts 7/30 and falls back to 7 for anything else', () => {
    expect(parseDashboardRange('30')).toBe(30);
    expect(parseDashboardRange('7')).toBe(7);
    // 非法值不抛错、不猜：回落默认 7（与后端一致）。
    for (const raw of [null, undefined, '', 'abc', '030', '0', '365', 'thirty', '30.0']) {
      expect(parseDashboardRange(raw)).toBe(7);
    }
    // 前后空格按 trim 处理（与 Worker 侧 parseDashboardRange 完全一致）。
    expect(parseDashboardRange(' 30 ')).toBe(30);
  });
});

describe('dashboard todo parsing', () => {
  it('accepts a complete todo section with optional stock details', () => {
    const todo = parseDashboardTodo({ pendingReviews: 3, pendingReports: 0, lowStockCodes: true, availableCodes: 4, lowStockThreshold: 50 });
    expect(todo).toEqual({ pendingReviews: 3, pendingReports: 0, lowStockCodes: true, availableCodes: 4, lowStockThreshold: 50 });
  });
  it('returns null instead of fabricating zeros when fields are missing or wrong-typed', () => {
    expect(parseDashboardTodo(null)).toBeNull();
    expect(parseDashboardTodo({ pendingReviews: -1, pendingReports: 0, lowStockCodes: true })).toBeNull();
    expect(parseDashboardTodo({ pendingReviews: 1, pendingReports: 2, lowStockCodes: 'yes' })).toBeNull();
    expect(parseDashboardTodo([1, 2, 3])).toBeNull();
  });
});

describe('analytics parsing (batch 6)', () => {
  it('reads every documented block and keeps 0 as a real value', () => {
    const parsed = parseDashboardAnalytics(analyticsFixture());
    expect(parsed).not.toBeNull();
    expect(parsed!.range).toBe(7);
    expect(parsed!.kpis.todayNewCreators).toBe(12);
    expect(parsed!.kpis.pendingBreakdown.reportsReviewing).toBe(1);
    expect(parsed!.series).toHaveLength(2);
    expect(parsed!.series[0]!.newUsers).toBe(0); // 0 不是 null
    expect(parsed!.series[0]!.avgDurationMs).toBeNull(); // 无耗时样本
    expect(parsed!.funnel.completionsAreEvents).toBe(true);
    expect(parsed!.comparison.current.requests).toBe(4200);
    expect(parsed!.quality.errorCodesTop5).toEqual([{ code: 'HTTP_500', count: 5 }]);
  });
  it('returns null when a required block is missing (old Worker) instead of inventing data', () => {
    expect(parseDashboardAnalytics(null)).toBeNull();
    expect(parseDashboardAnalytics({})).toBeNull();
    expect(parseDashboardAnalytics({ ...analyticsFixture(), kpis: undefined })).toBeNull();
    expect(parseDashboardAnalytics({ ...analyticsFixture(), funnel: { works: 1 } })).toBeNull();
    const missingComparison = analyticsFixture();
    delete (missingComparison.comparison as Record<string, unknown>).current;
    expect(parseDashboardAnalytics(missingComparison)).toBeNull();
  });
  it('never returns NaN/Infinity for ratios the backend sent as null', () => {
    const parsed = parseDashboardAnalytics(analyticsFixture({
      funnel: { works: 0, completions: 0, posts: 0, stepRate: { toCompletion: null, toPublish: null }, overallRate: null, completionsAreEvents: true },
      quality: { errorRateProxy: null, errors: 0, requests: 0, avgDurationMs: null, maxDurationMs: null, durationSamples: 0, errorCodesTop5: [], unresolvedErrors: 0 },
    }));
    expect(parsed!.funnel.overallRate).toBeNull();
    expect(parsed!.quality.errorRateProxy).toBeNull();
    expect(Number.isNaN(parsed!.funnel.overallRate as unknown as number)).toBe(false);
    expect(conversionLabel(parsed!.funnel.overallRate, 0)).toBe('本期无样本');
  });
  it('drops malformed series points instead of zero-filling them', () => {
    const parsed = parseDashboardAnalytics(analyticsFixture({
      series: [
        { date: '2025-11-10', newUsers: 1, activeUsersProxy: 1, works: 1, posts: 0, completions: 0, errors: 0, avgDurationMs: null },
        { date: 'bad', newUsers: 'x' },
        null,
        { newUsers: 3 },
      ],
    }));
    expect(parsed!.series).toHaveLength(1);
  });
  it('treats a missing errorCodesTop5 as empty rather than throwing', () => {
    const fixture = analyticsFixture();
    delete (fixture.quality as Record<string, unknown>).errorCodesTop5;
    expect(parseDashboardAnalytics(fixture)!.quality.errorCodesTop5).toEqual([]);
  });
});

describe('ratio / delta formatting (null never becomes 0)', () => {
  it('formats null ratios as an em dash and real ratios as percentages', () => {
    expect(formatRatePercent(null)).toBe('—');
    expect(formatRatePercent(undefined)).toBe('—');
    expect(formatRatePercent(0)).toBe('0.0%');
    expect(formatRatePercent(0.3398)).toBe('34.0%');
    expect(formatRatePercent(1)).toBe('100.0%');
    expect(formatRatePercent(2, 0)).toBe('200%');
    // 小于 1% 的比率多给一位小数：0.046% 不能显示成 0.0%（那看起来像"没有错误"）。
    expect(formatRatePercent(0.00046)).toBe('0.05%');
    expect(formatRatePercent(0.0046)).toBe('0.46%');
    expect(formatRatePercent(0.0123)).toBe('1.2%');
  });
  it('formats counts and durations, mapping null to an em dash', () => {
    expect(formatCount(null)).toBe('—');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1234)).toBe('1,234');
    expect(formatDurationMs(null)).toBe('—');
    expect(formatDurationMs(142)).toBe('142 ms');
    expect(formatDurationMs(142.6)).toBe('143 ms');
    expect(formatDurationMs(-5)).toBe('0 ms');
  });
  it('expresses direction with arrows and sign, never with color semantics', () => {
    expect(deltaTone(20)).toBe('up');
    expect(deltaTone(-3.45)).toBe('down');
    expect(deltaTone(0)).toBe('flat');
    expect(deltaTone(null)).toBe('none');
    expect(formatDeltaPercent(20)).toBe('▲ +20.0%');
    expect(formatDeltaPercent(-3.45)).toBe('▼ -3.5%');
    expect(formatDeltaPercent(0)).toBe('0.0%');
    expect(formatDeltaPercent(null)).toBe('—');
    expect(formatDeltaPercent(undefined)).toBe('—');
  });
  it('labels conversions: no sample -> 本期无样本, rate>1 -> 口径不可比, else percent', () => {
    expect(conversionLabel(null, 0)).toBe('本期无样本');
    expect(conversionLabel(0.4, 0)).toBe('本期无样本');
    expect(conversionLabel(0.3398, 412)).toBe('34.0%');
    expect(conversionLabel(1, 10)).toBe('100.0%');
    // 完成事件含修订，可能 >1：不钳位，明示口径不可比。
    expect(conversionLabel(2, 1)).toBe('—（口径不可比）');
    expect(conversionIsIncomparable(2)).toBe(true);
    expect(conversionIsIncomparable(1)).toBe(false);
    expect(conversionIsIncomparable(null)).toBe(false);
  });
});

describe('chart rows and axis ticks', () => {
  const series: DashboardSeriesPoint[] = [
    { date: '2025-11-10', newUsers: 0, activeUsersProxy: 3, works: 2, posts: 1, completions: 1, errors: 0, requests: 40, errorRatePct: 0, avgDurationMs: null },
    { date: '2025-11-11', newUsers: 5, activeUsersProxy: 4, works: 3, posts: 2, completions: 2, errors: 1, requests: 40, errorRatePct: 2.44, avgDurationMs: 142 },
  ];
  it('derives MM-DD axis labels and readable tooltip titles without touching values', () => {
    const rows = dashboardChartRows(series);
    expect(rows.map(row => row.label)).toEqual(['11-10', '11-11']);
    expect(rows.map(row => row.title)).toEqual(['11月10日', '11月11日']);
    expect(rows[1]!.newUsers).toBe(5);
    expect(rows[0]!.avgDurationMs).toBeNull();
    // 每日请求数/错误率原样透传（后端算好，前端不参与除法）。
    expect(rows[1]!.requests).toBe(40);
    expect(rows[1]!.errorRatePct).toBe(2.44);
  });
  it('reports empty trends only when the three main series are all zero', () => {
    expect(trendIsEmpty([])).toBe(true);
    expect(trendIsEmpty(dashboardChartRows(series))).toBe(false);
    expect(trendIsEmpty(dashboardChartRows(series.map(point => ({ ...point, newUsers: 0, activeUsersProxy: 0, works: 0 }))))).toBe(true);
  });
  it('reports empty quality only when there are neither errors nor duration samples', () => {
    expect(qualityIsEmpty([])).toBe(true);
    expect(qualityIsEmpty(dashboardChartRows(series))).toBe(false);
    expect(qualityIsEmpty(dashboardChartRows(series.map(point => ({ ...point, errors: 0, avgDurationMs: null }))))).toBe(true);
  });
  it('produces 3-4 integer ticks from 0 without fractional headcounts', () => {
    expect(axisTicks(0, 4)).toEqual([0, 1, 2, 3]);
    expect(axisTicks(9, 4)).toEqual([0, 3, 6, 9]);
    expect(axisTicks(10, 4)).toEqual([0, 4, 8, 12]);
    expect(axisTicks(1, 3)).toEqual([0, 1, 2]);
    for (const tick of axisTicks(7, 4)) expect(Number.isInteger(tick)).toBe(true);
    // 顶部刻度必须 ≥ 真实最大值，否则柱子会溢出绘图区。
    expect(axisTicks(10, 4).at(-1)!).toBeGreaterThanOrEqual(10);
  });
});

describe('todo drill-down query', () => {
  it('maps each card to a preset parameter', () => {
    expect(todoDrillQuery('reviews')).toEqual({ preset: 'review-queue' });
    expect(todoDrillQuery('reports')).toEqual({ preset: 'reports' });
    expect(todoDrillQuery('codes')).toEqual({ preset: 'low-stock' });
  });
});

describe('trend tooltip copy', () => {
  it('renders ISO dates as a readable M月D日 label', () => {
    expect(trendTooltipDate('2025-11-11')).toBe('11月11日');
    expect(trendTooltipDate('2025-07-06')).toBe('7月6日');
    expect(trendTooltipDate(' 2025-11-01 ')).toBe('11月1日');
  });
  it('returns non-standard dates verbatim instead of guessing', () => {
    expect(trendTooltipDate('bad')).toBe('bad');
    expect(trendTooltipDate('')).toBe('');
    expect(trendTooltipDate('2025/11/11')).toBe('2025/11/11');
    // 格式合法但月日越界同样原样返回：不把 13月45日、2月30日 说成日期。
    expect(trendTooltipDate('2025-13-45')).toBe('2025-13-45');
    expect(trendTooltipDate('2025-02-30')).toBe('2025-02-30');
    expect(trendTooltipDate('2025-00-10')).toBe('2025-00-10');
    expect(trendTooltipDate('2025-11-00')).toBe('2025-11-00');
  });
  it('pairs the chart action word with a thousands-formatted count', () => {
    expect(trendTooltipValue('新建', 1)).toBe('新建 1 个');
    expect(trendTooltipValue('发布', 12)).toBe('发布 12 个');
    expect(trendTooltipValue('错误', 1234)).toBe('错误 1,234 个');
    expect(trendTooltipValue('操作', -3)).toBe('操作 0 个');
  });
});

describe('daily request / error-rate series (backend computes the ratio)', () => {
  it('passes requests and errorRatePct through without any frontend division', () => {
    const parsed = parseDashboardAnalytics({
      ...analyticsFixture(),
      series: [
        { date: '2025-11-11', newUsers: 1, activeUsersProxy: 1, works: 1, posts: 0, completions: 0, errors: 2, requests: 40, errorRatePct: 4.76, avgDurationMs: null },
        { date: '2025-11-10', newUsers: 0, activeUsersProxy: 0, works: 0, posts: 0, completions: 0, errors: 0, requests: 0, errorRatePct: null, avgDurationMs: null },
      ],
    });
    expect(parsed!.series[0]!.requests).toBe(40);
    // 4.76 就是后端给的百分比值，前端不改写、不重算（2/(40+2)=4.76%）。
    expect(parsed!.series[0]!.errorRatePct).toBe(4.76);
    // 无样本 → null，不是 0%。
    expect(parsed!.series[1]!.requests).toBe(0);
    expect(parsed!.series[1]!.errorRatePct).toBeNull();
  });
  it('tolerates an older Worker that does not send the new series fields', () => {
    const parsed = parseDashboardAnalytics({
      ...analyticsFixture(),
      series: [{ date: '2025-11-11', newUsers: 1, activeUsersProxy: 1, works: 1, posts: 0, completions: 0, errors: 0, avgDurationMs: null }],
    });
    expect(parsed!.series).toHaveLength(1);
    expect(parsed!.series[0]!.requests).toBe(0);
    expect(parsed!.series[0]!.errorRatePct).toBeNull();
  });
  it('formats percent values as-is (no ×100 again)', () => {
    expect(formatPercentValue(1.2)).toBe('1.2%');
    expect(formatPercentValue(4.76)).toBe('4.76%');
    expect(formatPercentValue(0.05)).toBe('0.05%');
    expect(formatPercentValue(12)).toBe('12%');
    expect(formatPercentValue(0)).toBe('0%');
    expect(formatPercentValue(null)).toBe('—');
    expect(formatPercentValue(undefined)).toBe('—');
  });
});

describe('funnel losses and conclusion (fills the card with information)', () => {
  const funnel = {
    works: 412, completions: 268, posts: 140,
    stepRate: { toCompletion: 268 / 412, toPublish: 140 / 268 },
    overallRate: 140 / 412, completionsAreEvents: true,
  };
  it('computes both transition losses with their share of the previous step', () => {
    const losses = funnelLosses(funnel);
    expect(losses.map(loss => loss.key)).toEqual(['toCompletion', 'toPublish']);
    expect(losses[0]!.label).toBe('创建 → 完成');
    expect(losses[0]!.lost).toBe(144); // 412 - 268
    expect(losses[0]!.sharePct).toBe(35); // 144/412 = 34.95% → 35.0
    expect(losses[1]!.label).toBe('完成 → 发布');
    expect(losses[1]!.lost).toBe(128); // 268 - 140
    expect(losses[1]!.sharePct).toBe(47.8); // 128/268
    expect(losses.every(loss => !loss.incomparable)).toBe(true);
  });
  it('picks the largest-loss transition and gives an actionable suggestion', () => {
    // 完成 → 发布 占比更大（47.8% > 35%）。
    const text = funnelConclusion(funnel);
    expect(text).toContain('主要流失在「完成 → 发布」');
    expect(text).toContain('流失 128 个');
    expect(text).toContain('占上一步 47.8%');
  });
  it('points at the completion step when that is where the loss is', () => {
    const text = funnelConclusion({
      works: 100, completions: 20, posts: 18,
      stepRate: { toCompletion: 0.2, toPublish: 0.9 }, overallRate: 0.18, completionsAreEvents: true,
    });
    expect(text).toContain('主要流失在「创建 → 完成」');
    expect(text).toContain('建议加强完成引导');
  });
  it('says so when there is no sample, no loss, or the funnel is incomparable', () => {
    expect(funnelConclusion(null)).toContain('本期无样本');
    expect(funnelConclusion({ works: 0, completions: 0, posts: 0, stepRate: { toCompletion: null, toPublish: null }, overallRate: null, completionsAreEvents: true })).toContain('本期无样本');
    expect(funnelConclusion({ works: 10, completions: 10, posts: 10, stepRate: { toCompletion: 1, toPublish: 1 }, overallRate: 1, completionsAreEvents: true })).toContain('没有流失');
    // 完成事件含修订 → 两步都是负流失（第二步>第一步、发布>完成）时如实标注口径不可比。
    const incomparable = funnelConclusion({ works: 1, completions: 5, posts: 6, stepRate: { toCompletion: 5, toPublish: 1.2 }, overallRate: 6, completionsAreEvents: true });
    expect(incomparable).toContain('口径不可比');
    // 有一段可比（完成→发布 有真实流失）时，仍然指出那一段，不因另一段不可比就放弃结论。
    const mixed = funnelConclusion({ works: 1, completions: 3, posts: 2, stepRate: { toCompletion: 3, toPublish: 2 / 3 }, overallRate: 2, completionsAreEvents: true });
    expect(mixed).toContain('主要流失在「完成 → 发布」');
    expect(mixed).toContain('流失 1 个');
    expect(funnelLosses({ works: 1, completions: 3, posts: 2, stepRate: { toCompletion: 3, toPublish: 2 / 3 }, overallRate: 2, completionsAreEvents: true })[0]!.incomparable).toBe(true);
  });
});
