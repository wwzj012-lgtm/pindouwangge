import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App';
import { LanguageProvider } from '../context/LanguageContext';
import { readCommunitySnapshot } from '../utils/communityPatternSnapshot';
import type { ExportedPatternRecord } from '../utils/patternHistory';
import type { StoredPatternProject } from '../utils/patternGridCodec';
import '../index.css';

const scope = window as any;
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
const project: StoredPatternProject = {
  version: 2, name: '原始无损工程', width: 2, height: 1, boardSize: 29, brand: 'CUSTOM', createdAt: 123,
  grid: [['red', null]],
  palette: [{ id: 'red', code: 'R1', name: '原始红色', hex: '#ff0000', rgb: [255, 0, 0], brand: 'CUSTOM' }],
  settings: { width: 2, height: 1, boardSize: 29, brand: 'CUSTOM', keepAspectRatio: true, dither: 'none', colorLimit: 1,
    brightness: 2, contrast: 3, saturation: 4, transparentCutoff: 5, colorMatchAlgo: 'rgb', sharpening: 0,
    outlineBoost: false, chromaKeyColor: null, chromaKeyTolerance: 0 },
};
const record = (patch = {}): ExportedPatternRecord => ({
  id: 'browser-work', userId: 'browser-user', title: '浏览器图纸', width: 2, height: 1, totalBeads: 1,
  createdAt: 123, updatedAt: 123, status: 0, syncState: 'synced', hasCloudCopy: true, hasLocalCopy: true,
  completionStatus: 'COMPLETED', paidNonEmptyBeads: 1, ...patch,
} as ExportedPatternRecord);
const listeners = new Set<() => void>();
const noop = async () => {};
const probe = scope.libraryProbe = {
  auth: { currentUser: { uid: 'browser-user', displayName: '图库测试用户' }, userProfile: null, isVip: true, isPro: false,
    creditSummary: null, canAccessAdmin: false, refreshProfile: noop, refreshCreditSummary: noop, updateUserProfile: noop, logoutUser: noop },
  subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
  records: [record()], calls: [] as { name: string; args: any[] }[], files: [] as File[],
  failure: '', holdRead: false, releaseRead: null as null | (() => void), holdUpload: false, releaseUpload: null as null | (() => void),
  browserErrors: [] as string[], interceptedApi: [] as string[], history: {} as Record<string, (...args: any[]) => any>,
  community: {} as Record<string, (...args: any[]) => any>,
};
window.addEventListener('error', event => probe.browserErrors.push(event.message));
window.addEventListener('unhandledrejection', event => probe.browserErrors.push(String(event.reason)));
window.fetch = async (input) => {
  const url = String(input);
  if (!url.includes('/api/')) throw new Error('Non-API fetch blocked in offline fixture');
  probe.interceptedApi.push(url);
  return new Response(JSON.stringify({ ok: true, data: { flags: [], announcements: [], posts: [], imported: [] } }), { headers: { 'Content-Type': 'application/json' } });
};
const track = (name: string, fn: (...args: any[]) => any) => (...args: any[]) => { probe.calls.push({ name, args }); return fn(...args); };
probe.history = {
  getUserExportedPatterns: track('list', async () => probe.records.map(value => ({ ...value }))),
  getPatternProject: track('read', async () => {
    if (probe.holdRead) await new Promise<void>(resolve => { probe.releaseRead = resolve; });
    return { ...structuredClone(project), workId: 'browser-work', completionStatus: 'COMPLETED', paidNonEmptyBeads: 1 };
  }),
  getExportedPatternPreview: track('preview', async () => null),
  markLegacyByWorkKeys: async () => [],
  saveExportedPatternRecord: async () => { throw new Error('Unexpected save'); },
  retryPatternCloudSync: track('sync', async (id, userId) => {
    if (probe.failure === 'sync') throw new Error('同步失败测试');
    const updated = { ...probe.records.find(value => value.id === id)!, userId, hasCloudCopy: true, syncState: 'synced' as const };
    probe.records = probe.records.map(value => value.id === id ? updated : value);
    return updated;
  }),
  renameExportedPattern: track('rename', async (value, _userId, title) => {
    const updated = { ...value, title, updatedAt: 456 };
    probe.records = probe.records.map(item => item.id === value.id ? updated : item);
    return updated;
  }),
  deleteLocalExportedPatternCopy: track('localDelete', async (id) => {
    probe.records = probe.records.flatMap(value => value.id !== id ? [value] : value.hasCloudCopy ? [{ ...value, hasLocalCopy: false }] : []);
    return true;
  }),
  deleteCloudExportedPatternAndLocal: track('cloudDelete', async (id) => { probe.records = probe.records.filter(value => value.id !== id); return true; }),
  markExportedPatternPublished: track('mark', async () => { if (probe.failure === 'mark') throw new Error('Local mark failed'); return null; }),
};
probe.community = {
  listFavoriteCommunityPosts: async () => ({ ok: true, data: { posts: [] } }),
  uploadCommunityAsset: track('upload', async (file) => {
    probe.files.push(file);
    if (probe.holdUpload) await new Promise<void>(resolve => { probe.releaseUpload = resolve; });
    if (probe.failure === 'upload') return { ok: false, error: '上传失败测试' };
    return { ok: true, data: { asset: { id: 'browser-asset' } } };
  }),
  publishCommunityPost: track('publish', async (input) => {
    if (probe.failure === 'publish') return { ok: false, status: 402, error: '后端权益拒绝测试' };
    probe.records = probe.records.map(value => value.id === input.workId
      ? { ...value, status: input.visibility === 'public' ? 1 : 0, communityPost: { id: 'browser-post', visibility: input.visibility } } : value);
    return { ok: true, data: { post: { id: 'browser-post', visibility: input.visibility } } };
  }),
  setCommunityPostVisibility: track('visibility', async (_id, visibility) => {
    probe.records = probe.records.map(value => ({ ...value, status: visibility === 'public' ? 1 : 0, communityPost: { id: 'browser-post', visibility } }));
    return { ok: true };
  }),
  withdrawCommunityPost: track('withdraw', async () => {
    probe.records = probe.records.map(value => ({ ...value, status: 0, communityPost: undefined }));
    return { ok: true };
  }),
};
history.replaceState({}, '', '/workspace?tab=studio');
createRoot(document.getElementById('root')!).render(<LanguageProvider><App /></LanguageProvider>);

