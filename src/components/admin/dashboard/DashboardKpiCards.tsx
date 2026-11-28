/**
 * A 区：4 张决策卡（PRD §3 首屏四问）。
 *
 * ① 今日新增创作者（含昨日同刻环比）② 发布转化率 ③ 待处理合计 ④ 24h 错误率。
 * 全部只读已解析的 analytics；无数据一律「—」，绝不补 0。
 */

import React from 'react';
import type { DashboardAnalytics, DashboardRange } from '../adminDashboardModel';
import {
  conversionIsIncomparable, conversionLabel, deltaTone, formatCount, formatDeltaPercent, formatRatePercent,
} from '../adminDashboardModel';

export function DashboardKpiCards({ analytics, range }: { analytics: DashboardAnalytics | null; range: DashboardRange }) {
  const kpis = analytics?.kpis;
  const conversionIncomparable = conversionIsIncomparable(kpis?.publishConversion.rate ?? null);
  const pendingNote = kpis
    ? '审核 ' + formatCount(kpis.pendingBreakdown.reviews) + ' / 举报 ' + formatCount(kpis.pendingBreakdown.reports)
      + (kpis.pendingBreakdown.reportsReviewing > 0 ? '（复核 ' + formatCount(kpis.pendingBreakdown.reportsReviewing) + '）' : '')
    : '—';
  const errorNote = kpis
    ? '错误 ' + formatCount(kpis.errorRate24hProxy.errors) + ' / 请求 ' + formatCount(kpis.errorRate24hProxy.requests)
    : '—';

  return <section className="admin-dash-kpis" aria-label="核心指标" data-dashboard-kpis>
    <article className="admin-dash-kpi" data-kpi-card="creators">
      <span className="admin-dash-kpi-label">今日新增创作者</span>
      <strong className="admin-dash-kpi-value" data-kpi-value="creators">{formatCount(kpis?.todayNewCreators)}</strong>
      <p className="admin-dash-kpi-sub">
        <span>昨日同刻 {formatCount(kpis?.todayNewCreatorsPrevSameTime)}</span>
        <b className="admin-dash-delta" data-tone={deltaTone(kpis?.todayNewCreatorsDeltaPct)}
          data-kpi-delta="creators">{formatDeltaPercent(kpis?.todayNewCreatorsDeltaPct)}</b>
      </p>
    </article>

    <article className="admin-dash-kpi" data-kpi-card="conversion">
      <span className="admin-dash-kpi-label">{range} 天发布转化率</span>
      <strong className="admin-dash-kpi-value" data-kpi-value="conversion"
        data-tone={conversionIncomparable ? 'muted' : undefined}>
        {/* analytics 整段缺失（旧 Worker）→「—」；有 analytics 但分母 0 →「本期无样本」。 */}
        {kpis ? conversionLabel(kpis.publishConversion.rate, kpis.publishConversion.denominator) : '—'}
      </strong>
      <p className="admin-dash-kpi-sub">
        <span>图纸 {formatCount(kpis?.publishConversion.denominator)} → 发布 {formatCount(kpis?.publishConversion.numerator)}</span>
      </p>
    </article>

    <article className="admin-dash-kpi" data-kpi-card="pending">
      <span className="admin-dash-kpi-label">待处理</span>
      <strong className="admin-dash-kpi-value" data-kpi-value="pending">{formatCount(kpis?.pendingTotal)}</strong>
      <p className="admin-dash-kpi-sub"><span>{pendingNote}</span></p>
    </article>

    <article className="admin-dash-kpi" data-kpi-card="error-rate">
      <span className="admin-dash-kpi-label">24 小时错误率</span>
      <strong className="admin-dash-kpi-value" data-kpi-value="error-rate">{formatRatePercent(kpis?.errorRate24hProxy.rate ?? null)}</strong>
      <p className="admin-dash-kpi-sub"><span>{errorNote}</span><span className="admin-dash-kpi-scope">代理口径</span></p>
    </article>
  </section>;
}
