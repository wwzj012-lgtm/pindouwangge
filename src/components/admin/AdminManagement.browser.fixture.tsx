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
  let codeCopied = false; let roleCodes = ['dashboard.read']; let hasGridSnapshot = false; let corruptPreview = false;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
  const now = 1_793_000_000_000;
  const announcement = { id: 'notice-1', title: '测试公告', body: '公告正文', status: 'draft', audience: 'all', publishAt: null, expireAt: null, createdAt: now, updatedAt: now };
  const card = { id: 'card-1', brandKey: 'mard', displayName: 'Mard-291', colorCount: 291, sourceUrl: null, status: 'active', notes: '', swatchCount: 1, createdAt: now, updatedAt: now };
  const asset = { id: 'asset-1', objectKey: 'works/test.png', resourceType: 'work', contentType: 'image/png', byteSize: 1024, visibility: 'private', status: 'active', ownerUid: 'target', metadata: null };
  const content = { id: 'work-1', entityType: 'work', title: '测试图纸作品', authorUid: 'target', status: 'published', moderation: { action: 'approve', createdAt: now } };
  let communityPost = { publicationToken: 'observed-publication', id: 'post_0123456789abcdef', assetId: 'asset-1', workId: 'work-1', title: '测试社区帖子', description: '',
    publishedAt: now, withdrawnAt: null as number | null, visibility: 'public' as 'public' | 'private', publiclyVisible: true,
    author: { uid: 'target', displayName: '测试用户' }, moderation: { state: 'visible' as 'visible' | 'hidden', version: 0, reason: '' },
    work: { id: 'work-1', status: 1, width: 29, height: 29, totalBeads: 100 }, imageUrl: '/api/admin/community-posts/asset?id=post_0123456789abcdef' };
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
      if ((endpoint.endsWith('/takedown') || endpoint.endsWith('/restore')) && writeStatus < 400) {
        communityPost = { ...communityPost, moderation: { state: endpoint.endsWith('/takedown') ? 'hidden' : 'visible', version: communityPost.moderation.version + 1, reason: body.reason } };
        return response({ post: communityPost, audit: { action: endpoint.endsWith('/takedown') ? 'takedown' : 'restore' } }, writeStatus);
      }
      if (endpoint === '/api/admin/roles/permissions' && writeStatus < 400) roleCodes = body.permissionCodes;
      if (endpoint === '/api/admin/update-code' && writeStatus < 400 && typeof body?.updates?.copied === 'boolean') codeCopied = body.updates.copied;
      if (endpoint === '/api/admin/generate-codes') return response({ count: body.codes.length }, writeStatus);
      return response({}, writeStatus);
    }
    if (readStatus !== 200 && endpoint !== '/api/admin/dashboard') return response({}, readStatus);
    if (endpoint === '/api/admin/dashboard') return response({ overview: {}, telemetry: { errorCodes: [] }, trends: { days7: {} } });
    if (endpoint === '/api/admin/announcements') return response(page([announcement], announcementTotal));
    if (endpoint === '/api/admin/color-cards') return response(page([card]));
    if (endpoint === '/api/admin/color-swatches') return response(page([{ id: 'swatch-1', cardId: card.id, colorCode: 'A01', displayName: '樱花粉', hex: '#FF0088', rgb: { r: 255, g: 0, b: 136 }, sortOrder: 0 }]));
    if (endpoint === '/api/admin/community-assets') return response(page([{id:'asset_0123456789abcdef', ownerUid:'target',contentType:'image/png', byteSize:68,sha256:'a'.repeat(64),createdAt:now,availability:'available',usage:{postCount:1,activePostCount:1,workCount:1},inUse:true,canDelete:false,previewPath:'/api/admin/community-assets/preview?id=asset_0123456789abcdef'}]));
    if (endpoint === '/api/admin/community-posts/asset' || endpoint === '/api/admin/community-posts/pattern-preview' || endpoint === '/api/admin/community-assets/preview') {
      const h = new Headers(init?.headers);
      assert(h.get('Authorization') === 'Bearer fixture-user' && h.get('X-Admin-Session') === 'fixture-admin', 'private image uses bearer and session headers');
      if (corruptPreview) return new Response('broken-image', {headers:{'Content-Type':'image/png'}});
      return new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}});
    }
    if (endpoint === '/api/admin/storage-assets') return response(page([asset]));
    if (endpoint === '/api/admin/community-content') return response(page([content]));
    if (endpoint === '/api/admin/community-posts') return response(page([communityPost]));
    if (endpoint === '/api/admin/community-posts/detail') return response({ post: communityPost, asset: { content_type: 'image/png', byte_length: 1024 }, work: communityPost.work, snapshot: hasGridSnapshot ? {kind:'grid',source:'current-active-revision',revision:1, manifest:{width:29,height:29,name:'fixture-current-grid'},previewUrl:'/api/admin/community-posts/pattern-preview?id='+communityPost.id+'&revision=1'} : null, audit: [] });
    if (endpoint === '/api/admin/reports') return response(page([report]));
    if (endpoint === '/api/admin/content-moderation') return response(page([{ ...content, id: 'action-1', entityId: content.id, action: 'hide', reason: '测试记录', operatorUid: 'operator', createdAt: now }]));
    if (endpoint === '/api/admin/feature-flags') return response(page([{ key: 'fixture.flag', enabled: false, description: '测试开关', config: { enabled: false } }]));
    if (endpoint === '/api/admin/system-settings') return response(page([]));
    if (endpoint === '/api/admin/codes') return response({ ...page([{ ...code, copied: codeCopied }]), page: 1, stats: { total: 1, redeemed: 0, available: 1, copied: codeCopied ? 1 : 0, deletePending: 0 } });
    if (endpoint === '/api/admin/code-redemptions') return response(page([]));
    if (endpoint === '/api/admin/users') return response(page([{ uid: 'target', displayName: '测试用户', email: 'target@example.invalid', member_type: 0, member_expire: null, moderation: { status: 'active' } }]));
    if (endpoint === '/api/admin/user-tags') return response(page([]));
    if (endpoint === '/api/admin/roles') return response(page([role]));
    if (endpoint === '/api/admin/permissions') return response(page([{ id: 'perm-1', code: 'dashboard.read', displayName: 'Read dashboard' }, {id:'perm-2',code:'users.read',displayName:'Read users'}]));
    if (endpoint === '/api/admin/roles/permissions') return response({ role, permissionCodes: roleCodes });
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
  const waitForState = async (ready: () => boolean, label: string) => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (ready()) return;
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    }
    const modules = Array.from(document.querySelectorAll('.admin-permission-module-toggle')).map(item => ({
      panel: item.getAttribute('aria-controls'), expanded: item.getAttribute('aria-expanded'), text: item.textContent,
    }));
    throw new Error('Timed out waiting for ' + label + ': ' + JSON.stringify(modules));
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
  const codeRow = () => document.querySelector<HTMLElement>('[data-code-row="code-1"]')!;
  assert(!codeRow().classList.contains('admin-code-row--sale-marked') && text().includes('未标记发售'), 'unmarked code keeps the normal row state');
  await click('标记为发售'); await click('确认提交');
  assert(codeRow().classList.contains('admin-code-row--sale-marked') && text().includes('已标记发售') && text().includes('仅表示发售标记，不代表真实付款'), 'successful reread applies the yellow sale marker');
  readStatus = 500; await click('取消发售标记'); await click('确认提交');
  assert(codeRow().classList.contains('admin-code-row--sale-marked') && text().includes('当前仍显示旧状态，请刷新确认'), 'failed reread keeps the old yellow snapshot and reports pending confirmation');
  readStatus = 200; await click('刷新兑换数据');
  assert(!codeRow().classList.contains('admin-code-row--sale-marked') && text().includes('未标记发售'), 'successful refresh reconciles the server sale marker');
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
  await click('内建色卡（只读）');
  assert(text().includes('内建色卡只读目录') && text().includes('不会自动替换内建调色板或改变匹配算法'), 'builtin catalog is read-only and separate from custom CRUD and matching');
  await change(document.querySelector<HTMLSelectElement>('[aria-label="内建色卡品牌"]')!, 'MARD');
  await change(document.querySelector<HTMLInputElement>('[aria-label="搜索内建色号或HEX"]')!, '#FAF4C8');
  assert(text().includes('A1') && text().includes('#FAF4C8') && Boolean(document.querySelector('[data-builtin-color="MARD_A1"]')), 'builtin brand/code/HEX come from actual static palette');
  assert(!Array.from(document.querySelectorAll('.admin-builtin-palettes button')).some(b=>/新增|删除|编辑/.test(b.textContent??'')), 'builtin directory has no mutating controls');
  await click('色卡配置');
  assert(Boolean(button('新建色卡')), 'custom color card CRUD remains available after builtin lookup');
  await click('真实资源文件');
  assert(text().includes('KV 对象存在') && text().includes('跨存储操作不保证原子性'), 'resource tab reads actual object availability and declares deletion safety limit');
  assert(requests.some(item=>item.path.startsWith('/api/admin/community-assets?')), 'resource tab uses real resource endpoint');
  await click('预览资源 asset_0123456789abcdef');
  await waitForState(() => Boolean(top().querySelector<HTMLImageElement>('img[src^="blob:"]')?.naturalWidth), 'resource image to successfully decode');
  assert(Boolean(top().querySelector('img[src^="blob:"]')), 'resource preview displays authenticated binary object URL');
  await click('关闭资源预览');
  corruptPreview = true; await click('预览资源 asset_0123456789abcdef');
  await waitForState(() => text().includes('资源图片解码失败'), 'corrupt resource to show decoding error');
  assert(!document.querySelector('[role="dialog"] img'), 'corrupt resource blob is removed instead of shown as success');
  corruptPreview = false;
  ensureNames(); noOverflow('assets');

  await mount('community', 'community');
  assert(text().includes('社区帖子审核') && requests.some(item => item.path.startsWith('/api/admin/community-posts?')), 'community menu uses the new real community-post route');
  assert(!text().includes('通过审核') && !text().includes('approve'), 'new community panel does not misrepresent old generic moderation actions');
  await click(innerWidth < 768 ? '查看详情' : '详情');
  assert(text().includes('缺少图纸证据，当前仅记录审核'), 'community detail discloses that the diagram evidence is missing');
  await waitForState(() => text().includes('真实预览已加载'), 'community image to successfully decode');
  assert(Boolean(document.querySelector('.admin-community-preview img[src^="blob:"]')) && text().includes('真实预览已加载'), 'community shows real authenticated image evidence via object URL');
  assert(!text().includes('已查看完整视觉证据'), 'community does not claim unviewed evidence was reviewed');
  hasGridSnapshot = true; await click(innerWidth < 768 ? '查看详情' : '详情');
  await waitForState(() => Array.from(document.querySelectorAll<HTMLImageElement>('.admin-community-preview img')).length === 2 && Array.from(document.querySelectorAll<HTMLImageElement>('.admin-community-preview img')).every(img => img.naturalWidth > 0), 'both community images to successfully decode');
  assert(document.querySelectorAll('.admin-community-preview img[src^="blob:"]').length === 2, 'community renders both authenticated asset and actual pattern preview');
  assert(text().includes('当前快照（非历史版本）') && text().includes('fixture-current-grid'), 'current manifest is readable and explicitly not historical');
  const writesBeforeReview = writes().length;
  await click('下架帖子');
  assert(writes().length === writesBeforeReview && top().textContent?.includes('expectedVersion') === false, 'takedown opens confirmation without an early write');
  assert(button('确认提交').disabled, 'empty moderation reason blocks submission');
  await change(top().querySelector('textarea')!, '  fixture moderation reason  ');
  await click('确认提交');
  const takedown = writes().at(-1)!;
  assert(takedown.path === '/api/admin/community-posts/takedown' && takedown.body.id === communityPost.id && takedown.body.reason === 'fixture moderation reason' && takedown.body.expectedVersion === 0 && takedown.body.expectedPublicationToken === 'observed-publication', 'confirmed takedown sends actual endpoint, reason and CAS version');
  assert(text().includes('已下架') && document.querySelector('.admin-community-detail-body')?.getAttribute('data-community-version') === '1', 'successful takedown reports the server-read state and incremented version');

  corruptPreview = true; await click(innerWidth < 768 ? '查看详情' : '详情');
  await waitForState(() => text().includes('图片解码失败') && text().includes('图纸预览解码失败'), 'corrupt community image and pattern to report decode errors');
  assert(!text().includes('真实预览已加载') && document.querySelectorAll('.admin-community-preview img').length === 0, 'corrupt blobs never count as visible evidence and their image URLs are removed');
  corruptPreview = false;

  await mount('roles', 'roles');
  await waitForState(() => Boolean(document.querySelector<HTMLInputElement>('.admin-role-permissions [data-permission-code="dashboard.read"]')?.checked), 'the actual role permissions to finish loading');
  assert(text().includes('只读管理员') && !text().includes('Read only'), 'known English role display name is mapped to Chinese');
  // Modules are sorted by Chinese label, not server code or insertion order.
  // Expand the exact dashboard module, never whichever module happens to be first.
  const dashboardModule = document.querySelector<HTMLButtonElement>('.admin-permission-module-toggle[aria-controls="admin-permission-group-dashboard"]')!;
  assert(Boolean(dashboardModule), 'dashboard permission module has a stable control target');
  if (dashboardModule.getAttribute('aria-expanded') !== 'true') await flush(() => dashboardModule.click());
  await waitForState(() => dashboardModule.getAttribute('aria-expanded') === 'true' && visible(document.querySelector('[data-permission-code="dashboard.read"]')!), 'dashboard permission module to be visibly expanded');
  assert(text().includes('dashboard.read') && text().includes('读取') && Boolean(document.querySelector('[data-permission-code="dashboard.read"]')), 'permission codes remain technical identifiers with Chinese module/action labels');
  const userModule = document.querySelector<HTMLButtonElement>('.admin-permission-module-toggle[aria-controls="admin-permission-group-users"]')!;
  assert(Boolean(userModule), 'user permission module has a stable control target');
  if (userModule.getAttribute('aria-expanded') !== 'true') await flush(()=>userModule.click());
  await waitForState(() => userModule.getAttribute('aria-expanded') === 'true' && visible(document.querySelector('[data-permission-code="users.read"]')!), 'user permission module to be visibly expanded');
  await flush(()=>document.querySelector<HTMLInputElement>('[data-permission-code="users.read"]')!.click());
  assert(document.querySelector<HTMLInputElement>('[data-permission-code="dashboard.read"]')!.disabled, 'minimum permission stays locked during optional grant');
  await click('保存权限'); await click('确认操作');
  await waitForState(() => Boolean(document.querySelector<HTMLInputElement>('[data-permission-code="users.read"]')?.checked) && text().includes('权限已保存'), 'saved permissions to be reread');
  assert(roleCodes.includes('users.read') && writes().at(-1)?.body.permissionCodes.includes('users.read'), 'role save submits true server permission codes');
  assert(document.querySelector<HTMLInputElement>('[data-permission-code="users.read"]')!.checked && text().includes('权限已保存'), 'saved role permissions are reread and reflected in actual controls');
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
  assert(text().includes('暂无成功读取结果') && !text().includes('暂无可读取的'), 'initial failed read does not claim community is empty');
  readStatus = 200;

  // Keep a representative existing core screen mounted for screenshot evidence.
  await mount('evidence', 'community'); await click(innerWidth < 768 ? '查看详情' : '详情');
  assert(text().includes('帖子详情') && text().includes('已下架'), 'community evidence view remains usable after server-confirmed moderation');
  await flush();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
  ensureNames(); noOverflow('reports');
  assert(browserErrors.length === 0, 'browser has no React/runtime errors');
  const selectedTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.admin-main button[aria-pressed]')).map(item => ({ label: item.textContent, selected: item.getAttribute('aria-pressed'), className: item.className, background: getComputedStyle(item).backgroundColor }));
  assert(text().includes('当前快照（非历史版本）') && document.querySelectorAll('.admin-community-preview img[src^="blob:"]').length === 2, 'final community view renders real image and pattern evidence');
  return { checks, browserErrors, viewportWidth: innerWidth, writeCount: writes().length, selectedTabs, requests: requests.map(({ path, method }) => ({ path, method })), note: 'Synthetic API only; no production requests, credentials, secrets or writes.' };
}
