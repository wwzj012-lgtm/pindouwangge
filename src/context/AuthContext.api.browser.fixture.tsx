import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AuthProvider, useAuth } from './AuthContext';
import type { UserProfile } from '../lib/accountApi';
import {
  apiGet, apiPost, apiGetBlob, apiPostBlob, createAdminSession,
  getApiToken, getAdminSessionToken, setApiToken, setAdminSessionToken, clearAdminSession,
} from '../utils/api';

// No API aliases: requests go through the real client and only fetch is offline.
export async function runRealApiSessionChecks(scenario: string) {
  const checks: string[] = [];
  const browserErrors: string[] = [];
  let unauthorizedEvents = 0;
  let storageWrites = 0;
  let fetchCalls = 0;
  let forbiddenRequests = 0;
  const check = (value: unknown, message: string) => {
    if (!value) throw new Error(message); // Never print credentials or raw storage.
    checks.push(message);
  };
  window.addEventListener('error', event => browserErrors.push(event.message));
  window.addEventListener('unhandledrejection', event => browserErrors.push(String(event.reason)));
  window.addEventListener('unauthorized', () => { unauthorizedEvents++; });
  const storage = (): Storage => {
    const values = new Map<string, string>();
    return {
      get length() { return values.size; },
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { storageWrites++; values.set(key, String(value)); },
      removeItem: key => { storageWrites++; values.delete(key); },
      clear: () => { storageWrites++; values.clear(); },
      key: index => [...values.keys()][index] ?? null,
    };
  };
  Object.defineProperty(window, 'localStorage', { value: storage(), configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: storage(), configurable: true });
  const profile = (uid: string, vip = false): UserProfile => ({
    uid, email: `${uid}@example.test`, displayName: uid, photoURL: null, role: 'user',
    member_type: vip ? 1 : 0, member_expire: null, vipExpireAt: null, isVip: vip,
    freeTrialUsed: false, createdAt: 1, updatedAt: 1,
  });
  const response = (status: number, data?: unknown) => new Response(JSON.stringify({
    success: status === 200, data, message: status === 200 ? undefined : 'Synthetic request rejected',
  }), { status, headers: { 'Content-Type': 'application/json' } });
  let delayed: { path: string; resolve: (response: Response) => void; requested: boolean; authenticated: boolean } | undefined;
  const delay = (path: string) => {
    let resolve!: (response: Response) => void;
    const promise = new Promise<Response>(finish => { resolve = finish; });
    const entry = { path, resolve, requested: false, authenticated: false };
    delayed = entry;
    return { entry, promise };
  };
  let pendingFetch: Promise<Response> | undefined;
  window.fetch = async (input, options) => {
    fetchCalls++;
    const url = new URL(String(input));
    if (url.origin !== 'https://offline.invalid') {
      forbiddenRequests++;
      throw new Error('Unexpected API origin; live requests forbidden');
    }
    if (delayed && !delayed.requested && url.pathname === delayed.path) {
      delayed.requested = true;
      delayed.authenticated = new Headers(options?.headers).get('Authorization') === `Bearer ${getApiToken()}`;
      return pendingFetch!;
    }
    if (url.pathname === '/api/credits/summary') return response(200, { balanceUnits: 200, availableUnits: 200 });
    throw new Error('Unexpected offline API path');
  };
  let auth: ReturnType<typeof useAuth>;
  function Consumer() {
    auth = useAuth();
    return <output id="identity">{JSON.stringify({ uid: auth.currentUser?.uid, profileUid: auth.userProfile?.uid, vip: auth.isVip })}</output>;
  }
  const root = createRoot(document.getElementById('root')!);
  const tick = () => new Promise(resolve => setTimeout(resolve, 20));
  const login = async (uid: string, persistence: 'persistent' | 'session' = 'session', credential = `synthetic-${uid}`) => {
    flushSync(() => { void auth.setLocalCustomUser({ token: credential, profile: profile(uid) }, persistence); });
    await tick();
  };
  const logout = async () => { flushSync(() => { void auth.logoutUser(); }); await tick(); };
  const stored = (value: Storage) => Array.from({ length: value.length }, (_, index) => {
    const key = value.key(index)!; return [key, value.getItem(key)];
  }).sort(([a], [b]) => a!.localeCompare(b!));
  const snapshot = () => JSON.stringify({
    user: auth.currentUser, profile: auth.userProfile, vip: auth.isVip, credits: auth.creditSummary,
    persistent: stored(localStorage), session: stored(sessionStorage),
  });
  const begin = (path: string, start: () => Promise<unknown>) => {
    const waiting = delay(path); pendingFetch = waiting.promise;
    const pending = start();
    check(waiting.entry.requested, `${path}: real client reaches mock fetch`);
    check(waiting.entry.authenticated, `${path}: initiating request captures current bearer`);
    return { pending, finish: waiting.entry.resolve };
  };
  const unchangedAfter = async (pending: Promise<unknown>, finish: (response: Response) => void, status: number, data: unknown, name: string) => {
    const before = snapshot(); const eventsBefore = unauthorizedEvents; const writesBefore = storageWrites;
    finish(response(status, data)); await pending; await tick();
    check(snapshot() === before, `${name}: current identity, membership and both storages unchanged`);
    check(storageWrites === writesBefore, `${name}: no late storage mutation`);
    check(unauthorizedEvents === eventsBefore, `${name}: no late unauthorized event`);
  };
  try {
    flushSync(() => root.render(<AuthProvider><Consumer /></AuthProvider>)); await tick();
    check(!auth.loading && !auth.currentUser, 'real Provider starts signed out');
    if (scenario === 'refresh' || scenario === 'redeem') {
      const path = scenario === 'refresh' ? '/api/user-profile' : '/api/redeem-code';
      for (const persistence of ['persistent', 'session'] as const) {
        for (const status of [200, 500, 401]) {
          await login('A');
          const { pending, finish } = begin(path, () => scenario === 'refresh' ? auth.refreshProfile() : auth.redeemVipCode('offline-code'));
          await logout(); await login('B', persistence);
          setAdminSessionToken('synthetic-current-admin');
          await unchangedAfter(pending, finish, status, scenario === 'refresh' ? profile('A', true) : { profile: profile('A', true) }, `${scenario} ${status}, B ${persistence}`);
          check(auth.currentUser?.uid === 'B' && auth.userProfile?.uid === 'B' && !auth.isVip, 'B stays non-VIP after A response');
        }
      }
    } else if (scenario === 'transports') {
      const cases: Array<[string, string, () => Promise<unknown>, number]> = [
        ['JSON', '/api/user-profile', () => apiGet('/api/user-profile'), 401],
        ['blob', '/api/community/preview', () => apiGetBlob('/api/community/preview'), 401],
        ['upload', '/api/community/assets', () => apiPostBlob('/api/community/assets', new Blob(['offline']), 'image/png'), 401],
        ['admin', '/api/admin/users', () => apiGet('/api/admin/users'), 401],
        ['admin forbidden', '/api/admin/users', () => apiGet('/api/admin/users'), 403],
        ['admin unlock', '/api/admin/session', () => createAdminSession('synthetic-not-a-secret'), 401],
      ];
      for (const [name, path, start, status] of cases) {
        await login('A'); setAdminSessionToken('synthetic-admin-A');
        const { pending, finish } = begin(path, start);
        await logout(); await login('B', 'persistent'); setAdminSessionToken('synthetic-admin-B');
        await unchangedAfter(pending, finish, status, null, `${name} late ${status}`);
      }
    } else if (scenario === 'current') {
      const cases: Array<[string, string, () => Promise<unknown>]> = [
        ['Provider refresh', '/api/user-profile', () => auth.refreshProfile()],
        ['Provider redeem', '/api/redeem-code', () => auth.redeemVipCode('offline-code')],
        ['JSON', '/api/user-profile', () => apiGet('/api/user-profile')],
        ['blob', '/api/community/preview', () => apiGetBlob('/api/community/preview')],
        ['upload', '/api/community/assets', () => apiPostBlob('/api/community/assets', new Blob(['offline']), 'image/png')],
        ['admin', '/api/admin/users', () => apiGet('/api/admin/users')],
        ['admin unlock', '/api/admin/session', () => createAdminSession('synthetic-not-a-secret')],
      ];
      for (const [name, path, start] of cases) {
        await login('current', 'persistent'); setAdminSessionToken('synthetic-current-admin');
        const { pending, finish } = begin(path, start); const before = unauthorizedEvents;
        finish(response(401)); await pending; await tick();
        check(!auth.currentUser && !auth.userProfile && !auth.isVip, `${name}: current 401 clears Provider`);
        check(!getApiToken() && !getAdminSessionToken() && localStorage.length === 0 && sessionStorage.length === 0, `${name}: current 401 clears both session storages`);
        check(unauthorizedEvents === before + 1, `${name}: current 401 emits exactly one unauthorized`);
      }
      await login('current'); setAdminSessionToken('synthetic-current-admin');
      const { pending, finish } = begin('/api/admin/users', () => apiGet('/api/admin/users')); const before = unauthorizedEvents;
      finish(response(403)); await pending; await tick();
      check(auth.currentUser?.uid === 'current' && !!getApiToken() && !getAdminSessionToken(), 'current admin 403 clears only admin credentials');
      check(unauthorizedEvents === before, 'admin 403 never emits unauthorized');
      for (const path of ['/api/auth/signin', '/api/auth/signup']) {
        const { pending, finish } = begin(path, () => apiPost(path, {}));
        await unchangedAfter(pending, finish, 401, null, `${path}: existing login exemption retained`);
      }
    } else if (scenario === 'credentials') {
      await login('same', 'session', 'synthetic-reused-user');
      let waiting = begin('/api/user-profile', () => auth.refreshProfile());
      await logout(); await login('same', 'persistent', 'synthetic-reused-user');
      await unchangedAfter(waiting.pending, waiting.finish, 401, null, 'same bearer after re-login belongs to a new generation');
      await login('same'); setAdminSessionToken('synthetic-admin-old');
      waiting = begin('/api/admin/users', () => apiGet('/api/admin/users'));
      setAdminSessionToken('synthetic-admin-new');
      await unchangedAfter(waiting.pending, waiting.finish, 401, null, 'rotated admin token with unchanged user token');
      waiting = begin('/api/admin/users', () => apiGet('/api/admin/users'));
      clearAdminSession(); setAdminSessionToken('synthetic-admin-new');
      await unchangedAfter(waiting.pending, waiting.finish, 403, null, 'same admin bearer after re-unlock belongs to a new generation');
      waiting = begin('/api/user-profile', () => apiGet('/api/user-profile'));
      // Simulate another tab changing storage without calling the local setters.
      sessionStorage.setItem('beadgrid_worker_jwt', 'synthetic-storage-replacement');
      await unchangedAfter(waiting.pending, waiting.finish, 401, null, 'raw storage token change also rejects stale invalidation');
      setApiToken('synthetic-storage-replacement', false);
      await logout();
      const anonymous = delay('/api/user-profile'); pendingFetch = anonymous.promise;
      const anonymousPending = apiGet('/api/user-profile');
      check(anonymous.entry.requested, 'anonymous request issued before new login');
      await login('B');
      await unchangedAfter(anonymousPending, anonymous.entry.resolve, 401, null, 'anonymous old 401 cannot clear a new login');
    } else throw new Error('Unknown real API scenario');
    check(forbiddenRequests === 0, 'no non-mocked or live fetch requests');
    check(browserErrors.length === 0, 'no browser exceptions');
    return { checks, browserErrors, fetchCalls, forbiddenRequests };
  } finally {
    flushSync(() => root.unmount());
  }
}
