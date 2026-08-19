import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardPlus,
  Crown,
  Loader2,
  Minus,
  Plus,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Tag,
  UserCog,
  X,
} from 'lucide-react';
import type { AdminRequest } from './AdminConsole';

type PageMode = 'users' | 'roles';
type UserStatus = 'all' | 'active' | 'suspended' | 'banned';
type ModerationAction = 'ban' | 'suspend' | 'unban';

interface AdminUser {
  uid: string;
  email: string;
  displayName?: string;
  role?: 'user' | 'admin';
  member_type?: 0 | 1 | 2;
  memberType?: 0 | 1 | 2;
  member_expire?: number | null;
  memberExpire?: number | null;
  moderation?: { status?: 'active' | 'suspended' | 'banned'; expiresAt?: number | null };
}

interface UsersResponse { items: AdminUser[]; total: number; limit: number; offset: number; }
interface AdminTag { id: string; key: string; displayName: string; colorHex?: string | null; assignedAt?: number; }
interface UserNote { id: string; content: string; authorUid?: string | null; createdAt: number; }
interface UserDetail { user: AdminUser; tags: AdminTag[]; notes: UserNote[]; moderation: { status: 'active' | 'suspended' | 'banned'; reason: string; expiresAt?: number | null }; workCount: number; }
interface AdminRole { id: string; code: string; displayName: string; description: string; system: boolean; permissionCount: number; permissionCodes?: string[]; }
interface Permission { id: string; code: string; displayName: string; description: string; }
interface UserRole { userUid: string; roleId: string; roleCode: string; roleName: string; assignedBy?: string | null; assignedAt: number; }
interface RolePermissionsDetail { role: AdminRole; permissionIds: string[]; permissionCodes: string[]; permissions: Permission[]; }

interface AdminUsersRolesProps { mode: PageMode; request: AdminRequest; }

const PAGE_SIZE = 20;
const dateTime = (value?: number | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
const membership = (user: AdminUser) => user.member_type ?? user.memberType ?? 0;
const expiresAt = (user: AdminUser) => user.member_expire ?? user.memberExpire ?? null;
const userLabel = (user: AdminUser) => user.displayName || user.email || user.uid;

function Notice({ children, tone = 'amber' }: { children: React.ReactNode; tone?: 'amber' | 'rose' | 'sky' }) {
  const classes = tone === 'rose' ? 'border-rose-400/30 bg-rose-500/10 text-rose-100' : tone === 'sky' ? 'border-sky-400/30 bg-sky-500/10 text-sky-100' : 'border-amber-400/30 bg-amber-500/10 text-amber-100';
  return <div role="alert" className={`flex items-start gap-2 border px-3 py-3 text-sm leading-6 ${classes}`}><CircleAlert className="mt-1 h-4 w-4 shrink-0" />{children}</div>;
}

function UserBadge({ user }: { user: AdminUser }) {
  const type = membership(user);
  const status = user.moderation?.status ?? 'active';
  const label = status === 'banned' ? '已封禁' : status === 'suspended' ? '已暂停' : type === 2 ? 'Pro' : type === 1 ? 'VIP' : '免费';
  const classes = status === 'banned' ? 'bg-rose-500/15 text-rose-200' : status === 'suspended' ? 'bg-amber-500/15 text-amber-200' : type === 2 ? 'bg-violet-500/15 text-violet-200' : type === 1 ? 'bg-amber-500/15 text-amber-200' : 'bg-slate-800 text-slate-300';
  return <span className={`inline-flex rounded px-2 py-1 text-[11px] font-medium ${classes}`}>{label}</span>;
}

function UserList({ users, loading, onOpen }: { users: AdminUser[]; loading: boolean; onOpen: (user: AdminUser) => void }) {
  if (loading) return <div className="grid min-h-64 place-items-center border border-slate-800 bg-slate-950/50"><Loader2 className="h-5 w-5 animate-spin text-sky-300" /></div>;
  if (users.length === 0) return <div className="grid min-h-64 place-items-center border border-slate-800 bg-slate-950/50 px-4 text-center text-sm text-slate-500">没有符合当前筛选条件的用户。</div>;
  return <>
    <div className="hidden overflow-x-auto border border-slate-800 md:block"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-900 text-xs text-slate-500"><tr><th className="px-4 py-3 font-medium">用户</th><th className="px-4 py-3 font-medium">账号</th><th className="px-4 py-3 font-medium">会员</th><th className="px-4 py-3 font-medium">状态</th><th className="px-4 py-3 text-right font-medium">操作</th></tr></thead><tbody>{users.map((user) => <tr key={user.uid} className="border-t border-slate-800 text-slate-300"><td className="px-4 py-3 font-medium text-white">{userLabel(user)}</td><td className="px-4 py-3 text-slate-400">{user.email}</td><td className="px-4 py-3"><UserBadge user={user} /></td><td className="px-4 py-3 text-xs text-slate-500">{user.moderation?.expiresAt ? `至 ${dateTime(user.moderation.expiresAt)}` : '-'}</td><td className="px-4 py-3 text-right"><button type="button" onClick={() => onOpen(user)} className="min-h-11 px-3 text-sm text-sky-300 hover:bg-sky-500/10">查看</button></td></tr>)}</tbody></table></div>
    <div className="space-y-2 md:hidden">{users.map((user) => <article key={user.uid} className="border border-slate-800 bg-slate-950/60 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-white">{userLabel(user)}</p><p className="mt-1 truncate text-xs text-slate-500">{user.email}</p></div><UserBadge user={user} /></div><button type="button" onClick={() => onOpen(user)} className="mt-3 min-h-11 w-full border border-slate-700 text-sm text-sky-200 hover:bg-slate-800">查看用户</button></article>)}</div>
  </>;
}

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-400"><span>共 {total} 名用户</span><div className="flex items-center gap-2"><button type="button" title="上一页" aria-label="上一页" disabled={page <= 1} onClick={() => onChange(page - 1)} className="grid h-11 w-11 place-items-center border border-slate-700 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span className="min-w-16 text-center tabular-nums">{page} / {pageCount}</span><button type="button" title="下一页" aria-label="下一页" disabled={page >= pageCount} onClick={() => onChange(page + 1)} className="grid h-11 w-11 place-items-center border border-slate-700 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div>;
}

