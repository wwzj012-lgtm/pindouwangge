import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { UserProfile } from '../lib/accountApi';
import { canUseSavingTarget, getSmartReduceMembership } from '../utils/smartReduceAccess';
import { AuthProvider, useAuth } from './AuthContext';

// Browser-only test fixture: no app entrypoint, real accounts, or network.
const now = Date.UTC(2026, 9, 13);
const sessionKey = 'beadgrid_local_session';
const checks: string[] = [];
const requests: string[] = [];
const browserErrors: string[] = [];
let auth: ReturnType<typeof useAuth>;
let nextProfile: UserProfile;
let token: string | null = null;

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'provider-fixture-user', email: 'provider@example.test', displayName: 'Synthetic only',
    photoURL: null, role: 'user', member_type: 0, member_expire: null, vipExpireAt: null,
    isVip: false, freeTrialUsed: false, createdAt: now, updatedAt: now, ...overrides,
  };
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

function assert(value: boolean, message: string): void {
  if (!value) throw new Error(message);
}

function Consumer() {
  auth = useAuth();
  const { loading, memberType, memberExpire, isVip, isPro, isAdmin, hasFreeTrial } = auth;
  return (
    <>
      <output id="membership">{JSON.stringify({
        loading, memberType, memberExpire, isVip, isPro, isAdmin, hasFreeTrial,
        uid: auth.currentUser?.uid ?? null,
        canSave40: canUseSavingTarget(40, getSmartReduceMembership(isVip, isPro)),
      })}</output>
      <button id="vip-consumer" disabled={!isVip}>VIP consumer</button>
    </>
  );
}

function check(name: string, expected: Record<string, unknown>): void {
  const observed = JSON.parse(document.getElementById('membership')!.textContent!);
  for (const [key, value] of Object.entries(expected)) {
    assert(Object.is(observed[key], value), `${name}: ${key}: expected ${value}, received ${observed[key]}`);
  }
  assert(observed.canSave40 === observed.isPro, `${name}: 40% must match paid Pro`);
  assert((document.getElementById('vip-consumer') as HTMLButtonElement).disabled === !observed.isVip, `${name}: consumer wiring`);
  assert(!observed.loading, `${name}: restore must finish`);
  checks.push(name);
}

