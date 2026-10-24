import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminConsole } from './AdminConsole';

export async function runAdminReviewRegressionChecks(scenario: 'config' | 'uncertain' | 'pagination') {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).__adminFixtureAuth = { currentUser: { uid: 'review-operator', displayName: '复核管理员', role: 'user' } };
  const checks: string[] = [], browserErrors: string[] = [];
  const requests: { path: string; method: string; body: any }[] = [];
  console.error = (...values) => browserErrors.push(values.map(String).join(' '));
  window.addEventListener('error', event => browserErrors.push(event.message));
  window.addEventListener('unhandledrejection', event => browserErrors.push(String(event.reason)));
  const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  const response = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, data, message: status >= 400 ? '复核读取被拒绝。' : undefined }), { status });
  const paged = (items: unknown[], total = items.length, offset = 0) => ({ items, total, limit: 20, offset });
  let flagStatus = 200, storageStatus = 200, moderationStatus = 200, networkWrite = false;
  let holdFlags = false, releaseFlags: (() => void) | undefined;
  let codesTotal = 21, recordsTotal = 21, logsTotal = 21;
  let holdCodePageTwo = false, releaseCodePageTwo: (() => void) | undefined;
  const now = 1_793_000_000_000;
  globalThis.fetch = async (input, init) => {
    const path = String(input), method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (!path.startsWith('/api/admin/')) throw new Error('External request forbidden');
    requests.push({ path, method, body });
    const url = new URL(path, 'https://offline.invalid'), endpoint = url.pathname, page = Number(url.searchParams.get('page') ?? 1);
    if (endpoint === '/api/admin/session') return response({ authenticated: true });
    if (endpoint === '/api/admin/dashboard') return response({ overview: {}, telemetry: { errorCodes: [] }, trends: { days7: {} } });
    if (method !== 'GET') {
      if (networkWrite) throw new Error('write outcome unknown');
      if (scenario === 'config') flagStatus = 403; // Write succeeds; mandatory subsequent reread fails.
      return response({});
    }
    if (endpoint === '/api/admin/feature-flags') {
      const result = response(paged([{ key: 'review.flag', enabled: false, description: '复核功能开关', config: { n: 1 } }]), flagStatus);
      if (holdFlags) await new Promise<void>(resolve => { releaseFlags = resolve; });
      return result;
    }
    if (endpoint === '/api/admin/system-settings') return response(paged([{ key: 'review.setting', description: '独立系统参数', value: null }]));
    if (endpoint === '/api/admin/color-cards') return response(paged([]));
    if (endpoint === '/api/admin/storage-assets') return response(paged([{ id: 'asset-1', objectKey: 'review/existing.png', resourceType: 'work', contentType: 'image/png', byteSize: 1, visibility: 'private', status: 'active', ownerUid: 'target', metadata: null }]), storageStatus);
    if (endpoint === '/api/admin/community-content') return response(paged([{ id: 'work-1', entityType: 'work', title: '复核图纸', authorUid: 'target', status: 'published' }]));
    if (endpoint === '/api/admin/content-moderation') return response(paged([]), moderationStatus);
    if (endpoint === '/api/admin/codes') {
      const requestedTotal = codesTotal;
      const result = response({ ...paged(page > Math.max(1, Math.ceil(requestedTotal / 20)) ? [] : [{ id: 'code-1', code: 'REVIEW-ONLY-CODE', days: 30, member_type: 1, used: false, copied: false, createdAt: now, channel: url.searchParams.get('search') || '复核渠道' }], requestedTotal, (page - 1) * 20), page });
      if (holdCodePageTwo && page === 2) await new Promise<void>(resolve => { releaseCodePageTwo = resolve; });
      return result;
    }
    if (endpoint === '/api/admin/code-redemptions') return response(paged(page > Math.max(1, Math.ceil(recordsTotal / 20)) ? [] : [{ id: 'redemption-1', code: 'REVIEW-ONLY-CODE', userUid: '复核兑换用户', days: 30, memberType: 1, redeemedAt: now }], recordsTotal, (page - 1) * 20));
    if (endpoint === '/api/admin/logs') return response(paged(page > Math.max(1, Math.ceil(logsTotal / 20)) ? [] : [{ id: 'log-1', type: url.searchParams.get('type') || 'admin', operatorUid: url.searchParams.get('operatorUid') || '复核操作者', level: url.searchParams.get('level') || 'review', timestamp: now }], logsTotal, (page - 1) * 20));
    throw new Error('Unexpected endpoint: ' + endpoint);
  };
  const deny = () => { throw new Error('External network forbidden'); };
  (globalThis as any).XMLHttpRequest = deny; (globalThis as any).WebSocket = deny; navigator.sendBeacon = deny;
  const root = createRoot(document.getElementById('root')!);
  const flush = async (action?: () => void) => {
    await act(async () => { action?.(); });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };
  const visible = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const top = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(visible).at(-1) ?? document.body;
  const button = (label: string, scope: ParentNode = top()) => {
    const found = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(item => visible(item) && (item.textContent?.trim() === label || item.getAttribute('aria-label') === label));
    if (!found) throw new Error('Missing visible button: ' + label); return found;
  };
  const click = async (label: string, scope?: ParentNode) => flush(() => button(label, scope).click());
  const change = async (element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) => flush(() => {
    if (!element) throw new Error('Missing field'); element.focus();
    const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
  let key = 0;
  const mount = async (section: string) => flush(() => { history.replaceState({}, '', '?section=' + section); root.render(<AdminConsole key={++key} />); });
  const writes = () => requests.filter(item => item.method !== 'GET');
  const mainText = () => document.querySelector<HTMLElement>('.admin-main')?.innerText ?? '';
  const configEdit = () => document.querySelector<HTMLButtonElement>('[data-config-edit="review.flag"]')!;
  const sectionFor = (label: string) => document.querySelector(`table[aria-label="${label}"]`)!.closest('section')!;
  const lastRead = (endpoint: string) => requests.filter(item => item.method === 'GET' && item.path.startsWith(endpoint)).at(-1)!;
  try {
    if (scenario === 'config') {
      await mount('config'); await click('编辑');
      await change(top().querySelector('[data-config-json]')!, '{"n":2}');
      await click('复核保存差异'); await click('确认提交');
      assert(writes().length === 1 && writes()[0].body.config.n === 2, 'P2-1: successful PUT retains the original configuration contract');
      assert(mainText().includes('403'), 'P2-1: post-write 403 is visible while the old list is retained');
      assert(configEdit().disabled, 'P2-1 RED: post-write failed reread must leave old configuration row read-only');
      const count = writes().length;
      await flush(() => configEdit().click());
      assert(!document.querySelector('[data-config-review]') && writes().length === count, 'P2-1: stale row cannot open another writable editor or PUT');
      assert(button('新建配置').disabled, 'P2-1: stale scope cannot create new configuration');
      await click('刷新配置'); assert(configEdit().disabled, 'P2-1: repeated 403 does not restore writing');
      await click('系统参数'); assert(!button('编辑').disabled, 'P2-1: successful independent setting scope remains usable');
      await click('功能开关'); flagStatus = 200; holdFlags = true;
      await click('刷新配置'); assert(configEdit().disabled && button('新建配置').disabled, 'P2-1: loading does not unlock the stale snapshot');
      holdFlags = false; await flush(() => releaseFlags?.());
      assert(!configEdit().disabled && !button('新建配置').disabled, 'P2-1: only successful current reread restores configuration writes');
    }
    if (scenario === 'uncertain') {
      await mount('colors-assets'); await click('资源元数据'); await click('登记资源');
      const fields = top().querySelectorAll<HTMLInputElement>('input');
      await change(fields[0], 'review/new.png'); await change(fields[1], 'work');
      await click('保存'); networkWrite = true; await click('确认提交');
      assert(button('确认提交').disabled && writes().length === 1, 'P2-2: first uncertain resource POST is blocked in its original confirmation');
      await click('取消'); await click('保存');
      assert(button('确认提交').disabled, 'P2-2 RED: reopening review without any GET must not clear uncertain resource write');
      await click('确认提交'); assert(writes().length === 1, 'P2-2: reopened uncertain review cannot send a duplicate resource POST');
      await click('取消'); storageStatus = 403;
      await click('刷新', document.body);
      assert(button('保存').disabled, 'P2-2: failed resource reread cannot unlock the editor');
      // Remounting and reading another module must not be treated as resource reconciliation.
      networkWrite = false; await mount('community');
      await click(innerWidth < 768 ? '记录审核动作' : '审核'); await click('记录审核');
      networkWrite = true; await click('确认提交');
      assert(writes().at(-1)?.body.action === 'approve' && writes().at(-1)?.body.entityType === 'work', 'P2-2: moderation keeps original action and entity type');
      await click('取消'); await click('记录审核');
      assert(button('确认提交').disabled, 'P2-2: moderation POST also remains blocked after reopening review');
      await click('取消');
      await click('刷新', document.body); // community-content GET, not content-moderation GET.
      await click('记录审核'); assert(button('确认提交').disabled, 'P2-2: successful content-summary GET cannot reconcile moderation-record scope');
      await click('取消'); await click('关闭新增内容审核动作');
      await mount('community'); // A new component instance still has no moderation-record GET.
      await click(innerWidth < 768 ? '记录审核动作' : '审核'); await click('记录审核');
      assert(button('确认提交').disabled, 'P2-2: remounting current operator does not reset scope uncertainty');
      await click('取消'); await click('关闭新增内容审核动作');
      moderationStatus = 403; await click('审核记录'); await click('刷新');
      await click('社区内容', document.querySelector('.admin-main')!); assert(button('社区内容', document.querySelector('.admin-main')!).getAttribute('aria-pressed') === 'true', 'P2-2: select the community content tab, not the same-named desktop sidebar entry'); await click(innerWidth < 768 ? '记录审核动作' : '审核'); await click('记录审核');
      assert(button('确认提交').disabled, 'P2-2: failed moderation-record GET does not clear uncertainty');
      await click('取消'); await click('关闭新增内容审核动作');
      moderationStatus = 200; await click('审核记录'); await click('社区内容', document.querySelector('.admin-main')!); assert(button('社区内容', document.querySelector('.admin-main')!).getAttribute('aria-pressed') === 'true', 'P2-2: select the community content tab, not the same-named desktop sidebar entry');
      await click(innerWidth < 768 ? '记录审核动作' : '审核'); await click('记录审核');
      assert(!button('确认提交').disabled, 'P2-2: successful related moderation-record GET permits deliberate retry');
      networkWrite = false; await click('确认提交');
      assert(writes().filter(item => item.path === '/api/admin/content-moderation').length === 2, 'P2-2: moderation has exactly original uncertain write and one reconciled deliberate retry');
      await mount('colors-assets'); // color-card GET is unrelated to resource scope.
      storageStatus = 200; await click('资源元数据'); await click('登记资源');
      const retryFields = top().querySelectorAll<HTMLInputElement>('input');
      await change(retryFields[0], 'review/new.png'); await change(retryFields[1], 'work'); await click('保存');
      assert(!button('确认提交').disabled, 'P2-2: successful related resource GET releases only its resource scope');
      await click('确认提交');
      assert(writes().filter(item => item.path === '/api/admin/storage-assets').length === 2, 'P2-2: resources have no extra POST before successful scope reconciliation');
    }
    if (scenario === 'pagination') {
      await mount('codes'); await change(document.querySelector('[data-code-search]')!, '筛选标识'); await click('查询');
      await click('下一页', sectionFor('兑换码列表')); codesTotal = 1; const before = requests.length;
      await click('刷新兑换数据');
      assert(requests.slice(before).some(item => item.path.startsWith('/api/admin/codes?') && new URL(item.path, location.href).searchParams.get('page') === '1'), 'P2-3 RED: shrinking code total must reread effective last page rather than hide pagination');
      assert(mainText().includes('筛选标识') && !mainText().includes('没有匹配兑换码'), 'P2-3: code last-page rows remain visible after shrink');
      assert(new URL(lastRead('/api/admin/codes?').path, location.href).searchParams.get('search') === '筛选标识', 'P2-3: code page clamp preserves submitted filters');
      await click('下一页', sectionFor('兑换使用记录')); recordsTotal = 1; await click('刷新兑换数据');
      assert(new URL(lastRead('/api/admin/code-redemptions?').path, location.href).searchParams.get('page') === '1', 'P2-3: redemption records reread last valid page too');
      assert(new URL(lastRead('/api/admin/code-redemptions?').path, location.href).searchParams.get('code') === '筛选标识', 'P2-3: redemption clamp preserves its code filter');
      await mount('logs'); await change(document.querySelector('[data-log-operator]')!, 'review-user'); await change(document.querySelector('[data-log-level]')!, 'review-action'); await click('查询');
      await click('下一页'); logsTotal = 1; await click('刷新日志');
      const logQuery = new URL(lastRead('/api/admin/logs?').path, location.href).searchParams;
      assert(logQuery.get('page') === '1' && logQuery.get('operatorUid') === 'review-user' && logQuery.get('level') === 'review-action', 'P2-3: shrinking logs reread last page with original type/operator/action filters');
      assert(mainText().includes('review-user') && !mainText().includes('没有匹配日志'), 'P2-3: logs no longer claim a false empty result');
      codesTotal = 21; await mount('codes'); await click('下一页', sectionFor('兑换码列表'));
      holdCodePageTwo = true; codesTotal = 1; await click('刷新兑换数据');
      await change(document.querySelector('[data-code-search]')!, '最新筛选'); await click('查询');
      const afterNewQuery = requests.length; holdCodePageTwo = false; await flush(() => releaseCodePageTwo?.());
      assert(requests.length === afterNewQuery && mainText().includes('最新筛选'), 'P2-3: obsolete page-two response cannot clamp or overwrite a newer filter result');
      assert(writes().length === 0, 'P2-3: pagination and filter recovery perform no writes');
    }
    assert(document.documentElement.scrollWidth <= innerWidth + 1, 'current regression view has no horizontal viewport overflow');
    assert(browserErrors.length === 0, 'no browser/React runtime errors');
    return { passed: true, scenario, viewportWidth: innerWidth, checks, requests, browserErrors };
  } catch (error) {
    return { passed: false, scenario, viewportWidth: innerWidth, checks, requests, browserErrors, error: String(error instanceof Error ? error.stack : error) };
  }
}
