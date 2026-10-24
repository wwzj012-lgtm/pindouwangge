import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AuthProvider, useAuth } from '../context/AuthContext';
import type { UserProfile } from '../lib/accountApi';
import { AuthModal } from './AuthModal';
import { VipPrivilegesModal } from './VipPrivilegesModal';
import { AccountManagementModal } from './AccountManagementModal';

// Real Provider and modal components; only API/credential boundaries are offline.
export async function runAccountSessionChecks(scenario: string) {
  const state = globalThis as any;
  const checks: string[] = [];
  const browserErrors: string[] = [];
  const requests: Array<{ path: string; token: string | null; body: any }> = [];
  let networkCalls = 0;
  window.fetch = async () => { networkCalls++; throw new Error('Live requests forbidden'); };
  window.addEventListener('error', event => browserErrors.push(event.message));
  window.addEventListener('unhandledrejection', event => browserErrors.push(String(event.reason)));
  const check = (value: unknown, name: string) => {
    if (!value) throw new Error(`${name}; observed=${JSON.stringify(snapshot())}`);
    checks.push(name);
  };
  const storage = (): Storage => {
    const values = new Map<string, string>();
    return {
      get length() { return values.size; },
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, String(value)); },
      removeItem: key => { values.delete(key); },
      clear: () => values.clear(), key: index => [...values.keys()][index] ?? null,
    };
  };
  Object.defineProperty(window, 'localStorage', { value: storage(), configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: storage(), configurable: true });
  const sessionKey = 'beadgrid_local_session';
  let token: string | null = null;
  let auth: ReturnType<typeof useAuth>;
  let openAuth: (value: boolean) => void;
  let openVip: (value: boolean) => void;
  let openAccount: (value: boolean) => void;
  let closeCalls = 0;
  let adminVisits = 0;
  let failLogout = false;
  let afterLogoutClear: (() => void) | undefined;
  const profile = (uid: string, overrides: Partial<UserProfile> = {}): UserProfile => ({
    uid, email: `${uid}@example.test`, displayName: uid, photoURL: null, role: 'user',
    member_type: 0, member_expire: null, isVip: false, vipExpireAt: null,
    freeTrialUsed: false, createdAt: 1, updatedAt: 1, ...overrides,
  });
  const upgraded = (uid: string) => profile(uid, { member_type: 1, isVip: true });
  const snapshot = () => ({
    uid: auth?.currentUser?.uid, profile: auth?.userProfile?.uid, vip: auth?.isVip,
    token, persistent: localStorage.getItem(sessionKey), session: sessionStorage.getItem(sessionKey),
    credits: auth?.creditSummary,
  });
  const routes = new Map<string, (body: any) => Promise<any>>();
  const request = async (path: string, body?: any) => {
    requests.push({ path, token, body });
    const route = routes.get(path);
    if (route) return route(body);
    if (path === '/api/credits/summary') return { ok: true, status: 200, data: { owner: token } };
    if (path === '/api/user-profile') return { ok: true, status: 200, data: auth.userProfile };
    throw new Error(`Unexpected offline API request: ${path}`);
  };
  state.__accountSessionApi = {
    apiGet: request, apiPost: request,
    apiGetCreditsSummary: () => request('/api/credits/summary'),
    apiCheckinCredits: () => request('/api/credits/checkin'),
    getApiToken: () => token,
    setApiToken: (value: string) => { token = value; },
    clearAdminSession: () => {},
    clearApiToken: () => {
      if (failLogout) { failLogout = false; throw new Error('Synthetic logout failure'); }
      token = null;
      const after = afterLogoutClear;
      afterLogoutClear = undefined;
      if (after) queueMicrotask(after);
    },
  };
  function Flow() {
    auth = useAuth();
    const [authOpen, setAuthOpen] = useState(false);
    const [vipOpen, setVipOpen] = useState(false);
    const [accountOpen, setAccountOpen] = useState(false);
    openAuth = setAuthOpen; openVip = setVipOpen; openAccount = setAccountOpen;
    return <>
      <output id="provider-state">{JSON.stringify(snapshot())}</output>
      <button onClick={() => setAuthOpen(true)}>打开账号</button>
      <button onClick={() => setVipOpen(true)}>打开权益</button>
      <AuthModal isOpen={authOpen} onClose={() => { closeCalls++; setAuthOpen(false); }} onOpenAdminPanel={() => { adminVisits++; }} />
      <VipPrivilegesModal isOpen={vipOpen} onClose={() => setVipOpen(false)} onOpenAuthModal={() => setAuthOpen(true)} />
      <AccountManagementModal isOpen={accountOpen} onClose={() => setAccountOpen(false)} />
    </>;
  }
  const root = createRoot(document.getElementById('root')!);
  const render = () => flushSync(() => root.render(<AuthProvider><Flow /></AuthProvider>));
  const tick = () => new Promise(resolve => setTimeout(resolve, 20));
  const buttons = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')]
    .filter(button => button.textContent?.trim() === label || button.getAttribute('aria-label') === label);
  const click = async (label: string) => {
    const button = buttons(label)[0];
    check(button && !button.disabled, `reachable button: ${label}`);
    flushSync(() => button.click()); await tick();
  };
  const input = async (selector: string, value: string) => {
    const node = document.querySelector<HTMLInputElement>(selector);
    check(node, `reachable input: ${selector}`);
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
      node!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await tick();
  };
  const login = async (uid: string, persistence: 'persistent' | 'session' = 'session', nextProfile = profile(uid), nextToken = `token-${uid}`) => {
    flushSync(() => { void auth.setLocalCustomUser({ token: nextToken, profile: nextProfile }, persistence); });
    await tick();
  };
  const logout = async () => { flushSync(() => { void auth.logoutUser(); }); await tick(); };
  const delay = (path: string) => {
    let finish!: (value: any) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    // Delay only the initiating request; B's independent request must get B's data.
    routes.set(path, () => { routes.delete(path); return pending; });
    return async (data: any) => { finish({ ok: true, status: 200, data }); await tick(); };
  };
  const unchanged = (before: ReturnType<typeof snapshot>, name: string) => {
    check(JSON.stringify(snapshot()) === JSON.stringify(before), name);
  };
  let unmounted = false;
  try {
    render(); await tick();
    check(!auth.loading && auth.currentUser === null, 'real Provider restores signed-out state');
    if (scenario === 'redeem') {
      await login('A', 'persistent'); await click('打开账号');
      const finish = delay('/api/redeem-code');
      await input('#membership-redeem-code', 'old-a'); await click('立即兑换');
      check(requests.at(-1)?.token === 'token-A', 'A redemption starts with A token');
      await click('关闭账号窗口'); await logout(); await login('B'); await click('打开账号');
      await input('#membership-redeem-code', 'new-b');
      const before = snapshot();
      await finish({ profile: upgraded('A') });
      unchanged(before, 'late A redeem cannot change B identity, membership, token, credits or storage');
      check(!document.querySelector('[role="status"]'), 'late A redeem has no success in reopened B modal');
      check(document.querySelector<HTMLInputElement>('#membership-redeem-code')?.value === 'NEW-B', 'B input remains usable');
      routes.set('/api/redeem-code', async () => ({ ok: true, status: 200, data: { profile: upgraded('B') } }));
      await click('立即兑换');
      check(auth.isVip && auth.userProfile?.uid === 'B', 'B normal redemption still updates real membership');
      check(document.querySelector('[role="status"]')?.textContent === '兑换成功', 'B redemption success feedback retained');
    } else if (scenario === 'scopes') {
      const operations: Array<[string, () => Promise<unknown>, (uid: string) => any]> = [
        ['/api/user-profile', () => auth.refreshProfile(), upgraded],
        ['/api/user-profile/update', () => auth.updateUserProfile({ displayName: 'updated' }), upgraded],
        ['/api/credits/summary', () => auth.refreshCreditSummary(), uid => ({ owner: uid })],
        ['/api/credits/checkin', () => auth.checkinCredits(), () => ({ success: true })],
        ['/api/auth/consume-free-trial', () => auth.consumeFreeTrial(), () => ({ consumed: true })],
        ['/api/redeem-code', () => auth.redeemVipCode('old'), uid => ({ profile: upgraded(uid) })],
      ];
      for (const [path, start, response] of operations) {
        routes.clear(); await login('A', 'persistent');
        const finish = delay(path);
        const pending = start();
        await logout(); await login('B');
        const before = snapshot(); const beforeRequests = requests.length;
        await finish(response('A')); await pending; await tick();
        unchanged(before, `${path}: late A operation cannot write B state or storage`);
        check(requests.length === beforeRequests, `${path}: stale operation cannot start follow-up requests as B`);
      }
      routes.clear(); await login('A');
      const finish = delay('/api/redeem-code'); const pending = auth.redeemVipCode('same-uid');
      await logout(); await login('A', 'persistent', profile('A'), 'new-token-A');
      const before = snapshot(); await finish({ profile: upgraded('A') }); await pending;
      unchanged(before, 'same uid after re-login still rejects previous session generation');
      routes.clear();
      const signedOutFinish = delay('/api/redeem-code'); const signedOutPending = auth.redeemVipCode('signed-out');
      await logout(); const signedOut = snapshot();
      await signedOutFinish({ profile: upgraded('A') }); await signedOutPending;
      unchanged(signedOut, 'logout invalidates pending redeem without a new login');
      routes.clear(); await login('A');
      const unauthorizedFinish = delay('/api/user-profile'); const unauthorizedPending = auth.refreshProfile();
      flushSync(() => window.dispatchEvent(new Event('unauthorized'))); await tick();
      const unauthorized = snapshot(); await unauthorizedFinish(upgraded('A')); await unauthorizedPending;
      unchanged(unauthorized, 'unauthorized invalidates pending profile refresh');
      routes.clear(); await login('A');
      const unmountFinish = delay('/api/user-profile/update'); const unmountPending = auth.updateUserProfile({ displayName: 'late' });
      const stored = sessionStorage.getItem(sessionKey);
      flushSync(() => root.unmount()); unmounted = true;
      await unmountFinish(upgraded('A')); await unmountPending;
      check(sessionStorage.getItem(sessionKey) === stored, 'unmounted Provider cannot persist late profile update');
    } else if (scenario === 'restore') {
      flushSync(() => root.unmount());
      // A separate root exercises the real initial restore, not just refreshProfile.
      const restoreRoot = createRoot(document.getElementById('root')!); unmounted = true;
      sessionStorage.setItem(sessionKey, JSON.stringify({ token: 'token-A', profile: profile('A') }));
      const finish = delay('/api/user-profile');
      flushSync(() => restoreRoot.render(<AuthProvider><Flow /></AuthProvider>)); await tick();
      await login('B', 'persistent'); const before = snapshot(); const beforeRequests = requests.length;
      await finish(upgraded('A'));
      unchanged(before, 'late restored A profile cannot overwrite B state or persisted session');
      check(requests.length === beforeRequests, 'stale restore cannot fetch B credits');
      check(!auth.loading, 'B login is not stuck behind an obsolete restore');
      flushSync(() => restoreRoot.unmount());
    } else if (scenario === 'logout') {
      await login('A'); await click('打开账号');
      // Flush identity before the await continuation, as a real Provider consumer may do.
      afterLogoutClear = render;
      await click('退出登录');
      check(auth.currentUser === null && !document.querySelector('[role="dialog"]'), 'successful real-Provider logout closes, rather than showing login form');
      check(closeCalls === 1, 'logout closes once');
      await login('A'); await click('打开账号'); failLogout = true;
      await click('退出登录');
      check(document.querySelector('[role="alert"]')?.textContent === '退出失败，请稍后重试', 'logout failure stays visible for retry');
      check(auth.currentUser?.uid === 'A' && !buttons('退出登录')[0].disabled, 'failed logout retains account and retry');
      afterLogoutClear = render; await click('退出登录');
      check(!document.querySelector('[role="dialog"]') && closeCalls === 2, 'logout retry closes successfully');
    } else if (scenario === 'reopen') {
      await login('A'); await click('打开账号');
      afterLogoutClear = () => {
        render();
        flushSync(() => openAuth(false));
        flushSync(() => { void auth.setLocalCustomUser({ token: 'token-B', profile: profile('B') }, 'session'); });
        flushSync(() => openAuth(true));
      };
      await click('退出登录');
      check(auth.currentUser?.uid === 'B' && document.querySelector('#membership-redeem-code'), 'A logout completion cannot close reopened B modal');
      check(closeCalls === 0, 'old logout does not invoke new modal close callback');
    } else if (scenario === 'layout') {
      await login('A'); await click('打开权益');
      for (const language of ['zh', 'en']) {
        state.__accountSessionLanguage = language; render(); await tick();
        const labels = language === 'zh' ? ['👑 VIP 专享功能', '全量功能清单', '权益对比表'] : ['VIP Exclusives', 'Full Feature List', 'Free vs VIP'];
        const tabs = labels.map(label => buttons(label)[0]);
        const group = tabs[0].parentElement!; const bar = group.parentElement!;
        check(group.scrollWidth <= group.clientWidth + 1 && bar.scrollWidth <= bar.clientWidth + 1, `${language}: tabs and CTA fit without horizontal clipping`);
        for (const tab of tabs) {
          const span = tab.querySelector('span')!; const range = document.createRange(); range.selectNodeContents(span);
          const box = tab.getBoundingClientRect(); const textBox = range.getBoundingClientRect();
          check(textBox.height <= parseFloat(getComputedStyle(span).lineHeight) + 2, `${language}: tab text stays horizontal: ${tab.textContent}`);
          check(box.left >= 0 && box.right <= innerWidth && box.top >= bar.getBoundingClientRect().top && box.bottom <= bar.getBoundingClientRect().bottom + 1, `${language}: tab fully visible and reachable`);
          check(textBox.left >= box.left && textBox.right <= box.right, `${language}: text remains inside tab`);
          flushSync(() => tab.click()); await tick();
        }
        const cta = buttons(language === 'zh' ? '兑换会员激活码' : 'Redeem membership code')[0];
        const box = cta.getBoundingClientRect();
        check(box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, `${language}: top redeem CTA fully visible`);
        flushSync(() => cta.click()); await tick();
        check(document.querySelector('#membership-redeem-code'), `${language}: top CTA opens real redemption`);
        flushSync(() => { openAuth(false); openVip(true); }); await tick();
      }
    } else if (scenario === 'capabilities') {
      await click('打开账号');
      routes.set('/api/auth/signin', async () => ({ ok: true, status: 200, data: { token: 'token-A', profile: profile('A') } }));
      await input('[name="username"]', 'creator'); await input('[name="password"]', 'offline-password');
      flushSync(() => document.querySelector<HTMLInputElement>('#remember-login')!.click()); await tick();
      await click('立即登录账号');
      check(auth.currentUser?.uid === 'A' && !document.querySelector('[role="dialog"]'), 'real Provider signin closes modal');
      check(!localStorage.getItem(sessionKey) && !!sessionStorage.getItem(sessionKey), 'signin retains session-only choice');
      await logout(); await click('打开账号'); await click('没有账号？点此注册');
      routes.set('/api/auth/signup', async () => ({ ok: true, status: 200, data: { token: 'token-B', profile: profile('B') } }));
      await input('[name="username"]', 'newcreator'); await input('[name="password"]', 'offline-password');
      await click('立即注册并登录');
      check(auth.currentUser?.uid === 'B' && !!localStorage.getItem(sessionKey), 'signup retains persistent login');
      await login('admin', 'session', profile('admin', { role: 'admin', canAccessAdmin: true })); await click('打开账号');
      await click('进入管理后台'); check(adminVisits === 1, 'real Provider admin callback retained');
      await login('B'); flushSync(() => openAccount(true)); await tick();
      routes.set('/api/user-profile/update', async body => ({ ok: true, status: 200, data: profile('B', body) }));
      await input('#account-display-name', '新昵称'); await click('保存个人资料修改');
      check(auth.currentUser?.displayName === '新昵称' && auth.userProfile?.displayName === '新昵称', 'profile editing retains both Provider identity and profile');
      check(JSON.parse(sessionStorage.getItem(sessionKey)!).profile.displayName === '新昵称', 'profile edit persists for the correct account');
    } else throw new Error(`Unknown scenario: ${scenario}`);
    check(networkCalls === 0, 'no live API requests');
    check(browserErrors.length === 0, 'no browser exceptions');
    return { checks, browserErrors, networkCalls, viewportWidth: innerWidth };
  } finally {
    if (!unmounted) flushSync(() => root.unmount());
  }
}
