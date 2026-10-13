import { describe, expect, it } from 'vitest';
import type { UserProfile } from '../lib/accountApi';
import { canUseSavingTarget, getSmartReduceMembership } from '../utils/smartReduceAccess';
import { deriveMembershipState } from './AuthContext';

const now = Date.UTC(2026, 9, 13);

function profile(overrides: Partial<UserProfile>): UserProfile {
  return {
    uid: 'membership-test-user',
    email: 'membership@example.test',
    displayName: 'Membership test',
    photoURL: null,
    role: 'user',
    member_type: 0,
    member_expire: null,
    vipExpireAt: null,
    isVip: false,
    freeTrialUsed: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface MembershipCase {
  name: string;
  input: Partial<UserProfile>;
  memberType: 0 | 1 | 2;
  isVip: boolean;
  isPro: boolean;
  isAdmin: boolean;
  reducerTier: 'free' | 'vip' | 'pro';
}

const cases: MembershipCase[] = [
  { name: 'admin type 0 gets effective Pro', input: { role: 'admin', isVip: true }, memberType: 2, isVip: true, isPro: true, isAdmin: true, reducerTier: 'pro' },
  { name: 'admin type 1 gets effective Pro', input: { role: 'admin', member_type: 1, member_expire: now + 1, isVip: true }, memberType: 2, isVip: true, isPro: true, isAdmin: true, reducerTier: 'pro' },
  { name: 'admin expired type 1 gets effective Pro', input: { role: 'admin', member_type: 1, member_expire: now - 1, isVip: true }, memberType: 2, isVip: true, isPro: true, isAdmin: true, reducerTier: 'pro' },
  { name: 'admin with active Pro retains both benefits', input: { role: 'admin', member_type: 2, member_expire: now + 1, isVip: true }, memberType: 2, isVip: true, isPro: true, isAdmin: true, reducerTier: 'pro' },
  { name: 'admin with expired Pro retains effective Pro', input: { role: 'admin', member_type: 2, member_expire: now - 1, isVip: true }, memberType: 2, isVip: true, isPro: true, isAdmin: true, reducerTier: 'pro' },
  { name: 'ordinary VIP gets VIP only', input: { member_type: 1, member_expire: now + 1, isVip: true }, memberType: 1, isVip: true, isPro: false, isAdmin: false, reducerTier: 'vip' },
  { name: 'expired VIP has neither benefit', input: { member_type: 1, member_expire: now - 1, isVip: true }, memberType: 0, isVip: false, isPro: false, isAdmin: false, reducerTier: 'free' },
  { name: 'active Pro gets both benefits', input: { member_type: 2, member_expire: now + 1, isVip: true }, memberType: 2, isVip: true, isPro: true, isAdmin: false, reducerTier: 'pro' },
  { name: 'expired Pro cannot use a stale isVip flag', input: { member_type: 2, member_expire: now - 1, isVip: true }, memberType: 0, isVip: false, isPro: false, isAdmin: false, reducerTier: 'free' },
  { name: 'ordinary type 0 has neither benefit', input: {}, memberType: 0, isVip: false, isPro: false, isAdmin: false, reducerTier: 'free' },
  { name: 'ordinary type 0 is not promoted by isVip alone', input: { isVip: true }, memberType: 0, isVip: false, isPro: false, isAdmin: false, reducerTier: 'free' },
  { name: 'VIP still requires the server membership flag', input: { member_type: 1, member_expire: now + 1 }, memberType: 0, isVip: false, isPro: false, isAdmin: false, reducerTier: 'free' },
  { name: 'Pro still requires the server membership flag', input: { member_type: 2, member_expire: now + 1 }, memberType: 0, isVip: false, isPro: false, isAdmin: false, reducerTier: 'free' },
];

describe('AuthProvider membership derivation and downstream permissions', () => {
  it.each(cases)('$name', ({ input, memberType, isVip, isPro, isAdmin, reducerTier }) => {
    const state = deriveMembershipState(profile(input), now);
    expect(state).toMatchObject({ memberType, isVip, isPro, isAdmin });
    const membership = getSmartReduceMembership(state.isVip, state.isPro);
    expect(membership).toBe(reducerTier);
    expect(canUseSavingTarget(40, membership)).toBe(isPro);
  });

  it.each([
    { role: 'user' as const, type: 1 as const, expiresAt: now, memberType: 0, isVip: false, isPro: false },
    { role: 'user' as const, type: 2 as const, expiresAt: now, memberType: 0, isVip: false, isPro: false },
    { role: 'admin' as const, type: 2 as const, expiresAt: now, memberType: 2, isVip: true, isPro: true },
    { role: 'user' as const, type: 2 as const, expiresAt: now + 1, memberType: 2, isVip: true, isPro: true },
    { role: 'user' as const, type: 2 as const, expiresAt: null, memberType: 2, isVip: true, isPro: true },
  ])('preserves expiry rules for $role type $type at $expiresAt', ({ role, type, expiresAt, memberType, isVip, isPro }) => {
    expect(deriveMembershipState(profile({ role, member_type: type, member_expire: expiresAt, isVip: true }), now))
      .toMatchObject({ memberExpire: role === 'admin' ? null : expiresAt, memberType, isVip, isPro });
  });

  it('keeps signed-out users without any membership or administrator benefit', () => {
    expect(deriveMembershipState(null, now)).toEqual({
      active: false, memberExpire: null, memberType: 0, isVip: false, isPro: false, isAdmin: false,
    });
  });

  it('normalizes a missing expiry without changing the existing permanent-membership rule', () => {
    const input = profile({ member_type: 2, isVip: true });
    // Older/malformed JSON can omit this required field at runtime.
    Reflect.deleteProperty(input, 'member_expire');
    expect(deriveMembershipState(input, now)).toEqual({
      active: true, memberExpire: null, memberType: 2, isVip: true, isPro: true, isAdmin: false,
    });
  });

  it('grants administrator Pro without changing the paid-active flag used by free trials', () => {
    expect(deriveMembershipState(profile({ role: 'admin', member_type: 2, isVip: false }), now))
      .toEqual({ active: false, memberExpire: null, memberType: 2, isVip: true, isPro: true, isAdmin: true });
  });

  it.each([0, 1, 2] as const)('keeps raw type %s and expiry intact while exposing effective Pro', (type) => {
    const input = Object.freeze(profile({ role: 'admin', member_type: type, member_expire: now - 1, vipExpireAt: now - 2, isVip: false }));
    const before = { ...input };
    expect(deriveMembershipState(input, now)).toEqual({
      active: false, memberExpire: null, memberType: 2, isVip: true, isPro: true, isAdmin: true,
    });
    expect(input).toEqual(before);
  });

  it.each([
    { type: 0 as const, expiresAt: null, memberType: 0, isVip: false, isPro: false },
    { type: 1 as const, expiresAt: now + 1, memberType: 1, isVip: true, isPro: false },
    { type: 1 as const, expiresAt: now - 1, memberType: 0, isVip: false, isPro: false },
    { type: 2 as const, expiresAt: now + 1, memberType: 2, isVip: true, isPro: true },
    { type: 2 as const, expiresAt: now - 1, memberType: 0, isVip: false, isPro: false },
  ])('removing admin restores raw type $type with expiry $expiresAt', ({ type, expiresAt, memberType, isVip, isPro }) => {
    const input = profile({ role: 'admin', member_type: type, member_expire: expiresAt, isVip: true });
    expect(deriveMembershipState(input, now)).toMatchObject({ memberType: 2, memberExpire: null, isPro: true });
    expect(deriveMembershipState({ ...input, role: 'user' }, now))
      .toMatchObject({ memberType, memberExpire: expiresAt, isVip, isPro, isAdmin: false });
  });
});
