import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminRequest } from './adminRequest';
import { AdminBadge, AdminButton, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { AdminDataTable, type AdminDataTableColumn } from './shared/AdminDataTable';
import { AdminPagination } from './shared/AdminPagination';
import { FilterBar } from './shared/FilterBar';
import { dateText } from './adminUserModel';

/**
 * 批次 4：管理操作审计板块（GET /api/admin/operation-logs）。
 * 筛选：操作者 / 动作 / 时间区间；行内展开 before → after 结构化 diff。
 */

export interface OperationLogItem {
  id: string;
  actorUid: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  beforeJson: string | null;
  afterJson: string | null;
  note: string | null;
  createdAt: number;
}

interface OperationLogPage { items: OperationLogItem[]; total: number; limit: number; offset: number }

export interface OperationLogQuery { actor: string; action: string; from: string; to: string; limit: number; offset: number }

export const emptyOperationLogQuery = (): OperationLogQuery => ({ actor: '', action: '', from: '', to: '', limit: 30, offset: 0 });

/** 严格序列化查询串：空筛选不进 URL，日期必须为 YYYY-MM-DD。 */
export function operationLogQuery(query: OperationLogQuery): string {
  const params = new URLSearchParams();
  if (query.actor.trim()) params.set('actor', query.actor.trim());
  if (query.action.trim()) params.set('action', query.action.trim());
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (datePattern.test(query.from)) params.set('from', query.from);
  if (datePattern.test(query.to)) params.set('to', query.to);
  params.set('limit', String(query.limit));
  params.set('offset', String(query.offset));
  return `?${params.toString()}`;
}

/** 结构化 diff：解析 before/after JSON，把变更字段列成「字段 旧 → 新」行。 */
export function operationLogDiff(item: Pick<OperationLogItem, 'before' | 'after'>): Array<{ field: string; before: string; after: string }> {
  const format = (value: unknown): string => {
    if (value === null || value === undefined) return '∅';
    if (typeof value === 'string') return value.length > 80 ? value.slice(0, 80) + '…' : value;
    try { const text = JSON.stringify(value); return text && text.length > 120 ? text.slice(0, 120) + '…' : text ?? '∅'; }
    catch { return '∅'; }
  };
  const before = (item.before && typeof item.before === 'object' && !Array.isArray(item.before) ? item.before : null) as Record<string, unknown> | null;
  const after = (item.after && typeof item.after === 'object' && !Array.isArray(item.after) ? item.after : null) as Record<string, unknown> | null;
  if (!before && !after) {
    return [{ field: '值', before: format(item.before), after: format(item.after) }];
  }
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...fields].map((field) => {
    const beforeValue = before ? before[field] : undefined;
    const afterValue = after ? after[field] : undefined;
    const same = JSON.stringify(beforeValue ?? null) === JSON.stringify(afterValue ?? null);
    return { field, before: same ? '（未变）' : format(beforeValue), after: format(afterValue) };
  });
}

