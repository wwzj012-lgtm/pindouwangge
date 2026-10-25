import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminConsole, isEditorControl } from './AdminConsole';

// This fixture mounts the current /admin shell. All requests stay in this page.
export async function runAdminPasswordResetChecks() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const checks: string[] = [], logs: string[] = [];
  const secrets = ['Fixture-custom-135!', 'Fixture-temporary-246!', 'Fixture-other-357!'];
  for (const name of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    console[name] = (...args) => { logs.push(args.map(value => String(value)).join(' ')); };
  }
  const assert = (condition: unknown, label: string) => { if (!condition) throw new Error(label); checks.push(label); };
  const users = [
    { uid: 'target-user', email: 'target@example.invalid', displayName: '测试用户', role: 'user', member_type: 0, member_expire: null },
    { uid: 'other-user', email: 'other@example.invalid', displayName: '测试用户', role: 'user', member_type: 0, member_expire: null },
    // RBAC operator: users.write does not imply admins.write or legacy role=admin.
    { uid: 'operator', email: 'operator@example.invalid', displayName: '当前管理员', role: 'user', member_type: 0, member_expire: null },
    { uid: 'target-admin', email: 'admin-target@example.invalid', displayName: '目标管理员', role: 'admin', member_type: 0, member_expire: null },
  ];
  (globalThis as any).__adminFixtureAuth = { currentUser: users[2] };
  let outcome: number | 'network' | 'malformed' | 'missing-password' = 200;
  let release: (() => void) | undefined;
  let hold = false;
  let allowAdminTarget = false, sessionClears = 0;
  (globalThis as any).__adminFixtureClearSession = () => { sessionClears++; };
  const requests: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const writes = () => requests.filter(item => item.method !== 'GET');
  const response = (data: unknown, status = 200, success = true) => new Response(JSON.stringify({ success, data, message: status === 200 ? undefined : secrets[0] }), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (input, init) => {
    const path = String(input), method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({ path, method, body });
    if (path === '/api/admin/session') return response({ authenticated: true });
    if (path === '/api/admin/dashboard') return response({ overview: {}, trends: { days7: {} }, telemetry: { errorCodes: [] } });
    if (path.startsWith('/api/admin/users?')) return response({ items: users, total: users.length, limit: 20, offset: 0 });
    if (path === '/api/admin/user-tags') return response({ items: [] });
    if (path === '/api/admin/roles') return response({ items: [] });
    if (path.startsWith('/api/admin/users/detail?')) return response({ user: users.find(user => user.uid === new URL(path, 'https://fixture.invalid').searchParams.get('uid')), tags: [], notes: [], moderation: { status: 'active', reason: '' } });
    if (path === '/api/admin/reset-password' && method === 'POST') {
      // Model the unchanged server-side admins.write gate, not a role-based UI gate.
      const rejectedAdmin = body.uid === 'target-admin' && !allowAdminTarget;
      if (hold) await new Promise<void>(resolve => { release = resolve; });
      if (rejectedAdmin) return response({}, 403, false);
      if (outcome === 'network') throw new Error(secrets[0]);
      if (outcome === 'malformed') return response({ unexpected: true });
      if (outcome === 'missing-password') return response({ success: true, mode: 'random' });
      if (outcome !== 200) return response({}, outcome, false);
      return response({ success: true, mode: body.mode, ...(body.mode === 'random' ? { temporaryPassword: secrets[1] } : {}) });
    }
    throw new Error('Unexpected fixture request');
  };
  const networkDenied = () => { throw new Error('External network forbidden'); };
  (globalThis as any).XMLHttpRequest = networkDenied; (globalThis as any).WebSocket = networkDenied;
  (globalThis as any).EventSource = networkDenied; navigator.sendBeacon = networkDenied;
  let copied = '', rejectCopy = false;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => {
    if (rejectCopy) throw new Error('Clipboard denied');
    copied = value;
  } } });
  const root = createRoot(document.getElementById('root')!);
  const flush = async (action?: () => void) => {
    await act(async () => { action?.(); });
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };
  const visible = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const top = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(visible).at(-1) ?? document.body;
  const button = (label: string, scope: ParentNode = top()) => {
    const found = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(item => visible(item) && item.textContent?.trim() === label);
    if (!found) throw new Error('Missing button: ' + label);
    return found;
  };
  const click = async (label: string) => { await flush(() => button(label).click()); };
  const change = async (element: HTMLInputElement | HTMLSelectElement, value: string) => {
    await flush(() => {
      element.focus();
      Object.getOwnPropertyDescriptor(element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
  };
  const open = async (uid = 'target-user') => {
    const entry = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-user-reset-password="' + uid + '"]')).find(visible)!;
    await flush(() => entry.click());
    assert(top().textContent?.includes('UID：' + uid), 'reset shows exact target UID ' + uid);
  };
  const selectMode = async (mode: string) => { await change(top().querySelector('select')!, mode); };
  const custom = async (first = secrets[0], second = first) => {
    const fields = top().querySelectorAll<HTMLInputElement>('input[type="password"]');
    await change(fields[0], first); await change(fields[1], second);
  };
  const noSecrets = (label: string) => {
    const summary = Array.from(document.querySelectorAll('.admin-change-summary')).map(element => element.textContent).join('');
    const storage = (store: Storage) => Array.from({ length: store.length }, (_, i) => store.getItem(store.key(i)!)).join('');
    assert(secrets.every(secret => !summary.includes(secret)), label + ': confirmation summary excludes passwords');
    assert(secrets.every(secret => !logs.join('\n').includes(secret)), label + ': console excludes passwords');
    assert(secrets.every(secret => !(storage(localStorage) + storage(sessionStorage)).includes(secret)), label + ': browser storage excludes passwords');
    assert(requests.every(item => item.method === 'GET' || item.path === '/api/admin/reset-password'), label + ': no generic audit or unrelated writes');
  };
  const editorCache = () => (globalThis as any).__adminFixtureEdits.current as Map<HTMLElement, string>;
  const assertCacheClean = (label: string, cache = editorCache()) => {
    const retained = [...cache.keys()].filter(control => !control.isConnected)
      .flatMap(control => [...(control.getRootNode() as ParentNode).querySelectorAll<HTMLInputElement>('input[type=password]')])
      .filter(input => secrets.includes(input.value));
    assert(retained.length === 0, label + ': Kant retained password count is zero');
    assert([...cache.keys()].every(control => control.isConnected), label + ': cache has no disconnected DOM keys');
    assert([...cache.keys()].every(control => !control.closest('[data-admin-password-reset]')), label + ': cache excludes entire reset surface');
  };
  await flush(() => root.render(<AdminConsole />));
  assert(document.querySelector('[data-admin-module="users"]'), 'current /admin user management mounted');
  assert(Array.from(document.querySelectorAll<HTMLButtonElement>('[data-user-reset-password="operator"]')).every(item => item.disabled), 'self reset entries disabled');
  assert(document.documentElement.scrollWidth <= window.innerWidth, 'current admin layout fits viewport');

  await open();
  assert(top().querySelector('select')?.value === 'random', 'random is default mode');
  const initialWrites = writes().length;
  await selectMode('custom'); await custom(); noSecrets('custom editing');
  assert(Array.from(top().querySelectorAll('input')).every(field => !isEditorControl(field)), 'actual password inputs excluded from generic editor cache');
  assert(!isEditorControl(top().querySelector('select')), 'reset mode select excluded with entire sensitive surface');
  assert(!editorCache().has(top().querySelector('select')!), 'actual editor cache never stores reset mode select');
  await selectMode('random'); assert(top().querySelectorAll('input[type="password"]').length === 0, 'random removes custom fields');
  await selectMode('custom'); assert(Array.from(top().querySelectorAll<HTMLInputElement>('input')).every(item => !item.value), 'mode changes clear custom secrets');
  await custom(); await click('核对目标并继续');
  assert(top().textContent?.includes('target@example.invalid'), 'explicit confirmation shows target email'); noSecrets('custom review');
  assert(writes().length === initialWrites, 'opening and reviewing make no writes');
  await click('取消'); await click('取消');
  assert(writes().length === initialWrites, 'canceling both dialogs makes no request');
  assertCacheClean('confirmation cancel then drawer cancel');
  await flush(() => document.querySelector<HTMLButtonElement>('[data-admin-refresh]')!.click());
  assertCacheClean('refresh after canceled custom reset');

  for (const dismissal of ['cancel', 'close', 'escape'] as const) {
    await open(); await selectMode('custom'); await custom();
    const select = top().querySelector('select')!;
    const detachedSurface = select.closest('[data-admin-password-reset]')!;
    assertCacheClean('editing before ' + dismissal);
    if (dismissal === 'cancel') await click('取消');
    else if (dismissal === 'close') await flush(() => top().querySelector<HTMLButtonElement>('[aria-label="关闭重置用户密码"]')!.click());
    else await flush(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert(!detachedSurface.isConnected, 'reset surface detached after ' + dismissal);
    assert([...detachedSurface.querySelectorAll<HTMLInputElement>('input')].every(input => !input.value && !input.defaultValue && !input.hasAttribute('value')), 'detached password DOM scrubbed after ' + dismissal);
    assertCacheClean('closed via ' + dismissal);
    await flush(() => document.querySelector<HTMLButtonElement>('[data-admin-refresh]')!.click());
    assertCacheClean('refresh after ' + dismissal);
    await open('other-user');
    assert(!top().textContent?.includes(secrets[0]), 'switching target after ' + dismissal + ' has no earlier secret');
    await click('取消'); assertCacheClean('target switch after ' + dismissal);
  }
  assert(writes().length === initialWrites, 'all dismissal and target-switch paths make no reset requests');

  await open(); await selectMode('custom');
  for (const [first, second, message] of [['short', 'short', '8–72'], [' '.repeat(8), ' '.repeat(8), '8–72'], ['x'.repeat(73), 'x'.repeat(73), '8–72'], [secrets[0], secrets[2], '不一致']]) {
    await custom(first, second); await click('核对目标并继续');
    assert(top().querySelector('[role="alert"]')?.textContent?.includes(message), 'custom validation rejects ' + (message === '不一致' ? 'mismatch' : 'invalid length or whitespace'));
  }
  assert(writes().length === initialWrites, 'invalid passwords never request');
  await custom(); await click('核对目标并继续');
  hold = true;
  const confirm = button('确认重置密码');
  await flush(() => { confirm.click(); confirm.click(); });
  assert(writes().length === initialWrites + 1, 'double click sends exactly one request');
  assert(button('确认重置密码').disabled && button('取消').disabled, 'pending confirmation and cancellation disabled');
  const beforeEscape = document.querySelectorAll('[role="dialog"]').length;
  await flush(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert(document.querySelectorAll('[role="dialog"]').length === beforeEscape, 'pending escape cannot dismiss');
  await flush(() => release!()); hold = false;
  const sent = writes().at(-1)!;
  assert(sent.body.uid === 'target-user' && sent.body.mode === 'custom' && sent.body.password === secrets[0] && Object.keys(sent.body).length === 3, 'custom confirmation sends exact backend contract');
  assert(top().textContent?.includes('现有登录会话已撤销'), 'custom success explains session revocation');
  assert(top().querySelectorAll('input[type="password"]').length === 0 && !top().textContent?.includes(secrets[0]), 'custom success clears and never reveals password');
  noSecrets('custom success'); await click('完成并关闭');

  await open(); await click('核对目标并继续'); await click('确认重置密码');
  assert(writes().at(-1)?.body.mode === 'random' && !('password' in writes().at(-1)!.body), 'random confirmation never sends custom password');
  assert(top().textContent?.includes(secrets[1]) && top().textContent?.includes('仅本次展示'), 'random password displayed only in current result');
  assert(!copied, 'temporary password is not automatically copied');
  await click('复制临时密码');
  assert(copied === secrets[1] && top().textContent?.includes('已复制'), 'explicit copy reports success');
  rejectCopy = true; await click('复制临时密码');
  assert(top().textContent?.includes('复制失败'), 'clipboard failure has visible manual-copy fallback');
  assert(!top().querySelector('input'), 'result is not a generic editable field'); noSecrets('random success');
  await click('完成并关闭'); await open();
  assert(!top().textContent?.includes(secrets[1]), 'reopening cannot recover temporary password');
  await click('取消'); await open('other-user');
  assert(!top().textContent?.includes(secrets[1]), 'switching targets cannot leak earlier password'); await click('取消');

  for (const failure of [403, 500, 'network'] as const) {
    outcome = failure; await open(); await selectMode('custom'); await custom(); await click('核对目标并继续');
    const before = writes().length; await click('确认重置密码');
    assert(top().querySelector('[role="alert"]')?.textContent?.includes(failure === 403 ? '403' : failure === 500 ? '500' : '网络'), 'visible reset failure ' + failure);
    assert(!top().textContent?.includes(secrets[0]), 'failure never renders echoed server password ' + failure);
    assert(button('确认重置密码').disabled, 'failure requires fresh review ' + failure);
    await flush(() => button('确认重置密码').click());
    assert(writes().length === before + 1, 'no automatic or disabled-button retry ' + failure);
    noSecrets('failure ' + failure); await click('返回设置并重新核对');
    assert(Array.from(top().querySelectorAll<HTMLInputElement>('input')).every(field => field.value === secrets[0]), 'explicit failure retains input for correction ' + failure);
    outcome = 200; await click('核对目标并继续'); await click('确认重置密码');
    assert(top().querySelector('[data-password-reset-result]'), 'fresh explicit confirmation recovers ' + failure);
    await click('完成并关闭');
  }
  for (const partial of ['malformed', 'missing-password'] as const) {
    outcome = partial; await open(); await click('核对目标并继续'); await click('确认重置密码');
    assert(top().textContent?.includes('未提供完整结果'), 'success with incomplete payload requires verification ' + partial);
    assert(!Array.from(top().querySelectorAll('button')).some(item => item.textContent === '确认重置密码'), 'partial success cannot silently repeat reset ' + partial);
    await click('完成并关闭');
  }
  outcome = 200;
  await open('target-admin'); await click('核对目标并继续');
  assert(top().textContent?.includes('admin-target@example.invalid'), 'administrator target confirmed by exact email');
  await click('确认重置密码');
  assert(top().querySelector('[role="alert"]')?.textContent?.includes('admins.write'), 'server denial for administrator target explains additional permission');
  assert(writes().at(-1)?.body.uid === 'target-admin', 'administrator target uses same reset endpoint and target contract');
  assert(button('确认重置密码').disabled, 'administrator permission denial cannot be repeated without review');
  await click('取消'); await click('取消');
  allowAdminTarget = true;
  await open('target-admin'); await click('核对目标并继续'); await click('确认重置密码');
  assert(top().querySelector('[data-password-reset-result]'), 'server-authorized administrator target succeeds without changing UI permissions');
  await click('完成并关闭');

  const detail = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-user-open="target-user"]')).find(visible)!;
  const targetDetailOpen = () => {
    const drawer = top();
    return drawer.matches('[role="dialog"].admin-user-drawer')
      && drawer.querySelector('[data-user-reset-password="target-user"]') !== null
      && drawer.querySelector('[data-user-note]') !== null;
  };
  await flush(() => detail.click());
  assert(targetDetailOpen(), 'current user detail drawer opened');
  await click('重置密码'); assert(top().textContent?.includes('重置用户密码'), 'detail reset entry opens current reset UI');
  await click('取消'); assert(targetDetailOpen(), 'cancel returns to original user detail');
  const note = top().querySelector<HTMLTextAreaElement>('[data-user-note]')!;
  await flush(() => {
    note.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(note, 'Fixture ordinary note');
    note.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert(isEditorControl(note) && editorCache().has(note), 'ordinary note still enters actual dirty-editor cache');
  await flush(() => document.querySelector<HTMLButtonElement>('[data-admin-refresh]')!.click());
  assert(top().textContent?.includes('存在未保存编辑'), 'shell refresh still requires confirmation for ordinary dirty editor');
  await click('取消');
  assert(note.value === 'Fixture ordinary note' && editorCache().has(note), 'canceling generic refresh preserves ordinary unsaved editor and tracking');
  await flush(() => top().querySelector<HTMLButtonElement>('[aria-label="关闭用户详情"]')!.click());
  assert(top().textContent?.includes('放弃未保存编辑'), 'ordinary unsaved note still requires explicit discard');
  await click('放弃并关闭');
  assert(!editorCache().has(note), 'observer removes detached ordinary editor without requiring refresh');
  assertCacheClean('ordinary drawer discarded');

  // The shell previously retained every editor's initial plaintext value. Drive a
  // focus/change/navigation sequence and ensure passwords are excluded from it.
  await open(); await selectMode('custom'); await custom();
  const fields = top().querySelectorAll<HTMLInputElement>('input');
  await change(fields[0], secrets[2]); await change(fields[1], secrets[2]);
  noSecrets('sensitive edit lifecycle');
  await click('取消');
  assertCacheClean('final canceled custom reset');

  hold = true;
  await open(); await click('核对目标并继续'); await click('确认重置密码');
  const targetSwitchWrites = writes().length;
  await open('other-user');
  await flush(() => release!()); hold = false;
  assert(top().textContent?.includes('UID：other-user') && !top().querySelector('[data-password-reset-result]'), 'late reset success cannot replace a newly selected target');
  assert(!top().textContent?.includes(secrets[1]) && writes().length === targetSwitchWrites, 'pending target change neither reveals old password nor replays request');
  assertCacheClean('pending target changed'); await click('取消');

  // Switch the authenticated operator while an actual reset request is pending.
  // Old success, error and 401 responses must not affect the new operator.
  for (const lateOutcome of [200, 500, 401] as const) {
    outcome = lateOutcome; hold = true;
    await open();
    if (lateOutcome !== 200) { await selectMode('custom'); await custom(); }
    const oldSurface = document.querySelector('[data-admin-password-reset]')!;
    const oldCache = editorCache();
    await click('核对目标并继续'); await click('确认重置密码');
    const beforeSwitch = writes().length, beforeClear = sessionClears;
    await flush(() => {
      (globalThis as any).__adminFixtureAuth.currentUser = { ...users[2], uid: 'switched-' + lateOutcome, displayName: '新管理员' };
      root.render(<AdminConsole />);
    });
    assert(document.querySelector('[data-admin-module="users"]'), 'new operator gets freshly verified user module ' + lateOutcome);
    assert(!document.querySelector('[data-admin-password-reset]'), 'account switch removes pending sensitive surface ' + lateOutcome);
    assert(!oldSurface.isConnected && [...oldSurface.querySelectorAll<HTMLInputElement>('input')].every(input => !input.value && !input.defaultValue), 'account switch scrubs detached password inputs ' + lateOutcome);
    assert(oldCache.size === 0, 'old operator editor cache cleared ' + lateOutcome);
    assert(editorCache() !== oldCache, 'new operator owns separate editor cache ' + lateOutcome);
    await open('other-user');
    await flush(() => release!()); hold = false;
    assert(top().textContent?.includes('UID：other-user') && !top().querySelector('[data-password-reset-result]'), 'late response cannot replace new operator target ' + lateOutcome);
    assert(!top().querySelector('[role="alert"]') && !top().textContent?.includes(secrets[1]), 'late response leaks no result or error to new operator ' + lateOutcome);
    assert(sessionClears === beforeClear, 'late response cannot clear new operator session ' + lateOutcome);
    assert(writes().length === beforeSwitch, 'account switch never replays reset ' + lateOutcome);
    assertCacheClean('new operator after late ' + lateOutcome);
    await click('取消');
    outcome = 200;
  }
  await flush(() => document.querySelector<HTMLButtonElement>('[data-admin-section="roles"]')!.click());
  assert(!document.body.textContent?.includes('存在未保存编辑'), 'closed password inputs leave no generic dirty confirmation');
  await flush(() => root.unmount());
  assert(secrets.every(secret => !document.getElementById('root')!.innerHTML.includes(secret)), 'unmount clears all rendered secrets');
  noSecrets('unmounted');
  return { checks, viewportWidth: window.innerWidth, writeCount: writes().length, browserErrors: logs.filter(line => /uncaught|act\(.*not|not wrapped in act|error occurred/i.test(line)) };
}
