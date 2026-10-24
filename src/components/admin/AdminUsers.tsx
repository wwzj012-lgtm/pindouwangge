import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, ChevronLeft, ChevronRight, KeyRound, Plus, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AdminPasswordReset } from './AdminPasswordReset';
import type { AdminRequest } from './adminRequest';
import { adminPageCount } from './adminPresentation';
import { AdminBadge, AdminButton, AdminConfirmDialog, AdminDrawer, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { LatestRequest, dateText, emptyUserQuery, memberLabel, membershipDraft, membershipPresentation, membershipProposal, requestError, returnedExpiry, userLabel, userQueryString, type AdminTag, type AdminUser, type MembershipDraft, type UserDetail, type UserQuery, type UserStatus } from './adminUserModel';

const statusLabel = (status?: string) => status === 'banned' ? '已封禁' : status === 'suspended' ? '已暂停' : status === 'active' ? '正常' : '未提供';
function StatusBadge({ status }: { status?: string }) { return <AdminBadge tone={status === 'banned' ? 'danger' : status === 'suspended' ? 'warning' : status === 'active' ? 'success' : 'neutral'}>{statusLabel(status)}</AdminBadge>; }
interface UsersPage { items: AdminUser[]; total: number; limit: number; offset: number; }
interface Snapshot extends UsersPage { query: UserQuery; }

export function AdminUsers({ request }: { request: AdminRequest }) {
  const { currentUser } = useAuth();
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [draft, setDraft] = useState(emptyUserQuery);
  const [query, setQuery] = useState(emptyUserQuery);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [tags, setTags] = useState<AdminTag[]>([]), [tagError, setTagError] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [details, setDetails] = useState<Record<string, UserDetail>>({});
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
  const apply = () => setQuery({ ...draft, search: draft.search.trim(), page: 1 });
  const reset = () => { setDraft(emptyUserQuery()); setQuery(emptyUserQuery()); };
  const open = (user: AdminUser) => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSelected(user); };
  const resetEntry = (user: AdminUser, disabled = false) => <AdminButton data-user-reset-password={user.uid} disabled={disabled || user.uid === currentUser?.uid} title={user.uid === currentUser?.uid ? '不能重置当前管理员自己的密码' : '重置该用户登录密码'} onClick={() => setResetUser(user)}><KeyRound aria-hidden="true" />重置密码</AdminButton>;
  const close = () => { setSelected(null); requestAnimationFrame(() => { if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); }); };
  const tagText = (user: AdminUser) => {
    const known = details[user.uid]?.tags ?? user.tags;
    return known ? known.length ? known.map(tag => tag.displayName).join('、') : '无标签' : '详情可查看';
  };
  const eligibility = (user: AdminUser) => { const view = membershipPresentation(user); return <><span className="admin-eligibility">{view.effective}</span><small>接口付费字段：{view.paid}</small><small>{view.expiry}</small>{view.caveat && <small>{view.caveat}</small>}</>; };
  return <section className="admin-users-page">
    <AdminToolbar actions={<AdminButton onClick={() => void load()} busy={loading}>刷新列表</AdminButton>}><h2>用户与会员</h2><p>账号限制与会员资格分开展示；查询仅在提交后生效。</p></AdminToolbar>
    <div className="admin-stage-panel admin-user-filters" role="search" aria-label="用户查询">
      <label>搜索用户<input value={draft.search} maxLength={120} onChange={event => setDraft(current => ({ ...current, search: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (!loading) apply(); } }} placeholder="昵称、邮箱或 UID" /></label>
      <label>账号状态<select aria-label="账号状态筛选" value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value as UserStatus }))}><option value="all">所有状态</option><option value="active">正常</option><option value="suspended">暂停</option><option value="banned">封禁</option></select></label>
      <label>用户标签<select aria-label="用户标签筛选" value={draft.tag} onChange={event => setDraft(current => ({ ...current, tag: event.target.value }))}><option value="">所有标签</option>{tags.map(tag => <option key={tag.id} value={tag.key}>{tag.displayName}</option>)}</select></label>
      <div className="admin-filter-actions"><AdminButton data-users-query disabled={loading} variant="primary" onClick={apply}>查询</AdminButton><AdminButton data-users-reset disabled={loading} onClick={reset}>重置</AdminButton></div>
    </div>
    {tagError && <AdminErrorState title="标签目录暂不可用" message={tagError} retry={() => void loadTags()} />}
    {error && <AdminErrorState title="未能更新用户列表" message={error + ' 上次成功列表及查询输入未丢弃。'} retry={() => void load()} busy={loading} />}
    <div className="admin-stage-panel admin-user-results" aria-busy={loading}>
      <p className="admin-result-caption" role="status">{loading ? '正在查询；已有列表暂时保留…' : snapshot ? '已读取 ' + snapshot.total + ' 名匹配用户。' : '尚无成功读取结果。'}{snapshot && error && ' 当前展示上次成功结果：' + (snapshot.query.search || '全部用户') + '，第' + snapshot.query.page + '页。'}</p>
      {!snapshot ? loading ? <AdminLoading label="正在读取用户列表…" /> : <AdminEmptyState title="尚无可显示结果" description="请重试读取；未知总数不会显示为零。" /> : snapshot.items.length === 0 ? <AdminEmptyState title="没有匹配的用户" description="调整查询条件，或重置后重试。" action={<AdminButton onClick={reset}>重置筛选</AdminButton>} /> : <>
        <div className="admin-users-table-wrap"><table className="admin-stage-table" aria-label="用户列表"><thead><tr><th>用户 / 账号</th><th>账号状态</th><th>会员权益 / 付费字段</th><th>标签</th><th>最近活动</th><th>操作</th></tr></thead><tbody>{snapshot.items.map(user => <tr key={user.uid} data-user-row={user.uid}>
          <td><strong>{userLabel(user)}</strong><small>{user.email}</small><small className="admin-mono">{user.uid}</small></td>
          <td><StatusBadge status={user.moderation?.status} />{user.moderation?.expiresAt && <small>限制至 {dateText(user.moderation.expiresAt)}</small>}</td>
          <td>{eligibility(user)}</td><td><span className="admin-tag-summary">{tagText(user)}</span></td><td>{dateText(user.lastActiveAt)}{user.lastActiveAt == null && <small>接口未提供</small>}</td>
          <td><div className="admin-final-actions"><AdminButton data-user-open={user.uid} onClick={() => open(user)}>详情</AdminButton>{resetEntry(user)}</div></td>
        </tr>)}</tbody></table></div>
        <div className="admin-user-cards">{snapshot.items.map(user => <article className="admin-user-card" key={user.uid}><div className="admin-card-heading"><strong>{userLabel(user)}</strong><StatusBadge status={user.moderation?.status} /></div><p>{user.email}</p><p className="admin-mono">{user.uid}</p><div className="admin-card-membership">{eligibility(user)}</div><p>标签：{tagText(user)}</p><p>最近活动：{user.lastActiveAt == null ? '接口未提供' : dateText(user.lastActiveAt)}</p><div className="admin-final-actions"><AdminButton data-user-open={user.uid} onClick={() => open(user)}>详情</AdminButton>{resetEntry(user)}</div></article>)}</div>
      </>}
      {snapshot && <div className="admin-pagination"><span>共 {snapshot.total} 名 · 第 {snapshot.query.page} / {adminPageCount(snapshot.total, snapshot.limit)} 页</span><div><AdminButton iconOnly aria-label="上一页" disabled={loading || Boolean(error) || snapshot.query.page <= 1} onClick={() => setQuery({ ...query, page: snapshot.query.page - 1 })}><ChevronLeft aria-hidden="true" /></AdminButton><AdminButton iconOnly aria-label="下一页" disabled={loading || Boolean(error) || snapshot.query.page >= adminPageCount(snapshot.total, snapshot.limit)} onClick={() => setQuery({ ...query, page: snapshot.query.page + 1 })}><ChevronRight aria-hidden="true" /></AdminButton></div></div>}
    </div>
    <p className="admin-stage-footnote">列表接口不返回逐用户标签或最近活动时间。标签在详情读取后展示；不额外批量请求或伪造活动记录。</p>
    {selected && <UserDetailDrawer key={selected.uid} user={selected} tags={tags} request={request} onClose={close} onRead={value => setDetails(current => ({ ...current, [value.user.uid]: value }))} onChanged={() => void load()} resetEntry={resetEntry} />}
    {resetUser && <AdminPasswordReset key={resetUser.uid} user={resetUser} currentUserUid={currentUser?.uid} request={request} onClose={() => setResetUser(null)} />}
  </section>;
}

