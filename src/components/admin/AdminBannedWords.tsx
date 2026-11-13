import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldAlert, Trash2 } from 'lucide-react';
import { AdminBadge, AdminButton, AdminConfirmDialog, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { AdminToast } from './shared/AdminToast';
import type { AdminRequest } from './adminRequest';

export interface AdminBannedWordItem {
  id: number;
  word: string;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

interface BannedWordsPage {
  items: AdminBannedWordItem[];
}

/** 违禁词录入校验：与后端 bannedWordText 的 1-100 字符规则一致。 */
export function bannedWordDraftError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return '请输入违禁词。';
  if (trimmed.length > 100) return '违禁词长度需在 1-100 个字符之间。';
  return null;
}

/** 管理端违禁词库：列表 / 添加 / 启停 / 删除。只拦新增与编辑，不回扫存量内容。 */
export function AdminBannedWords({ request }: { request: AdminRequest }) {
  const [items, setItems] = useState<AdminBannedWordItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AdminBannedWordItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const epoch = useRef(0);

  const load = useCallback(async () => {
    const version = ++epoch.current;
    setLoading(true);
    setError('');
    try {
      const result = await request<BannedWordsPage>('/api/admin/community/banned-words');
      if (version !== epoch.current) return;
      if (result.ok && result.data && Array.isArray(result.data.items)) setItems(result.data.items);
      else {
        setItems(null);
        setError(result.error ?? '读取违禁词库失败，请重试。');
      }
    } finally {
      if (version === epoch.current) setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void load();
    return () => { epoch.current += 1; };
  }, [load]);

  const add = async () => {
    const word = draft.trim();
    if (busy) return;
    const draftError = bannedWordDraftError(word);
    if (draftError) { setActionError(draftError); return; }
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const result = await request<{ item: AdminBannedWordItem }>('/api/admin/community/banned-words', {
        method: 'POST',
        body: JSON.stringify({ word }),
      });
      if (!result.ok) {
        setActionError(result.error ?? '新增违禁词失败，请重试。');
        return;
      }
      setDraft('');
      setNotice(`已添加违禁词“${result.data?.item?.word ?? word}”。`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (item: AdminBannedWordItem) => {
    if (busy || deleting) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const nextStatus = item.status === 'active' ? 'disabled' : 'active';
      const result = await request<{ item: AdminBannedWordItem | null }>(
        `/api/admin/community/banned-words?id=${encodeURIComponent(String(item.id))}`,
        { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) },
      );
      if (!result.ok) {
        setActionError(result.error ?? '更新违禁词状态失败，请重试。');
        return;
      }
      setNotice(nextStatus === 'disabled' ? `已停用违禁词“${item.word}”。` : `已启用违禁词“${item.word}”。`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    const item = pendingDelete;
    if (!item || deleting) return;
    setDeleting(true);
    setActionError('');
    setNotice('');
    try {
      const result = await request<{ deleted: boolean }>(
        `/api/admin/community/banned-words?id=${encodeURIComponent(String(item.id))}`,
        { method: 'DELETE' },
      );
      if (!result.ok) {
        setActionError(result.error ?? '删除违禁词失败，请重试。');
        return;
      }
      setPendingDelete(null);
      setNotice(`已删除违禁词“${item.word}”。`);
      await load();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section aria-label="违禁词库">
      <AdminToolbar>
        <h2>违禁词库</h2>
        <p>发布与编辑保存时会校验作品名称和标签；命中即拦截。修改后最多 5 分钟生效。</p>
      </AdminToolbar>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={draft}
          maxLength={100}
          disabled={busy || deleting}
          aria-label="新违禁词"
          placeholder="输入违禁词（1-100 字符）"
          onChange={(event) => { setDraft(event.target.value); setActionError(''); }}
          onKeyDown={(event) => { if (event.key === 'Enter') void add(); }}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-200 disabled:opacity-60"
        />
        <AdminButton variant="primary" busy={busy} onClick={() => void add()} disabled={deleting}>添加违禁词</AdminButton>
      </div>
      <p className="mt-2 text-xs text-slate-500" role="status">
        <ShieldAlert aria-hidden="true" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
        违禁词只在新增发布与编辑保存时拦截，不会回扫已有内容；词库缓存 5 分钟，修改后最多 5 分钟生效。
      </p>
      {notice && <AdminToast message={notice} onDismiss={() => setNotice('')} />}
      {actionError && <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">{actionError}</p>}
      {loading && !items ? <AdminLoading label="正在读取违禁词库…" />
        : error ? <AdminErrorState title="违禁词库暂不可用" message={error} retry={() => void load()} busy={loading} />
          : !items || items.length === 0 ? <AdminEmptyState title="词库为空" description="未配置违禁词时，所有标题与标签都会通过校验。" />
            : (
              <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white" aria-label="违禁词列表">
                {items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                    <span className="min-w-0 flex-1 break-words text-sm font-bold text-slate-900">{item.word}</span>
                    <AdminBadge tone={item.status === 'active' ? 'danger' : 'neutral'}>
                      {item.status === 'active' ? '生效中' : '已停用'}
                    </AdminBadge>
                    <span className="text-xs text-slate-500" title={item.updatedAt}>更新于 {item.updatedAt}</span>
                    <AdminButton
                      busy={busy}
                      onClick={() => void toggle(item)}
                      disabled={deleting}
                      aria-label={item.status === 'active' ? `停用违禁词 ${item.word}` : `启用违禁词 ${item.word}`}
                    >
                      {item.status === 'active' ? '停用' : '启用'}
                    </AdminButton>
                    <AdminButton
                      variant="ghost"
                      onClick={() => setPendingDelete(item)}
                      disabled={busy || deleting}
                      aria-label={`删除违禁词 ${item.word}`}
                    >
                      <Trash2 aria-hidden="true" />
                    </AdminButton>
                  </li>
                ))}
              </ul>
            )}
      <AdminConfirmDialog
        open={pendingDelete !== null}
        title="删除违禁词"
        description="删除后该词立即失去发布拦截能力（缓存最多 5 分钟）。"
        subject={pendingDelete?.word ?? ''}
        impact="已发布内容不受影响；确认后此词不再拦截新增发布与编辑。"
        confirmLabel="删除违禁词"
        pending={deleting}
        onClose={() => { if (!deleting) setPendingDelete(null); }}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