export function OperationLogViewer({ request, pageSize = 30, initialItems }: { request: AdminRequest; pageSize?: number; initialItems?: OperationLogItem[] }) {
  const [query, setQuery] = useState<OperationLogQuery>(() => emptyOperationLogQuery());
  const [page, setPage] = useState<OperationLogPage | null>(() => initialItems
    ? { items: initialItems, total: initialItems.length, limit: pageSize, offset: 0 }
    : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const epoch = useRef(0);
  const load = useCallback(async (target: OperationLogQuery) => {
    const version = ++epoch.current;
    setLoading(true); setError('');
    try {
      const result = await request<OperationLogPage>('/api/admin/operation-logs' + operationLogQuery(target));
      if (version !== epoch.current) return;
      if (result.ok && result.data && Array.isArray(result.data.items)) { setPage(result.data); setExpanded(null); }
      else setError((result.status === 403 ? '读取审计被服务端拒绝（403）：' : '操作审计读取失败：') + (result.error ?? '请重试'));
    } catch { if (version === epoch.current) setError('读取失败，请检查网络后重试。'); }
    finally { if (version === epoch.current) setLoading(false); }
  }, [request]);
  useEffect(() => { void load(query); return () => { epoch.current++; }; }, [load, query]);
  const total = page?.total ?? 0;
  // 批次 5：共享表格 + 三段式筛选栏（机械替换，行为不变）。
  const columns: Array<AdminDataTableColumn<OperationLogItem>> = [
    { key: 'createdAt', label: '时间', render: item => dateText(item.createdAt) },
    { key: 'actorUid', label: '操作者', render: item => <span className="admin-mono">{item.actorUid ?? '—'}</span> },
    { key: 'action', label: '动作', render: item => <AdminBadge>{item.action}</AdminBadge> },
    {
      key: 'target',
      label: '目标',
      render: item => <span className="admin-mono">{item.targetType ?? '—'}{item.targetId ? ` · ${item.targetId}` : ''}</span>,
    },
    {
      key: 'note',
      label: '备注 / diff',
      render: item => <>
        {item.note && <small>{item.note}</small>}
        <div><AdminButton aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>
          {expanded === item.id ? '收起 diff' : '展开前后对比'}
        </AdminButton></div>
      </>,
    },
  ];
  return <section aria-label="管理操作审计" aria-busy={loading}>
    <AdminToolbar actions={<AdminButton busy={loading} onClick={() => void load(query)}>刷新审计</AdminButton>}>
      <h2>管理操作审计</h2>
      <p>结构化写操作审计（admin_operation_logs），每条含改动前后快照；展开行查看字段级 diff。</p>
    </AdminToolbar>
    <FilterBar label="审计筛选" className="admin-stage-panel admin-log-filters"
      filters={<>
        <label>操作者 UID<input data-ops-actor value={query.actor} maxLength={128} placeholder="留空为全部"
          onChange={event => setQuery({ ...query, actor: event.target.value, offset: 0 })} /></label>
        <label>动作<input data-ops-action value={query.action} maxLength={120} placeholder="如 announcement.upsert"
          onChange={event => setQuery({ ...query, action: event.target.value, offset: 0 })} /></label>
        <label>起始日期<input data-ops-from type="date" value={query.from}
          onChange={event => setQuery({ ...query, from: event.target.value, offset: 0 })} /></label>
        <label>结束日期<input data-ops-to type="date" value={query.to}
          onChange={event => setQuery({ ...query, to: event.target.value, offset: 0 })} /></label>
      </>} />
    {error && <AdminErrorState message={error} retry={() => void load(query)} busy={loading} />}
    <div className="admin-stage-panel" aria-busy={loading}>
      {!page ? loading ? <AdminLoading /> : <AdminEmptyState title="尚无成功读取结果" /> : page.items.length === 0
        ? <AdminEmptyState title="没有匹配的操作审计" description="调整筛选条件后重试；本页只记录管理端写操作。" />
        : <>
          <AdminDataTable columns={columns} rows={page.items} rowKey={item => item.id} ariaLabel="操作审计列表" minWidth={760}
            rowAttrs={item => ({ 'data-ops-row': item.action })}
            renderExpandedRow={item => expanded === item.id
              ? <tr><td colSpan={5}>
                <table className="admin-stage-table" aria-label={'diff ' + item.id}>
                  <thead><tr><th>字段</th><th>改动前</th><th>改动后</th></tr></thead>
                  <tbody>{operationLogDiff(item).map(row => <tr key={row.field}>
                    <td className="admin-mono">{row.field}</td><td>{row.before}</td><td>{row.after}</td>
                  </tr>)}</tbody>
                </table>
              </td></tr>
              : undefined} />
          <AdminPagination label="操作审计分页" total={total} limit={page.limit} offset={page.offset} busy={loading}
            onPageChange={nextOffset => setQuery({ ...query, offset: nextOffset })}
            pageSizeOptions={[10, 20, 30, 50, 100]}
            onLimitChange={nextLimit => setQuery({ ...query, limit: nextLimit, offset: 0 })} />
        </>}
    </div>
  </section>;
}
