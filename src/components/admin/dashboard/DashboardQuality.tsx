/**
 * C 区右：质量与错误（错误率 + 耗时趋势 + 错误码 Top5）。
 *
 * 口径声明（PRD §2，必须显示）：成功只统计白名单路由的埋点，错误统计全部 5xx，
 * 因此**真实错误率 ≥ 展示值**，标题必须写「代理口径」。
 *
 * 折线：左轴「错误率 %」（后端算好的 errorRatePct，前端不做除法）、右轴「平均耗时 ms」。
 * 每日错误数不单独成线，放在 tooltip 副行（错误 N 次 / 请求 M 次），避免同构图堆叠。
 */

import React, { Suspense, useMemo } from 'react';
import type { DashboardAnalytics, DashboardRange } from '../adminDashboardModel';
import { dashboardChartRows, formatCount, formatDurationMs, formatRatePercent, qualityIsEmpty } from '../adminDashboardModel';
import { useAdminChartColors } from './useAdminChartColors';

const LazyQualityChart = React.lazy(() => import('./AdminDashboardCharts').then(module => ({ default: module.DashboardQualityChart })));

export function DashboardQuality({ analytics, range }: { analytics: DashboardAnalytics | null; range: DashboardRange }) {
  const quality = analytics?.quality;
  const rows = useMemo(() => dashboardChartRows(analytics?.series ?? []), [analytics]);
  const colors = useAdminChartColors();
  const empty = qualityIsEmpty(rows);

  return <section className="admin-dash-panel" aria-labelledby="admin-dash-quality-title" data-dashboard-quality>
    <div className="admin-dash-panel-head">
      <div>
        <h2 id="admin-dash-quality-title">错误率与耗时</h2>
        <p className="admin-dash-scope">代理口径：真实错误率 ≥ 展示值（成功只统计白名单路由埋点）</p>
      </div>
    </div>
    <dl className="admin-dash-facts">
      <div><dt>{range} 天错误率</dt><dd data-quality-fact="errorRate">{formatRatePercent(quality?.errorRateProxy ?? null)}</dd></div>
      <div><dt>平均耗时</dt><dd data-quality-fact="avgDuration">{formatDurationMs(quality?.avgDurationMs ?? null)}</dd></div>
      <div><dt>最大耗时</dt><dd data-quality-fact="maxDuration">{formatDurationMs(quality?.maxDurationMs ?? null)}</dd></div>
      <div><dt>未处理错误</dt><dd data-quality-fact="unresolved">{formatCount(quality?.unresolvedErrors ?? null)}</dd></div>
    </dl>
    <p className="admin-dash-scope" data-quality-samples>
      样本：错误 {formatCount(quality?.errors ?? null)} 次 / 请求 {formatCount(quality?.requests ?? null)} 次 · 耗时样本 {formatCount(quality?.durationSamples ?? null)} 次
    </p>
    {empty
      ? <p className="admin-dash-empty" data-dashboard-quality-empty>近 {range} 天无错误与耗时记录</p>
      : <div className="admin-dash-chart admin-dash-chart--quality" data-dashboard-chart="quality">
        <Suspense fallback={<div className="admin-dash-chart-skeleton" style={{ height: 200 }} role="status" aria-live="polite"><span className="admin-hidden-text">图表加载中</span></div>}>
          <LazyQualityChart rows={rows} colors={colors} />
        </Suspense>
      </div>}
    {quality && quality.errorCodesTop5.length > 0
      ? <div className="admin-dash-code-list" data-quality-error-codes>
        <h3>错误码 Top5</h3>
        <ol>{quality.errorCodesTop5.map(item => <li key={item.code}>
          <span className="admin-mono">{item.code}</span><b>{formatCount(item.count)}</b>
        </li>)}</ol>
      </div>
      : <p className="admin-dash-empty admin-dash-empty--inline" data-quality-error-codes-empty>近 {range} 天无错误码记录</p>}
  </section>;
}
