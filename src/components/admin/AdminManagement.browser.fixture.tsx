import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminConsole } from './AdminConsole';

/** Real current components, synthetic API only; never import production credentials. */
export async function runAdminManagementChecks() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const checks: string[] = [], browserErrors: string[] = [];
  console.error = (...values) => browserErrors.push(values.map(String).join(' '));
  window.addEventListener('error', event => browserErrors.push(event.message));
  window.addEventListener('unhandledrejection', event => browserErrors.push(String(event.reason)));
  const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  const auth = { currentUser: { uid: 'operator', email: 'operator@example.invalid', displayName: '测试管理员', role: 'user' } as Record<string, unknown> | null };
  (globalThis as any).__adminFixtureAuth = auth;
  const requests: { path: string; method: string; body: any }[] = [];
  let sessionStatus = 200, readStatus = 200, writeStatus: number | 'network' = 200;
  let announcementTotal = 21, holdWrite = false, releaseWrite: (() => void) | undefined;
  let copied = '';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
  const now = 1_793_000_000_000;
  const announcement = { id: 'notice-1', title: '测试公告', body: '公告正文', status: 'draft', audience: 'all', publishAt: null, expireAt: null, createdAt: now, updatedAt: now };
  const card = { id: 'card-1', brandKey: 'mard', displayName: 'Mard-291', colorCount: 291, sourceUrl: null, status: 'active', notes: '', swatchCount: 1, createdAt: now, updatedAt: now };
  const asset = { id: 'asset-1', objectKey: 'works/test.png', resourceType: 'work', contentType: 'image/png', byteSize: 1024, visibility: 'private', status: 'active', ownerUid: 'target', metadata: null };
  const content = { id: 'work-1', entityType: 'work', title: '测试图纸作品', authorUid: 'target', status: 'published', moderation: { action: 'approve', createdAt: now } };
  const report = { id: 'report-1', entityType: 'post', entityId: 'post-1', reporterUid: 'target', reasonCode: 'fixture_reason', description: '测试举报说明', status: 'open', createdAt: now };
  const code = { id: 'code-1', code: 'FIXTURE-CODE-ONLY', days: 30, member_type: 1, used: false, copied: false, createdAt: now };
  const role = { id: 'role-1', code: 'read_only', displayName: 'Read only', description: 'Read only access', permissionCount: 1, system: true };
  const response = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, data, message: status >= 400 ? '服务端拒绝了本次测试请求。' : undefined }), { status });
  const page = (items: unknown[], total = items.length, offset = 0) => ({ items, total, limit: 20, offset });
  globalThis.fetch = async (input, init) => {
    const path = String(input), method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (!path.startsWith('/api/admin/')) throw new Error('Unexpected external request');
    requests.push({ path, method, body });
    const url = new URL(path, 'https://offline.invalid'), endpoint = url.pathname;
    if (endpoint === '/api/admin/session') return response({ authenticated: sessionStatus === 200 }, sessionStatus);
    if (method !== 'GET') {
      if (holdWrite) await new Promise<void>(resolve => { releaseWrite = resolve; });
      if (writeStatus === 'network') throw new Error('offline write result unknown');
      if (endpoint === '/api/admin/generate-codes') return response({ count: body.codes.length }, writeStatus);
      return response({}, writeStatus);
    }
    if (readStatus !== 200 && endpoint !== '/api/admin/dashboard') return response({}, readStatus);
    if (endpoint === '/api/admin/dashboard') return response({ overview: {}, telemetry: { errorCodes: [] }, trends: { days7: {} } });
    if (endpoint === '/api/admin/announcements') return response(page([announcement], announcementTotal));
    if (endpoint === '/api/admin/color-cards') return response(page([card]));
    if (endpoint === '/api/admin/color-swatches') return response(page([{ id: 'swatch-1', cardId: card.id, colorCode: 'A01', displayName: '樱花粉', hex: '#FF0088', rgb: { r: 255, g: 0, b: 136 }, sortOrder: 0 }]));
    if (endpoint === '/api/admin/storage-assets') return response(page([asset]));
    if (endpoint === '/api/admin/community-content') return response(page([content]));
    if (endpoint === '/api/admin/reports') return response(page([report]));
    if (endpoint === '/api/admin/content-moderation') return response(page([{ ...content, id: 'action-1', entityId: content.id, action: 'hide', reason: '测试记录', operatorUid: 'operator', createdAt: now }]));
    if (endpoint === '/api/admin/feature-flags') return response(page([{ key: 'fixture.flag', enabled: false, description: '测试开关', config: { enabled: false } }]));
    if (endpoint === '/api/admin/system-settings') return response(page([]));
    if (endpoint === '/api/admin/codes') return response({ ...page([code]), page: 1, stats: { total: 1, redeemed: 0, available: 1, copied: 0, deletePending: 0 } });
    if (endpoint === '/api/admin/code-redemptions') return response(page([]));
    if (endpoint === '/api/admin/users') return response(page([{ uid: 'target', displayName: '测试用户', email: 'target@example.invalid', member_type: 0, member_expire: null, moderation: { status: 'active' } }]));
    if (endpoint === '/api/admin/user-tags') return response(page([]));
    if (endpoint === '/api/admin/roles') return response(page([role]));
    if (endpoint === '/api/admin/permissions') return response(page([{ id: 'perm-1', code: 'dashboard.read', displayName: 'Read dashboard' }]));
    if (endpoint === '/api/admin/roles/permissions') return response({ role, permissionCodes: ['dashboard.read'] });
    if (endpoint === '/api/admin/admin-user-roles') return response(page([]));
    if (endpoint === '/api/admin/logs') return response(page([]));
    throw new Error('Unexpected fixture endpoint: ' + endpoint);
  };
  const denyNetwork = () => { throw new Error('External network forbidden'); };
  (globalThis as any).XMLHttpRequest = denyNetwork;
  (globalThis as any).WebSocket = denyNetwork;
  navigator.sendBeacon = denyNetwork;
  const root = createRoot(document.getElementById('root')!);
  const flush = async (action?: () => void) => {
    await act(async () => { action?.(); });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };
  const visible = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const top = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(visible).at(-1) ?? document.body;
  const text = () => document.querySelector<HTMLElement>('.admin-main')?.innerText ?? document.body.innerText;
  const button = (label: string, scope: ParentNode = top()) => {
    const found = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(item => visible(item) && (item.textContent?.trim() === label || item.getAttribute('aria-label') === label));
    if (!found) throw new Error('Missing visible button: ' + label);
    return found;
  };
  const click = async (label: string) => flush(() => button(label).click());
  const change = async (element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) => flush(() => {
    assert(Boolean(element), 'field exists'); element.focus();
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
  const writes = () => requests.filter(item => item.method !== 'GET');
  const mount = async (key: string, section: string) => flush(() => {
    history.replaceState({}, '', '?section=' + section);
    root.render(<AdminConsole key={key} />);
  });
  const noOverflow = (label: string) => assert(document.documentElement.scrollWidth <= innerWidth + 1, label + ': no horizontal page overflow');
  const ensureNames = () => {
    for (const field of Array.from(document.querySelectorAll<HTMLElement>('.admin-main input, .admin-main select, .admin-main textarea'))) {
      if (visible(field)) assert(Boolean(field.getAttribute('aria-label') || field.closest('label')?.textContent?.trim()), 'visible filter has accessible name');
    }
  };

  auth.currentUser = null; sessionStatus = 401;
  await mount('signed-out', 'dashboard');
  assert(document.body.innerText.includes('请先登录正式账号'), 'ordinary signed-out visitor sees Chinese sign-in state');
  assert(!document.querySelector('.admin-sidebar'), 'signed-out visitor has no management shell');
  auth.currentUser = { uid: 'ordinary-user', role: 'user' }; sessionStatus = 403;
  await mount('forbidden', 'users');
  assert(document.body.innerText.includes('无后台访问权限'), 'ordinary unauthorized user sees Chinese denial');
  assert(!document.querySelector('[data-user-open]'), 'denied user never sees user-management data');
  assert(writes().length === 0, 'access checks perform no writes');
  noOverflow('denied view');

  auth.currentUser = { uid: 'operator', role: 'user', displayName: '测试管理员' }; sessionStatus = 200;
  await mount('normal', 'users');
  assert(text().includes('用户与会员'), 'valid existing session shows normal management UI');
  assert(Array.from(document.querySelectorAll('[data-user-reset-password]')).some(visible), 'existing reset entry remains present');
  ensureNames(); noOverflow('users');
  if (innerWidth < 1024) {
    await click('打开菜单');
    assert(top().getAttribute('aria-modal') === 'true', 'mobile menu is semantic modal');
    await flush(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert(!document.querySelector('[role="dialog"]'), 'Escape closes mobile menu');
  }

  await mount('announcements', 'announcements');
  assert(text().includes('所有用户') && !text().includes(' · all'), 'announcement audience is Chinese');
  await click('下一页');
  assert(requests.some(item => item.path.includes('/announcements?') && item.path.includes('page=2')), 'announcement pagination sends page two');
  readStatus = 500; await click('刷新公告');
  assert(text().includes('第 2 页') && !text().includes('暂无匹配公告'), 'failed announcement read is not a new empty success');
  assert(button('上一页').disabled, 'failed announcement snapshot cannot paginate');
  readStatus = 200; announcementTotal = 1; await click('刷新公告');
  assert(text().includes('测试公告') && text().includes('1/1页'), 'shrinking total returns from out-of-range page');
  await click('新建草稿');
  await change(top().querySelector('[data-announcement-title]')!, '新公告');
  await change(top().querySelector('[data-announcement-body]')!, '新正文');
  await click('复核内容变更');
  assert(document.activeElement?.textContent === '取消', 'danger confirmation defaults to cancel');
  assert(writes().length === 0, 'review alone does not write');
  await click('取消');
  assert((top().querySelector('[data-announcement-title]') as HTMLInputElement).value === '新公告', 'cancel review preserves draft');
  await click('关闭新建公告草稿');
  assert(top().textContent?.includes('放弃未保存输入'), 'closing dirty editor requires discard confirmation');
  await click('取消');
  assert(top().textContent?.includes('新建公告草稿'), 'cancel discard returns to editor');
  await click('复核内容变更');
  holdWrite = true;
  await flush(() => { button('确认提交').click(); button('确认提交').click(); });
  assert(writes().length === 1, 'rapid repeated confirmation produces one write');
  assert(Array.from(top().querySelectorAll('button')).every(item => item.disabled), 'pending confirmation disables cancel/close/confirm');
  holdWrite = false; await flush(() => releaseWrite?.());
  assert(writes()[0].body.status === 'draft' && writes()[0].body.audience === 'all', 'announcement labels preserve original API values');
  assert(text().includes('已确认成功'), 'successful write has visible Chinese feedback');

  await mount('codes', 'codes');
  ensureNames(); noOverflow('redemption codes');
  const beforeGeneration = writes().length;
  await change(document.querySelector('[data-generation-count]')!, '2');
  await click('确认参数并生成');
  assert(writes().length === beforeGeneration, 'code generation requires separate confirmation');
  await click('取消');
  assert((document.querySelector('[data-generation-count]') as HTMLInputElement).value === '2', 'cancel code generation retains quantity');
  await click('确认参数并生成');
  await click('确认提交');
  const generated = writes().at(-1)!;
  assert(generated.path === '/api/admin/generate-codes' && generated.body.codes.length === 2, 'confirmed generation sends only the frozen existing code contract');
  await click('复制本批全部');
  assert(copied.split('\n').length === 2 && writes().length === beforeGeneration + 1, 'copying generated codes performs no sale-mark write');
  await click('关闭本批生成结果');
  await click('申请删除');
  assert(top().textContent?.includes('三天删除等待'), 'code delete keeps existing three-day waiting semantics');
  await click('取消');
  assert(writes().length === beforeGeneration + 1, 'cancelled code deletion never writes');

  await mount('colors', 'colors-assets');
  assert(text().includes('正常') && !text().includes('active'), 'color-card status is Chinese');
  ensureNames(); noOverflow('color cards');
  const beforeDelete = writes().length;
  await click(innerWidth < 768 ? '删除' : '删除色卡');
  assert(top().textContent?.includes('删除后台元数据'), 'metadata delete requires scoped confirmation');
  await click('取消');
  assert(writes().length === beforeDelete, 'cancelled deletion never writes');
  await click('资源元数据');
  assert(text().includes('私有') && text().includes('正常'), 'resource visibility and status are Chinese');
  ensureNames(); noOverflow('assets');
  await click(innerWidth < 768 ? '编辑元数据' : '编辑资源元数据');
  assert((top().querySelector('textarea') as HTMLTextAreaElement).value === 'null', 'existing resource metadata null is retained');
  const visibility = Array.from(top().querySelectorAll('select')).find(field => Array.from(field.options).some(option => option.value === 'restricted'))!;
  await change(visibility, 'restricted');
  await click('保存');
  await click('确认提交');
  assert(writes().at(-1)?.body.visibility === 'restricted' && writes().at(-1)?.body.metadata === null, 'Chinese resource editor preserves visibility and JSON null API contract');

  await mount('community', 'community');
  assert(text().includes('缺少') || text().includes('证据不足'), 'community discloses missing content evidence');
  assert(text().includes('通过审核') && !text().includes('approve'), 'moderation action is Chinese');
  await click(innerWidth < 768 ? '记录审核动作' : '审核');
  const action = top().querySelector('select')!;
  assert(Array.from(action.options).find(option => option.value === 'hide')?.textContent === '隐藏', 'action option label differs from submitted raw value');
  await change(action, 'hide');
  await click('记录审核');
  await click('确认提交');
  assert(writes().at(-1)?.body.action === 'hide' && writes().at(-1)?.body.entityType === 'work', 'Chinese moderation submits unchanged action/type values');
  await click('举报处理');
  assert(text().includes('待处理') && !text().includes('open'), 'report status is Chinese'); ensureNames();
  await click('详情 / 处置');
  await change(top().querySelector('[data-report-status]')!, 'resolved');
  await click('复核状态并提交');
  await click('确认提交');
  assert(writes().at(-1)?.body.status === 'resolved', 'Chinese report action submits original status');

  await mount('roles', 'roles');
  assert(text().includes('只读管理员') && !text().includes('Read only'), 'known English role display name is mapped to Chinese');
  assert(text().includes('权限项（dashboard.read）'), 'permission codes remain technical identifiers with Chinese labels');
  ensureNames(); noOverflow('roles');

  await mount('config', 'config');
  await click('编辑');
  await change(top().querySelector('[data-config-json]')!, '{invalid');
  assert(top().textContent?.includes('JSON格式无效') && button('复核保存差异').disabled, 'invalid JSON blocks configuration review');
  await change(top().querySelector('[data-config-json]')!, 'null');
  await click('复核保存差异');
  writeStatus = 'network'; await click('确认提交');
  assert(top().textContent?.includes('写入结果不确定'), 'unknown write outcome tells operator to verify first');
  const uncertainCount = writes().length;
  await click('确认提交');
  assert(button('确认提交').disabled && writes().length === uncertainCount, 'unknown write cannot be blindly resubmitted');
  await click('取消');
  assert((top().querySelector('[data-config-json]') as HTMLTextAreaElement).value === 'null', 'unknown write preserves editor input');
  writeStatus = 200;

  await mount('read-failure', 'colors-assets'); readStatus = 403;
  await click('刷新');
  assert(text().includes('当前结果未更新'), 'failed content read marks old results unconfirmed');
  assert(button(innerWidth < 768 ? '编辑' : '编辑色卡').disabled, 'unconfirmed stale row cannot be mutated');
  readStatus = 200; await click('刷新');
  assert(!button(innerWidth < 768 ? '编辑' : '编辑色卡').disabled, 'explicit successful refresh restores row editing');
  readStatus = 500; await mount('initial-failure', 'community');
  assert(text().includes('尚无可确认的读取结果') && !text().includes('暂无可读取的'), 'initial failed read does not claim community is empty');
  readStatus = 200;

  // Keep a representative existing core screen mounted for screenshot evidence.
  await mount('evidence', 'community'); await click('举报处理');
  assert(button('举报处理').getAttribute('aria-pressed') === 'true', 'community tab announces its selected state');
  await flush();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
  ensureNames(); noOverflow('reports');
  assert(browserErrors.length === 0, 'browser has no React/runtime errors');
  const selectedTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.admin-main button[aria-pressed]')).map(item => ({ label: item.textContent, selected: item.getAttribute('aria-pressed'), className: item.className, background: getComputedStyle(item).backgroundColor }));
  assert(selectedTabs.find(item => item.selected === 'true')?.background !== selectedTabs.find(item => item.selected === 'false')?.background, 'selected tab has a distinct painted state in reduced-motion mode');
  return { checks, browserErrors, viewportWidth: innerWidth, writeCount: writes().length, selectedTabs, requests: requests.map(({ path, method }) => ({ path, method })), note: 'Synthetic API only; no production requests, credentials, secrets or writes.' };
}
