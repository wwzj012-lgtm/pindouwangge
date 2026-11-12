export type MemberType = 0 | 1 | 2;
export type UserStatus = 'all' | 'active' | 'suspended' | 'banned';
export interface AdminTag { id: string; key: string; displayName: string; colorHex?: string | null; }
export interface AdminUser {
  uid: string; email: string; displayName?: string; role?: 'user' | 'admin';
  member_type?: MemberType; memberType?: MemberType; member_expire?: number | null; memberExpire?: number | null;
  createdAt?: number; updatedAt?: number; tags?: AdminTag[]; lastActiveAt?: number | null; authProvider?: string;
  moderation?: { status?: 'active' | 'suspended' | 'banned'; expiresAt?: number | null; reason?: string };
}
export interface UserDetail {
  user: AdminUser; tags: AdminTag[]; notes: { id: string; content: string; authorUid?: string | null; createdAt: number }[];
  moderation: { status: 'active' | 'suspended' | 'banned'; reason: string; expiresAt?: number | null };
  aggregates?: { works?: number | null; publicPosts?: number | null }; workCount?: number;
  credits?: { availableUnits: number; heldUnits: number; unitsPerPoint: number; updatedAt: number } | null;
  recentActivity?: { at: number; source: string } | null; activityScope?: string;
  /** 批次 3 补全：显式计数、最近活跃时间、最近管理员积分调整。 */
  worksCount?: number | null;
  postsCount?: number | null;
  lastActiveAt?: number | null;
  recentCreditLedger?: CreditAdjustmentSummary[];
}
export interface CreditAdjustmentSummary {
  id: string; uid: string; operatorUid: string;
  deltaUnits: number; reason: string;
  beforeAvailableUnits: number; afterAvailableUnits: number;
  createdAt: number;
}
export function userOverview(detail: UserDetail) {
  const credits = detail.credits;
  const points = (units: number) => credits && Number.isSafeInteger(units) && units >= 0 && Number.isSafeInteger(credits.unitsPerPoint) && credits.unitsPerPoint > 0 ? String(units / credits.unitsPerPoint) + ' 积分' : '未提供';
  const count = (value: number | null | undefined) => Number.isSafeInteger(value) && value! >= 0 ? String(value) : '未提供';
  const source = detail.recentActivity?.source === 'work_updated' ? '图纸更新' : detail.recentActivity?.source === 'public_post_published' ? '公开帖发布' : '活动';
  return {
    available: credits ? points(credits.availableUnits) : '未提供（无积分账户记录或数据未接入）',
    held: credits ? points(credits.heldUnits) : '未提供',
    works: count(detail.aggregates?.works ?? detail.workCount), posts: count(detail.aggregates?.publicPosts),
    activity: detail.recentActivity ? dateText(detail.recentActivity.at) + ' · ' + source : '未提供',
    provider: detail.user.authProvider === 'password' ? '邮箱密码' : detail.user.authProvider === 'guest' ? '游客' : detail.user.authProvider === 'firebase' ? 'Firebase' : '未提供',
  };
}
export type UserSortBy = 'registered_at' | 'credit_balance';
export type UserSortDir = 'asc' | 'desc';
export interface UserQuery {
  search: string; status: UserStatus; tag: string; page: number;
  /** 批次 3 新增筛选：role / vip / 会员类型 / 注册时间区间 / 排序；缺省即"全部"。 */
  role?: '' | 'user' | 'admin';
  vip?: '' | 'true' | 'false';
  memberType?: '' | '0' | '1' | '2';
  registeredFrom?: string;
  registeredTo?: string;
  sortBy?: UserSortBy;
  sortDir?: UserSortDir;
}
export const emptyUserQuery = (): UserQuery => ({
  search: '', status: 'all', tag: '', page: 1,
  role: '', vip: '', memberType: '', registeredFrom: '', registeredTo: '',
  sortBy: 'registered_at', sortDir: 'desc',
});
export function userQueryString(query: UserQuery): string {
  const params = new URLSearchParams({ page: String(Math.max(1, Math.floor(query.page))), limit: '20', status: query.status });
  if (query.search.trim()) params.set('search', query.search.trim()); if (query.tag) params.set('tag', query.tag);
  if (query.role) params.set('role', query.role);
  if (query.vip) params.set('vip', query.vip);
  if (query.memberType) params.set('memberType', query.memberType);
  if (query.registeredFrom) params.set('registeredFrom', query.registeredFrom);
  if (query.registeredTo) params.set('registeredTo', query.registeredTo);
  params.set('sortBy', query.sortBy ?? 'registered_at');
  params.set('sortDir', query.sortDir ?? 'desc');
  return params.toString();
}
/** 点击排序表头：同列切换方向，新列从升序开始。 */
export function toggleUserSort(current: UserQuery, column: UserSortBy): { sortBy: UserSortBy; sortDir: UserSortDir } {
  if ((current.sortBy ?? 'registered_at') === column) {
    return { sortBy: column, sortDir: (current.sortDir ?? 'desc') === 'asc' ? 'desc' : 'asc' };
  }
  return { sortBy: column, sortDir: 'asc' };
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
export const SYSTEM_ROLE_MINIMUMS: Record<string, string[]> = { operations: ['dashboard.read'], content_moderator: ['community.read', 'community.moderate'], read_only: ['dashboard.read'] };export function permissionDelta(before: Iterable<string>, after: Iterable<string>) {
  const a = new Set(before), b = new Set(after);
  return { added: [...b].filter(code => !a.has(code)).sort(), removed: [...a].filter(code => !b.has(code)).sort() };
}

// ===== 批次 3：批量操作与 CSV 导出 =====

export type BatchUserOp = 'ban' | 'unban' | 'adjustCredits';
export type BatchEntity = 'users' | 'posts';
export interface BatchOutcome {
  total: number; succeeded: number; failed: { id: string; error: string }[];
}
export interface BatchBody {
  entity: BatchEntity; op: BatchUserOp | 'hide' | 'restore';
  ids: string[]; params?: { delta?: number; reason?: string };
}

export const BATCH_ID_LIMIT = 100;

/** 组装批量请求体；ids 空或超 100 抛错（调用前 UI 已按勾选数禁用）。 */
export function buildUserBatchBody(op: BatchUserOp, ids: string[], params?: { delta?: number; reason?: string }): BatchBody {
  if (ids.length === 0 || ids.length > BATCH_ID_LIMIT) {
    throw new Error(`批量操作需选择 1-${BATCH_ID_LIMIT} 个用户`);
  }
  return { entity: 'users', op, ids, params };
}

/** 校验服务端批量结果；缺字段或类型不符返回 null（不伪造成功）。 */
export function parseBatchOutcome(value: unknown): BatchOutcome | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const total = candidate.total, succeeded = candidate.succeeded;
  if (typeof total !== 'number' || typeof succeeded !== 'number' || !Array.isArray(candidate.failed)) return null;
  const failed = (candidate.failed as unknown[]).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Record<string, unknown>;
    return typeof entry.id === 'string' && typeof entry.error === 'string'
      ? [{ id: entry.id, error: entry.error }]
      : [];
  });
  return { total, succeeded, failed };
}

export type CsvExportType = 'users' | 'credit-ledger' | 'redemptions' | 'audit-logs';
export const CSV_EXPORT_MAX = 10_000;

export function exportCsvPath(type: CsvExportType, limit = CSV_EXPORT_MAX): string {
  const bounded = Math.max(1, Math.min(CSV_EXPORT_MAX, Math.floor(limit)));
  return `/api/admin/export?type=${encodeURIComponent(type)}&limit=${bounded}`;
}

export function exportCsvFilename(type: CsvExportType, date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10).replaceAll('-', '');
  return `${type}-${stamp}.csv`;
}
