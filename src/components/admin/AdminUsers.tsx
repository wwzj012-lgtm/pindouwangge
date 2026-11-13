import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, Eye, KeyRound, Plus, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AdminPasswordReset } from './AdminPasswordReset';
import { BatchActionBar } from './BatchActionBar';
import { CsvExportButton } from './CsvExportButton';
import type { AdminRequest } from './adminRequest';
import { adminPageCount, createFilterDebounce } from './adminPresentation';
import { AdminBadge, AdminButton, AdminConfirmDialog, AdminDrawer, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { AdminDataTable, type AdminDataTableColumn } from './shared/AdminDataTable';
import { AdminPagination } from './shared/AdminPagination';
import {
  LatestRequest, buildUserBatchBody, userOverview, dateText, emptyUserQuery, memberLabel, membershipDraft,
  membershipPresentation, membershipProposal, parseBatchOutcome, requestError, returnedExpiry, toggleUserSort,
  userLabel, userQueryString, type AdminTag, type AdminUser, type MembershipDraft, type UserDetail, type UserQuery,
  type UserSortBy, type UserStatus,
} from './adminUserModel';

const statusLabel = (status?: string) => status === 'banned' ? '已封禁' : status === 'suspended' ? '已暂停' : status === 'active' ? '正常' : '未提供';
function StatusBadge({ status }: { status?: string }) { return <AdminBadge tone={status === 'banned' ? 'danger' : status === 'suspended' ? 'warning' : status === 'active' ? 'success' : 'neutral'}>{statusLabel(status)}</AdminBadge>; }
interface UsersPage { items: AdminUser[]; total: number; limit: number; offset: number; }
interface Snapshot extends UsersPage { query: UserQuery; }

export function AdminUsers({ request }: { request: AdminRequest }) {
  const { currentUser } = useAuth();
  return currentUser ? <AdminUsersForAccount key={currentUser.uid} request={request} /> : null;
}
function AdminUsersForAccount({ request }: { request: AdminRequest; key?: string }) {
  const { currentUser } = useAuth();
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [draft, setDraft] = useState(emptyUserQuery);
  const [query, setQuery] = useState(emptyUserQuery);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [tags, setTags] = useState<AdminTag[]>([]), [tagError, setTagError] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [details, setDetails] = useState<Record<string, UserDetail>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const epoch = useRef(new LatestRequest()), tagEpoch = useRef(new LatestRequest());
  const trigger = useRef<HTMLElement | null>(null);
  const load = useCallback(async () => {
    const version = epoch.current.next(); setLoading(true); setError('');
    try {
      const result = await request<UsersPage>('/api/admin/users?' + userQueryString(query));
      if (!epoch.current.current(version)) return;
      if (!result.ok || !result.data || !Array.isArray(result.data.items)) { setError(requestError(result, '读取用户列表')); return; }
      if (query.page > adminPageCount(result.data.total, result.data.limit)) { setQuery(value => ({ ...value, page: adminPageCount(result.data!.total, result.data!.limit) })); return; }
      setSnapshot({ ...result.data, query: { ...query } });
    } catch { if (epoch.current.current(version)) setError('读取用户列表失败，请重试；输入和上次成功结果已保留。'); }
    finally { if (epoch.current.current(version)) setLoading(false); }
  }, [request, query]);
  const loadTags = useCallback(async () => {
    const version = tagEpoch.current.next(); setTagError('');
    try { const result = await request<{ items: AdminTag[] }>('/api/admin/user-tags'); if (!tagEpoch.current.current(version)) return; if (result.ok && result.data) setTags(result.data.items); else setTagError(requestError(result, '读取标签目录')); }
    catch { if (tagEpoch.current.current(version)) setTagError('标签目录读取失败，用户列表仍可使用。'); }
  }, [request]);
  useEffect(() => { void load(); return () => epoch.current.invalidate(); }, [load]);
  useEffect(() => { void loadTags(); return () => tagEpoch.current.invalidate(); }, [loadTags]);
  // ===== 筛选收敛（PRD B3）：去掉"查询"按钮，筛选变更 300ms 防抖后即时生效 =====
  const draftRef = useRef(draft);
  const applyDraft = useCallback(() => {
    const current = draftRef.current;
    setQuery({ ...current, search: current.search.trim(), page: 1 });
  }, []);
  const debouncer = useRef<ReturnType<typeof createFilterDebounce> | null>(null);
  if (!debouncer.current) debouncer.current = createFilterDebounce(applyDraft);
  const firstDraftRender = useRef(true);
  useEffect(() => {
    // 挂载时 draft === query，不触发自动刷新；之后每次变更重置 300ms 定时器。
    draftRef.current = draft;
    if (firstDraftRender.current) { firstDraftRender.current = false; return; }
    debouncer.current!.schedule();
  }, [draft]);
  useEffect(() => () => debouncer.current?.cancel(), []);
  const apply = () => { debouncer.current?.cancel(); applyDraft(); };
  const reset = () => { debouncer.current?.cancel(); setDraft(emptyUserQuery()); setQuery(emptyUserQuery()); setChecked(new Set()); };
  const toggleSort = (column: UserSortBy) => { debouncer.current?.cancel(); setChecked(new Set()); setQuery(current => ({ ...current, ...toggleUserSort(current, column), page: 1 })); };
  const toggleChecked = (uid: string) => setChecked(current => {
    const next = new Set(current);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  });
  const toggleAllChecked = () => setChecked(current => {
    if (snapshot && current.size >= snapshot.items.length) return new Set();
    return new Set((snapshot?.items ?? []).map(user => user.uid));
  });
  /** 批量执行：服务端逐条处理，结果展示在 BatchActionBar 弹窗里。 */
  const runBatch = async (actionKey: string, params: { reason: string }) => {
    const op = actionKey === 'ban' ? 'ban' as const : actionKey === 'unban' ? 'unban' as const : null;
    if (!op) return { outcome: null, error: '未知的批量动作' };
    const body = buildUserBatchBody(op, Array.from(checked), op === 'ban' ? { reason: params.reason } : undefined);
    setBatchBusy(true);
    try {
      const result = await request('/api/admin/batch', { method: 'POST', body: JSON.stringify(body) });
      const outcome = result.ok ? parseBatchOutcome(result.data) : null;
      if (!outcome) return { outcome: null, error: result.error ?? '批量结果无法解析，请稍后核对审计日志。' };
      await load();
      return { outcome };
    } finally { setBatchBusy(false); }
  };
  const open = (user: AdminUser) => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSelected(user); };
  const resetEntry = (user: AdminUser, disabled = false, icon = false) => icon
    ? <AdminButton data-user-reset-password={user.uid} iconOnly variant="ghost" disabled={disabled || user.uid === currentUser?.uid}
      title={user.uid === currentUser?.uid ? '不能重置当前管理员自己的密码' : '重置该用户登录密码'}
      aria-label={'重置 ' + userLabel(user) + ' 的密码'} onClick={() => setResetUser(user)}><KeyRound aria-hidden="true" /></AdminButton>
    : <AdminButton data-user-reset-password={user.uid} disabled={disabled || user.uid === currentUser?.uid} title={user.uid === currentUser?.uid ? '不能重置当前管理员自己的密码' : '重置该用户登录密码'} onClick={() => setResetUser(user)}><KeyRound aria-hidden="true" />重置密码</AdminButton>;
  const close = () => { setSelected(null); requestAnimationFrame(() => { if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); }); };
  const tagText = (user: AdminUser) => {
    const known = details[user.uid]?.tags ?? user.tags;
    return known ? known.length ? known.map(tag => tag.displayName).join('、') : '无标签' : '—';
  };
  const eligibility = (user: AdminUser) => { const view = membershipPresentation(user);
    const expiry = view.expiry === '空到期值' ? '无到期限制' : view.expiry;
    return <><span className="admin-eligibility">{view.effective}</span><small className="admin-cell-note" title={'接口付费字段 ' + view.paid + ' · 原到期值 ' + view.expiry}>{expiry}</small>{view.caveat && <small className="admin-cell-note">{view.caveat}</small>}</>; };
  // ===== 表格精修（密度改版）：账号列单行（姓名+邮箱+最多 2 个标签徽标，UID 进 tooltip），
  // 行内副信息（限制到期/到期值）改为同一行 .admin-cell-note，行高压到 ≤40px =====
  const userColumns: Array<AdminDataTableColumn<AdminUser>> = [
    {
      key: 'label',
      label: '用户 / 账号',
      render: user => {
        const tags = details[user.uid]?.tags ?? user.tags ?? [];
        return <div className="admin-user-cell" title={user.uid}>
          <strong>{userLabel(user)}</strong>
          <span className="admin-user-email">{user.email}</span>
          {tags.slice(0, 2).map(tag => <span className="admin-user-tag" key={tag.id}>{tag.displayName}</span>)}
        </div>;
      },
    },
    {
      key: 'status',
      label: '账号状态',
      render: user => <><StatusBadge status={user.moderation?.status} />{user.moderation?.expiresAt && <small className="admin-cell-note">限制至 {dateText(user.moderation.expiresAt)}</small>}</>,
    },
    { key: 'membership', label: '会员权益', render: user => eligibility(user) },
    {
      key: 'createdAt',
      label: '注册时间',
      sortable: true,
      sortDirection: snapshot?.query.sortBy === 'registered_at' ? snapshot.query.sortDir : null,
      render: user => <span title={user.createdAt == null ? '接口未返回注册时间' : undefined}>{dateText(user.createdAt)}</span>,
      header: <button type="button" data-sort-registered className="admin-sort-header" onClick={() => toggleSort('registered_at')}>注册时间{snapshot?.query.sortBy === 'registered_at' ? (snapshot.query.sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</button>,
    },
    {
      key: 'actions',
      label: '操作',
      sticky: 'right',
      render: user => <div className="admin-row-actions" style={{ display: 'flex', gap: 4 }}>
        <AdminButton data-user-open={user.uid} iconOnly variant="ghost" title="查看详情" aria-label={'查看 ' + userLabel(user) + ' 详情'} onClick={() => open(user)}><Eye aria-hidden="true" /></AdminButton>
        {resetEntry(user, false, true)}
      </div>,
    },
  ];
  return <section className="admin-users-page">
    <AdminToolbar actions={<><CsvExportButton type="users" label="导出用户 CSV" disabled={loading || batchBusy} /><AdminButton onClick={() => void load()} busy={loading}>刷新列表</AdminButton></>} />
    <div className="admin-stage-panel admin-user-filters" role="search" aria-label="用户查询">
      <label>搜索用户<input value={draft.search} maxLength={120} onChange={event => setDraft(current => ({ ...current, search: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (!loading) apply(); } }} placeholder="昵称、邮箱或 UID" /></label>
      <label>账号状态<select aria-label="账号状态筛选" value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value as UserStatus }))}><option value="all">所有状态</option><option value="active">正常</option><option value="suspended">暂停</option><option value="banned">封禁</option></select></label>
      <label>用户标签<select aria-label="用户标签筛选" value={draft.tag} onChange={event => setDraft(current => ({ ...current, tag: event.target.value }))}><option value="">所有标签</option>{tags.map(tag => <option key={tag.id} value={tag.key}>{tag.displayName}</option>)}</select></label>
      <label>角色<select data-filter-role aria-label="角色筛选" value={draft.role} onChange={event => setDraft(current => ({ ...current, role: event.target.value as UserQuery['role'] }))}><option value="">所有角色</option><option value="user">普通用户</option><option value="admin">管理员</option></select></label>
      <div className="admin-filter-actions"><AdminButton data-users-reset disabled={loading} onClick={reset}>重置</AdminButton></div>
      <details className="admin-more-filters" data-more-filters>
        <summary>更多筛选</summary>
        <div className="admin-more-filters-grid">
          <label>会员字段<select data-filter-vip aria-label="VIP 字段筛选" value={draft.vip} onChange={event => setDraft(current => ({ ...current, vip: event.target.value as UserQuery['vip'] }))}><option value="">全部（is_vip）</option><option value="true">is_vip 开</option><option value="false">is_vip 关</option></select></label>
          <label>付费级别<select data-filter-member-type aria-label="付费级别筛选" value={draft.memberType} onChange={event => setDraft(current => ({ ...current, memberType: event.target.value as UserQuery['memberType'] }))}><option value="">所有级别</option><option value="0">免费</option><option value="1">VIP</option><option value="2">商家 Pro</option></select></label>
          <label>注册起<input data-filter-registered-from type="date" aria-label="注册开始日期" value={draft.registeredFrom} onChange={event => setDraft(current => ({ ...current, registeredFrom: event.target.value }))} /></label>
          <label>注册止<input data-filter-registered-to type="date" aria-label="注册结束日期" value={draft.registeredTo} onChange={event => setDraft(current => ({ ...current, registeredTo: event.target.value }))} /></label>
          <label>排序字段<select data-filter-sort-by aria-label="排序字段" value={draft.sortBy} onChange={event => setDraft(current => ({ ...current, sortBy: event.target.value as UserSortBy }))}><option value="registered_at">注册时间</option><option value="credit_balance">可用积分</option></select></label>
          <label>排序方向<select data-filter-sort-dir aria-label="排序方向" value={draft.sortDir} onChange={event => setDraft(current => ({ ...current, sortDir: event.target.value as UserQuery['sortDir'] }))}><option value="desc">降序</option><option value="asc">升序</option></select></label>
        </div>
      </details>
    </div>
    <BatchActionBar
      selectedCount={checked.size}
      disabled={batchBusy}
      actions={[
        { key: 'ban', label: '封禁', requiresReason: true },
        { key: 'unban', label: '解封' },
      ]}
      onRun={runBatch}
      onClear={() => setChecked(new Set())}
    />
    {tagError && <AdminErrorState title="标签目录暂不可用" message={tagError} retry={() => void loadTags()} />}
    {error && <AdminErrorState title="未能更新用户列表" message={error + ' 上次成功列表及查询输入未丢弃。'} retry={() => void load()} busy={loading} />}
    <div className="admin-stage-panel admin-user-results" aria-busy={loading}>
      <p className="admin-result-caption" role="status">{loading ? '正在查询；已有列表暂时保留…' : snapshot ? '已读取 ' + snapshot.total + ' 名匹配用户。' : '尚无成功读取结果。'}{snapshot && error && ' 当前展示上次成功结果：' + (snapshot.query.search || '全部用户') + '，第' + snapshot.query.page + '页。'}</p>
      {!snapshot ? loading ? <AdminLoading label="正在读取用户列表…" /> : <AdminEmptyState title="尚无可显示结果" description="请重试读取；未知总数不会显示为零。" /> : snapshot.items.length === 0 ? <AdminEmptyState title="没有匹配的用户" description="调整查询条件，或重置后重试。" action={<AdminButton onClick={reset}>重置筛选</AdminButton>} /> : <>
        <div className="admin-users-table-wrap"><AdminDataTable columns={userColumns} rows={snapshot.items} rowKey={user => user.uid} ariaLabel="用户列表" minWidth={850}
          selectable
          selected={checked}
          selectAllLabel="全选本页"
          selectAllChecked={snapshot.items.length > 0 && checked.size >= snapshot.items.length}
          selectAllAttrs={{ 'data-users-select-all': '' }}
          onToggleAll={() => toggleAllChecked()}
          rowSelectLabel={user => '勾选 ' + userLabel(user)}
          rowSelectAttrs={user => ({ 'data-user-check': user.uid })}
          onToggleRow={user => toggleChecked(user.uid)}
          rowAttrs={user => ({ 'data-user-row': user.uid })} /></div>
        <div className="admin-user-cards">{snapshot.items.map(user => <article className="admin-user-card" key={user.uid}><div className="admin-card-heading"><strong>{userLabel(user)}</strong><StatusBadge status={user.moderation?.status} /></div><p>{user.email}</p><p className="admin-mono admin-uid" title={user.uid}>{user.uid.length > 13 ? user.uid.slice(0, 12) + '…' : user.uid}</p><div className="admin-card-membership">{eligibility(user)}</div><p>标签：{tagText(user)}</p><p title={user.lastActiveAt == null ? '接口未返回该用户的最近活动时间' : undefined}>最近活动：{dateText(user.lastActiveAt)}</p><div className="admin-final-actions"><AdminButton data-user-open={user.uid} onClick={() => open(user)}>详情</AdminButton>{resetEntry(user)}</div></article>)}</div>
      </>}
      {snapshot && <AdminPagination label="用户列表分页" total={snapshot.total} limit={snapshot.limit}
        offset={(snapshot.query.page - 1) * snapshot.limit} busy={loading || Boolean(error)}
        onPageChange={nextOffset => setQuery({ ...query, page: Math.floor(nextOffset / snapshot.limit) + 1 })} />}
    </div>
    <p className="admin-stage-footnote">筛选变更后 300ms 自动生效，无需提交。账号列单行展示姓名与邮箱，标签最多内联 2 个小徽标，完整 UID 悬停可见；列表接口未返回时显示 —。排序仅支持注册时间与可用积分。勾选行后可批量封禁/解封；批量操作逐条提交，结果以服务端为准。</p>
    {selected && <UserDetailDrawer key={selected.uid} user={selected} tags={tags} request={request} onClose={close} onRead={value => setDetails(current => ({ ...current, [value.user.uid]: value }))} onChanged={() => void load()} resetEntry={resetEntry} />}
    {resetUser && <AdminPasswordReset key={resetUser.uid} user={resetUser} currentUserUid={currentUser?.uid} request={request} onClose={() => setResetUser(null)} />}
  </section>;
}

