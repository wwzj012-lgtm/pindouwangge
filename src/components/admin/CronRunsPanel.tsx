import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminRequest } from './adminRequest';
import { AdminBadge, AdminButton, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { AdminDataTable, type AdminDataTableColumn } from './shared/AdminDataTable';

/**
 * 批次 4：定时任务执行记录板块（GET /api/admin/cron-runs）。
 * 数据来自 cron_task_runs：每天每任务一行，失败也会记录（success/partial/failed）。
 */

export interface CronRunItem {
  id: string;
  taskName: string;
  runDate: string;
  status: 'success' | 'partial' | 'failed' | string;
  durationMs: number | null;
  details: Record<string, unknown>;
  createdAt: number;
}

interface CronRunPage { items: CronRunItem[]; total: number; limit: number; offset: number }

export const cronTaskLabels: Record<string, string> = {
  work_cleanup: '已删除作品清理',
  specs_backfill: '社区帖子 specs 回填',
  tag_dictionary_recalibration: '标签字典使用计数校准',
};

export function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'success') return 'success';
  if (status === 'partial') return 'warning';
  if (status === 'failed') return 'danger';
  return 'neutral';
}

export function durationText(durationMs: number | null): string {
  return typeof durationMs === 'number' && Number.isFinite(durationMs) ? `${Math.round(durationMs)} ms` : '—';
}

export function cronDetailsText(details: Record<string, unknown>): string {
  const entries = Object.entries(details ?? {}).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) return '—';
  return entries.map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join('；');
}

export function CronRunsPanel({ request, pageSize = 50, initialRuns }: { request: AdminRequest; pageSize?: number; initialRuns?: CronRunItem[] }) {
  const [page, setPage] = useState<CronRunPage | null>(() => initialRuns
    ? { items: initialRuns, total: initialRuns.length, limit: pageSize, offset: 0 }
    : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const load = useCallback(async () => {
    const version = ++epoch.current;
    setLoading(true); setError('');
    try {
      const result = await request<CronRunPage>(`/api/admin/cron-runs?limit=${pageSize}&offset=0`);
      if (version !== epoch.current) return;
      if (result.ok && result.data && Array.isArray(result.data.items)) { setPage(result.data); setError(''); }
      else setError((result.status === 403 ? '读取执行记录被服务端拒绝（403）：' : '定时任务执行记录读取失败：') + (result.error ?? '请重试'));
    } catch { if (version === epoch.current) setError('读取失败，请检查网络后重试。'); }
    finally { if (version === epoch.current) setLoading(false); }
  }, [request, pageSize]);
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [load]);
  // 批次 5：共享表格列定义（机械替换，行为不变）。
  const columns: Array<AdminDataTableColumn<CronRunItem>> = [
    {
      key: 'taskName',
      label: '任务',
      render: item => <><strong>{cronTaskLabels[item.taskName] ?? item.taskName}</strong><small className="admin-mono">{item.taskName}</small></>,
    },
    { key: 'runDate', label: '运行日期' },
    { key: 'status', label: '状态', render: item => <AdminBadge tone={statusTone(item.status)}>{item.status}</AdminBadge> },
    { key: 'durationMs', label: '耗时', numeric: true, render: item => durationText(item.durationMs) },
    { key: 'details', label: '详情', render: item => <small>{cronDetailsText(item.details)}</small> },
  ];
  return <section aria-label="定时任务执行记录" aria-busy={loading}>
    <AdminToolbar actions={<AdminButton busy={loading} onClick={() => void load()}>刷新记录</AdminButton>}>
      <h2>定时任务执行记录</h2>
      <p>每天（UTC）每任务一行，重跑当日任务会覆盖为最新结果；失败同样留痕。</p>
    </AdminToolbar>
    {error && <AdminErrorState message={error} retry={() => void load()} busy={loading} />}
    <div className="admin-stage-panel" aria-busy={loading}>
      {!page ? loading ? <AdminLoading /> : <AdminEmptyState title="尚无成功读取结果" /> : page.items.length === 0
        ? <AdminEmptyState title="还没有定时任务执行记录" description="记录在 Worker scheduled cron 首次运行后出现。" />
        : <AdminDataTable columns={columns} rows={page.items} rowKey={item => item.id} ariaLabel="定时任务执行记录" minWidth={640}
          rowAttrs={item => ({ 'data-cron-row': item.taskName })} />}
    </div>
  </section>;
}