export async function runProviderChecks(): Promise<void> {
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    __providerMockApi: {
      apiGet: async (path: string) => {
        assert(path === '/api/user-profile', `Unexpected mock GET: ${path}`);
        requests.push(path);
        return { ok: true, data: nextProfile };
      },
      apiGetCreditsSummary: async () => {
        requests.push('/api/credits/summary (mock)');
        return { ok: false, status: 404 };
      },
      apiPost: async () => { throw new Error('Unexpected mock POST'); },
      apiCheckinCredits: async () => { throw new Error('Unexpected mock check-in'); },
      clearApiToken: () => { token = null; },
      clearAdminSession: () => undefined,
      getApiToken: () => token,
      setApiToken: (value: string) => { token = value; },
    },
  });
  Date.now = () => now;
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: memoryStorage(), configurable: true });
  console.error = (...args: unknown[]) => { browserErrors.push(args.map(String).join(' ')); };
  const container = document.getElementById('root')!;
  let root = createRoot(container);
  const mount = async () => { await act(async () => { root.render(<AuthProvider><Consumer /></AuthProvider>); }); };
  const login = async (value: UserProfile) => {
    await act(async () => {
      await auth.setLocalCustomUser({ token: 'synthetic-token-not-a-credential', profile: value }, 'session');
    });
  };

  try {
    await mount();
    check('signed out', { uid: null, memberType: 0, memberExpire: null, isVip: false, isPro: false, isAdmin: false, hasFreeTrial: false });
    const cases: Array<[string, Partial<UserProfile>, number, boolean, boolean, boolean]> = [
      ['admin type0', { role: 'admin', isVip: true }, 0, true, false, false],
      ['admin without membership flag', { role: 'admin', isVip: false }, 0, true, false, true],
      ['admin paid Pro', { role: 'admin', isVip: true, member_type: 2, member_expire: now + 1 }, 2, true, true, false],
      ['admin expired Pro', { role: 'admin', isVip: true, member_type: 2, member_expire: now - 1 }, 0, true, false, true],
      ['admin exact expiry', { role: 'admin', isVip: true, member_type: 2, member_expire: now }, 0, true, false, true],
      ['ordinary VIP', { isVip: true, member_type: 1, member_expire: now + 1 }, 1, true, false, false],
      ['ordinary Pro', { isVip: true, member_type: 2, member_expire: now + 1 }, 2, true, true, false],
      ['expired VIP', { isVip: true, member_type: 1, member_expire: now - 1 }, 0, false, false, true],
      ['expired Pro', { isVip: true, member_type: 2, member_expire: now - 1 }, 0, false, false, true],
      ['exact Pro expiry', { isVip: true, member_type: 2, member_expire: now }, 0, false, false, true],
      ['permanent Pro', { isVip: true, member_type: 2, member_expire: null }, 2, true, true, false],
      ['missing expiry Pro', { isVip: true, member_type: 2, member_expire: undefined }, 2, true, true, false],
      ['paid type without flag', { member_type: 2, member_expire: now + 1 }, 0, false, false, true],
      ['ordinary type0 with flag', { isVip: true }, 0, false, false, false],
      ['free trial available', {}, 0, false, false, true],
      ['free trial used', { freeTrialUsed: true }, 0, false, false, false],
      ['expired admin trial used', { role: 'admin', isVip: true, member_type: 2, member_expire: now - 1, freeTrialUsed: true }, 0, true, false, false],
    ];
    for (const [name, input, memberType, isVip, isPro, hasFreeTrial] of cases) {
      await login(profile(input));
      check(name, { uid: 'provider-fixture-user', memberType, memberExpire: input.member_expire ?? null, isVip, isPro, isAdmin: input.role === 'admin', hasFreeTrial });
    }

    nextProfile = profile({ role: 'admin', member_type: 2, isVip: true, member_expire: now + 1 });
    await act(async () => { await auth.refreshProfile(); });
    check('mock profile refresh grants paid Pro', { memberType: 2, isVip: true, isPro: true, isAdmin: true, hasFreeTrial: false });
    nextProfile = profile({ role: 'admin', member_type: 2, isVip: true, member_expire: now });
    await act(async () => { await auth.refreshProfile(); });
    check('mock profile refresh expires Pro but retains admin VIP', { memberType: 0, isVip: true, isPro: false, isAdmin: true, hasFreeTrial: true });
    await act(async () => { window.dispatchEvent(new Event('unauthorized')); });
    check('unauthorized clears permissions', { uid: null, memberType: 0, isVip: false, isPro: false, isAdmin: false, hasFreeTrial: false });
    assert(localStorage.length === 0 && sessionStorage.length === 0 && token === null, 'Unauthorized must clear synthetic session');

    await login(profile({ role: 'admin' }));
    await act(async () => { await auth.logoutUser(); });
    check('logout clears permissions', { uid: null, isVip: false, isPro: false, isAdmin: false, hasFreeTrial: false });
    await act(async () => { root.unmount(); });
    sessionStorage.setItem(sessionKey, JSON.stringify({ token: 'synthetic-restored-session', profile: profile({ role: 'admin' }) }));
    nextProfile = profile({ role: 'admin', member_type: 2, isVip: true, member_expire: now - 1 });
    root = createRoot(container);
    await mount();
    check('restored session uses refreshed expired-admin profile', { uid: 'provider-fixture-user', memberType: 0, isVip: true, isPro: false, isAdmin: true, hasFreeTrial: true });
    assert(auth.userProfile?.member_expire === now - 1, 'Restore must use the mock response, not stale cached profile');
    assert(JSON.parse(sessionStorage.getItem(sessionKey)!).profile.member_expire === now - 1, 'Restore must persist the refreshed synthetic profile');
    assert(requests.filter((path) => path === '/api/user-profile').length === 3, 'Expected three real Provider mock GET calls');
    assert(browserErrors.length === 0, `Unexpected React errors: ${browserErrors.join('; ')}`);
  } finally {
    await act(async () => { root.unmount(); });
  }
  document.getElementById('result')!.textContent = JSON.stringify({ checks, requests, browserErrors });
  document.body.dataset.result = 'passed';
}
