import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import type { AdminRequest } from './adminRequest';
import { AdminButton, AdminConfirmDialog, AdminErrorState, AdminToolbar } from './AdminPrimitives';
import { AdminToast } from './shared/AdminToast';
import { AdminStatusBadge } from './shared/StatusBadge';
import { AdminDataTable, type AdminDataTableColumn } from './shared/AdminDataTable';
import { EmptyState } from './shared/EmptyState';
import { LoadingSkeleton } from './shared/LoadingSkeleton';

/**
 * 批次 5：标签字典治理面板（新 SectionId：tagDictionary）。
 *
 * - GET /api/admin/community/tags/dictionary  全量字典（含 status='hidden'，cap community.read）；
 * - PUT /api/admin/community/tags/dictionary  改展示名 / 隐藏 / 恢复（cap tags.write，
 *   defineAdminWrite 埋点，后端即时生效：前台只读 active 行）。
 *
 * 风格对齐 AdminBannedWords：直接操作 + 操作后刷新；隐藏走确认弹窗。
 */

export type TagDictionaryStatus = 'active' | 'hidden';

export interface TagDictionaryItem {
  tag: string;
  name: string;
  usageCount: number;
  status: TagDictionaryStatus;
  createdAt: string;
}

interface TagDictionaryPage { items: TagDictionaryItem[]; total: number; limit: number; offset: number }

/** 列表查询串：status 默认 all（含已隐藏），limit 有服务端上限 500。 */
export function tagDictionaryQuery(status: 'all' | TagDictionaryStatus = 'all', limit = 500, offset = 0): string {
  const params = new URLSearchParams({ status, limit: String(limit), offset: String(offset) });
  return `?${params.toString()}`;
}

/** 更新请求体：name 与 status 至少给一项（与后端 parseTagUpdateBody 对齐）。 */
export function tagUpdateBody(tag: string, patch: { name?: string; status?: TagDictionaryStatus }): Record<string, unknown> {
  const body: Record<string, unknown> = { tag };
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.status !== undefined) body.status = patch.status;
  return body;
}

