import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AuthModal } from './AuthModal';
import { VipPrivilegesModal } from './VipPrivilegesModal';
import { AccountManagementModal } from './AccountManagementModal';

// Used only by the offline esbuild aliases in MembershipRedemption.browser.test.ts.
export async function runMembershipChecks() {
  const state = globalThis as any;
  const checks: string[] = [];
  const browserErrors: string[] = [];
  window.addEventListener('error', e => browserErrors.push(e.message));
  window.addEventListener('unhandledrejection', e => browserErrors.push(String(e.reason)));
  let networkCalls = 0;
  window.fetch = async () => { networkCalls++; throw new Error('Live requests forbidden'); };
  const check = (value: unknown, name: string) => {
    if (!value) throw new Error(name);
    checks.push(name);
  };
  const tick = () => new Promise(resolve => setTimeout(resolve, 20));
  const text = () => document.getElementById('root')!.textContent ?? '';
  const root = createRoot(document.getElementById('root')!);
  let sequence = 0;
  let adminVisits = 0;
  let legacyGalleryVisits = 0;
  let logoutCalls = 0;
  let redeemCalls: string[] = [];
  let profileWrites: any[] = [];
  let apiCalls: any[] = [];
  let persistence: string | undefined;
  let credentialSaves = 0;
  let redeem: (code: string) => Promise<any> = async () => ({ success: true, message: '兑换成功' });
  let save: (changes: any) => Promise<any> = async () => ({ success: true, message: '资料已更新' });
  let logout: () => Promise<void> = async () => {};
  let api: () => Promise<any> = async () => ({ ok: true, data: { token: 'offline-token', profile: { uid: 'signed-in' } } });
  state.__membershipApi = async (...args: any[]) => { apiCalls.push(args); return api(); };
  state.__membershipCredentials = async () => { credentialSaves++; };
  state.__membershipLanguage = 'zh';
  const profile = { uid: 'member', displayName: '离线用户', email: 'offline@example.test', photoURL: '', member_type: 0, role: 'user', member_expire: null };
  const auth = (overrides = {}) => ({
    currentUser: { uid: 'member' }, userProfile: { ...profile }, loading: false,
    isVip: false, isPro: false, isAdmin: false, canAccessAdmin: false,
    redeemVipCode: async (code: string) => { redeemCalls.push(code); return redeem(code); },
    logoutUser: async () => { logoutCalls++; await logout(); },
    updateUserProfile: async (changes: any) => { profileWrites.push(changes); return save(changes); },
    setLocalCustomUser: async (_session: unknown, nextPersistence: string) => { persistence = nextPersistence; },
    ...overrides,
  });
  function Flow({ screen }: { screen: 'vip' | 'account'; key?: number }) {
    const [vipOpen, setVipOpen] = useState(screen === 'vip');
    const [authOpen, setAuthOpen] = useState(false);
    const [accountOpen, setAccountOpen] = useState(screen === 'account');
    return <>
      <button onClick={() => setVipOpen(true)}>重新打开会员权益</button>
      <button onClick={() => setAccountOpen(true)}>重新打开资料编辑</button>
      <VipPrivilegesModal isOpen={vipOpen} onClose={() => setVipOpen(false)} onOpenAuthModal={() => setAuthOpen(true)} />
      <AuthModal isOpen={authOpen} zIndex={90} onClose={() => setAuthOpen(false)}
        onOpenAdminPanel={() => { adminVisits++; }} onOpenPatternsModal={() => { legacyGalleryVisits++; }} />
      <AccountManagementModal isOpen={accountOpen} onClose={() => setAccountOpen(false)} />
    </>;
  }
  const mount = async (value = auth(), screen: 'vip' | 'account' = 'vip') => {
    state.__membershipAuth = value;
    flushSync(() => root.render(<Flow key={++sequence} screen={screen} />));
    await tick();
  };
  const buttons = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].filter(b => b.textContent?.trim() === label || b.getAttribute('aria-label') === label || b.title === label);
  const click = async (label: string, last = false) => {
    const found = buttons(label);
    check(found.length > 0, `button reachable: ${label}`);
    const button = last ? found[found.length - 1] : found[0];
    check(!button.disabled, `button enabled: ${label}`);
    flushSync(() => button.click());
    await tick();
  };
  const input = async (selector: string, value: string) => {
    const node = document.querySelector<HTMLInputElement>(selector);
    check(node, `input present: ${selector}`);
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
      node!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await tick();
  };
  const enterRedeem = async (last = true) => {
    await click('兑换会员激活码', last);
    check(document.querySelector('[aria-label="会员激活码兑换"]'), 'VIP opens redemption form');
    check(document.activeElement?.id === 'membership-redeem-code', 'redemption input receives focus');
    check(document.querySelector('[role="dialog"]')?.getAttribute('style')?.includes('90'), 'Auth retains caller stacking order');
    check(!text().includes(profile.email) && !text().includes(profile.displayName), 'no repeated identity overview');
    check(!text().includes('查看我的可编辑图纸记录') && !text().includes('核心权益：'), 'no legacy gallery or privilege overview');
  };

  await mount();
  check(buttons('兑换会员激活码').length === 2, 'standard account has header and footer redemption CTA');
  await enterRedeem();
  check(buttons('立即兑换')[0].disabled, 'empty code cannot submit');
  check(!buttons('进入管理后台').length, 'ordinary account has no admin link');
  await input('#membership-redeem-code', '  test-code  ');
  await click('立即兑换');
  check(redeemCalls.at(-1) === 'TEST-CODE', 'existing redeem receives trimmed uppercase code');
  check(document.querySelector('[role="status"]')?.textContent === '兑换成功', 'redemption success is announced');
  check(document.querySelector<HTMLInputElement>('#membership-redeem-code')!.value === '', 'success clears code');

  // The real context refreshes the profile before its redeem promise resolves.
  redeem = async () => {
    state.__membershipAuth = { ...state.__membershipAuth, isVip: true, userProfile: { ...profile, member_type: 1 } };
    flushSync(() => root.render(<Flow key={sequence} screen="vip" />));
    return { success: true, message: '会员兑换成功' };
  };
  await input('#membership-redeem-code', 'upgrade'); await click('立即兑换');
  check(text().includes('VIP 会员') && text().includes('会员兑换成功'), 'context membership refresh keeps success feedback');

  redeem = async () => ({ success: false, message: '激活码已使用' });
  await input('#membership-redeem-code', 'used'); await click('立即兑换');
  check(document.querySelector('[role="alert"]')?.textContent === '激活码已使用', 'API failure shown');
  check(document.querySelector<HTMLInputElement>('#membership-redeem-code')!.value === 'USED', 'failure retains code for correction');
  redeem = async () => { throw new Error('offline'); };
  await click('立即兑换');
  check(text().includes('兑换失败，请检查网络后重试'), 'thrown redeem failure shown');
  check(!buttons('立即兑换')[0].disabled, 'redeem can retry after exception');

  let finish: (value: any) => void = () => {};
  redeem = () => new Promise(resolve => { finish = resolve; });
  const beforePending = redeemCalls.length;
  await click('立即兑换');
  check(document.querySelector<HTMLInputElement>('#membership-redeem-code')!.disabled, 'pending code disabled');
  check(buttons('退出登录')[0].disabled, 'pending operation disables logout');
  flushSync(() => {
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await tick();
  check(redeemCalls.length === beforePending + 1, 'pending duplicate submit blocked');
  await click('关闭账号窗口');
  await click('重新打开会员权益'); await enterRedeem();
  finish({ success: true, message: '迟到的兑换结果' }); await tick();
  check(!text().includes('迟到的兑换结果'), 'closed attempt cannot populate reopened form');
  check(!document.querySelector<HTMLInputElement>('#membership-redeem-code')!.disabled, 'reopened form usable');
  logout = async () => { throw new Error('offline'); };
  await click('退出登录');
  check(text().includes('退出失败，请稍后重试'), 'logout failure keeps retry visible');
  logout = async () => {};
  await click('退出登录');
  check(!document.querySelector('[role="dialog"]'), 'successful logout closes dialog');

  for (const tier of [{ isVip: true, isPro: false, label: 'VIP 会员' }, { isVip: true, isPro: true, label: '商家 Pro' }]) {
    await mount(auth({ ...tier, userProfile: { ...profile, member_expire: 1893456000000 } }));
    check(buttons('兑换会员激活码').length === 1, 'existing member has footer CTA');
    await enterRedeem();
    check(text().includes(tier.label) && text().includes('到期时间：'), 'member retains compact status and expiry');
  }
  await mount(auth({ isAdmin: true, canAccessAdmin: true, isVip: true, isPro: true, userProfile: { ...profile, role: 'admin' } }));
  await enterRedeem();
  check(text().includes('永久有效'), 'admin retains permanent status');
  await click('进入管理后台');
  check(adminVisits === 1 && !document.querySelector('[role="dialog"]'), 'admin navigation callback reachable after close');

  for (const value of [
    auth({ currentUser: null, userProfile: null }),
    ...['authProvider', 'auth_provider', 'provider'].flatMap(field => [
      auth({ currentUser: { uid: 'guest', [field]: 'guest' } }),
      auth({ userProfile: { ...profile, [field]: 'guest' } }),
    ]),
  ]) {
    await mount(value); await click('登录后兑换', true);
    check(document.querySelector('input[name="username"]'), 'anonymous/guest goes to login');
    check(document.activeElement?.getAttribute('name') === 'username', 'login input receives focus');
    check(!document.querySelector('#membership-redeem-code') && !buttons('进入管理后台').length, 'guest cannot redeem or open admin');
    await click('关闭账号窗口');
    check(!document.querySelector('[role="dialog"]'), 'login cancel closes');
  }
  await mount(auth({ currentUser: null, userProfile: null }));
  await click('登录后兑换', true);
  await input('[name="username"]', 'creator'); await input('[name="password"]', 'test-password');
  api = async () => ({ ok: false, error: '账号密码错误' });
  await click('立即登录账号');
  check(text().includes('账号密码错误'), 'login error retained');
  api = async () => ({ ok: true, data: { token: 'offline-token', profile: { uid: 'signed-in' } } });
  const checkbox = document.querySelector<HTMLInputElement>('#remember-login')!;
  flushSync(() => checkbox.click()); await tick();
  await click('立即登录账号');
  check(apiCalls.at(-1)[0] === '/api/auth/signin', 'login retains signin endpoint');
  check(persistence === 'session' && credentialSaves === 0, 'unchecked remember retains session persistence');
  check(!document.querySelector('[role="dialog"]'), 'login success closes normally');
  await mount(auth({ currentUser: null, userProfile: null }));
  await click('登录后兑换', true); await click('没有账号？点此注册');
  await input('[name="username"]', 'newcreator'); await input('[name="password"]', 'test-password');
  await click('立即注册并登录');
  check(apiCalls.at(-1)[0] === '/api/auth/signup' && persistence === 'persistent', 'signup retains endpoint and persistence');

  await mount(auth({ loading: true })); await click('兑换会员激活码', true);
  check(text().includes('正在安全加载') && !document.querySelector('form'), 'loading does not expose actionable form');
  await click('关闭账号窗口');

  await mount(auth(), 'account');
  check(!document.querySelector('input[type="password"]') && !text().includes('安全登录密码'), 'profile does not promise unsupported password changes');
  check(document.querySelector('input[type="file"]'), 'avatar upload retained');
  await click('像素萌猫');
  await input('#account-display-name', ' 新昵称 ');
  await click('保存个人资料修改');
  check(profileWrites.at(-1).displayName === '新昵称' && profileWrites.at(-1).photoURL.includes('photo-1514888286974'), 'nickname and preset avatar use existing profile API');
  check(Object.keys(profileWrites.at(-1)).sort().join(',') === 'displayName,photoURL', 'profile sends no password fields');
  check(text().includes('资料已更新'), 'profile success feedback');
  save = async () => ({ success: false, message: '昵称保存失败' });
  await click('保存个人资料修改'); check(text().includes('昵称保存失败'), 'profile API failure feedback');
  save = async () => { throw new Error('offline'); };
  await click('保存个人资料修改'); check(text().includes('资料保存失败，请检查网络后重试'), 'profile network failure feedback');
  const beforeCancel = profileWrites.length;
  await click('关闭账号管理'); check(profileWrites.length === beforeCancel, 'profile cancel makes no save');
  await click('重新打开资料编辑');
  check(document.querySelector<HTMLInputElement>('#account-display-name')!.value === profile.displayName, 'profile reopen discards unsaved fields');
  const beforeLogout = logoutCalls;
  window.confirm = () => false;
  await click('退出账号'); check(logoutCalls === beforeLogout, 'account logout cancellation retained');
  window.confirm = () => true;
  await click('退出账号'); check(logoutCalls === beforeLogout + 1 && !document.querySelector('[role="dialog"]'), 'account confirmed logout retained');
  check(legacyGalleryVisits === 0, 'legacy gallery callback never used');
  check(networkCalls === 0, 'no live API requests');
  root.unmount();
  return { checks, browserErrors, networkCalls, viewportWidth: window.innerWidth };
}
