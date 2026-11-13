import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminRequest } from './adminRequest';
import { AdminBadge, AdminButton, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { AdminDataTable, type AdminDataTableColumn } from './shared/AdminDataTable';
import { dateText } from './adminUserModel';

/**
 * 批次 4：运行日志板块（GET /api/admin/run-logs）。
 * 两源切换：activity = user_activity_logs（用户行为事件），audit = audit_logs
 * （旧版管理审计行）。结构化写操作审计在「操作审计」板块，不在本页。
 */

export type RunLogSource = 'activity' | 'audit';

interface ActivityLogItem {
  id: string; actorUid: string | null; eventType: string; entityType: string | null;
  entityId: string | null; metadata: unknown; occurredAt: number;
}
interface AuditLogItem {
  id: string; operatorUid: string | null; operatorEmail: string | null;
  action: string; details: string | null; timestamp: number;
}

interface RunLogPage {
  type: RunLogSource; items: Array<ActivityLogItem | AuditLogItem>; total: number; limit: number; offset: number;
}

export const runLogSources: Array<{ id: RunLogSource; label: string }> = [
  { id: 'activity', label: '用户活动' },
  { id: 'audit', label: '管理审计' },
];

export function isActivityItem(item: ActivityLogItem | AuditLogItem): item is ActivityLogItem {
  return 'eventType' in item && 'occurredAt' in item;
}

export function runLogQuery(source: RunLogSource, limit: number, offset: number): string {
  const params = new URLSearchParams({ type: source, limit: String(limit), offset: String(offset) });
  return `?${params.toString()}`;
}

const eventTone = (eventType: string): 'neutral' | 'success' | 'warning' | 'danger' => {
  if (/error|fail/.test(eventType)) return 'danger';
  if (/publish|checked_in|completed/.test(eventType)) return 'success';
  return 'neutral';
};

export function RunLogsViewer({ request, pageSize = 30, initialItems, initialSource = 'activity' }: { request: AdminRequest; pageSize?: number; initialItems?: Array<ActivityLogItem | AuditLogItem>; initialSource?: RunLogSource }) {
  const [source, setSource] = useState<RunLogSource>(initialSource);
  const [page, setPage] = useState<RunLogPage | null>(() => initialItems
    ? { type: initialSource, items: initialItems, total: initialItems.length, limit: pageSize, offset: 0 }
    : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const load = useCallback(async (target: RunLogSource) => {
    const version = ++epoch.current;
    setLoading(true); setError('');
    try {
      const result = await request<RunLogPage>('/api/admin/run-logs' + runLogQuery(target, pageSize, 0));
      if (version !== epoch.current) return;
      if (result.ok && result.data && Array.isArray(result.data.items) && result.data.type === target) {
        setPage(result.data); setError('');
      } else setError((result.status === 403 ? '读取日志被服务端拒绝（403）：' : '运行日志读取失败：') + (result.error ?? '请重试'));
    } catch { if (version === epoch.current) setError('读取失败，请检查网络后重试。'); }
    finally { if (version === epoch.current) setLoading(false); }
  }, [request, pageSize]);
  useEffect(() => { void load(source); return () => { epoch.current++; }; }, [load, source]);
  const total = page?.total ?? 0;
  // 批次 5：共享表格列定义。两种数据源形状不同，列集合保持一致，单元格内按行分支。
  const columns: Array<AdminDataTableColumn<ActivityLogItem | AuditLogItem>> = [
    {
      key: 'time',
      label: '时间',
      render: item => dateText(isActivityItem(item) ? item.occurredAt : item.timestamp),
    },
    {
      key: 'actor',
      label: '来源主体',
      render: item => <span className="admin-mono">{isActivityItem(item) ? item.actorUid ?? '系统' : (item.operatorUid ?? '—') + (item.operatorEmail ? ` (${item.operatorEmail})` : '')}</span>,
    },
    {
      key: 'action',
      label: '事件 / 动作',
      render: item => isActivityItem(item)
        ? <AdminBadge tone={eventTone(item.eventType)}>{item.eventType}</AdminBadge>
        : <AdminBadge>{item.action}</AdminBadge>,
    },
    {
      key: 'detail',
      label: '明细',
      render: item => isActivityItem(item)
        ? <small>{item.entityType ?? '—'}{item.entityId ? ` · ${item.entityId}` : ''}</small>
        : <small className="admin-final-excerpt">{item.details ?? '—'}</small>,
    },
  ];
  return <section aria-label="运行日志" aria-busy={loading}>
    <AdminToolbar actions={<AdminButton busy={loading} onClick={() => void load(source)}>刷新日志</AdminButton>}>
      <h2>运行日志</h2>
      <p>原「系统日志」按数据源分流：用户活动与管理审计分开检索。</p>
    </AdminToolbar>
    <div className="admin-module-tabs" role="group" aria-label="日志来源">
      {runLogSources.map(item => <AdminButton key={item.id} aria-pressed={source === item.id}
        variant={source === item.id ? 'primary' : 'secondary'} onClick={() => setSource(item.id)}>{item.label}</AdminButton>)}
    </div>
    {error && <AdminErrorState message={error} retry={() => void load(source)} busy={loading} />}
    <div className="admin-stage-panel" aria-busy={loading}>
      {!page ? loading ? <AdminLoading /> : <AdminEmptyState title="尚无成功读取结果" /> : page.items.length === 0
        ? <AdminEmptyState title="该来源暂无日志" />
        : <AdminDataTable columns={columns} rows={page.items} rowKey={item => item.id} ariaLabel="运行日志列表" minWidth={620}
          rowAttrs={item => ({ 'data-runlog-row': isActivityItem(item) ? 'activity' : 'audit' })} />}
      {page && total > page.limit && <div className="admin-pagination"><span>共 {total} 条，本页显示前 {page.limit} 条</span></div>}
    </div>
  </section>;
}