export function AdminCommunityTagDictionary({ request, initialItems }: { request: AdminRequest; initialItems?: TagDictionaryItem[] }) {
  const [items, setItems] = useState<TagDictionaryItem[] | null>(initialItems ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [savingTag, setSavingTag] = useState<string | null>(null);
  const [pendingHide, setPendingHide] = useState<TagDictionaryItem | null>(null);
  const [hiding, setHiding] = useState(false);
  const epoch = useRef(0);

  const load = useCallback(async () => {
    const version = ++epoch.current;
    setLoading(true);
    setError('');
    try {
      const result = await request<TagDictionaryPage>('/api/admin/community/tags/dictionary' + tagDictionaryQuery());
      if (version !== epoch.current) return;
      if (result.ok && result.data && Array.isArray(result.data.items)) {
        setItems(result.data.items);
        setNameDrafts(Object.fromEntries(result.data.items.map(item => [item.tag, item.name])));
        return;
      }
      setError(result.error ?? '读取标签字典失败，请重试。');
    } catch {
      if (version === epoch.current) setError('读取标签字典失败，请检查网络后重试。');
    } finally {
      if (version === epoch.current) setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); return () => { epoch.current++; }; }, [load]);

  const updateTag = useCallback(async (item: TagDictionaryItem, patch: { name?: string; status?: TagDictionaryStatus }, message: string) => {
    setSavingTag(item.tag);
    setActionError('');
    setNotice('');
    try {
      const result = await request<{ tag: string; name: string; status: TagDictionaryStatus }>(
        '/api/admin/community/tags/dictionary',
        { method: 'PUT', body: JSON.stringify(tagUpdateBody(item.tag, patch)) },
      );
      if (!result.ok) { setActionError(`更新标签「${item.tag}」失败：` + (result.error ?? '请重试')); return false; }
      setNotice(message);
      await load();
      return true;
    } catch {
      setActionError(`更新标签「${item.tag}」请求失败，请检查网络后重试。`);
      return false;
    } finally { setSavingTag(null); }
  }, [load]);

  const rename = (item: TagDictionaryItem) => {
    const draft = (nameDrafts[item.tag] ?? '').trim();
    if (!draft) { setActionError('展示名不能为空。'); return; }
    if (draft === item.name) { setNotice(`标签「${item.tag}」展示名未变化。`); return; }
    void updateTag(item, { name: draft }, `已更新标签「${item.tag}」的展示名为「${draft}」。`);
  };

  const confirmHide = async () => {
    const item = pendingHide;
    if (!item || hiding) return;
    setHiding(true);
    const nextStatus: TagDictionaryStatus = item.status === 'hidden' ? 'active' : 'hidden';
    const ok = await updateTag(item, { status: nextStatus },
      nextStatus === 'hidden' ? `已隐藏标签「${item.tag}」；前台发布器与筛选不再返回（存量帖子上的标签保留）。` : `已恢复标签「${item.tag}」，前台立即可见。`);
    if (ok) setPendingHide(null);
    setHiding(false);
  };

  const columns: Array<AdminDataTableColumn<TagDictionaryItem>> = [
    { key: 'tag', label: '标签', render: item => <span className="admin-mono admin-tag-key">{item.tag}</span> },
    {
      key: 'name',
      label: '展示名',
      render: item => <span className="admin-tag-name-editor">
        <input data-tag-name={item.tag} value={nameDrafts[item.tag] ?? item.name} maxLength={48} aria-label={'展示名 ' + item.tag}
          disabled={savingTag !== null}
          onChange={event => setNameDrafts(current => ({ ...current, [item.tag]: event.target.value }))}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); rename(item); } }} />
        <AdminButton data-tag-rename={item.tag} iconOnly aria-label={'保存展示名 ' + item.tag} disabled={savingTag !== null}
          onClick={() => rename(item)}><Save aria-hidden="true" /></AdminButton>
      </span>,
    },
    { key: 'usageCount', label: '使用次数', numeric: true, width: '110px', render: item => String(item.usageCount) },
    {
      key: 'status',
      label: '状态',
      width: '110px',
      render: item => <AdminStatusBadge status={item.status} label={item.status === 'active' ? '前台可见' : '已隐藏'} />,
    },
    {
      key: 'actions',
      label: '操作',
      sticky: 'right',
      width: '110px',
      render: item => <AdminButton data-tag-toggle={item.tag} variant={item.status === 'active' ? 'danger-quiet' : 'secondary'}
        disabled={savingTag !== null} aria-label={item.status === 'active' ? '隐藏标签 ' + item.tag : '恢复标签 ' + item.tag}
        onClick={() => setPendingHide(item)}>{item.status === 'active' ? '隐藏' : '恢复'}</AdminButton>,
    },
  ];

  return <section aria-label="标签字典" aria-busy={loading}>
    <AdminToolbar actions={<AdminButton busy={loading} onClick={() => void load()}>刷新字典</AdminButton>}>
      <h2>标签字典</h2>
      <p>改展示名或隐藏标签即时生效；隐藏后前台发布器与筛选不再返回，存量帖子上的标签保留不回扫。</p>
    </AdminToolbar>
    {notice && <AdminToast message={notice} onDismiss={() => setNotice('')} />}
    {actionError && <AdminErrorState title="标签更新未完成" message={actionError} retry={() => void load()} busy={loading || savingTag !== null} />}
    {error && <AdminErrorState title="标签字典暂不可用" message={error} retry={() => void load()} busy={loading} />}
    {!items ? loading ? <LoadingSkeleton rows={6} columns={5} ariaLabel="正在读取标签字典…" />
      : <EmptyState title="尚无成功读取结果" description="请重试读取；失败不会当作空字典。" />
      : items.length === 0
        ? <EmptyState title="标签字典为空" description="用户发布帖子使用的标签会自动进入字典。" scope="tag-dictionary" />
        : <div className="admin-stage-panel" aria-busy={loading}>
          <AdminDataTable columns={columns} rows={items} rowKey={item => item.tag} ariaLabel="标签字典列表"
            rowAttrs={item => ({ 'data-tag-row': item.tag })} />
          <p className="admin-stage-footnote">共 {items.length} 条（含已隐藏）；使用次数为后台校准值，展示名与启停状态更新后立即对前台生效。</p>
        </div>}
    <AdminConfirmDialog open={Boolean(pendingHide)}
      title={pendingHide?.status === 'active' ? '隐藏标签' : '恢复标签'}
      description={pendingHide?.status === 'active'
        ? '隐藏后前台发布器与筛选抽屉不再返回该标签；存量帖子上的标签保留，不回扫。'
        : '恢复后该标签重新出现在前台发布器与筛选抽屉。'}
      subject={pendingHide ? `${pendingHide.tag}（当前展示名：${pendingHide.name}）` : ''}
      impact={pendingHide?.status === 'active' ? '新发布与筛选不再提供该标签；已发布内容不受影响。' : '变更立即对前台生效。'}
      confirmLabel={pendingHide?.status === 'active' ? '确认隐藏' : '确认恢复'}
      pending={hiding}
      onClose={() => { if (!hiding) setPendingHide(null); }}
      onConfirm={() => void confirmHide()}
    />
  </section>;
}