interface DrawerProps { user: AdminUser; tags: AdminTag[]; request: AdminRequest; onClose: () => void; onRead: (detail: UserDetail) => void; onChanged: () => void; resetEntry: (user: AdminUser, disabled?: boolean) => React.ReactNode; key?: string; }
type Confirmation = { kind: 'membership'; proposal: ReturnType<typeof membershipProposal> } | { kind: 'moderation'; payload: { userUid: string; action: string; reason: string; expiresAt?: number } } | { kind: 'tag'; id: string; name: string };
function UserDetailDrawer({ user, tags, request, onClose, onRead, onChanged, resetEntry }: DrawerProps) {
  const [detail, setDetail] = useState<UserDetail | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [draft, setDraft] = useState<MembershipDraft>(() => membershipDraft(user));
  const [note, setNote] = useState(''), [tagId, setTagId] = useState('');
  const [action, setAction] = useState(''), [reason, setReason] = useState(''), [suspendDays, setSuspendDays] = useState('7');
  const [busy, setBusy] = useState(false), [needsRead, setNeedsRead] = useState(false), [success, setSuccess] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null), [closeConfirm, setCloseConfirm] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const epoch = useRef(new LatestRequest()), writing = useRef(false), initial = useRef(true);
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
  const mutate = async (path: string, init: RequestInit, message: string, reset: () => void) => {
    if (writing.current || needsRead) return; writing.current = true; setBusy(true); setError(''); setSuccess('');
    try {
      const result = await request(path, init);
      if (!result.ok) { setError(requestError(result, message)); return; }
      reset(); setConfirmation(null); setSuccess(message + '已成功。');
      if (!(await read())) { setNeedsRead(true); setSuccess(message + '已成功，但详情刷新失败；请重试读取，不要重复提交。'); }
      onChanged();
    } catch { setError(message + '失败，输入保持不变，可重试。'); }
    finally { writing.current = false; setBusy(false); }
  };
  const submitConfirmation = () => {
    if (!confirmation || !detail) return;
    if (confirmation.kind === 'membership' && confirmation.proposal.updates) void mutate('/api/admin/update-user', { method: 'POST', body: JSON.stringify({ uid: user.uid, updates: confirmation.proposal.updates }) }, '会员权益修改', () => { setDraft({ type: confirmation.proposal.type, expiry: 'keep', days: '30' }); setFormVersion(v => v + 1); });
    else if (confirmation.kind === 'moderation') void mutate('/api/admin/users/moderation', { method: 'POST', body: JSON.stringify(confirmation.payload) }, '账号限制处理', () => { setAction(''); setReason(''); });
    else if (confirmation.kind === 'tag') void mutate('/api/admin/user-tags/assign?userUid=' + encodeURIComponent(user.uid) + '&tagId=' + encodeURIComponent(confirmation.id), { method: 'DELETE' }, '标签移除', () => {});
  };
  const moderationReview = () => {
    if (!action) return; if (action !== 'unban' && !reason.trim()) { setError('请填写处理原因。'); return; }
    setConfirmation({ kind: 'moderation', payload: { userUid: user.uid, action, reason: reason.trim(), ...(action === 'suspend' ? { expiresAt: Date.now() + Number(suspendDays) * 86_400_000 } : {}) } });
  };
  const view = membershipPresentation(detail?.user ?? user);
  const disabled = busy || loading || needsRead;
  const currentTags = detail?.tags ?? [], assigned = new Set(currentTags.map(tag => tag.id));
  const confirmTitle = confirmation?.kind === 'membership' ? '确认会员权益差异' : confirmation?.kind === 'moderation' ? '确认账号限制' : '确认移除标签';
  return <>
    <AdminDrawer open title="用户详情" description={userLabel(user) + ' · ' + user.uid} className="admin-user-drawer" pending={busy} onClose={close}>
      {success && <p className="admin-success-message" role="status">{success}</p>}
      {error && <AdminErrorState title="操作尚未完成" message={error} retry={() => void read()} busy={busy || loading} />}
      {!detail ? loading ? <AdminLoading label="正在读取用户详情…" /> : <AdminEmptyState title="无法读取该用户" description="接口未返回详情；不会按列表信息编造。" /> : <>
        <section className="admin-detail-section"><h2>概况</h2><dl className="admin-detail-facts"><div><dt>账号</dt><dd>{detail.user.email}</dd></div><div><dt>UID</dt><dd className="admin-mono">{detail.user.uid}</dd></div><div><dt>账号状态</dt><dd><StatusBadge status={detail.moderation.status} /></dd></div><div><dt>角色有效权益</dt><dd>{view.effective}</dd></div><div><dt>创建时间</dt><dd>{dateText(detail.user.createdAt)}</dd></div><div><dt>资料更新时间</dt><dd>{dateText(detail.user.updatedAt)}</dd></div><div><dt>图纸数量</dt><dd>{detail.aggregates?.works ?? detail.workCount ?? '—'}</dd></div><div><dt>最近活动</dt><dd>{dateText(detail.user.lastActiveAt)}（未提供时不推断）</dd></div></dl><div className="admin-reset-entry">{resetEntry(detail.user, disabled)}</div></section>
        <section className="admin-detail-section"><h2>会员权益</h2><div className="admin-info-box"><p>当前接口付费字段：<strong>{view.paid}</strong></p><p>当前到期值：{view.expiry}</p>{detail.user.role === 'admin' && <p>Pro来自管理员角色，不代表付费Pro，也不会写回付费字段。</p>}{view.caveat && <p>{view.caveat}</p>}</div>
          <div className="admin-form-grid" key={formVersion}>
            <label>将提交的付费级别<select data-membership-type value={draft.type} disabled={disabled} onChange={event => setDraft(current => ({ ...current, type: Number(event.target.value) as 0 | 1 | 2 }))}>{draft.type === '' && <option value="">未提供，请选择</option>}<option value={0}>免费</option><option value={1}>VIP</option><option value={2}>商家 Pro</option></select></label>
            <label>到期处理<select data-membership-expiry value={draft.expiry} disabled={disabled} onChange={event => setDraft(current => ({ ...current, expiry: event.target.value as MembershipDraft['expiry'] }))}><option value="keep">保留原到期值（不续期）</option>{draft.type === 0 ? <option value="lifetime">明确清空付费到期值</option> : <><option value="days">从本次确认时刻起设置天数</option><option value="lifetime">永久（无到期时间）</option></>}</select></label>
            {draft.type !== 0 && draft.expiry === 'days' && <label>有效天数<select data-membership-days value={draft.days} disabled={disabled} onChange={event => setDraft(current => ({ ...current, days: event.target.value }))}>{['7','30','90','365'].map(value => <option key={value} value={value}>{value}天</option>)}</select></label>}
          </div>{proposal.error && proposal.changed && <p className="admin-field-error">{proposal.error}</p>}
          <AdminButton data-membership-review disabled={disabled || !proposal.updates} onClick={() => setConfirmation({ kind: 'membership', proposal: membershipProposal(detail.user, draft) })}>查看差异并确认</AdminButton>
          {!proposal.changed && <p className="admin-stage-footnote">没有资格或到期变化，不会提交或默认重设30天。</p>}
        </section>
        <section className="admin-detail-section"><h2>标签与内部备注</h2><div className="admin-tag-list">{currentTags.length ? currentTags.map(tag => <span className="admin-detail-tag" key={tag.id}>{tag.displayName}<AdminButton iconOnly variant="ghost" aria-label={'移除标签' + tag.displayName} disabled={disabled} onClick={() => setConfirmation({ kind: 'tag', id: tag.id, name: tag.displayName })}><X aria-hidden="true" /></AdminButton></span>) : <p className="admin-muted">暂无标签</p>}</div>
          <div className="admin-inline-form"><label>添加标签<select value={tagId} disabled={disabled} onChange={event => setTagId(event.target.value)}><option value="">选择标签</option>{tags.filter(tag => !assigned.has(tag.id)).map(tag => <option key={tag.id} value={tag.id}>{tag.displayName}</option>)}</select></label><AdminButton disabled={disabled || !tagId} onClick={() => void mutate('/api/admin/user-tags/assign', { method: 'POST', body: JSON.stringify({ userUid: user.uid, tagId }) }, '标签分配', () => setTagId(''))}><Plus aria-hidden="true" />添加</AdminButton></div>
          <div className="admin-note-list">{detail.notes.length ? detail.notes.map(item => <article key={item.id}><p>{item.content}</p><small>{dateText(item.createdAt)} · {item.authorUid ?? '作者未提供'}</small></article>) : <p className="admin-muted">暂无内部备注</p>}</div>
          <label className="admin-stage-field">新备注<textarea data-user-note value={note} maxLength={4000} disabled={disabled} onChange={event => setNote(event.target.value)} placeholder="仅管理员可见的备注" /></label><AdminButton data-note-save disabled={disabled || !note.trim()} onClick={() => void mutate('/api/admin/user-notes', { method: 'POST', body: JSON.stringify({ userUid: user.uid, content: note.trim() }) }, '备注添加', () => setNote(''))}>添加备注</AdminButton>
        </section>
        <section className="admin-detail-section admin-danger-zone"><h2>账号限制 · 危险操作</h2><p>当前：{statusLabel(detail.moderation.status)}；{detail.moderation.reason || '没有处理原因记录'}</p>
          <label className="admin-stage-field">拟执行动作<select data-moderation-action value={action} disabled={disabled} onChange={event => setAction(event.target.value)}><option value="">请选择，不自动执行</option>{detail.moderation.status !== 'banned' && <option value="ban">封禁账号</option>}{detail.moderation.status === 'active' && <option value="suspend">暂停账号</option>}{detail.moderation.status !== 'active' && <option value="unban">解除限制</option>}</select></label>
          {action && action !== 'unban' && <label className="admin-stage-field">处理原因<textarea value={reason} maxLength={1000} disabled={disabled} onChange={event => setReason(event.target.value)} placeholder="填写处理原因" /></label>}
          {action === 'suspend' && <label className="admin-stage-field">暂停天数<select value={suspendDays} disabled={disabled} onChange={event => setSuspendDays(event.target.value)}>{['1','7','30'].map(value => <option key={value} value={value}>{value}天</option>)}</select></label>}
          <AdminButton data-moderation-review variant="danger" disabled={disabled || !action || action !== 'unban' && !reason.trim()} onClick={moderationReview}><Ban aria-hidden="true" />查看影响并确认</AdminButton>
        </section>
      </>}
    </AdminDrawer>
    <AdminConfirmDialog open={Boolean(confirmation)} title={confirmTitle} description={'对象：' + userLabel(user) + '（' + user.uid + '）。以下值将用于现有服务端接口。'} pending={busy} confirmLabel="确认提交" onClose={() => setConfirmation(null)} onConfirm={submitConfirmation}>
      {confirmation?.kind === 'membership' && <div className="admin-change-summary" data-membership-confirm><p>当前接口级别：{memberLabel(confirmation.proposal.beforeType)}</p><p>当前到期：{confirmation.proposal.beforeExpiry === null ? 'null（空/永久，结合级别）' : dateText(confirmation.proposal.beforeExpiry)}</p><hr /><p>将提交级别：{confirmation.proposal.type === '' ? '未提供' : memberLabel(confirmation.proposal.type)}</p><p>将提交到期：{confirmation.proposal.expiry === null ? 'null（永久/免费清空）' : dateText(confirmation.proposal.expiry)}</p><p>member_expire：{String(confirmation.proposal.expiry)}</p><p>影响：覆盖该用户付费字段；不改变角色或角色提供的 Pro 权益。</p>{view.caveat && <p>{view.caveat}</p>}</div>}
      {confirmation?.kind === 'moderation' && <div className="admin-change-summary"><p>动作：{confirmation.payload.action === 'ban' ? '封禁账号' : confirmation.payload.action === 'suspend' ? '暂停账号' : '解除限制'}</p><p>原因：{confirmation.payload.reason || '解除限制'}</p><p>到期：{dateText(confirmation.payload.expiresAt)}</p><p>影响：请求服务端改变账号限制；不删除用户或图纸。</p></div>}
      {confirmation?.kind === 'tag' && <p>仅移除该用户与“{confirmation.name}”的标签关联，不删除标签目录。</p>}
      {error && <AdminErrorState message={error} />}
    </AdminConfirmDialog>
    <AdminConfirmDialog open={closeConfirm} title="放弃未保存编辑？" description={'对象：' + userLabel(user) + '。关闭会丢弃尚未提交的权益、备注或限制输入。'} confirmLabel="放弃并关闭" onClose={() => setCloseConfirm(false)} onConfirm={onClose} />
  </>;
}