function UserDrawer({ detail, allTags, onClose, request, reload, forbidden }: { detail: UserDetail; allTags: AdminTag[]; onClose: () => void; request: AdminRequest; reload: () => Promise<void>; forbidden: boolean }) {
  const [memberType, setMemberType] = useState<0 | 1 | 2>(membership(detail.user));
  const [days, setDays] = useState(() => membership(detail.user) > 0 && expiresAt(detail.user) === null ? '36500' : '30');
  const [tagId, setTagId] = useState('');
  const [note, setNote] = useState('');
  const [action, setAction] = useState<ModerationAction | null>(null);
  const [reason, setReason] = useState('');
  const [suspendDays, setSuspendDays] = useState('7');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const assigned = new Set(detail.tags.map((tag) => tag.id));

  const run = async (name: string, work: () => Promise<void>) => {
    setBusy(name); setError('');
    try { await work(); await reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败，请重试。'); } finally { setBusy(''); }
  };
  const expect = <T,>(result: { ok: boolean; error?: string }): T => { if (!result.ok) throw new Error(result.error ?? '请求失败'); return undefined as T; };

  const saveMembership = () => run('membership', async () => {
    const lifetime = days === '36500';
    const expire = memberType === 0 ? null : lifetime ? null : Date.now() + Number(days) * 86_400_000;
    expect(await request('/api/admin/update-user', { method: 'POST', body: JSON.stringify({ uid: detail.user.uid, updates: { member_type: memberType, member_expire: expire, member_source: '后台用户管理' } }) }));
  });
  const assignTag = () => tagId && run('tag', async () => { expect(await request('/api/admin/user-tags/assign', { method: 'POST', body: JSON.stringify({ userUid: detail.user.uid, tagId }) })); setTagId(''); });
  const removeTag = (id: string) => run(`tag-${id}`, async () => expect(await request(`/api/admin/user-tags/assign?userUid=${encodeURIComponent(detail.user.uid)}&tagId=${encodeURIComponent(id)}`, { method: 'DELETE' })));
  const addNote = () => note.trim() && run('note', async () => { expect(await request('/api/admin/user-notes', { method: 'POST', body: JSON.stringify({ userUid: detail.user.uid, content: note.trim() }) })); setNote(''); });
  const moderate = () => action && run('moderation', async () => {
    if (action !== 'unban' && !reason.trim()) throw new Error('请填写限制原因。');
    const expiresAt = action === 'suspend' ? Date.now() + Number(suspendDays) * 86_400_000 : undefined;
    expect(await request('/api/admin/users/moderation', { method: 'POST', body: JSON.stringify({ userUid: detail.user.uid, action, reason: reason.trim(), ...(expiresAt ? { expiresAt } : {}) }) }));
    setAction(null); setReason('');
  });

  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70"><button type="button" aria-label="关闭用户详情" className="absolute inset-0 cursor-default" onClick={onClose} /><aside className="relative flex h-full w-full max-w-xl flex-col border-l border-slate-700 bg-slate-900 shadow-2xl"><header className="flex min-h-16 items-center justify-between border-b border-slate-800 px-4"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{userLabel(detail.user)}</p><p className="mt-0.5 truncate text-xs text-slate-500">{detail.user.uid}</p></div><button type="button" title="关闭" aria-label="关闭" onClick={onClose} className="grid h-11 w-11 place-items-center text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button></header><div className="flex-1 overflow-y-auto p-4 sm:p-5">{error && <Notice tone="rose">{error}</Notice>}<section className="border-b border-slate-800 pb-5"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-white">会员权益</h2><UserBadge user={detail.user} /></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-400">会员级别<select value={memberType} disabled={forbidden || busy !== ''} onChange={(event) => setMemberType(Number(event.target.value) as 0 | 1 | 2)} className="mt-1 min-h-11 w-full border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value={0}>免费</option><option value={1}>VIP</option><option value={2}>商家 Pro</option></select></label><label className="text-xs text-slate-400">有效期<select value={days} disabled={forbidden || busy !== '' || memberType === 0} onChange={(event) => setDays(event.target.value)} className="mt-1 min-h-11 w-full border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option><option value="365">365 天</option><option value="36500">永久</option></select></label></div><button type="button" disabled={forbidden || busy !== ''} onClick={() => void saveMembership()} className="mt-3 flex min-h-11 items-center gap-2 bg-sky-400 px-4 text-sm font-medium text-slate-950 disabled:opacity-50"><Crown className="h-4 w-4" />保存会员权益</button></section><section className="border-b border-slate-800 py-5"><h2 className="text-sm font-semibold text-white">用户标签</h2><div className="mt-3 flex flex-wrap gap-2">{detail.tags.length ? detail.tags.map((tag) => <span key={tag.id} className="inline-flex min-h-8 items-center gap-1 bg-slate-800 px-2 text-xs text-slate-200"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.colorHex ?? '#94A3B8' }} />{tag.displayName}<button type="button" title={`移除 ${tag.displayName}`} aria-label={`移除 ${tag.displayName}`} disabled={forbidden || busy !== ''} onClick={() => void removeTag(tag.id)} className="ml-1 text-slate-400 hover:text-rose-300"><X className="h-3.5 w-3.5" /></button></span>) : <p className="text-sm text-slate-500">暂无标签</p>}</div><div className="mt-3 flex gap-2"><select value={tagId} disabled={forbidden || busy !== ''} onChange={(event) => setTagId(event.target.value)} className="min-h-11 min-w-0 flex-1 border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="">选择标签</option>{allTags.filter((tag) => !assigned.has(tag.id)).map((tag) => <option key={tag.id} value={tag.id}>{tag.displayName}</option>)}</select><button type="button" disabled={!tagId || forbidden || busy !== ''} onClick={() => void assignTag()} className="grid h-11 w-11 place-items-center border border-sky-400/50 text-sky-200 disabled:opacity-40" title="分配标签"><Plus className="h-4 w-4" /></button></div></section><section className="border-b border-slate-800 py-5"><h2 className="text-sm font-semibold text-white">内部备注</h2><div className="mt-3 space-y-2">{detail.notes.length ? detail.notes.map((item) => <article key={item.id} className="border-l-2 border-slate-700 pl-3"><p className="text-sm leading-6 text-slate-300">{item.content}</p><p className="mt-1 text-xs text-slate-500">{dateTime(item.createdAt)}</p></article>) : <p className="text-sm text-slate-500">暂无内部备注</p>}</div><textarea value={note} disabled={forbidden || busy !== ''} onChange={(event) => setNote(event.target.value)} maxLength={4000} placeholder="仅管理员可见的备注" className="mt-3 min-h-24 w-full border border-slate-700 bg-slate-950 p-3 text-sm text-white placeholder:text-slate-600" /><button type="button" disabled={!note.trim() || forbidden || busy !== ''} onClick={() => void addNote()} className="mt-2 flex min-h-11 items-center gap-2 border border-slate-600 px-3 text-sm text-slate-200 disabled:opacity-40"><ClipboardPlus className="h-4 w-4" />添加备注</button></section><section className="pt-5"><h2 className="text-sm font-semibold text-white">账号限制</h2><p className="mt-2 text-sm text-slate-500">当前状态：{detail.moderation.status}</p>{action ? <div className="mt-3 border border-rose-400/30 bg-rose-500/5 p-3"><p className="text-sm text-rose-100">确认{action === 'ban' ? '封禁' : action === 'suspend' ? '暂停' : '解除限制'}该账号</p>{action !== 'unban' && <><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="填写处理原因" maxLength={1000} className="mt-3 min-h-20 w-full border border-slate-700 bg-slate-950 p-2 text-sm text-white placeholder:text-slate-600" />{action === 'suspend' && <select value={suspendDays} onChange={(event) => setSuspendDays(event.target.value)} className="mt-2 min-h-11 w-full border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="1">暂停 1 天</option><option value="7">暂停 7 天</option><option value="30">暂停 30 天</option></select>}</>}<div className="mt-3 flex gap-2"><button type="button" disabled={busy !== ''} onClick={() => void moderate()} className="min-h-11 bg-rose-500 px-4 text-sm font-medium text-white disabled:opacity-50">确认处理</button><button type="button" onClick={() => setAction(null)} className="min-h-11 border border-slate-700 px-4 text-sm text-slate-300">取消</button></div></div> : <div className="mt-3 flex flex-wrap gap-2">{detail.moderation.status !== 'banned' && <button type="button" disabled={forbidden || busy !== ''} onClick={() => setAction('ban')} className="flex min-h-11 items-center gap-2 border border-rose-400/50 px-3 text-sm text-rose-200 disabled:opacity-40"><Ban className="h-4 w-4" />封禁</button>}{detail.moderation.status === 'active' && <button type="button" disabled={forbidden || busy !== ''} onClick={() => setAction('suspend')} className="flex min-h-11 items-center gap-2 border border-amber-400/50 px-3 text-sm text-amber-100 disabled:opacity-40"><ShieldAlert className="h-4 w-4" />暂停</button>}{detail.moderation.status !== 'active' && <button type="button" disabled={forbidden || busy !== ''} onClick={() => setAction('unban')} className="flex min-h-11 items-center gap-2 border border-emerald-400/50 px-3 text-sm text-emerald-100 disabled:opacity-40"><ShieldCheck className="h-4 w-4" />解除限制</button>}</div>}</section></div></aside></div>;
}

