/**
 * D 区：待办条（待审核 / 待举报 / 兑换码库存），三项可点击下钻。
 *
 * 计数口径必须与目标列表默认筛选一致（PRD P0-5）：
 * - 待审核：`community_post_moderation.state = 'pending'` → community 页 preset=review-queue
 * - 待举报：`content_reports.status = 'open'` → community 页 preset=reports
 *   `reportsReviewing` 只作副行灰字，不并入待举报数（与举报列表默认筛选对齐）
 * - 兑换码：可用库存（`used=0 AND delete_pending_at IS NULL`）→ codes 页 preset=low-stock
 */

import React from 'react';
import type { DashboardAnalytics, DashboardTodo } from '../adminDashboardModel';
import { formatCount, todoDrillQuery } from '../adminDashboardModel';

export type DashboardTarget = 'community' | 'codes';

export function DashboardTodoBar({ todo, analytics, onDrill }: {
  todo: DashboardTodo | null;
  analytics: DashboardAnalytics | null;
  onDrill: (target: DashboardTarget, query?: Record<string, string>) => void;
}) {
  const reviewing = analytics?.kpis.pendingBreakdown.reportsReviewing ?? 0;
  const items: { key: string; label: string; value: string; note?: string; tone: 'danger' | 'warning' | 'neutral'; target: DashboardTarget; query: Record<string, string> }[] = [
    {
      key: 'reviews',
      label: '待审核帖子',
      value: formatCount(todo?.pendingReviews),
      tone: (todo?.pendingReviews ?? 0) > 0 ? 'warning' : 'neutral',
      target: 'community',
      query: todoDrillQuery('reviews'),
    },
    {
      key: 'reports',
      label: '待处理举报',
      value: formatCount(todo?.pendingReports),
      note: reviewing > 0 ? '复核中 ' + formatCount(reviewing) + ' 条（不计入）' : undefined,
      tone: (todo?.pendingReports ?? 0) > 0 ? 'danger' : 'neutral',
      target: 'community',
      query: todoDrillQuery('reports'),
    },
    {
      key: 'codes',
      label: '兑换码可用库存',
      value: formatCount(todo?.availableCodes),
      note: typeof todo?.lowStockThreshold === 'number' ? '低库存阈值 ' + formatCount(todo.lowStockThreshold) : undefined,
      tone: todo?.lowStockCodes ? 'danger' : 'neutral',
      target: 'codes',
      query: todoDrillQuery('codes'),
    },
  ];

  return <section className="admin-dash-panel admin-dash-panel--todo" aria-labelledby="admin-dash-todo-title" data-dashboard-todo>
    <div className="admin-dash-panel-head">
      <h2 id="admin-dash-todo-title">待办</h2>
      <p className="admin-dash-scope">点击进入对应列表并带筛选条件</p>
    </div>
    <div className="admin-dash-todo">
      {items.map(item => <button type="button" key={item.key} className="admin-dash-todo-item" data-todo-card={item.key}
        data-tone={item.tone} aria-label={item.label + ' ' + item.value + '，去处理'}
        onClick={() => onDrill(item.target, item.query)}>
        <span className="admin-dash-todo-label">{item.label}</span>
        <strong data-todo-value={item.key}>{item.value}</strong>
        {item.note && <small className="admin-dash-todo-note">{item.note}</small>}
        <span className="admin-dash-todo-action" aria-hidden="true">去处理 →</span>
      </button>)}
    </div>
  </section>;
}
