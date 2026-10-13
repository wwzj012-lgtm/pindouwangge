import { describe, expect, it } from 'vitest';
import { LatestRequest, SYSTEM_ROLE_MINIMUMS, emptyUserQuery, membershipDraft, membershipPresentation, membershipProposal, permissionDelta, returnedExpiry, userQueryString, type AdminUser } from './adminUserModel';

const now = 1_800_000_000_000;
const vip: AdminUser = { uid: 'test', email: 'test@example.invalid', role: 'user', member_type: 1, member_expire: now + 90 * 86_400_000 };
describe('committed user query and request order', () => {
  it('starts on first page without speculative filters', () => { expect(emptyUserQuery()).toEqual({ search: '', status: 'all', tag: '', page: 1 }); });
  it('serializes only existing server query fields', () => { const p = new URLSearchParams(userQueryString({ search: '  昵称  ', status: 'banned', tag: 'priority', page: 2 })); expect([...p.keys()].sort()).toEqual(['limit','page','search','status','tag']); expect(p.get('search')).toBe('昵称'); expect(p.get('limit')).toBe('20'); expect(p.get('page')).toBe('2'); });
  it('clamps a negative page and preserves default status', () => { const p = new URLSearchParams(userQueryString({ ...emptyUserQuery(), page: -1 })); expect(p.get('page')).toBe('1'); expect(p.get('status')).toBe('all'); });
  it('rejects a late earlier request', () => { const epoch = new LatestRequest(); const slow = epoch.next(), fast = epoch.next(); expect(epoch.current(fast)).toBe(true); expect(epoch.current(slow)).toBe(false); });
  it('invalidates response updates after unmount', () => { const epoch = new LatestRequest(); const id = epoch.next(); epoch.invalidate(); expect(epoch.current(id)).toBe(false); });
});
describe('role benefits are not paid fields', () => {
  it('shows an unpaid legacy administrator as role Pro without mutating data', () => { const admin = { ...vip, role: 'admin' as const, member_type: 0 as const, member_expire: null }; const before = JSON.stringify(admin); const view = membershipPresentation(admin, now); expect(view.effective).toBe('Pro（管理员角色）'); expect(view.paid).toBe('免费'); expect(JSON.stringify(admin)).toBe(before); });
  it('does not count expired paid membership as current effective benefits', () => { expect(membershipPresentation({ ...vip, member_expire: now - 1 }, now).effective).toBe('免费'); });
  it('marks hidden historical paid levels as unknown, not reconstructed', () => { const view = membershipPresentation({ ...vip, member_type: 0, member_expire: now - 1 }, now); expect(view.caveat).toContain('历史存储级别未提供'); expect(view.paid).toBe('免费'); });
  it('preserves an explicit primary null over a legacy alias', () => { expect(returnedExpiry({ ...vip, member_expire: null, memberExpire: now })).toBeNull(); });
  it('does not turn missing qualification into a made-up paid tier', () => { const view = membershipPresentation({ uid: 'unknown', email: '' }, now); expect(view.effective).toBe('资格未提供'); expect(view.paid).toBe('未提供'); });
});
describe('membership confirmation preserves existing conversion semantics', () => {
  it('defaults to keep and has no write for an unchanged finite membership', () => { const draft = membershipDraft(vip); expect(draft.expiry).toBe('keep'); const p = membershipProposal(vip, draft, now); expect(p.changed).toBe(false); expect(p.updates).toBeUndefined(); expect(p.expiry).toBe(vip.member_expire); });
  it('does not reset permanent membership without explicit change', () => { const user = { ...vip, member_expire: null }; const p = membershipProposal(user, membershipDraft(user), now); expect(p.changed).toBe(false); expect(p.updates).toBeUndefined(); });
  it('does not write a fake paid Pro for an administrator', () => { const user = { ...vip, role: 'admin' as const, member_type: 0 as const, member_expire: null }; const p = membershipProposal(user, membershipDraft(user), now); expect(p.updates).toBeUndefined(); expect(p.type).toBe(0); });
  it('retains a finite expiry when explicitly changing only VIP to Pro', () => { const p = membershipProposal(vip, { ...membershipDraft(vip), type: 2 }, now); expect(p.updates?.member_type).toBe(2); expect(p.updates?.member_expire).toBe(vip.member_expire); });
  it('uses now plus days times 86400000 only after explicit finite selection', () => { const p = membershipProposal(vip, { type: 1, expiry: 'days', days: '7' }, now); expect(p.updates?.member_expire).toBe(now + 7 * 86_400_000); });
  it('freezes the reviewed submitted value instead of recomputing it later', () => { const p = membershipProposal(vip, { type: 1, expiry: 'days', days: '30' }, now); expect(p.updates?.member_expire).toBe(now + 30 * 86_400_000); expect(p.expiry).toBe(p.updates?.member_expire); });
  it('explicit permanent submits null', () => { const p = membershipProposal(vip, { type: 1, expiry: 'lifetime', days: '30' }, now); expect(p.updates?.member_expire).toBeNull(); expect(p.updates?.member_type).toBe(1); });
  it('explicit free clears paid expiry with the original API fields', () => { const p = membershipProposal(vip, { type: 0, expiry: 'keep', days: '30' }, now); expect(p.updates).toEqual({ member_type: 0, member_expire: null, member_source: '后台用户管理' }); });
  it('does not silently grant permanent paid membership from a free null', () => { const p = membershipProposal({ ...vip, member_type: 0, member_expire: null }, { type: 1, expiry: 'keep', days: '30' }, now); expect(p.error).toContain('明确选择'); expect(p.updates).toBeUndefined(); });
  it('rejects invalid day options rather than serializing NaN', () => { const p = membershipProposal(vip, { type: 1, expiry: 'days', days: '-5' }, now); expect(p.error).toBeTruthy(); expect(p.updates).toBeUndefined(); });
});
describe('existing role protection and exact differences', () => {
  it('keeps the approved system role minimums unchanged', () => { expect(SYSTEM_ROLE_MINIMUMS).toEqual({ operations: ['dashboard.read'], content_moderator: ['community.read','community.moderate'], read_only: ['dashboard.read'] }); });
  it('lists exact added and removed permission codes', () => { expect(permissionDelta(['dashboard.read','users.read'], ['dashboard.read','roles.read'])).toEqual({ added: ['roles.read'], removed: ['users.read'] }); });
  it('does not invent a delta from reordering or duplicates', () => { expect(permissionDelta(['b','a'], ['a','b','a'])).toEqual({ added: [], removed: [] }); });
});