function UsersPanel({ request }: { request: AdminRequest }) {
  const [users, setUsers] = useState<AdminUser[]>([]); const [tags, setTags] = useState<AdminTag[]>([]); const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1); const [search, setSearch] = useState(''); const [status, setStatus] = useState<UserStatus>('all'); const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(true); const [forbidden, setForbidden] = useState(false); const [error, setError] = useState(''); const [detail, setDetail] = useState<UserDetail | null>(null);
  const load = useCallback(async () => { setLoading(true); setError(''); const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), status }); if (search.trim()) params.set('search', search.trim()); if (tag) params.set('tag', tag); const [usersResult, tagsResult] = await Promise.all([request<UsersResponse>(`/api/admin/users?${params}`), request<{ items: AdminTag[] }>('/api/admin/user-tags')]); if (usersResult.status === 403 || tagsResult.status === 403) { setForbidden(true); setError('当前角色没有用户管理权限。'); setLoading(false); return; } if (!usersResult.ok) { setError(usersResult.error ?? '用户列表加载失败。'); setLoading(false); return; } setUsers(usersResult.data?.items ?? []); setTotal(usersResult.data?.total ?? 0); if (tagsResult.ok) setTags(tagsResult.data?.items ?? []); setForbidden(false); setLoading(false); }, [page, request, search, status, tag]);
  useEffect(() => { void load(); }, [load]);
  const open = async (user: AdminUser) => { setError(''); const result = await request<UserDetail>(`/api/admin/users/detail?uid=${encodeURIComponent(user.uid)}`); if (result.status === 403) { setForbidden(true); setError('当前角色没有查看用户详情的权限。'); return; } if (!result.ok || !result.data) { setError(result.error ?? '用户详情加载失败。'); return; } setDetail(result.data); };
  const reloadDetail = async () => { if (!detail) return; const result = await request<UserDetail>(`/api/admin/users/detail?uid=${encodeURIComponent(detail.user.uid)}`); if (!result.ok || !result.data) throw new Error(result.error ?? '用户详情刷新失败。'); setDetail(result.data); await load(); };
  const applyFilter = () => { setPage(1); void load(); };
  return <section><div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-end"><div><p className="text-xs font-medium text-sky-300">用户与会员</p><h1 className="mt-2 text-2xl font-semibold text-white">用户管理</h1></div><p className="text-sm text-slate-500">搜索和筛选均由服务端分页执行。</p></div>{error && <div className="mt-5"><Notice tone={forbidden ? 'rose' : 'amber'}>{error}</Notice></div>}<div className="mt-5 grid gap-2 border border-slate-800 bg-slate-900/50 p-3 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]"><label className="relative"><span className="sr-only">搜索用户</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyFilter(); }} placeholder="昵称、邮箱或 UID" className="min-h-11 w-full border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm text-white placeholder:text-slate-600" /></label><select value={status} onChange={(event) => { setStatus(event.target.value as UserStatus); setPage(1); }} className="min-h-11 border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="all">所有状态</option><option value="active">正常</option><option value="suspended">暂停</option><option value="banned">封禁</option></select><select value={tag} onChange={(event) => { setTag(event.target.value); setPage(1); }} className="min-h-11 border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="">所有标签</option>{tags.map((item) => <option key={item.id} value={item.key}>{item.displayName}</option>)}</select><button type="button" onClick={applyFilter} className="min-h-11 bg-sky-400 px-4 text-sm font-medium text-slate-950">搜索</button></div><div className="mt-5"><UserList users={users} loading={loading} onOpen={(user) => void open(user)} /><Pager page={page} total={total} onChange={setPage} /></div>{detail && <UserDrawer detail={detail} allTags={tags} request={request} reload={reloadDetail} forbidden={forbidden} onClose={() => setDetail(null)} />}</section>;
}

