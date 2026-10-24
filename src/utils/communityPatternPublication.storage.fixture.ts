import {
  saveExportedPatternRecord, getUserExportedPatterns, getPatternProject, retryPatternCloudSync,
  renameExportedPattern, deleteLocalExportedPatternCopy, deleteCloudExportedPatternAndLocal,
  markExportedPatternPublished, type PatternCompletionMetadata,
} from './patternHistory';
import { publishCommunityPattern } from './communityPatternPublication';
import { readCommunitySnapshot } from './communityPatternSnapshot';
import type { StoredPatternProject } from './patternGridCodec';
import { retryPatternCloudSync as bindInStore } from './patternStore';

const account = 'storage-user-a';
const project: StoredPatternProject = {
  version: 2, name: '真实存储图纸', width: 2, height: 1, boardSize: 29, brand: 'CUSTOM', createdAt: 1,
  grid: [['red', null]], palette: [{ id: 'red', code: 'R1', name: '红', hex: '#ff0000', rgb: [255, 0, 0], brand: 'CUSTOM' }],
  settings: { width: 2, height: 1, boardSize: 29, brand: 'CUSTOM', keepAspectRatio: true, dither: 'none', colorLimit: 1,
    brightness: 0, contrast: 0, saturation: 0, transparentCutoff: 0, colorMatchAlgo: 'rgb', sharpening: 0,
    outlineBoost: false, chromaKeyColor: null, chromaKeyTolerance: 0 },
};
const entitlement: PatternCompletionMetadata = { completionStatus: 'COMPLETED', paidNonEmptyBeads: 1, paidUnits: 7,
  paidBeadSavingLevel: 25, sourceHash: 'source-a', gridHash: 'grid-a' };
const metadataKey = (uid: string | null) => `beadgrid_pattern_completion_v1:${encodeURIComponent(uid ?? 'local')}`;
const state = { offline: false, failSync: false, calls: [] as { path: string; body: any }[], remote: new Map<string, any>(), chunks: new Map<number, any>(), manifest: null as any, png: null as Blob | null };
const response = (data: unknown, success = true, status = 200) => new Response(JSON.stringify({ success, data, message: success ? undefined : 'offline test' }), { status, headers: { 'Content-Type': 'application/json' } });
window.fetch = async (input, options) => {
  const path = new URL(String(input)).pathname;
  const body = typeof options?.body === 'string' ? JSON.parse(options.body) : options?.body;
  state.calls.push({ path, body });
  if (state.offline) return response(null, false, 503);
  if (path === '/api/user-patterns/grid/init') {
    if (state.failSync) return response(null, false, 503);
    state.manifest = body.manifest;
    state.remote.set(body.id, { id: body.id, title: body.title, width: body.width, height: body.height, totalBeads: body.totalBeads,
      createdAt: 1, updatedAt: 2, revision: 1, status: 0, thumbnailUrl: null });
    return response({ revision: 1 });
  }
  if (path === '/api/user-patterns/grid/chunk') {
    if (options?.method === 'POST') { state.chunks.set(body.index, body); return response({ accepted: true }); }
    return response(state.chunks.get(Number(new URL(String(input)).searchParams.get('index'))));
  }
  if (path === '/api/user-patterns/grid/finalize' || path === '/api/user-patterns/preview') return response({ revision: 1, uploaded: true });
  if (path === '/api/user-patterns/grid/open') {
    const id = new URL(String(input)).searchParams.get('id')!;
    return response({ work: state.remote.get(id), manifest: state.manifest });
  }
  if (path === '/api/user-patterns/rename') {
    const value = { ...state.remote.get(body.id), title: body.title, updatedAt: 3 };
    state.remote.set(body.id, value); return response(value);
  }
  if (path === '/api/user-patterns/delete') { state.remote.delete(body.id); return response({ deleted: true }); }
  if (path === '/api/user-patterns') return response([...state.remote.values()]);
  if (path === '/api/community/assets') { state.png = body; return response({ asset: { id: 'real-asset' } }); }
  if (path === '/api/community/posts') {
    state.remote.set(body.workId, { ...state.remote.get(body.workId), status: body.visibility === 'public' ? 1 : 0,
      communityPost: { id: 'real-post', visibility: body.visibility } });
    return response({ post: { id: 'real-post', assetId: body.assetId, title: body.title, visibility: body.visibility, workId: body.workId, publishedAt: 4 } });
  }
  throw new Error(`Unexpected offline fixture API: ${path}`);
};