interface DrawerProps { user: AdminUser; tags: AdminTag[]; request: AdminRequest; onClose: () => void; onRead: (detail: UserDetail) => void; onChanged: () => void; resetEntry: (user: AdminUser, disabled?: boolean, icon?: boolean) => React.ReactNode; key?: string; }
/** 仅危险操作（封禁/暂停）保留二次确认；确认负载结构保持不变。 */
type Confirmation = { kind: 'moderation'; payload: { userUid: string; action: string; reason: string; expiresAt?: number } };
/** 行内撤销 toast：普通操作直接执行后 5 秒内可撤销。 */
interface UndoToastState { message: string; undo?: () => void; }
function UserDetailDrawer({ user, tags, request, onClose, onRead, onChanged, resetEntry }: DrawerProps) {
  const [detail, setDetail] = useState<UserDetail | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [draft, setDraft] = useState<MembershipDraft>(() => membershipDraft(user));
  const [note, setNote] = useState(''), [tagId, setTagId] = useState('');
  const [action, setAction] = useState(''), [reason, setReason] = useState(''), [suspendDays, setSuspendDays] = useState('7');
  const [busy, setBusy] = useState(false), [needsRead, setNeedsRead] = useState(false), [success, setSuccess] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null), [closeConfirm, setCloseConfirm] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [undoToast, setUndoToast] = useState<UndoToastState | null>(null);
  const epoch = useRef(new LatestRequest()), writing = useRef(false), initial = useRef(true), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!undoToast) return;
    const timer = setTimeout(() => setUndoToast(null), 5000);
    return () => clearTimeout(timer);
  }, [undoToast]);
  const read = useCallback(async (): Promise<boolean> => {
    const version = epoch.current.next(); setLoading(true); setError('');
    try {
      const result = await request<UserDetail>('/api/admin/users/detail?uid=' + encodeURIComponent(user.uid));
      if (!epoch.current.current(version)) return false;
      if (!result.ok || !result.data || result.data.user.uid !== user.uid) { setError(requestError(result, '读取用户详情')); return false; }
      setDetail(result.data); onRead(result.data); setNeedsRead(false);
      if (initial.current) { setDraft(membershipDraft(result.data.user)); initial.current = false; }
      return true;
    } catch { if (epoch.current.current(version)) setError('用户详情读取失败，编辑内容保留，可重试。'); return false; }
    finally { if (epoch.current.current(version)) setLoading(false); }
  }, [request, user.uid]);
  useEffect(() => { void read(); return () => epoch.current.invalidate(); }, [read]);
  const proposal = membershipProposal(detail?.user ?? user, draft);
  const dirty = proposal.changed || draft.expiry !== 'keep' || Boolean(note.trim() || tagId || action || reason.trim());
  const close = () => { if (writing.current) return; if (dirty) setCloseConfirm(true); else onClose(); };
  /** 写操作：成功后弹行内 toast；提供 undo 时 5 秒内可一键撤销。 */
  const mutate = async (path: string, init: RequestInit, message: string, reset: () => void, undo?: () => void) => {
    if (writing.current || needsRead) return; writing.current = true; setBusy(true); setError(''); setSuccess('');
    try {
      const result = await request(path, init);
      if (!alive.current) return;
      if (!result.ok) { setError(requestError(result, message)); return; }
      reset(); setConfirmation(null); setSuccess(message + '已成功。');
      setUndoToast({ message: message + '已成功', undo });
      if (!(await read()) && alive.current) { setNeedsRead(true); setSuccess(message + '已成功，但详情刷新失败；请重试读取，不要重复提交。'); }
      if (alive.current) onChanged();
    } catch { if (alive.current) setError(message + '失败，输入保持不变，可重试。'); }
    finally { writing.current = false; if (alive.current) setBusy(false); }
  };
  // ===== 交互简化（PRD C）：会员权益修改 / 标签移除 / 解封直接执行，免弹窗 =====
  const applyMembership = () => {
    if (!detail || !proposal.updates) return;
    const beforeType = proposal.beforeType, beforeExpiry = proposal.beforeExpiry;
    void mutate('/api/admin/update-user', { method: 'POST', body: JSON.stringify({ uid: user.uid, updates: proposal.updates }) }, '会员权益修改', () => { setDraft({ type: proposal.type, expiry: 'keep', days: '30' }); setFormVersion(v => v + 1); },
      beforeType === undefined ? undefined : () => {
        // 撤销：把修改前的接口原值原样提交回去。
        void mutate('/api/admin/update-user', { method: 'POST', body: JSON.stringify({ uid: user.uid, updates: { member_type: beforeType, member_expire: beforeExpiry, member_source: '后台用户管理' } }) }, '撤销会员权益修改', () => {});
      });
  };
  const submitConfirmation = () => {
    if (!confirmation || !detail) return;
    if (confirmation.kind === 'moderation') void mutate('/api/admin/users/moderation', { method: 'POST', body: JSON.stringify(confirmation.payload) }, '账号限制处理', () => { setAction(''); setReason(''); });
  };
  const moderationReview = () => {
    if (!action) return;
    if (action === 'unban') {
      // 解封是普通操作：直接执行 + 行内撤销（恢复原限制状态由服务端记录，不做反向猜测）。
      void mutate('/api/admin/users/moderation', { method: 'POST', body: JSON.stringify({ userUid: user.uid, action, reason: reason.trim() }) }, '解除账号限制', () => { setAction(''); setReason(''); });
      return;
    }
    if (!reason.trim()) { setError('请填写处理原因。'); return; }
    setConfirmation({ kind: 'moderation', payload: { userUid: user.uid, action, reason: reason.trim(), ...(action === 'suspend' ? { expiresAt: Date.now() + Number(suspendDays) * 86_400_000 } : {}) } });
  };
  const removeTag = (tag: { id: string; displayName: string }) => {
    void mutate('/api/admin/user-tags/assign?userUid=' + encodeURIComponent(user.uid) + '&tagId=' + encodeURIComponent(tag.id), { method: 'DELETE' }, '标签移除', () => {}, () => {
      void mutate('/api/admin/user-tags/assign', { method: 'POST', body: JSON.stringify({ userUid: user.uid, tagId: tag.id }) }, '撤销标签移除', () => {});
    });
  };
  const view = membershipPresentation(detail?.user ?? user);
  const disabled = busy || loading || needsRead;
  const currentTags = detail?.tags ?? [], assigned = new Set(currentTags.map(tag => tag.id));
  const confirmTitle = '确认账号限制';
  return <>
    <AdminDrawer open title="用户详情" description={userLabel(user) + ' · ' + user.uid} className="admin-user-drawer" pending={busy} onClose={close}>
      {success && <p className="admin-success-message" role="status">{success}</p>}
      {error && <AdminErrorState title="操作尚未完成" message={error} retry={() => void read()} busy={busy || loading} />}
      {!detail ? loading ? <AdminLoading label="正在读取用户详情…" /> : <AdminEmptyState title="无法读取该用户" description="接口未返回详情；不会按列表信息编造。" /> : <>
        <UserOperationsOverview detail={detail} />
        <section className="admin-detail-section"><h2>账号安全</h2><div className="admin-reset-entry">{resetEntry(detail.user, disabled)}</div></section>
        <section className="admin-detail-section"><h2>会员权益</h2><div className="admin-info-box"><p>当前接口付费字段：<strong>{view.paid}</strong></p><p>当前到期值：{view.expiry}</p>{detail.user.role === 'admin' && <p>Pro来自管理员角色，不代表付费Pro，也不会写回付费字段。</p>}{view.caveat && <p>{view.caveat}</p>}</div>
          <div className="admin-form-grid" key={formVersion}>
            <label>将提交的付费级别<select data-membership-type value={draft.type} disabled={disabled} onChange={event => setDraft(current => ({ ...current, type: Number(event.target.value) as 0 | 1 | 2 }))}>{draft.type === '' && <option value="">未提供，请选择</option>}<option value={0}>免费</option><option value={1}>VIP</option><option value={2}>商家 Pro</option></select></label>
            <label>到期处理<select data-membership-expiry value={draft.expiry} disabled={disabled} onChange={event => setDraft(current => ({ ...current, expiry: event.target.value as MembershipDraft['expiry'] }))}><option value="keep">保留原到期值（不续期）</option>{draft.type === 0 ? <option value="lifetime">明确清空付费到期值</option> : <><option value="days">从本次确认时刻起设置天数</option><option value="lifetime">永久（无到期时间）</option></>}</select></label>
            {draft.type !== 0 && draft.expiry === 'days' && <label>有效天数<select data-membership-days value={draft.days} disabled={disabled} onChange={event => setDraft(current => ({ ...current, days: event.target.value }))}>{['7','30','90','365'].map(value => <option key={value} value={value}>{value}天</option>)}</select></label>}
          </div>{proposal.error && proposal.changed && <p className="admin-field-error">{proposal.error}</p>}
          <AdminButton data-membership-review disabled={disabled || !proposal.updates} onClick={applyMembership}>应用会员权益变更</AdminButton>
          {!proposal.changed && <p className="admin-stage-footnote">没有资格或到期变化，不会提交或默认重设30天。</p>}
        </section>
        <section className="admin-detail-section"><h2>标签与内部备注</h2><div className="admin-tag-list">{currentTags.length ? currentTags.map(tag => <span className="admin-detail-tag" key={tag.id}>{tag.displayName}<AdminButton iconOnly variant="ghost" aria-label={'移除标签' + tag.displayName} disabled={disabled} onClick={() => removeTag(tag)}><X aria-hidden="true" /></AdminButton></span>) : <p className="admin-muted">暂无标签</p>}</div>
          <div className="admin-inline-form"><label>添加标签<select value={tagId} disabled={disabled} onChange={event => setTagId(event.target.value)}><option value="">选择标签</option>{tags.filter(tag => !assigned.has(tag.id)).map(tag => <option key={tag.id} value={tag.id}>{tag.displayName}</option>)}</select></label><AdminButton disabled={disabled || !tagId} onClick={() => void mutate('/api/admin/user-tags/assign', { method: 'POST', body: JSON.stringify({ userUid: user.uid, tagId }) }, '标签分配', () => setTagId(''))}><Plus aria-hidden="true" />添加</AdminButton></div>
          <div className="admin-note-list">{detail.notes.length ? detail.notes.map(item => <article key={item.id}><p>{item.content}</p><small>{dateText(item.createdAt)} · {item.authorUid ?? '作者未提供'}</small></article>) : <p className="admin-muted">暂无内部备注</p>}</div>
          <label className="admin-stage-field">新备注<textarea data-user-note value={note} maxLength={4000} disabled={disabled} onChange={event => setNote(event.target.value)} placeholder="仅管理员可见的备注" /></label><AdminButton data-note-save disabled={disabled || !note.trim()} onClick={() => void mutate('/api/admin/user-notes', { method: 'POST', body: JSON.stringify({ userUid: user.uid, content: note.trim() }) }, '备注添加', () => setNote(''))}>添加备注</AdminButton>
        </section>
        <section className="admin-detail-section admin-danger-zone"><h2>账号限制 · 危险操作</h2><p>当前：{statusLabel(detail.moderation.status)}；{detail.moderation.reason || '没有处理原因记录'}</p>
          <label className="admin-stage-field">拟执行动作<select data-moderation-action value={action} disabled={disabled} onChange={event => setAction(event.target.value)}><option value="">请选择，不自动执行</option>{detail.moderation.status !== 'banned' && <option value="ban">封禁账号</option>}{detail.moderation.status === 'active' && <option value="suspend">暂停账号</option>}{detail.moderation.status !== 'active' && <option value="unban">解除限制</option>}</select></label>
          {action && action !== 'unban' && <label className="admin-stage-field">处理原因<textarea value={reason} maxLength={1000} disabled={disabled} onChange={event => setReason(event.target.value)} placeholder="填写处理原因" /></label>}
          {action === 'suspend' && <label className="admin-stage-field">暂停天数<select value={suspendDays} disabled={disabled} onChange={event => setSuspendDays(event.target.value)}>{['1','7','30'].map(value => <option key={value} value={value}>{value}天</option>)}</select></label>}
          <AdminButton data-moderation-review variant="danger" disabled={disabled || !action || action !== 'unban' && !reason.trim()} onClick={moderationReview}><Ban aria-hidden="true" />{action === 'unban' ? '解除限制' : '查看影响并确认'}</AdminButton>
        </section>
      </>}
    </AdminDrawer>
    <AdminConfirmDialog open={Boolean(confirmation)} title={confirmTitle} description="请核对目标用户、影响与待提交值。"
      subject={userLabel(user) + ' · ' + user.email + ' · UID：' + user.uid}
      impact="改变该用户的账号限制；保留用户、图纸和会员字段。"
      reason={confirmation?.payload.reason || undefined}
      pending={busy} confirmLabel="确认提交" onClose={() => setConfirmation(null)} onConfirm={submitConfirmation}>
      {confirmation?.payload.action === 'suspend' && <div className="admin-change-summary"><p>限制到期：{dateText(confirmation.payload.expiresAt)}</p></div>}
      {error && <AdminErrorState message={error} />}
    </AdminConfirmDialog>
    <AdminConfirmDialog open={closeConfirm} title="放弃未保存编辑？" description={'对象：' + userLabel(user) + '。关闭会丢弃尚未提交的权益、备注或限制输入。'} confirmLabel="放弃并关闭" onClose={() => setCloseConfirm(false)} onConfirm={onClose} />
    {undoToast && <div className="admin-undo-toast" role="status" data-undo-toast>
      <span>{undoToast.message}</span>
      {undoToast.undo && <AdminButton onClick={() => { const undo = undoToast.undo; setUndoToast(null); undo?.(); }}>撤销</AdminButton>}
    </div>}
  </>;
}

