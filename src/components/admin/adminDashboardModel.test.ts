import { describe, expect, it } from 'vitest';
import {
  parseDashboardMetrics, parseDashboardTodo, todoDrillQuery, todayRegistrations,
  trendTooltipDate, trendTooltipValue,
} from './adminDashboardModel';

describe('dashboard todo parsing (batch 3)', () => {
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

describe('dashboard metrics parsing (batch 3)', () => {
  const trend = [
    { date: '2026-07-06', count: 0 },
    { date: '2026-07-07', count: 5 },
    { date: '2026-07-08', count: 2 },
    { date: '2026-07-09', count: 0 },
    { date: '2026-07-10', count: 0 },
    { date: '2026-07-11', count: 0 },
    { date: '2026-07-12', count: 1 },
  ];
  it('accepts today counters plus a 7-day zero-filled trend', () => {
    const metrics = parseDashboardMetrics({ todayNewWorks: 0, todayNewPosts: 4, todayNewReports: 0, registerTrend7d: trend });
    // 0 是合法值：不会因为"今天没有发生"而变成 null。
    expect(metrics?.todayNewWorks).toBe(0);
    expect(metrics?.todayNewPosts).toBe(4);
    expect(metrics?.registerTrend7d).toHaveLength(7);
    expect(todayRegistrations(metrics)).toBe(1);
  });
  it('drops malformed trend samples instead of inventing them', () => {
    const metrics = parseDashboardMetrics({
      todayNewWorks: 1, todayNewPosts: 0, todayNewReports: 0,
      registerTrend7d: [ ...trend, { date: 'bad', count: 'x' }, null, { count: 9 } ],
    });
    expect(metrics?.registerTrend7d).toHaveLength(7);
  });
  it('returns null when any today counter is missing', () => {
    expect(parseDashboardMetrics({ todayNewWorks: 1, todayNewPosts: 2 })).toBeNull();
    expect(parseDashboardMetrics('nope')).toBeNull();
  });
  it('todayRegistrations is null for an absent trend, never a made-up zero', () => {
    expect(todayRegistrations(null)).toBeNull();
    expect(todayRegistrations(parseDashboardMetrics({ todayNewWorks: 0, todayNewPosts: 0, todayNewReports: 0, registerTrend7d: [] }))).toBeNull();
  });
});

describe('todo drill-down query', () => {
  it('maps each card to a preset parameter', () => {
    expect(todoDrillQuery('reviews')).toEqual({ preset: 'review-queue' });
    expect(todoDrillQuery('reports')).toEqual({ preset: 'reports' });
    expect(todoDrillQuery('codes')).toEqual({ preset: 'low-stock' });
  });
});

describe('trend tooltip copy (semantic hover, user feedback)', () => {
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
