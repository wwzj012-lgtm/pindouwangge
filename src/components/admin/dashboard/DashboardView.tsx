/**
 * 仪表盘视图（整块懒加载）：A 决策卡 → B 趋势主图 → C 转化与质量 → D 待办。
 *
 * 为什么整块懒加载：仪表盘的解析器 + 四个区块 + 图表一起搬出 AdminPage 主 chunk，
 * AdminPage 保持零增长；图表（recharts/d3）再单独一层懒加载，只在真有数据时下载。
 * 旧版 5 张同构 SVG 图、今日概览四小卡、注册柱图整块删除，不留并行实现。
 */

import React from 'react';
import { AdminButton, AdminEmptyState, AdminErrorState, AdminToolbar } from '../AdminPrimitives';
import {
  DASHBOARD_RANGES, formatCount, parseDashboardAnalytics, parseDashboardTodo,
  type DashboardRange,
} from '../adminDashboardModel';
import { DashboardKpiCards } from './DashboardKpiCards';
import { DashboardTrendSection } from './DashboardTrendSection';
import { DashboardFunnel } from './DashboardFunnel';
import { DashboardQuality } from './DashboardQuality';
import { DashboardTodoBar, type DashboardTarget } from './DashboardTodoBar';

/** 服务端返回（只做加法：批次 6 新增 analytics / meta.range）。 */
export interface DashboardResponse {
  overview?: {
    totalUsers?: number;
    newUsers30Days?: number;
    activeVipUsers?: number;
    works?: number;
    communityPosts?: number;
    redeemedCodes?: number;
    recentErrors?: number;
  };
  warnings?: string[];
  sections?: Record<string, { available: boolean; error?: string }>;
  todo?: unknown;
  analytics?: unknown;
  meta?: { requests?: number; generatedAt?: number; range?: number };
}

/** 首屏骨架：与真实卡片同高，避免数据到达时布局跳动（PRD §4 加载态）。 */
export function DashboardSkeleton() {
  return <div className="admin-dash-skeleton" role="status" aria-live="polite" data-dashboard-skeleton>
    <span className="admin-hidden-text">正在加载服务端统计</span>
    <div className="admin-dash-kpis">
      {[0, 1, 2, 3].map(index => <div className="admin-dash-kpi admin-dash-kpi--ghost" key={index} aria-hidden="true" />)}
    </div>
    <div className="admin-dash-chart-skeleton" style={{ height: 240 }} aria-hidden="true" />
  </div>;
}

interface DashboardViewProps {
  data: DashboardResponse | null;
  error: string;
  loading: boolean;
  retry: () => void;
  range: DashboardRange;
  onRangeChange: (range: DashboardRange) => void;
  onDrill: (target: DashboardTarget, query?: Record<string, string>) => void;
}

export default function DashboardView({ data, error, loading, retry, range, onRangeChange, onDrill }: DashboardViewProps) {
  if (loading && !data) return <DashboardSkeleton />;
  if (error) return <AdminErrorState title="统计暂不可用" message={error} retry={retry} busy={loading} />;
  if (!data) return <AdminEmptyState title="尚无统计结果" description="未知值不会显示为零。" action={<AdminButton onClick={retry}>刷新统计</AdminButton>} />;
  const analytics = parseDashboardAnalytics(data.analytics);
  const todo = parseDashboardTodo(data.todo);
  const overview = data.overview;
  return <section aria-label="运营概览" aria-busy={loading || undefined}>
    <AdminToolbar actions={<div className="admin-dash-range" role="group" aria-label="时间范围（影响趋势、漏斗、质量与待办窗口）">
      {DASHBOARD_RANGES.map(option => <button type="button" key={option} className="admin-dash-range-item"
        aria-pressed={range === option} data-range={option} onClick={() => onRangeChange(option)}>{option} 天</button>)}
    </div>}><h2>运营概览</h2></AdminToolbar>
    {loading && <p role="status" className="admin-muted">正在更新统计，当前结果暂时保留…</p>}
    <DashboardKpiCards analytics={analytics} range={range} />
    <DashboardTrendSection analytics={analytics} range={range} loading={loading} />
    <div className="admin-dash-grid">
      <DashboardFunnel funnel={analytics?.funnel ?? null} />
      <DashboardQuality analytics={analytics} range={range} />
    </div>
    <DashboardTodoBar todo={todo} analytics={analytics} onDrill={onDrill} />
    {!analytics && <p className="admin-dash-empty" role="status" data-dashboard-analytics-missing>
      服务端未返回分析数据（Worker 可能是旧版本）。趋势与转化率暂显示「—」，其它模块不受影响。
      <AdminButton onClick={retry} busy={loading}>重试</AdminButton>
    </p>}
    {/* 累计口径只做一行页脚小字：不作为图表，也不与新增/活跃混为一谈。 */}
    <p className="admin-dash-footnote" data-dashboard-cumulative>
      累计：注册 {formatCount(overview?.totalUsers ?? null)} · 图纸 {formatCount(overview?.works ?? null)} ·
      社区帖子 {formatCount(overview?.communityPosts ?? null)} · 有效会员 {formatCount(overview?.activeVipUsers ?? null)}
      {typeof data.meta?.generatedAt === 'number' && <span> · 统计于 {new Date(data.meta.generatedAt).toLocaleString('zh-CN', { hour12: false })}</span>}
    </p>
    {/* 分段降级：页脚 footnote 灰字 + 展开箭头；展开后显示分段级 error 详情。 */}
    {Boolean(data.warnings?.length) && <details className="admin-warnings-footnote" role="status" data-dashboard-warnings>
      <summary>部分统计暂不可用（{data.warnings!.length} 项）</summary>
      <ul>{data.warnings!.map(warning => <li key={warning}>{warning}</li>)}</ul>
      {data.sections && Object.entries(data.sections).filter(([, section]) => section.available === false && section.error).map(([key, section]) => <p key={key}><span className="admin-mono">{key}</span>：{section.error}</p>)}
    </details>}
  </section>;
}
