import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DashboardAnalytics } from '../adminDashboardModel';
import { parseDashboardAnalytics } from '../adminDashboardModel';
import { DashboardKpiCards } from './DashboardKpiCards';
import { DashboardFunnel } from './DashboardFunnel';
import { DashboardQuality } from './DashboardQuality';
import { DashboardTodoBar } from './DashboardTodoBar';
import { DashboardTrendSection } from './DashboardTrendSection';

/**
 * A/C/D 区块渲染断言（不引 recharts：图表走 Suspense 懒加载，服务端渲染只出骨架/空态）。
 * 覆盖 PRD 验收：无数据「—」、本期无样本、口径不可比、待举报只认 open、代理口径文案。
 */

const emptySeriesPoint = { date: '2025-11-11', newUsers: 0, activeUsersProxy: 0, works: 0, posts: 0, completions: 0, errors: 0, avgDurationMs: null };

function analytics(overrides: Record<string, unknown> = {}): DashboardAnalytics {
  const raw = {
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
    series: [emptySeriesPoint],
    comparison: {
      from: '2025-11-05', to: '2025-11-11', previousFrom: '2025-10-29', previousTo: '2025-11-05',
      current: { newUsers: 55, activeUsersProxy: 180, works: 412, completions: 268, posts: 140, errors: 21, requests: 4200 },
      previous: { newUsers: 49, activeUsersProxy: 165, works: 366, completions: 240, posts: 145, errors: 15, requests: 3900 },
      deltaPct: { newUsers: 12.24, activeUsersProxy: 9.09, works: 12.57, completions: 11.67, posts: -3.45, errors: 40, requests: 7.69 },
    },
    funnel: {
      works: 412, completions: 268, posts: 140,
      stepRate: { toCompletion: 268 / 412, toPublish: 140 / 268 },
      overallRate: 140 / 412, completionsAreEvents: true,
    },
    quality: {
      errorRateProxy: 8 / 648, errors: 8, requests: 640, avgDurationMs: 142, maxDurationMs: 980, durationSamples: 640,
      errorCodesTop5: [{ code: 'HTTP_500', count: 5 }, { code: 'OTHER', count: 3 }], unresolvedErrors: 3,
    },
    ...overrides,
  };
  const parsed = parseDashboardAnalytics(raw);
  if (!parsed) throw new Error('fixture must parse');
  return parsed;
}

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);

describe('KPI cards (A 区)', () => {
  it('renders the four decision numbers with their sub-lines', () => {
    const html = render(React.createElement(DashboardKpiCards, { analytics: analytics(), range: 7 }));
    expect(html).toContain('今日新增创作者');
    expect(html).toContain('7 天发布转化率');
    expect(html).toContain('待处理');
    expect(html).toContain('24 小时错误率');
    expect(html).toContain('>12<');
    expect(html).toContain('昨日同刻 10');
    expect(html).toContain('▲ +20.0%');
    expect(html).toContain('34.0%');
    expect(html).toContain('图纸 412 → 发布 140');
    expect(html).toContain('审核 3 / 举报 2（复核 1）');
    expect(html).toContain('错误 8 / 请求 640');
    expect(html).toContain('1.2%');
    expect(html).toContain('代理口径');
  });
  it('renders em dashes (never zeros) when analytics is missing', () => {
    const html = render(React.createElement(DashboardKpiCards, { analytics: null, range: 30 }));
    expect(html).toContain('30 天发布转化率');
    expect(html).not.toContain('0.0%');
    // 四张卡的数值位置全部是「—」。
    expect((html.match(/data-kpi-value="[a-z-]+">—</g) ?? []).length).toBe(4);
  });
  it('marks an incomparable conversion without clamping it to 100%', () => {
    const incomparable = analytics({
      kpis: {
        todayNewCreators: 1, todayNewCreatorsPrevSameTime: 0, todayNewCreatorsDeltaPct: null,
        publishConversion: { numerator: 5, denominator: 2, rate: 2.5 },
        pendingTotal: 0, pendingBreakdown: { reviews: 0, reports: 0, reportsReviewing: 0 },
        errorRate24hProxy: { errors: 0, requests: 0, rate: null },
      },
    });
    const html = render(React.createElement(DashboardKpiCards, { analytics: incomparable, range: 7 }));
    expect(html).toContain('—（口径不可比）');
    expect(html).not.toContain('100.0%');
    // 昨日同刻 0 → 环比无基线，显示「—」而不是 +∞。
    expect(html).toContain('>—<');
  });
});