export async function runLibraryChecks(width: number) {
  const checks: string[] = [];
  const check = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  const waitFor = async (fn: () => unknown, label: string) => { for (let i = 0; i < 100; i++) { if (fn()) return; await pause(); } throw new Error(`Timed out: ${label}; ${document.body.innerText.slice(-1800)}`); };
  const buttons = (container: ParentNode = document) => [...container.querySelectorAll<HTMLButtonElement>('button')];
  const button = (label: string, container: ParentNode = document) => {
    const value = buttons(container).find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label
      || (item.parentElement?.classList.contains('profile-tabs') && item.querySelector('span')?.textContent === label));
    if (!value) throw new Error(`Button missing: ${label}`);
    return value;
  };
  const click = async (label: string, container: ParentNode = document) => { const value = button(label, container); check(!value.disabled, `enabled: ${label}`); value.click(); await pause(); };
  const profile = () => document.querySelector('.profile-overlay')!;
  const publishDialog = () => document.querySelector<HTMLElement>('[aria-labelledby="profile-publish-title"]');
  const setValue = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
  };
  const count = (name: string) => probe.calls.filter(call => call.name === name).length;
  const open = async () => {
    if (width < 768) { await click('打开更多操作'); await click('我的图纸'); }
    else { const account = buttons().find(value => value.textContent?.includes('图库测试用户')); check(account, 'desktop account entry exists'); account!.click(); await pause(); }
    await waitFor(() => profile()?.textContent?.includes('我的图库 · 全部工程'), 'new library');
    check(!document.body.textContent?.includes('我的图库与已发布作品'), 'old full-page gallery absent');
    check(Boolean(document.querySelector('.profile-dialog')), 'new profile library DOM');
  };
  const reset = async (patch = {}) => {
    probe.failure = ''; probe.holdRead = false; probe.holdUpload = false; probe.records = [record(patch)];
    if (!profile()) await open();
    await click('刷新图库', profile());
    await waitFor(() => document.querySelectorAll('.profile-pattern-card').length === 1, 'one loaded card');
  };
  await waitFor(() => document.querySelector('header'), 'actual App header');
  await open();
  check(Boolean(document.querySelector('.profile-pattern-card')), 'saved project in real App library');
  await click('我的豆仓', profile());
  await click('关闭个人中心');
  await open();
  check(Boolean(document.querySelector('.profile-pattern-card')), 'entry resets prior inventory tab to library');
  if (width < 768) {
    await click('关闭个人中心');
    await click('更多工具与视图设置');
    const cloudEntry = buttons().find(value => value.textContent?.includes('云端图纸库'));
    check(cloudEntry, 'phone toolkit cloud entry exists'); cloudEntry!.click(); await pause();
    check(profile()?.textContent?.includes('我的图库 · 全部工程'), 'phone toolkit opens new profile library');
    check(!document.body.textContent?.includes('画板增强工具箱 & 视图控制'), 'toolkit closes on library navigation');
  }
  for (const patch of [{ completionStatus: 'DRAFT' }, { completionStatus: 'COMPLETED', paidNonEmptyBeads: 0 }]) {
    await reset(patch); const before = probe.calls.length;
    await click('发布', profile());
    check(profile().textContent?.includes('完成图纸后解锁发布。'), 'locked record shows current inline hint');
    check(!publishDialog(), 'locked record does not open composer');
    check(probe.calls.length === before, 'locked click performs no read/upload/post');
  }
  const lockedTitle = document.querySelector<HTMLElement>('.profile-pattern-card h4')!;
  lockedTitle.click(); await pause();
  await click('发布到豆社');
  check(!document.body.textContent?.includes('编辑图纸（载入画板继续制作）') && profile().textContent?.includes('完成图纸后解锁发布。'), 'thumbnail action lock returns to visible inline library hint');
  await reset();
  await click('发布', profile());
  check(profile().isConnected && publishDialog(), 'lightweight composer over unchanged new library');
  check(document.activeElement === document.querySelector('[aria-describedby="profile-publish-name-help"]'), 'composer title receives focus');
  check(publishDialog()!.getBoundingClientRect().width <= width, 'composer fits viewport');
  if (scope.captureComposer) { scope.composerReady = true; await new Promise(resolve => { scope.resumeComposer = resolve; }); }
  await setValue(document.querySelector('[aria-describedby="profile-publish-name-help"]')!, '私密测试作品');
  await setValue(document.querySelector('[aria-describedby="profile-publish-description-help"]')!, '保留原始简介');
  await click('私密', publishDialog()!); await click('人物', publishDialog()!);
  await setValue(document.querySelector('[aria-label="自定义标签"]')!, '自定义'); await click('添加标签', publishDialog()!);
  const firstControl = publishDialog()!.querySelector<HTMLButtonElement>('button')!;
  firstControl.focus(); firstControl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  check(document.activeElement === button('确认发布', publishDialog()!), 'keyboard focus stays inside composer');
  await setValue(document.querySelector('[aria-label="自定义标签"]')!, '自定义'); await click('添加标签', publishDialog()!);
  probe.failure = 'upload'; const publishes = count('publish');
  await click('确认发布', publishDialog()!);
  await waitFor(() => publishDialog()?.textContent?.includes('上传失败测试'), 'upload failure');
  check(count('publish') === publishes, 'upload rejection never creates post');
  check(!button('取消', publishDialog()!).disabled, 'failure unlocks cancel');
  await click('取消', publishDialog()!);
  check(!publishDialog() && profile().isConnected, 'cancel retains gallery');
  await click('发布', profile());
  probe.failure = 'publish';
  await click('确认发布', publishDialog()!);
  await waitFor(() => publishDialog()?.textContent?.includes('后端权益拒绝测试'), 'backend denial');
  const rejectedCount = count('publish'); await pause();
  check(count('publish') === rejectedCount, 'backend denial is not automatically retried/bypassed');
  check(count('mark') === 0, 'failed post not marked published');
  await setValue(document.querySelector('[aria-describedby="profile-publish-name-help"]')!, '私密测试作品');
  await setValue(document.querySelector('[aria-describedby="profile-publish-description-help"]')!, '保留原始简介');
  await click('私密', publishDialog()!); await click('人物', publishDialog()!);
  await setValue(document.querySelector('[aria-label="自定义标签"]')!, '自定义'); await click('添加标签', publishDialog()!);
  probe.failure = ''; probe.holdUpload = true;
  const reads = count('read'); const uploads = count('upload');
  const submit = button('确认发布', publishDialog()!); submit.click(); submit.click();
  await waitFor(() => probe.releaseUpload, 'pending upload');
  check(count('read') === reads + 1 && count('upload') === uploads + 1, 'double click creates one project read and upload');
  check(button('取消', publishDialog()!).disabled && button('确认发布', publishDialog()!).disabled, 'in-flight composer controls disabled');
  const beforeRelease = count('publish'); check(beforeRelease === rejectedCount, 'no post until upload returns');
  probe.releaseUpload!(); probe.releaseUpload = null;
  await waitFor(() => !publishDialog(), 'publish success');
  check(count('publish') === beforeRelease + 1, 'single post after double click');
  const payload = probe.calls.filter(call => call.name === 'publish').at(-1)!.args[0];
  check(payload.title === '私密测试作品' && payload.description === '保留原始简介' && payload.visibility === 'private' && payload.tags.join(',') === '人物,自定义', 'edited title description visibility tags sent unchanged');
  check(document.querySelectorAll('.profile-pattern-card').length === 1, 'published project remains in library');
  check(profile().textContent?.includes('作品已私密发布') && profile().textContent?.includes('私密'), 'private success status visible');
  const snapshot = await readCommunitySnapshot(probe.files.at(-1)!);
  check(JSON.stringify(snapshot?.grid) === JSON.stringify(project.grid), 'PNG snapshot keeps null cells and complete grid');
  check(JSON.stringify(snapshot?.palette) === JSON.stringify(project.palette), 'PNG snapshot keeps full palette metadata');
  check(JSON.stringify(snapshot?.settings) === JSON.stringify(project.settings) && snapshot?.name === project.name && snapshot?.createdAt === 123, 'PNG snapshot keeps settings name and creation metadata');
  check(!('workId' in snapshot!) && !('paidNonEmptyBeads' in snapshot!), 'public snapshot excludes private work and entitlement metadata');
  await click('作品', profile());
  check(document.querySelectorAll('.profile-pattern-card').length === 1, 'private post appears in published works');
  await click('我的图库', profile());
  await click('发布管理', profile());
  await click('公开作品');
  await waitFor(() => profile().textContent?.includes('作品已公开'), 'visibility update');
  await click('发布管理', profile()); await click('撤回作品'); await click('确认撤回');
  await waitFor(() => profile().textContent?.includes('作品已从豆社撤回'), 'withdraw');
  check(document.querySelectorAll('.profile-pattern-card').length === 1, 'withdraw keeps library project');

  await reset(); await click('重命名图纸', profile());
  await setValue(document.querySelector('[aria-label="图纸名称"]')!, '重命名后保留'); await click('保存图纸名称', profile());
  check(profile().textContent?.includes('重命名后保留') && count('rename') === 1, 'rename persists through current library');
  await reset({ syncState: 'failed' }); probe.failure = 'sync';
  await click('重试同步', profile()); check(profile().textContent?.includes('同步失败测试'), 'sync failure remains retryable');
  probe.failure = ''; await click('重试同步', profile());
  check(profile().textContent?.includes('已同步到当前账号'), 'sync retry succeeds in place');
  await reset({ userId: null, hasCloudCopy: false, syncState: 'local' });
  await click('绑定当前账号', profile()); check(probe.records[0].userId === 'browser-user', 'unbound local copy can bind to current account');
  await reset({ communityPost: { id: 'browser-post', visibility: 'private' } });
  const cloudDeletes = count('cloudDelete');
  await click('删除本机副本', profile()); await click('确认删除');
  await waitFor(() => !document.body.textContent?.includes('删除图库工程？'), 'local delete closes');
  check(count('localDelete') === 1 && count('cloudDelete') === cloudDeletes, 'local delete never calls cloud delete');
  check(document.querySelectorAll('.profile-pattern-card').length === 1 && profile().textContent?.includes('私密'), 'local delete retains cloud project and publication');
  check(!buttons(profile()).some(value => value.textContent?.trim() === '删除本机副本'), 'deleted local copy no longer offered');
  await click('删除云端记录', profile()); await click('取消');
  check(count('cloudDelete') === cloudDeletes, 'cancel cloud deletion performs no deletion');
  await click('删除云端记录', profile()); await click('确认删除');
  await waitFor(() => document.querySelectorAll('.profile-pattern-card').length === 0, 'cloud delete removes project');
  check(count('cloudDelete') === cloudDeletes + 1, 'explicit cloud deletion uses cloud-and-local operation');

  await reset({ hasCloudCopy: false, userId: null, syncState: 'local' });
  await click('删除本机副本', profile()); await click('确认删除');
  await waitFor(() => document.querySelectorAll('.profile-pattern-card').length === 0, 'local-only deletion removes local card');
  check(count('cloudDelete') === cloudDeletes + 1, 'local-only delete never sends cloud deletion');

  await reset(); probe.failure = 'mark'; await click('发布', profile()); await click('确认发布', publishDialog()!);
  await waitFor(() => profile().textContent?.includes('已发布，图库本地状态更新失败'), 'post-confirmed local mark warning');
  check(document.querySelectorAll('.profile-pattern-card').length === 1 && !publishDialog(), 'server-confirmed public post survives failed local mark');
  probe.failure = ''; await click('编辑', profile());
  await waitFor(() => !profile(), 'continue editing closes profile after actual App restore');
  check(count('read') > 0, 'continue editing reads full stored project');
  await open();

  if (width < 768) {
    await reset(); await click('我的豆仓', profile()); await click('关闭个人中心');
    const home = document.querySelector<HTMLButtonElement>('header button[title="返回首页"]');
    check(home, 'phone studio back-home entry exists'); home!.click(); await pause(); await click('我的');
    await waitFor(() => profile()?.textContent?.includes('我的图库 · 全部工程'), 'phone bottom profile entry');
    check(Boolean(document.querySelector('.profile-pattern-card')), 'phone bottom profile resets inventory tab to library');
    await click('关闭个人中心');
    const avatar = buttons(document.querySelector('header')!).find(value => value.textContent?.includes('图库测试用户'));
    check(avatar, 'phone avatar entry exists'); avatar!.click(); await pause();
    check(profile()?.textContent?.includes('我的图库 · 全部工程'), 'phone avatar opens new library');
  }

  await reset(); await click('发布', profile()); probe.holdRead = true;
  const beforeSwitch = count('publish'); const beforeSwitchUpload = count('upload');
  button('确认发布', publishDialog()!).click();
  await waitFor(() => probe.releaseRead, 'pending read before account switch');
  probe.auth = { ...probe.auth, currentUser: { uid: 'different-user', displayName: '账号二' } };
  listeners.forEach(fn => fn()); await pause();
  check(!publishDialog(), 'account switch closes old publish dialog');
  check(!profile().textContent?.includes('浏览器图纸'), 'account switch hides other-account records');
  probe.releaseRead!(); probe.releaseRead = null; await pause();
  check(count('publish') === beforeSwitch && count('upload') === beforeSwitchUpload, 'stale account read cannot upload or publish');

  probe.auth = { ...probe.auth, currentUser: { uid: 'browser-user', displayName: '图库测试用户' } };
  listeners.forEach(fn => fn()); await pause();
  await reset(); await click('发布', profile()); probe.holdUpload = true;
  const beforeUploadSwitch = count('publish');
  button('确认发布', publishDialog()!).click(); await waitFor(() => probe.releaseUpload, 'pending upload before switch');
  probe.auth = { ...probe.auth, currentUser: { uid: 'different-user', displayName: '账号二' } };
  listeners.forEach(fn => fn()); await pause();
  probe.releaseUpload!(); probe.releaseUpload = null; await pause();
  check(!publishDialog() && count('publish') === beforeUploadSwitch, 'account switch during upload prevents stale post creation');
  check(probe.browserErrors.length === 0, 'no browser runtime errors');
  return { viewportWidth: width, checks, browserErrors: probe.browserErrors, interceptedApi: probe.interceptedApi.length };
}
scope.runLibraryChecks = runLibraryChecks;
