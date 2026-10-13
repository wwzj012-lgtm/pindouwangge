export type MemberType = 0 | 1 | 2;
export type UserStatus = 'all' | 'active' | 'suspended' | 'banned';
export interface AdminTag { id: string; key: string; displayName: string; colorHex?: string | null; }
export interface AdminUser {
  uid: string; email: string; displayName?: string; role?: 'user' | 'admin';
  member_type?: MemberType; memberType?: MemberType; member_expire?: number | null; memberExpire?: number | null;
  createdAt?: number; updatedAt?: number; tags?: AdminTag[]; lastActiveAt?: number | null;
  moderation?: { status?: 'active' | 'suspended' | 'banned'; expiresAt?: number | null; reason?: string };
}
export interface UserDetail {
  user: AdminUser; tags: AdminTag[]; notes: { id: string; content: string; authorUid?: string | null; createdAt: number }[];
  moderation: { status: 'active' | 'suspended' | 'banned'; reason: string; expiresAt?: number | null };
  aggregates?: { works?: number }; workCount?: number;
}
export interface UserQuery { search: string; status: UserStatus; tag: string; page: number; }
export const emptyUserQuery = (): UserQuery => ({ search: '', status: 'all', tag: '', page: 1 });
export function userQueryString(query: UserQuery): string {
  const params = new URLSearchParams({ page: String(Math.max(1, Math.floor(query.page))), limit: '20', status: query.status });
  if (query.search.trim()) params.set('search', query.search.trim()); if (query.tag) params.set('tag', query.tag);
  return params.toString();
}
export class LatestRequest {
  private version = 0;
  next(): number { return ++this.version; }
  current(version: number): boolean { return version === this.version; }
  invalidate(): void { this.version++; }
}
export function userLabel(user: AdminUser): string { return user.displayName || user.email || user.uid; }
export function dateText(value: number | null | undefined): string { return typeof value === 'number' && Number.isFinite(value) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }
export function returnedMemberType(user: AdminUser): MemberType | undefined { const value = user.member_type ?? user.memberType; return value === 0 || value === 1 || value === 2 ? value : undefined; }
export function returnedExpiry(user: AdminUser): number | null | undefined { return user.member_expire !== undefined ? user.member_expire : user.memberExpire; }
export const memberLabel = (type: MemberType | undefined): string => type === 2 ? '商家 Pro' : type === 1 ? 'VIP' : type === 0 ? '免费' : '未提供';
export function membershipPresentation(user: AdminUser, now = Date.now()) {
  const type = returnedMemberType(user), expiry = returnedExpiry(user);
  const expired = typeof expiry === 'number' && expiry <= now;
  const active = type !== undefined && type > 0 && (expiry === null || typeof expiry === 'number' && expiry > now);
  return {
    effective: user.role === 'admin' ? 'Pro（管理员角色）' : active ? memberLabel(type) : type === undefined ? '资格未提供' : '免费',
    paid: memberLabel(type),
    expiry: expiry === null ? type === 0 ? '空到期值' : '永久' : expiry === undefined ? '到期未提供' : dateText(expiry) + (expired ? '（已到期）' : ''),
    caveat: type === 0 && expired && user.role !== 'admin' ? '接口对过期资格归零；历史存储级别未提供。' : '',
  };
}
export interface MembershipDraft { type: MemberType | ''; expiry: 'keep' | 'days' | 'lifetime'; days: string; }
export function membershipDraft(user: AdminUser): MembershipDraft { return { type: returnedMemberType(user) ?? '', expiry: 'keep', days: '30' }; }
export function membershipProposal(user: AdminUser, draft: MembershipDraft, now = Date.now()) {
  const beforeType = returnedMemberType(user), beforeExpiry = returnedExpiry(user);
  let expiry = beforeExpiry, error = '';
  if (draft.type === '') error = '请明确选择将提交的付费级别。';
  else if (draft.type === 0) expiry = draft.expiry === 'keep' && draft.type === beforeType ? beforeExpiry : null;
  else if (draft.expiry === 'lifetime') expiry = null;
  else if (draft.expiry === 'days') {
    const days = Number(draft.days); if (![7, 30, 90, 365].includes(days)) error = '请选择已有的有效期选项。';
    else expiry = now + days * 86_400_000;
  } else if (beforeType === 0 || beforeType === undefined) error = '新付费资格必须明确选择有期限或永久，不能把免费记录的空值默认当作永久。';
  else if (expiry === undefined) error = '接口未提供原到期值，无法安全保留。';
  const changed = draft.type !== beforeType || expiry !== beforeExpiry;
  return {
    uid: user.uid, beforeType, beforeExpiry, type: draft.type, expiry, changed, error,
    updates: draft.type !== '' && expiry !== undefined && !error && changed ? { member_type: draft.type, member_expire: expiry, member_source: '后台用户管理' } : undefined,
  };
}
export function requestError(result: { status: number; error?: string }, operation: string): string { return operation + (result.status === 403 ? '被服务端拒绝（403）' : '失败') + '：' + (result.error || '请重试。'); }
export const SYSTEM_ROLE_MINIMUMS: Record<string, string[]> = { operations: ['dashboard.read'], content_moderator: ['community.read', 'community.moderate'], read_only: ['dashboard.read'] };
export function permissionDelta(before: Iterable<string>, after: Iterable<string>) {
  const a = new Set(before), b = new Set(after);
  return { added: [...b].filter(code => !a.has(code)).sort(), removed: [...a].filter(code => !b.has(code)).sort() };
}
