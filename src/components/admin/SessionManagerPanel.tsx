import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminRequest } from './adminRequest';
import { AdminBadge, AdminButton, AdminConfirmDialog, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { AdminDataTable, type AdminDataTableColumn } from './shared/AdminDataTable';
import { dateText } from './adminUserModel';

/**
 * 批次 4：后台会话管理板块。
 * GET /api/admin/sessions 列活跃会话；POST /api/admin/sessions/force-logout
 * 强制下线其他管理员（服务端拒绝踢自己，前端同样对自身会话禁用按钮）。
 */

export interface AdminSessionItem {
  sessionId: string;
  adminUid: string;
  adminName: string | null;
  adminEmail: string | null;
  ipHash: string | null;
  userAgent: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

interface SessionPage { items: AdminSessionItem[]; generatedAt: number }

/** 当前操作者不能强制下线自己的会话（服务端 400 兜底，前端直接禁用）。 */
export function canForceLogout(session: AdminSessionItem, operatorUid: string): boolean {
  return session.adminUid !== operatorUid;
}

export function sessionLabel(session: AdminSessionItem): string {
  return session.adminName || session.adminEmail || session.adminUid;
}

export function SessionManagerPanel({ request, operatorUid, initialSessions }: { request: AdminRequest; operatorUid: string; initialSessions?: AdminSessionItem[] }) {
  const [items, setItems] = useState<AdminSessionItem[] | null>(initialSessions ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState<AdminSessionItem | null>(null);
  const [kicking, setKicking] = useState(false);
  const epoch = useRef(0);
  const load = useCallback(async () => {
    const version = ++epoch.current;
    setLoading(true); setError('');
    try {
      const result = await request<SessionPage>('/api/admin/sessions');
      if (version !== epoch.current) return;
      if (result.ok && result.data && Array.isArray(result.data.items)) { setItems(result.data.items); setSuccess(''); }
      else setError((result.status === 403 ? '读取会话被服务端拒绝（403）：' : '会话列表读取失败：') + (result.error ?? '请重试'));
    } catch { if (version === epoch.current) setError('读取失败，请检查网络后重试。'); }
    finally { if (version === epoch.current) setLoading(false); }
  }, [request]);
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [load]);
  const kick = async () => {
    if (!pending) return;
    setKicking(true);
    try {
      const result = await request<{ forceLoggedOut: boolean }>('/api/admin/sessions/force-logout', {
        method: 'POST', body: JSON.stringify({ sessionId: pending.sessionId }),
      });
      if (result.ok) {
        setSuccess(`已强制下线 ${sessionLabel(pending)} 的后台会话，其旧凭证立即失效。`);
        setPending(null);
        await load();
      } else setError((result.status === 400 ? '不能强制下线自己的会话：' : result.status === 404 ? '会话不存在或已结束：' : '强制下线失败：') + (result.error ?? '请重试'));
    } catch { setError('强制下线请求失败，请检查网络后重试。'); }
    finally { setKicking(false); }
  };
  // 批次 5：共享表格列定义（机械替换，行为不变）。
  const columns: Array<AdminDataTableColumn<AdminSessionItem>> = [
    {
      key: 'admin',
      label: '管理员',
      render: item => <><strong>{sessionLabel(item)}</strong><small className="admin-mono">{item.adminUid}</small></>,
    },
    { key: 'sessionId', label: '会话', render: item => <small className="admin-mono">{item.sessionId}</small> },
    { key: 'ipHash', label: 'IP 哈希', render: item => <small className="admin-mono">{item.ipHash ? item.ipHash.slice(0, 12) + '…' : '—'}</small> },
    {
      key: 'createdAt',
      label: '创建 / 最后活跃',
      render: item => <small>{dateText(item.createdAt)}<br />活跃 {dateText(item.lastSeenAt)}</small>,
    },
    { key: 'expiresAt', label: '过期', render: item => <small>{dateText(item.expiresAt)}</small> },
    {
      key: 'actions',
      label: '操作',
      sticky: 'right',
      render: item => {
        const self = !canForceLogout(item, operatorUid);
        return self
          ? <AdminBadge tone="neutral">当前会话</AdminBadge>
          : <AdminButton data-force-logout={item.sessionId} variant="danger-quiet" disabled={loading || kicking}
            onClick={() => setPending(item)}>强制下线</AdminButton>;
      },
    },
  ];
  return <section aria-label="后台会话管理" aria-busy={loading}>
    <AdminToolbar actions={<AdminButton busy={loading} onClick={() => void load()}>刷新会话</AdminButton>}>
      <h2>后台会话</h2>
      <p>活跃的后台不透明会话；IP 以哈希展示。强制下线后该管理员需重新进入后台。</p>
    </AdminToolbar>
    {success && <p className="admin-success-message" role="status">{success}</p>}
    {error && <AdminErrorState message={error} retry={() => void load()} busy={loading} />}
    <div className="admin-stage-panel" aria-busy={loading}>
      {!items ? loading ? <AdminLoading /> : <AdminEmptyState title="尚无成功读取结果" /> : items.length === 0
        ? <AdminEmptyState title="当前没有活跃的后台会话" />
        : <AdminDataTable columns={columns} rows={items} rowKey={item => item.sessionId} ariaLabel="后台会话列表" minWidth={620}
          rowAttrs={item => ({ 'data-session-row': item.adminUid })} />}
    </div>
    <AdminConfirmDialog
      open={Boolean(pending)}
      title="强制下线后台会话"
      description="确认后将立即撤销该管理员的活跃后台会话。"
      subject={pending ? sessionLabel(pending) : ''}
      impact="该管理员正在进行的后台操作会话立即失效，需要重新进入后台；不影响其前台登录。"
      confirmLabel="强制下线"
      pending={kicking}
      onClose={() => setPending(null)}
      onConfirm={() => void kick()}
    />
  </section>;
}