function RolesPanel({ request }: { request: AdminRequest }) {
  const [roles, setRoles] = useState<AdminRole[]>([]); const [permissions, setPermissions] = useState<Permission[]>([]); const [assignments, setAssignments] = useState<UserRole[]>([]);
  const [selectedRole, setSelectedRole] = useState(''); const [userUid, setUserUid] = useState(''); const [assignmentRole, setAssignmentRole] = useState(''); const [saving, setSaving] = useState(false); const [forbidden, setForbidden] = useState(false); const [error, setError] = useState('');
  const selected = useMemo(() => roles.find((role) => role.id === selectedRole) ?? null, [roles, selectedRole]);
  const readablePermissions = Array.isArray(selected?.permissionCodes) ? selected?.permissionCodes : null;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const load = useCallback(async () => { setError(''); const [rolesResult, permissionsResult, assignmentsResult] = await Promise.all([request<{ items: AdminRole[] }>('/api/admin/roles'), request<{ items: Permission[] }>('/api/admin/permissions'), request<{ items: UserRole[] }>('/api/admin/admin-user-roles')]); if ([rolesResult, permissionsResult, assignmentsResult].some((result) => result.status === 403)) { setForbidden(true); setError('当前角色没有角色或管理员账号管理权限。'); return; } if (!rolesResult.ok || !permissionsResult.ok || !assignmentsResult.ok) { setError(rolesResult.error ?? permissionsResult.error ?? assignmentsResult.error ?? '角色数据加载失败。'); return; } const nextRoles = rolesResult.data?.items ?? []; setRoles(nextRoles); setPermissions(permissionsResult.data?.items ?? []); setAssignments(assignmentsResult.data?.items ?? []); setForbidden(false); setSelectedRole((current) => current || nextRoles[0]?.id || ''); setAssignmentRole((current) => current || nextRoles[0]?.id || ''); }, [request]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setChecked(new Set(readablePermissions ?? [])); }, [readablePermissions]);
  const savePermissions = async () => { if (!selected || !readablePermissions) return; setSaving(true); setError(''); const result = await request('/api/admin/roles/permissions', { method: 'PUT', body: JSON.stringify({ roleId: selected.id, permissionCodes: Array.from(checked) }) }); if (!result.ok) setError(result.error ?? '权限保存失败。'); else await load(); setSaving(false); };
  const assignRole = async () => { if (!userUid.trim() || !assignmentRole || !window.confirm(`为 ${userUid.trim()} 分配后台角色？`)) return; setSaving(true); const result = await request('/api/admin/admin-user-roles', { method: 'POST', body: JSON.stringify({ userUid: userUid.trim(), roleId: assignmentRole }) }); if (!result.ok) setError(result.error ?? '角色分配失败。'); else { setUserUid(''); await load(); } setSaving(false); };
  const removeRole = async (assignment: UserRole) => { if (!window.confirm(`移除 ${assignment.userUid} 的角色 ${assignment.roleName}？`)) return; setSaving(true); const result = await request(`/api/admin/admin-user-roles?userUid=${encodeURIComponent(assignment.userUid)}&roleId=${encodeURIComponent(assignment.roleId)}`, { method: 'DELETE' }); if (!result.ok) setError(result.error ?? '角色移除失败。'); else await load(); setSaving(false); };
  return <section><div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-end"><div><p className="text-xs font-medium text-sky-300">后台访问控制</p><h1 className="mt-2 text-2xl font-semibold text-white">角色与权限</h1></div><p className="text-sm text-slate-500">权限校验始终以 Worker 端 RBAC 为准。</p></div>{error && <div className="mt-5"><Notice tone={forbidden ? 'rose' : 'amber'}>{error}</Notice></div>}<div className="mt-5 grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]"><section className="border border-slate-800 bg-slate-900/50"><h2 className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-white">角色列表</h2><div className="p-2">{roles.map((role) => <button key={role.id} type="button" onClick={() => setSelectedRole(role.id)} className={`w-full px-3 py-3 text-left ${selectedRole === role.id ? 'bg-sky-500/15 text-sky-100' : 'text-slate-400 hover:bg-slate-800'}`}><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{role.displayName}</span>{role.system && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">系统</span>}</div><p className="mt-1 text-xs text-slate-500">{role.permissionCount} 项权限</p></button>)}</div></section><section className="border border-slate-800 bg-slate-900/50"><div className="flex flex-col justify-between gap-3 border-b border-slate-800 p-4 sm:flex-row sm:items-center"><div><h2 className="text-sm font-semibold text-white">{selected?.displayName ?? '选择角色'}</h2><p className="mt-1 text-xs text-slate-500">{selected?.system ? '系统角色不可删除或改名；权限更改需谨慎。' : selected?.description}</p></div><button type="button" disabled={forbidden || saving || !readablePermissions} onClick={() => void savePermissions()} className="flex min-h-11 items-center justify-center gap-2 bg-sky-400 px-4 text-sm font-medium text-slate-950 disabled:opacity-40"><Save className="h-4 w-4" />保存权限</button></div>{!readablePermissions ? <div className="m-4"><Notice tone="amber">服务端当前只返回权限数量，未返回角色已分配的权限编码。为避免保存时清空既有权限，此界面已禁用编辑；需要补充只读权限明细接口后才能安全启用。</Notice></div> : <div className="grid gap-px bg-slate-800 sm:grid-cols-2">{permissions.map((permission) => <label key={permission.id} className="flex min-h-14 cursor-pointer items-center gap-3 bg-slate-900 px-4 text-sm text-slate-200 hover:bg-slate-800"><input type="checkbox" checked={checked.has(permission.code)} disabled={forbidden || saving} onChange={(event) => setChecked((previous) => { const next = new Set(previous); if (event.target.checked) next.add(permission.code); else next.delete(permission.code); return next; })} className="h-4 w-4 accent-sky-400" /><span className="min-w-0"><span className="block truncate">{permission.displayName}</span><code className="text-[11px] text-slate-500">{permission.code}</code></span></label>)}</div>}</section></div><section className="mt-6 border border-slate-800 bg-slate-900/50"><div className="border-b border-slate-800 p-4"><h2 className="text-sm font-semibold text-white">管理员账号角色</h2><p className="mt-1 text-xs text-slate-500">仅在此处为现有用户分配后台角色，不直接改写用户旧 role 字段。</p></div><div className="grid gap-2 p-4 md:grid-cols-[minmax(0,1fr)_14rem_auto]"><input value={userUid} disabled={forbidden || saving} onChange={(event) => setUserUid(event.target.value)} placeholder="输入用户 UID" className="min-h-11 border border-slate-700 bg-slate-950 px-3 text-sm text-white placeholder:text-slate-600" /><select value={assignmentRole} disabled={forbidden || saving} onChange={(event) => setAssignmentRole(event.target.value)} className="min-h-11 border border-slate-700 bg-slate-950 px-3 text-sm text-white">{roles.map((role) => <option key={role.id} value={role.id}>{role.displayName}</option>)}</select><button type="button" disabled={!userUid.trim() || !assignmentRole || forbidden || saving} onClick={() => void assignRole()} className="flex min-h-11 items-center justify-center gap-2 border border-sky-400/50 px-4 text-sm text-sky-100 disabled:opacity-40"><Plus className="h-4 w-4" />分配</button></div><div className="divide-y divide-slate-800">{assignments.length ? assignments.map((assignment) => <div key={`${assignment.userUid}-${assignment.roleId}`} className="flex flex-col gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="truncate text-slate-200">{assignment.userUid}</p><p className="mt-1 text-xs text-slate-500">{assignment.roleName} · {dateTime(assignment.assignedAt)}</p></div><button type="button" disabled={forbidden || saving} onClick={() => void removeRole(assignment)} className="flex min-h-11 items-center justify-center gap-2 border border-rose-400/40 px-3 text-sm text-rose-200 disabled:opacity-40"><Minus className="h-4 w-4" />移除</button></div>) : <p className="px-4 py-8 text-sm text-slate-500">暂无管理员角色分配。</p>}</div></section></section>;
}

