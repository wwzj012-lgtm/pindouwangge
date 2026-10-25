import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AdminUsers } from './AdminUsers';
import type { AdminRequest } from './adminRequest';
import type { UserDetail } from './adminUserModel';

export async function runAdminUsersOverviewChecks() {
  const checks: string[] = [], browserErrors: string[] = [];
  window.addEventListener('error', event => browserErrors.push(event.message));
  const check = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  const tick = () => new Promise(resolve => setTimeout(resolve, 30));
  const wait = async (predicate: () => unknown) => { for (let i = 0; i < 80; i++) { if (predicate()) return; await tick(); } throw new Error('DOM wait timed out'); };
  const users = ['a','b'].map(uid => ({ uid, email: uid + '@test.invalid', member_type: 0 as const, member_expire: null }));
  let resolveA: (value: unknown) => void = () => {}, writes = 0;
  let account = 'operator-one';
  const detail = (uid: string): UserDetail => ({ user: { ...users.find(u => u.uid === uid)!, authProvider: 'guest' }, tags: [], notes: [], moderation: { status: 'active', reason: '' }, aggregates: { works: 0, publicPosts: 1 }, credits: { availableUnits: 12345, heldUnits: 200, unitsPerPoint: 100, updatedAt: 100 }, recentActivity: { at: 200, source: 'work_updated' } });
  const request = (async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') writes++;
    if (path.includes('/users/detail?uid=a')) return new Promise(resolve => { resolveA = resolve; });
    if (path.includes('/users/detail?uid=b')) return { ok: true, status: 200, data: detail('b') };
    if (path.includes('/user-tags')) return { ok: true, status: 200, data: { items: [] } };
    return { ok: true, status: 200, data: { items: account === 'operator-one' ? users : [], total: account === 'operator-one' ? 2 : 0, limit: 20, offset: 0 } };
  }) as AdminRequest;
  const root = createRoot(document.getElementById('root')!);
  const render = () => {
    (globalThis as any).__adminFixtureAuth = { currentUser: { uid: account } };
    flushSync(() => root.render(<AdminUsers request={request} />));
  };
  const click = (selector: string) => { const el = document.querySelector<HTMLButtonElement>(selector); if (!el) throw new Error('Missing '+selector); flushSync(() => el.click()); };
  render(); await wait(() => document.querySelector('[data-user-open="a"]'));
  click('[data-user-open="a"]'); await tick();
  click('[data-user-open="b"]'); await wait(() => document.querySelector('[data-user-credit-balance]'));
  let overview = document.querySelector('[aria-label="用户详情运营总览"]')!;
  check(overview.textContent?.includes('b@test.invalid'), 'selected user identity');
  check(overview.textContent?.includes('123.45 积分'), 'true unit conversion');
  check(overview.textContent?.includes('2 积分'), 'held balance');
  check(overview.textContent?.includes('公开社区帖数'), 'public posts grouped');
  check(overview.textContent?.includes('图纸数（未删除）'), 'work count scope');
  check(overview.textContent?.includes('图纸更新'), 'recent activity source');
  check(overview.textContent?.includes('游客'), 'actual provider');
  check(overview.querySelectorAll('input,button,select,textarea').length === 0, 'balance overview is read only');
  check(Array.from(document.querySelectorAll('#root, [data-admin-portal]')).map(node => node.textContent).join('')?.includes('账号安全') && Array.from(document.querySelectorAll('#root, [data-admin-portal]')).map(node => node.textContent).join('')?.includes('标签与内部备注') && Array.from(document.querySelectorAll('#root, [data-admin-portal]')).map(node => node.textContent).join('')?.includes('会员权益'), 'existing operation groups');
  check(!Array.from(document.querySelectorAll('#root, [data-admin-portal]')).map(node => node.textContent).join('')?.includes('积分调账'), 'no unavailable balance action');
  resolveA({ ok: true, status: 200, data: { ...detail('a'), notes: [{ id: 'private', content: 'LATE_PRIVATE_A', createdAt: 1 }] } });
  await tick(); await tick();
  overview = document.querySelector('[aria-label="用户详情运营总览"]')!;
  check(overview.textContent?.includes('b@test.invalid') && !Array.from(document.querySelectorAll('#root, [data-admin-portal]')).map(node => node.textContent).join('')?.includes('LATE_PRIVATE_A'), 'late previous user response rejected');
  click('[data-user-open="a"]'); await tick();
  account = 'operator-two'; render();
  check(!Array.from(document.querySelectorAll('#root, [data-admin-portal]')).map(node => node.textContent).join('')?.includes('b@test.invalid') && !document.querySelector('[data-user-credit-balance]'), 'account switch clears detail and list synchronously');
  resolveA({ ok: true, status: 200, data: detail('a') });
  await tick(); check(!Array.from(document.querySelectorAll('#root, [data-admin-portal]')).map(node => node.textContent).join('')?.includes('a@test.invalid'), 'old account pending detail cannot refill the cache');
  check(writes === 0, 'reading overview never writes');
  root.unmount();
  return { checks, browserErrors, viewportWidth: innerWidth, writeCount: writes };
}