async function reset() {
  localStorage.clear(); sessionStorage.clear();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Storage reset remained blocked')), 3000);
    const request = indexedDB.deleteDatabase('stellabean-patterns');
    request.onsuccess = () => { clearTimeout(timeout); resolve(); };
    request.onerror = () => { clearTimeout(timeout); reject(request.error); };
    // An already-closing connection may briefly block deletion until its last
    // IndexedDB transaction commits; that is not a failed storage operation.
  });
  state.offline = false; state.failSync = false; state.calls = []; state.remote.clear(); state.chunks.clear(); state.png = null;
}
async function save(patch: Record<string, unknown> = {}) {
  return saveExportedPatternRecord({ id: 'real-work', userId: account, title: project.name, ...project,
    totalBeads: 1, ...entitlement, ...patch });
}
function assert(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
const count = (path: string) => state.calls.filter(call => call.path === path).length;
async function publish(record: Awaited<ReturnType<typeof save>>, visibility: 'public' | 'private' = 'public') {
  return publishCommunityPattern({ record, currentUserId: account, isSessionCurrent: () => true,
    metadata: { title: '发布元数据', description: '真实 helper', tags: ['原创'], visibility } });
}
async function rejects(operation: () => Promise<unknown>, label: string) {
  let rejected = false; try { await operation(); } catch { rejected = true; } assert(rejected, label);
}
async function withAccountQuotaFailure(operation: () => Promise<void>) {
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key.startsWith('beadgrid_pattern_completion_v1:') && key !== metadataKey(null)) throw new DOMException('Quota fault regression', 'QuotaExceededError');
    return originalSetItem.call(this, key, value);
  };
  try { await operation(); } finally { Storage.prototype.setItem = originalSetItem; }
}
const cases: Record<string, () => Promise<void>> = {
  'cloud-only rename': async () => {
    const original = await save(); await deleteLocalExportedPatternCopy(original.id, account);
    const cloud = (await getUserExportedPatterns(account))[0]; assert(!cloud.hasLocalCopy, 'must actually be cloud-only in IndexedDB');
    const renamed = await renameExportedPattern(cloud, account, '云端改名');
    assert(renamed.title === '云端改名' && !renamed.hasLocalCopy && renamed.hasCloudCopy, 'cloud-only rename must retain cloud availability');
    assert((await getUserExportedPatterns(account))[0].title === '云端改名', 'cloud-only renamed title persists remotely');
  },
  'cloud-only delete': async () => {
    const original = await save(); await deleteLocalExportedPatternCopy(original.id, account);
    await deleteCloudExportedPatternAndLocal(original.id, account);
    assert((await getUserExportedPatterns(account)).length === 0, 'cloud-only deletion must succeed with no IndexedDB record');
  },
  'missing local delete is idempotent': async () => {
    const original = await save(); await deleteLocalExportedPatternCopy(original.id, account);
    await deleteLocalExportedPatternCopy(original.id, account);
    assert(state.remote.has(original.id), 'local-only cleanup must not delete remote work');
  },
  'foreign local guards': async () => {
    const foreign = await save({ userId: 'storage-user-b' }); const before = state.calls.length;
    await rejects(() => renameExportedPattern(foreign, account, 'wrong'), 'must reject foreign local rename');
    await rejects(() => deleteCloudExportedPatternAndLocal(foreign.id, account), 'must reject foreign cloud delete');
    await rejects(() => deleteLocalExportedPatternCopy(foreign.id, account), 'must reject foreign local delete');
    assert(state.calls.length === before, 'foreign guards must run before any mutation API');
    assert((await getPatternProject(foreign.id, 'storage-user-b')).name === project.name, 'foreign project unchanged');
  },
  'real retry retains entitlement': async () => {
    state.failSync = true; const original = await save(); assert(original.syncState === 'failed', 'real initial cloud failure');
    state.failSync = false; const synced = await retryPatternCloudSync(original.id, account);
    assert(synced.userId === account && synced.hasCloudCopy, 'sync remains bound to current account');
    for (const [key, value] of Object.entries(entitlement)) assert(synced[key] === value, `retry lost authoritative ${key}`);
    const result = await publish(synced); assert(result.ok, 'real synced completed record must publish');
    for (const [key, value] of Object.entries(entitlement)) assert(result.record[key] === value, `publish lost ${key}`);
    await result.localMark;
  },
  'helper drives real sync without dropping entitlement': async () => {
    state.failSync = true; const original = await save(); state.failSync = false;
    const result = await publish(original);
    assert(result.ok, 'helper must execute real retry-to-cloud chain');
    for (const [key, value] of Object.entries(entitlement)) assert(result.record[key] === value, `helper sync lost ${key}`);
    assert(result.record.userId === account && result.record.hasCloudCopy, 'helper synced record belongs to current account');
    assert(count('/api/user-patterns/grid/init') === 2 && count('/api/community/posts') === 1, 'real failed save, retry upload and exactly one post');
    await result.localMark;
  },
  'unbound sync migrates scoped entitlement': async () => {
    const original = await save({ userId: null });
    const synced = await retryPatternCloudSync(original.id, account);
    for (const [key, value] of Object.entries(entitlement)) assert(synced[key] === value, `binding lost ${key}`);
    const restored = await getPatternProject(synced.id, account);
    assert(restored.completionStatus === 'COMPLETED' && restored.paidNonEmptyBeads === 1, 'bound project retains scoped entitlement after restore');
    const wrongNamespace = localStorage.getItem(metadataKey('storage-user-b'));
    await rejects(() => retryPatternCloudSync(synced.id, 'storage-user-b'), 'bound record cannot sync into another account');
    assert(localStorage.getItem(metadataKey('storage-user-b')) === wrongNamespace, 'rejected sync never copies entitlement to other account');
  },
  'quota recovery keeps DRAFT metadata and publishing locked': async () => {
    const draftMetadata = { ...entitlement, completionStatus: 'DRAFT' as const, paidNonEmptyBeads: 0 };
    const original = await save({ userId: null, ...draftMetadata });
    const anonymousBefore = localStorage.getItem(metadataKey(null));
    await withAccountQuotaFailure(async () => {
      await rejects(() => retryPatternCloudSync(original.id, account), 'quota failure must be surfaced');
    });
    const recovered = await retryPatternCloudSync(original.id, account);
    for (const [key, value] of Object.entries(draftMetadata)) assert(recovered[key] === value, `quota recovery lost ${key}`);
    const refreshed = (await getUserExportedPatterns(account))[0];
    const restored = await getPatternProject(original.id, account);
    assert(refreshed.completionStatus === 'DRAFT' && restored.completionStatus === 'DRAFT', 'list and project retain DRAFT after storage recovers and retry completes');
    const result = await publish(refreshed);
    assert(!result.ok && count('/api/community/assets') === 0 && count('/api/community/posts') === 0, 'quota recovery never promotes DRAFT into publishable LEGACY');
    assert(localStorage.getItem(metadataKey(null)) === anonymousBefore, 'recovery never destroys anonymous source metadata');
    const otherBefore = localStorage.getItem(metadataKey('storage-user-b'));
    await rejects(() => retryPatternCloudSync(original.id, 'storage-user-b'), 'recovered binding still rejects foreign retry');
    assert(localStorage.getItem(metadataKey('storage-user-b')) === otherBefore, 'foreign retry cannot copy anonymous entitlement into another namespace');
  },
  'already-bound migration failure stays locked and retryable': async () => {
    const original = await save({ userId: null, completionStatus: 'DRAFT', paidNonEmptyBeads: 0 });
    // Reproduce the durable partial state left by the previous implementation:
    // IndexedDB identity is bound but the account metadata write never happened.
    const partial = await bindInStore(original.id, account);
    assert(!localStorage.getItem(metadataKey(account)), 'fixture has no account-scoped metadata');
    await withAccountQuotaFailure(async () => {
      await rejects(() => retryPatternCloudSync(original.id, account), 'bound pending migration must still retry/fail on quota');
      const refreshed = (await getUserExportedPatterns(account))[0];
      assert(refreshed.completionStatus === 'DRAFT', 'failed bound migration must not become legacy in refreshed list');
      const restored = await getPatternProject(original.id, account);
      assert(restored.completionStatus === 'DRAFT' && restored.paidNonEmptyBeads === 0, 'failed bound migration preserves original project rights');
      const result = await publish(partial);
      assert(!result.ok && count('/api/community/assets') === 0 && count('/api/community/posts') === 0, 'stale unclassified summary cannot bypass bound pending migration');
    });
    const recovered = await retryPatternCloudSync(original.id, account);
    assert(recovered.completionStatus === 'DRAFT' && recovered.paidNonEmptyBeads === 0, 'already-bound migration recovers after quota is restored');
    assert((await getPatternProject(original.id, account)).completionStatus === 'DRAFT', 'recovered project remains DRAFT on fresh load');
  },
  'private helper persists offline publication': async () => {
    const original = await save(); const result = await publish(original, 'private');
    assert(result.ok, 'private real helper succeeds'); assert(await result.localMark === 'marked', 'private local marking succeeds');
    state.offline = true;
    const offline = (await getUserExportedPatterns(account))[0];
    assert(offline.status === 0, 'private cache must never become public status=1');
    assert(offline.communityPost?.id === 'real-post' && offline.communityPost.visibility === 'private', 'offline cache retains private management post id and visibility');
    assert(offline.hasLocalCopy && offline.hasCloudCopy, 'published project remains in library');
    const snapshot = await readCommunitySnapshot(state.png!);
    assert(JSON.stringify(snapshot?.grid) === JSON.stringify(project.grid), 'real uploaded PNG retains full grid');
  },
  'cloud-only private publish restores and persists cache': async () => {
    const original = await save(); await deleteLocalExportedPatternCopy(original.id, account);
    const cloud = (await getUserExportedPatterns(account))[0];
    const result = await publish(cloud, 'private'); assert(result.ok, 'cloud-only helper restores project then publishes privately');
    await result.localMark; state.offline = true;
    const cached = (await getUserExportedPatterns(account))[0];
    assert(cached.status === 0 && cached.communityPost?.visibility === 'private' && cached.communityPost.id === 'real-post', 'restored IndexedDB cache retains private publication');
    assert(count('/api/user-patterns/grid/open') === 1, 'real cloud manifest restore was exercised');
  },
  'two-argument mark remains compatible': async () => {
    const original = await save(); const marked = await markExportedPatternPublished(original.id, account);
    assert(marked?.status === 1, 'legacy two-argument mark remains public');
    const privateMark = await markExportedPatternPublished(original.id, account, { id: 'explicit-private', visibility: 'private' });
    assert(privateMark?.status === 0 && privateMark.communityPost?.id === 'explicit-private', 'new mark accepts exact publication metadata');
  },
  'latest DRAFT blocks stale completed summary': async () => {
    const stale = await save(); await save({ completionStatus: 'DRAFT' });
    assert((await getPatternProject(stale.id, account)).completionStatus === 'DRAFT', 'latest real stored project is DRAFT');
    const result = await publish(stale);
    assert(!result.ok, 'latest DRAFT must reject even when old summary says COMPLETED');
    assert(count('/api/community/assets') === 0 && count('/api/community/posts') === 0, 'draft rejected before upload/post');
  },
  'actual grid exceeds latest paid coverage': async () => {
    const stale = await save(); await save({ grid: [['red', 'red']], totalBeads: 2 });
    const latest = await getPatternProject(stale.id, account);
    assert(latest.grid[0][1] === 'red' && latest.paidNonEmptyBeads === 1, 'real latest project has two beads with only one paid');
    const result = await publish(stale);
    assert(!result.ok, 'actual grid occupancy must be covered, not old summary.totalBeads');
    assert(count('/api/community/assets') === 0 && count('/api/community/posts') === 0, 'unpaid added bead rejected before upload/post');
  },
};
(window as any).runStorageCase = async (name: string) => { await reset(); await cases[name](); return { name, passed: true }; };
