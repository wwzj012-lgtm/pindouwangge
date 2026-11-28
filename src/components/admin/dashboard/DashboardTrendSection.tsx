/**
 * B 区：主趋势图（懒加载 recharts chunk）。
 *
 * 折线：新增用户 · 互动活跃用户（代理）｜ 柱：图纸创建。
 * 口径声明（PRD §2 强制显示，不允许静默）：UTC 0 点切分 + 活跃用户为代理口径。
 */

import React, { Suspense, useMemo } from 'react';
import type { DashboardAnalytics, DashboardRange } from '../adminDashboardModel';
import { dashboardChartRows, formatCount, trendIsEmpty } from '../adminDashboardModel';
import { useAdminChartColors } from './useAdminChartColors';

const LazyTrendChart = React.lazy(() => import('./AdminDashboardCharts').then(module => ({ default: module.DashboardTrendChart })));

function ChartSkeleton({ height }: { height: number }) {
  // 等高骨架屏：占位与真实图同高，避免数据到达时布局跳动（PRD §4 加载态）。
  return <div className="admin-dash-chart-skeleton" style={{ height }} role="status" aria-live="polite" data-dashboard-chart-skeleton>
    <span className="admin-hidden-text">图表加载中</span>
  </div>;
}

export function DashboardTrendSection({ analytics, range, loading }: {
  analytics: DashboardAnalytics | null;
  range: DashboardRange;
  loading: boolean;
}) {
  const rows = useMemo(() => dashboardChartRows(analytics?.series ?? []), [analytics]);
  const colors = useAdminChartColors();
  const empty = trendIsEmpty(rows);

  return <section className="admin-dash-panel admin-dash-panel--trend" aria-labelledby="admin-dash-trend-title" data-dashboard-trend>
    <div className="admin-dash-panel-head">
      <div>
        <h2 id="admin-dash-trend-title">{range} 天趋势</h2>
        <p className="admin-dash-scope">UTC 0 点切分 · 互动活跃用户为代理口径（图纸 ∪ 发帖 ∪ 点赞 ∪ 收藏去重）</p>
      </div>
    </div>
    {empty
      ? <p className="admin-dash-empty" data-dashboard-trend-empty>近 {range} 天无新增</p>
      : <div className="admin-dash-chart" data-dashboard-chart="trend" aria-busy={loading || undefined}>
        <Suspense fallback={<ChartSkeleton height={220} />}>
          <LazyTrendChart rows={rows} colors={colors} />
        </Suspense>
      </div>}
    {analytics && analytics.comparison && <p className="admin-dash-scope admin-dash-compare">
      当前 {analytics.comparison.from} → {analytics.comparison.to}（
      {formatCount(analytics.comparison.current.works)} 图纸 · {formatCount(analytics.comparison.current.posts)} 发布 ·
      {' '}{formatCount(analytics.comparison.current.completions)} 完成事件）；对比 {analytics.comparison.previousFrom} → {analytics.comparison.previousTo}
    </p>}
  </section>;
}
