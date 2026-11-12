import { describe, expect, it } from 'vitest';
import {
  parseDashboardMetrics, parseDashboardTodo, todoDrillQuery, todayRegistrations, trendBarHeights,
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

describe('register trend mini bars', () => {
  it('scales the peak to 100% and keeps zero days visible at 8%', () => {
    const points = [
      { date: 'd1', count: 0 }, { date: 'd2', count: 10 }, { date: 'd3', count: 5 }, { date: 'd4', count: 0 },
    ];
    expect(trendBarHeights(points)).toEqual([8, 100, 50, 8]);
  });
  it('an all-zero trend still renders a flat baseline', () => {
    expect(trendBarHeights([{ date: 'a', count: 0 }, { date: 'b', count: 0 }])).toEqual([8, 8]);
    expect(trendBarHeights([])).toEqual([]);
  });
});

describe('todo drill-down query', () => {
  it('maps each card to a preset parameter', () => {
    expect(todoDrillQuery('reviews')).toEqual({ preset: 'review-queue' });
    expect(todoDrillQuery('reports')).toEqual({ preset: 'reports' });
    expect(todoDrillQuery('codes')).toEqual({ preset: 'low-stock' });
  });
});