export function UserOperationsOverview({ detail }: { detail: UserDetail }) {
  const summary = userOverview(detail), membership = membershipPresentation(detail.user);
  const ledger = detail.recentCreditLedger ?? [];
  return <section className="admin-detail-section" aria-label="用户详情运营总览"><h2>用户详情运营总览</h2>
    <dl className="admin-detail-facts">
      <div><dt>账号</dt><dd>{detail.user.email}</dd></div><div><dt>UID</dt><dd className="admin-mono">{detail.user.uid}</dd></div>
      <div><dt>可用积分（只读）</dt><dd data-user-credit-balance>{summary.available}</dd></div>
      <div><dt>冻结积分（只读）</dt><dd>{summary.held}</dd></div>
      <div><dt>积分账户更新时间</dt><dd>{dateText(detail.credits?.updatedAt)}</dd></div>
      <div><dt>图纸数（未删除）</dt><dd data-user-works-count>{Number.isSafeInteger(detail.worksCount) && detail.worksCount! >= 0 ? String(detail.worksCount) : summary.works}</dd></div>
      <div><dt>公开社区帖数</dt><dd data-user-posts-count>{Number.isSafeInteger(detail.postsCount) && detail.postsCount! >= 0 ? String(detail.postsCount) : summary.posts}</dd></div>
      <div><dt>最近活跃（登录/发帖/作品取最大）</dt><dd data-user-last-active>{dateText(detail.lastActiveAt)}</dd></div>
      <div><dt>最近内容活动</dt><dd>{summary.activity}</dd></div>
      <div><dt>会员有效权益</dt><dd>{membership.effective}</dd></div><div><dt>付费级别 / 到期</dt><dd>{membership.paid} / {membership.expiry === '空到期值' ? '无到期限制' : membership.expiry}</dd></div>
      <div><dt>账号限制</dt><dd><StatusBadge status={detail.moderation.status} />{detail.moderation.reason && <p>{detail.moderation.reason}</p>}<p>限制到期：{detail.moderation.expiresAt == null ? '无到期时间' : dateText(detail.moderation.expiresAt)}</p></dd></div>
      <div><dt>注册方式 / 当前认证来源</dt><dd>{summary.provider}</dd></div>
      <div><dt>注册时间</dt><dd>{dateText(detail.user.createdAt)}</dd></div><div><dt>资料更新时间</dt><dd>{dateText(detail.user.updatedAt)}</dd></div>
    </dl>
    <h3>最近管理员积分调整（最多 10 条）</h3>
    {ledger.length ? <ul className="admin-ledger-list" data-recent-credit-ledger>{ledger.map(item => <li key={item.id}>
      <span data-ledger-delta={item.deltaUnits > 0 ? 'plus' : 'minus'}>{item.deltaUnits > 0 ? '+' : ''}{item.deltaUnits}</span>
      <span>{item.reason}</span>
      <small>{dateText(item.createdAt)} · {item.beforeAvailableUnits} → {item.afterAvailableUnits}</small>
    </li>)}</ul> : <p className="admin-muted">暂无积分调整记录（或积分账本尚未启用）。</p>}
    <p className="admin-stage-footnote">{detail.activityScope || '活动统计口径未提供。'}；当前认证来源不代表历史注册方式。积分仅展示账户记录，不触发结算或调整。</p>
  </section>;
}