export function AdminUsersRoles({ mode, request }: AdminUsersRolesProps) {
  return mode === 'users' ? <UsersPanel request={request} /> : <RolesPanelV2 request={request} />;
}

const SYSTEM_ROLE_MINIMUMS: Record<string, string[]> = {
  operations: ['dashboard.read'],
  content_moderator: ['community.read', 'community.moderate'],
  read_only: ['dashboard.read'],
};

function RolesPanelV2({ request }: { request: AdminRequest }) {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [assignments, setAssignments] = useState<UserRole[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [permissionCodes, setPermissionCodes] = useState<Set<string> | null>(null);
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [userUid, setUserUid] = useState('');
  const [assignmentRoleId, setAssignmentRoleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const detailRequestVersion = useRef(0);

  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) ?? null,
    [roles, selectedRoleId],
  );
  const isSuperAdmin = selectedRole?.code === 'super_admin';
  const minimumPermissions = selectedRole ? SYSTEM_ROLE_MINIMUMS[selectedRole.code] ?? [] : [];

  const load = useCallback(async () => {
    setError('');
    try {
      const [rolesResult, permissionsResult, assignmentsResult] = await Promise.all([
        request<{ items: AdminRole[] }>('/api/admin/roles'),
        request<{ items: Permission[] }>('/api/admin/permissions'),
        request<{ items: UserRole[] }>('/api/admin/admin-user-roles'),
      ]);
      if ([rolesResult, permissionsResult, assignmentsResult].some((result) => result.status === 403)) {
        setForbidden(true);
        setError('当前角色没有角色或管理员账号管理权限。');
        return;
      }
      if (!rolesResult.ok || !permissionsResult.ok || !assignmentsResult.ok) {
        setError(rolesResult.error ?? permissionsResult.error ?? assignmentsResult.error ?? '角色数据加载失败。');
        return;
      }
      const nextRoles = rolesResult.data?.items ?? [];
      setRoles(nextRoles);
      setPermissions(permissionsResult.data?.items ?? []);
      setAssignments(assignmentsResult.data?.items ?? []);
      setForbidden(false);
      setSelectedRoleId((current) => nextRoles.some((role) => role.id === current) ? current : nextRoles[0]?.id ?? '');
      setAssignmentRoleId((current) => nextRoles.some((role) => role.id === current) ? current : nextRoles[0]?.id ?? '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '角色数据加载失败。');
    }
  }, [request]);

  const loadPermissionDetail = useCallback(async (roleId: string) => {
    const requestVersion = ++detailRequestVersion.current;
    setLoadingPermissions(true);
    setPermissionCodes(null);
    try {
      const result = await request<RolePermissionsDetail>(`/api/admin/roles/permissions?roleId=${encodeURIComponent(roleId)}`);
      if (requestVersion !== detailRequestVersion.current) return;
      if (result.status === 403) {
        setForbidden(true);
        setError('当前角色没有读取角色权限明细的权限。');
        return;
      }
      if (!result.ok || !result.data) {
        setError(result.error ?? '角色权限明细加载失败。');
        return;
      }
      setPermissionCodes(new Set(result.data.permissionCodes));
    } catch (caught) {
      if (requestVersion === detailRequestVersion.current) {
        setError(caught instanceof Error ? caught.message : '角色权限明细加载失败。');
      }
    } finally {
      if (requestVersion === detailRequestVersion.current) setLoadingPermissions(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selectedRoleId) return;
    void loadPermissionDetail(selectedRoleId);
  }, [loadPermissionDetail, selectedRoleId]);

  const savePermissions = async () => {
    if (!selectedRole || !permissionCodes || isSuperAdmin || forbidden) return;
    setBusy(true);
    setError('');
    try {
      const result = await request('/api/admin/roles/permissions', {
        method: 'PUT',
        body: JSON.stringify({ roleId: selectedRole.id, permissionCodes: Array.from(permissionCodes).sort() }),
      });
      if (result.status === 403) {
        setForbidden(true);
        setError('当前角色没有保存权限配置的权限。');
        return;
      }
      if (!result.ok) {
        setError(result.error ?? '权限保存失败。');
        return;
      }
      await Promise.all([loadPermissionDetail(selectedRole.id), load()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '权限保存失败。');
    } finally {
      setBusy(false);
    }
  };

  const assignRole = async () => {
    const targetUid = userUid.trim();
    if (!targetUid || !assignmentRoleId || forbidden || !window.confirm(`为 ${targetUid} 分配后台角色？`)) return;
    setBusy(true);
    setError('');
    try {
      const result = await request('/api/admin/admin-user-roles', {
        method: 'POST', body: JSON.stringify({ userUid: targetUid, roleId: assignmentRoleId }),
      });
      if (result.status === 403) { setForbidden(true); setError('当前角色没有分配管理员角色的权限。'); return; }
      if (!result.ok) { setError(result.error ?? '角色分配失败。'); return; }
      setUserUid('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '角色分配失败。');
    } finally { setBusy(false); }
  };

  const removeRole = async (assignment: UserRole) => {
    if (forbidden || !window.confirm(`移除 ${assignment.userUid} 的角色 ${assignment.roleName}？`)) return;
    setBusy(true);
    setError('');
    try {
      const result = await request(`/api/admin/admin-user-roles?userUid=${encodeURIComponent(assignment.userUid)}&roleId=${encodeURIComponent(assignment.roleId)}`, { method: 'DELETE' });
      if (result.status === 403) { setForbidden(true); setError('当前角色没有移除管理员角色的权限。'); return; }
      if (!result.ok) { setError(result.error ?? '角色移除失败。'); return; }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '角色移除失败。');
    } finally { setBusy(false); }
  };

  return <section>
    <div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-end"><div><p className="text-xs font-medium text-sky-300">后台访问控制</p><h1 className="mt-2 text-2xl font-semibold text-white">角色与权限</h1></div><p className="text-sm text-slate-500">权限校验始终以 Worker 端 RBAC 为准。</p></div>
    {error && <div className="mt-5"><Notice tone={forbidden ? 'rose' : 'amber'}>{error}</Notice></div>}
    <div className="mt-5 grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <section className="border border-slate-800 bg-slate-900/50"><h2 className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-white">角色列表</h2><div className="p-2">{roles.map((role) => <button key={role.id} type="button" onClick={() => setSelectedRoleId(role.id)} className={`w-full px-3 py-3 text-left ${selectedRoleId === role.id ? 'bg-sky-500/15 text-sky-100' : 'text-slate-400 hover:bg-slate-800'}`}><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{role.displayName}</span>{role.system && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">系统</span>}</div><p className="mt-1 text-xs text-slate-500">{role.permissionCount} 项权限</p></button>)}</div></section>
      <section className="border border-slate-800 bg-slate-900/50"><div className="flex flex-col justify-between gap-3 border-b border-slate-800 p-4 sm:flex-row sm:items-center"><div><h2 className="text-sm font-semibold text-white">{selectedRole?.displayName ?? '选择角色'}</h2><p className="mt-1 text-xs text-slate-500">{selectedRole?.system ? '系统角色不可删除或改名；权限规则受最低授权保护。' : selectedRole?.description}</p></div><button type="button" disabled={forbidden || busy || loadingPermissions || !permissionCodes || isSuperAdmin} onClick={() => void savePermissions()} className="flex min-h-11 items-center justify-center gap-2 bg-sky-400 px-4 text-sm font-medium text-slate-950 disabled:opacity-40"><Save className="h-4 w-4" />保存权限</button></div>
        {isSuperAdmin && <div className="m-4"><Notice tone="sky">超级管理员必须保留全部权限，因此该角色只读，不能取消任何权限。</Notice></div>}
        {!isSuperAdmin && minimumPermissions.length > 0 && <div className="m-4"><Notice tone="sky">系统角色至少保留：{minimumPermissions.join('、')}。其余权限可按运营需要配置。</Notice></div>}
        {loadingPermissions && <div className="grid min-h-48 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-sky-300" /></div>}
        {!loadingPermissions && permissionCodes && <div className="grid gap-px bg-slate-800 sm:grid-cols-2">{permissions.map((permission) => { const required = isSuperAdmin || minimumPermissions.includes(permission.code); return <label key={permission.id} className={`flex min-h-14 items-center gap-3 bg-slate-900 px-4 text-sm text-slate-200 ${required ? 'cursor-not-allowed opacity-75' : 'cursor-pointer hover:bg-slate-800'}`}><input type="checkbox" checked={permissionCodes.has(permission.code)} disabled={forbidden || busy || required} onChange={(event) => setPermissionCodes((previous) => { if (!previous) return previous; const next = new Set(previous); if (event.target.checked) next.add(permission.code); else next.delete(permission.code); return next; })} className="h-4 w-4 accent-sky-400" /><span className="min-w-0"><span className="block truncate">{permission.displayName}</span><code className="text-[11px] text-slate-500">{permission.code}</code></span></label>; })}</div>}
        {!loadingPermissions && !permissionCodes && !forbidden && <div className="m-4"><Notice tone="amber">未能读取角色权限明细，保存已禁用。</Notice></div>}
      </section>
    </div>
    <section className="mt-6 border border-slate-800 bg-slate-900/50"><div className="border-b border-slate-800 p-4"><h2 className="text-sm font-semibold text-white">管理员账号角色</h2><p className="mt-1 text-xs text-slate-500">仅在此处为现有用户分配后台角色，不直接改写用户旧 role 字段。</p></div><div className="grid gap-2 p-4 md:grid-cols-[minmax(0,1fr)_14rem_auto]"><input value={userUid} disabled={forbidden || busy} onChange={(event) => setUserUid(event.target.value)} placeholder="输入用户 UID" className="min-h-11 border border-slate-700 bg-slate-950 px-3 text-sm text-white placeholder:text-slate-600" /><select value={assignmentRoleId} disabled={forbidden || busy} onChange={(event) => setAssignmentRoleId(event.target.value)} className="min-h-11 border border-slate-700 bg-slate-950 px-3 text-sm text-white">{roles.map((role) => <option key={role.id} value={role.id}>{role.displayName}</option>)}</select><button type="button" disabled={!userUid.trim() || !assignmentRoleId || forbidden || busy} onClick={() => void assignRole()} className="flex min-h-11 items-center justify-center gap-2 border border-sky-400/50 px-4 text-sm text-sky-100 disabled:opacity-40"><Plus className="h-4 w-4" />分配</button></div><div className="divide-y divide-slate-800">{assignments.length ? assignments.map((assignment) => <div key={`${assignment.userUid}-${assignment.roleId}`} className="flex flex-col gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="truncate text-slate-200">{assignment.userUid}</p><p className="mt-1 text-xs text-slate-500">{assignment.roleName} · {dateTime(assignment.assignedAt)}</p></div><button type="button" disabled={forbidden || busy} onClick={() => void removeRole(assignment)} className="flex min-h-11 items-center justify-center gap-2 border border-rose-400/40 px-3 text-sm text-rose-200 disabled:opacity-40"><Minus className="h-4 w-4" />移除</button></div>) : <p className="px-4 py-8 text-sm text-slate-500">暂无管理员角色分配。</p>}</div></section>
  </section>;
}
