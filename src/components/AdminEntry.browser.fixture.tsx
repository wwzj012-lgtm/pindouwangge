import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { UserProfileModal } from './UserProfileModal';
import { AuthModal } from './AuthModal';
import { MobileBottomNav } from './mobile/MobileBottomNav';
import type { UserProfile } from '../lib/accountApi';
import { setAdminSessionToken, getAdminSessionToken } from '../utils/api';

export async function runAdminEntryChecks() {
  const checks: string[] = [];
  const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
  const browserErrors: string[] = [];
  window.addEventListener('error', e => browserErrors.push(e.message));
  window.addEventListener('unhandledrejection', e => browserErrors.push(String(e.reason)));
  localStorage.clear(); sessionStorage.clear();
  let profile: UserProfile & { canAccessAdmin?: boolean; authProvider?: string };
  let profileStatus = 200;
  let delayed: ((r: Response) => void) | undefined;
  let delayNext = false;
  let delayUpdate = false;
  let requests = 0;
  let forbiddenRequests = 0;
  const response = (status: number, data: unknown) => new Response(JSON.stringify({ success: status === 200, data }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  window.fetch = async (input) => {
    requests++;
    const url = new URL(String(input));
    if (url.origin !== 'https://offline.invalid') { forbiddenRequests++; throw new Error('Live network forbidden'); }
    if (url.pathname === '/api/user-profile') {
      if (delayNext) { delayNext = false; return new Promise<Response>(resolve => { delayed = resolve; }); }
      return response(profileStatus, profile);
    }
    if (url.pathname === '/api/user-profile/update' && delayUpdate) {
      delayUpdate = false;
      return new Promise<Response>(resolve => { delayed = resolve; });
    }
    if (url.pathname === '/api/credits/summary') return response(200, { balanceUnits: 100 });
    if (url.pathname === '/api/user-patterns') return response(200, []);
    throw new Error(`Unexpected offline path ${url.pathname}`);
  };
  let auth: ReturnType<typeof useAuth>;
  let opened = 0;
  function Consumer() {
    auth = useAuth();
    const [showProfile, setShowProfile] = useState(false);
    const [showAuth, setShowAuth] = useState(false);
    return <>
      <MobileBottomNav currentTab="home" setCurrentTab={() => {}} onOpenProfile={() => setShowProfile(true)} />
      <button id="open-legacy" onClick={() => setShowAuth(true)}>旧会员入口</button>
      <UserProfileModal isOpen={showProfile} onClose={() => setShowProfile(false)} onOpenAccountManagement={() => {}} />
      <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} onOpenAdminPanel={() => { opened++; }} />
    </>;
  }
  const root = createRoot(document.getElementById('root')!);
  let mountedRoot: ReturnType<typeof createRoot> | null = root;
  const tick = () => new Promise(resolve => setTimeout(resolve, 30));
  const makeProfile = (uid: string, capability?: boolean, role: 'user' | 'admin' = 'user', member_type: 0 | 1 | 2 = 0) => ({
    uid, email: `${uid}@example.test`, displayName: uid, photoURL: null, role,
    member_type, member_expire: null, vipExpireAt: null, isVip: member_type > 0,
    canAccessAdmin: capability, createdAt: 1, updatedAt: 1,
  });
  const login = async (next: typeof profile) => {
    profile = next; profileStatus = 200;
    flushSync(() => { void auth.setLocalCustomUser({ token: `offline-${next.uid}`, profile: next }, 'session'); });
    await tick();
  };
  const mobileProfile = async () => {
    const me = [...document.querySelectorAll('nav button')].find(b => b.textContent?.trim() === '我的') as HTMLButtonElement;
    check(me, 'real mobile Me entry exists'); me.click(); await tick();
    check(document.querySelector('[aria-label="个人中心"]'), 'mobile entry opens real profile DOM');
  };
  const link = () => document.querySelector<HTMLAnchorElement>('[aria-label="个人中心"] a[href="/admin"]');
  const closeProfile = async () => { (document.querySelector('[aria-label="关闭个人中心"]') as HTMLButtonElement).click(); await tick(); };
  try {
    flushSync(() => root.render(<AuthProvider><Consumer /></AuthProvider>)); await tick();
    await mobileProfile(); check(!link(), 'signed-out user has no admin entry'); await closeProfile();
    for (const next of [makeProfile('ordinary', false), { ...makeProfile('guest', false), authProvider: 'guest' as const }, makeProfile('vip', false, 'user', 1), makeProfile('pro', false, 'user', 2), makeProfile('legacy-missing', undefined, 'admin')]) {
      await login(next); await mobileProfile(); check(!link(), `${next.uid}: capability missing/false hides admin entry`); await closeProfile();
    }
    for (const next of [makeProfile('admin', true, 'admin'), makeProfile('rbac', true)]) {
      await login(next); await mobileProfile();
      check(link(), `${next.uid}: independent admin entry in profile`);
      const rect = link()!.getBoundingClientRect();
      check(rect.height >= 44 && rect.width >= 44 && rect.left >= 0 && rect.right <= innerWidth, 'admin entry is mobile-accessible without horizontal clipping');
      check(link()!.textContent?.includes('管理后台'), 'entry has understandable standalone label');
      if (next.uid === 'rbac') check(!auth.isAdmin && !auth.isPro && !auth.isVip, 'pure RBAC grants no paid benefits');
      await closeProfile();
      document.getElementById('open-legacy')!.click(); await tick();
      const button = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '进入管理后台');
      check(button, `${next.uid}: old Auth entry uses same capability`); (button as HTMLButtonElement).click(); await tick();
    }
    check(opened === 2, 'legacy admin callbacks still work');
    await mobileProfile();
    profile = makeProfile('rbac', false); await auth.refreshProfile(); await tick();
    check(!link(), 'role revocation refresh removes open profile entry');
    profile = makeProfile('rbac', true); await auth.refreshProfile(); await tick();
    check(link(), 'restored grant refresh restores entry');
    profileStatus = 503; await auth.refreshProfile().catch(() => {}); await tick();
    check(!link(), 'failed capability refresh fails closed rather than retaining stale admin visibility');
    profileStatus = 200; await auth.refreshProfile(); await tick(); check(link(), 'successful refresh recovers capability');
    profile = makeProfile('rbac', false); window.dispatchEvent(new Event('focus')); await tick();
    check(!link(), 'focus refresh notices revocation while profile remains open');
    delayNext = true; const staleRefresh = auth.refreshProfile(); await tick();
    const finishStale = delayed!;
    await auth.refreshProfile(); await tick();
    finishStale(response(200, makeProfile('rbac', true))); await staleRefresh; await tick();
    check(!link(), 'older same-account refresh cannot overwrite newer revoked capability');
    delayUpdate = true; const staleUpdate = auth.updateUserProfile({ displayName: 'Old update' }); await tick();
    const finishUpdate = delayed!;
    await auth.refreshProfile(); await tick();
    finishUpdate(response(200, makeProfile('rbac', true))); await staleUpdate; await tick();
    check(!link(), 'late profile mutation cannot restore capability after newer revocation refresh');
    delayNext = true; const pending = auth.refreshProfile(); await tick();
    const finish = delayed!;
    await auth.logoutUser(); await login(makeProfile('B', false));
    finish(response(200, makeProfile('rbac', true))); await pending; await tick();
    check(auth.currentUser?.uid === 'B' && !link(), 'late A capability cannot grant B an entry');
    await auth.logoutUser(); await tick(); check(!link(), 'logout removes admin capability');
    // A persisted capability is not current server evidence during restoration.
    flushSync(() => root.unmount());
    mountedRoot = null;
    sessionStorage.setItem('beadgrid_local_session', JSON.stringify({ token: 'offline-restored', profile: makeProfile('cached', true) }));
    profile = makeProfile('cached', false); delayNext = true;
    setAdminSessionToken('offline-tab-admin-session');
    const restoreRoot = createRoot(document.getElementById('root')!);
    mountedRoot = restoreRoot;
    flushSync(() => restoreRoot.render(<AuthProvider><Consumer /></AuthProvider>)); await tick();
    check(getAdminSessionToken() === 'offline-tab-admin-session', 'ordinary page restore preserves existing same-tab second credential');
    await mobileProfile(); check(!link(), 'cached capability hidden while restore fetch is pending');
    delayed!(response(200, profile)); await tick(); check(!link(), 'server revocation wins over stored grant');
    check(!forbiddenRequests && !browserErrors.length, 'no live requests or browser exceptions');
    return { checks, browserErrors, forbiddenRequests, requests, viewportWidth: innerWidth };
  } finally { if (mountedRoot) flushSync(() => mountedRoot!.unmount()); }
}