describe('funnel (C 区)', () => {
  it('labels the second step as an event count and shows per-step + overall conversion', () => {
    const html = render(React.createElement(DashboardFunnel, { funnel: analytics().funnel }));
    expect(html).toContain('完成事件（含修订）');
    expect(html).toContain('65.0%'); // 268/412
    expect(html).toContain('52.2%'); // 140/268
    expect(html).toContain('34.0%'); // 140/412
    expect(html).toContain('data-funnel-step-rate="completions"');
    expect(html).toContain('data-funnel-overall');
  });
  it('shows 本期无样本 for an empty window instead of NaN/Infinity', () => {
    const html = render(React.createElement(DashboardFunnel, {
      funnel: { works: 0, completions: 0, posts: 0, stepRate: { toCompletion: null, toPublish: null }, overallRate: null, completionsAreEvents: true },
    }));
    // 两步转化率 + 总转化率 + 结论行，全部如实说「本期无样本」，不出现 NaN/Infinity。
    expect(html.match(/本期无样本/g)?.length).toBe(4);
    expect(html).toContain('data-funnel-conclusion');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });
  it('returns rates above 100% as 口径不可比 without clamping', () => {
    const html = render(React.createElement(DashboardFunnel, {
      funnel: { works: 1, completions: 3, posts: 2, stepRate: { toCompletion: 3, toPublish: 2 / 3 }, overallRate: 2, completionsAreEvents: true },
    }));
    expect(html).toContain('—（口径不可比）');
    expect(html).not.toContain('300.0%');
    expect(html).not.toContain('200.0%');
  });
  it('renders em dashes when the funnel block is absent', () => {
    const html = render(React.createElement(DashboardFunnel, { funnel: null }));
    expect(html).toContain('本期无样本');
    expect(html).toContain('data-funnel-value="works">—<');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });
});

describe('quality (C 区)', () => {
  it('renders the four facts, sample line and error-code top5', () => {
    const html = render(React.createElement(DashboardQuality, { analytics: analytics(), range: 7 }));
    expect(html).toContain('代理口径：真实错误率 ≥ 展示值');
    expect(html).toContain('1.2%');
    expect(html).toContain('142 ms');
    expect(html).toContain('980 ms');
    expect(html).toContain('错误码 Top5');
    expect(html).toContain('HTTP_500');
    expect(html).toContain('耗时样本 640 次');
  });
  it('collapses an all-quiet window to one line and no chart', () => {
    const quiet = analytics({
      series: [emptySeriesPoint],
      quality: { errorRateProxy: null, errors: 0, requests: 0, avgDurationMs: null, maxDurationMs: null, durationSamples: 0, errorCodesTop5: [], unresolvedErrors: 0 },
    });
    const html = render(React.createElement(DashboardQuality, { analytics: quiet, range: 30 }));
    expect(html).toContain('近 30 天无错误与耗时记录');
    expect(html).toContain('近 30 天无错误码记录');
    expect(html).not.toContain('NaN');
  });
});

describe('todo bar (D 区)', () => {
  it('keeps reports (open) separate from reviewing and shows the stock threshold', () => {
    const html = render(React.createElement(DashboardTodoBar, {
      todo: { pendingReviews: 3, pendingReports: 2, lowStockCodes: true, availableCodes: 42, lowStockThreshold: 50 },
      analytics: analytics(),
      onDrill: () => undefined,
    }));
    expect(html).toContain('待审核帖子');
    expect(html).toContain('待处理举报');
    expect(html).toContain('兑换码可用库存');
    expect(html).toContain('data-todo-value="reviews">3<');
    expect(html).toContain('data-todo-value="reports">2<');
    expect(html).toContain('复核中 1 条（不计入）');
    expect(html).toContain('低库存阈值 50');
    // 低库存 → danger 态（视觉告警），但仍不把 reviewing 并入待举报。
    expect(html).toContain('data-tone="danger"');
  });
  it('renders em dashes when todo is absent instead of zeros', () => {
    const html = render(React.createElement(DashboardTodoBar, { todo: null, analytics: null, onDrill: () => undefined }));
    expect((html.match(/data-todo-value="[a-z]+">—</g) ?? []).length).toBe(3);
  });
});

describe('trend section (B 区)', () => {
  it('collapses an all-zero window to one gray line and never mounts the chart', () => {
    const html = render(React.createElement(DashboardTrendSection, { analytics: analytics(), range: 7, loading: false }));
    expect(html).toContain('近 7 天无新增');
    expect(html).toContain('UTC 0 点切分');
    expect(html).not.toContain('data-dashboard-chart="trend"');
  });
  it('renders the chart slot once there is data', () => {
    const withData = analytics({
      series: [{ date: '2025-11-11', newUsers: 5, activeUsersProxy: 4, works: 3, posts: 2, completions: 2, errors: 1, avgDurationMs: 142 }],
    });
    const html = render(React.createElement(DashboardTrendSection, { analytics: withData, range: 7, loading: false }));
    expect(html).toContain('data-dashboard-chart="trend"');
    expect(html).toContain('data-dashboard-chart-skeleton');
    expect(html).not.toContain('近 7 天无新增');
  });
});
