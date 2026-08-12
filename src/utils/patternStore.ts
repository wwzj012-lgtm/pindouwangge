import type { BrandKey, BeadColor } from '../types';
import { apiGet, apiGetBlob, apiPost } from './api';
import {
  base64ToBytes,
  bytesToBase64,
  cloneGrid,
  decodePatternProject,
  encodePatternProject,
  type EncodedGridChunk,
  type GridChunkCodec,
  type GridMatrix,
  type PatternSettingsSnapshot,
  type StoredPatternManifest,
  type StoredPatternProject,
} from './patternGridCodec';
import { renderPatternPreview } from './patternPreview';

const DATABASE_NAME = 'stellabean-patterns';
const DATABASE_VERSION = 2;
const PATTERN_STORE = 'patterns';
const PREVIEW_STORE = 'pattern-previews';

export type PatternSyncState = 'local-only' | 'pending' | 'synced' | 'failed';

export interface PatternRecordSummary {
  id: string;
  userId: string | null;
  title: string;
  width: number;
  height: number;
  totalBeads: number;
  createdAt: number;
  updatedAt: number;
  syncState: PatternSyncState;
  syncError?: string;
  cloudRevision?: number;
  thumbnailUrl?: string | null;
  previewBlob?: Blob | null;
  previewRevision?: number | null;
  hasPreview?: boolean;
  hasLocalCopy: boolean;
  hasCloudCopy: boolean;
}

interface LocalPatternRecord extends PatternRecordSummary {
  project: StoredPatternProject;
}

interface PreviewCacheRecord {
  key: string;
  id: string;
  revision: number;
  blob: Blob;
  updatedAt: number;
}

interface CloudPatternSummary {
  id: string;
  title: string;
  width: number;
  height: number;
  totalBeads: number;
  createdAt: number;
  updatedAt: number;
  revision: number;
  thumbnailUrl: string | null;
  hasPreview?: boolean;
  previewRevision?: number | null;
}

interface CloudManifestResponse {
  work: CloudPatternSummary;
  manifest: StoredPatternManifest;
}

interface CloudChunkResponse {
  index: number;
  codec: GridChunkCodec;
  payloadBase64: string;
  sha256: string;
}

interface CloudSaveInitResponse {
  revision: number;
}

export interface SavePatternInput {
  id?: string;
  userId: string | null;
  title: string;
  width: number;
  height: number;
  totalBeads: number;
  boardSize: number;
  brand: BrandKey;
  settings: PatternSettingsSnapshot;
  grid: GridMatrix;
  palette: BeadColor[];
}

export interface SavePatternResult {
  record: PatternRecordSummary;
  cloudSaved: boolean;
  message?: string;
}

export type PatternDeletionAction = 'local' | 'cloud-and-local';

const CLOUD_CHUNK_CONCURRENCY = 5;

interface CloudRenameResponse {
  id: string;
  title: string;
  updatedAt: number;
}

interface CloudPreviewUploadResponse {
  uploaded: boolean;
  revision: number;
}

function newPatternId(): string {
  return `pat_${crypto.randomUUID()}`;
}

function countBeads(grid: GridMatrix): number {
  return grid.reduce((total, row) => total + row.reduce((rowTotal, value) => rowTotal + (value === null ? 0 : 1), 0), 0);
}

export function normalizePatternTitle(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Pattern name must be text');
  const title = value.trim();
  if (title.length < 1 || title.length > 200) throw new Error('Pattern name must be between 1 and 200 characters');
  return title;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('This browser does not support offline pattern storage'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Unable to open offline pattern storage'));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PATTERN_STORE)) {
        const store = database.createObjectStore(PATTERN_STORE, { keyPath: 'id' });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!database.objectStoreNames.contains(PREVIEW_STORE)) {
        const store = database.createObjectStore(PREVIEW_STORE, { keyPath: 'key' });
        store.createIndex('id', 'id', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(storeName: string, mode: IDBTransactionMode, callback: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = callback(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Offline pattern operation failed'));
      transaction.onerror = () => reject(transaction.error ?? new Error('Offline pattern operation failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Offline pattern operation was aborted'));
    });
  } finally {
    database.close();
  }
}

async function putLocal(record: LocalPatternRecord): Promise<void> {
  await withStore(PATTERN_STORE, 'readwrite', (store) => store.put(record));
}

async function getLocal(id: string): Promise<LocalPatternRecord | undefined> {
  return withStore(PATTERN_STORE, 'readonly', (store) => store.get(id));
}

function previewCacheKey(id: string, revision: number): string {
  return `${id}:${revision}`;
}

async function getPreviewCache(id: string, revision: number): Promise<Blob | null> {
  const cached = await withStore<PreviewCacheRecord | undefined>(PREVIEW_STORE, 'readonly', (store) => store.get(previewCacheKey(id, revision)));
  return cached?.blob ?? null;
}

async function putPreviewCache(id: string, revision: number, blob: Blob): Promise<void> {
  await withStore(PREVIEW_STORE, 'readwrite', (store) => store.put({
    key: previewCacheKey(id, revision), id, revision, blob, updatedAt: Date.now(),
  } satisfies PreviewCacheRecord));
}

async function deletePreviewCaches(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PREVIEW_STORE, 'readwrite');
      const request = transaction.objectStore(PREVIEW_STORE).index('id').openCursor(IDBKeyRange.only(id));
      request.onerror = () => reject(request.error ?? new Error('Offline preview cleanup failed'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Offline preview cleanup failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Offline preview cleanup was aborted'));
    });
  } finally {
    database.close();
  }
}

function toSummary(record: LocalPatternRecord): PatternRecordSummary {
  const { project: _project, ...summary } = record;
  return summary;
}

function cloneProject(project: StoredPatternProject): StoredPatternProject {
  return {
    ...project,
    grid: cloneGrid(project.grid),
    palette: project.palette.map((color) => ({ ...color, rgb: [...color.rgb] as BeadColor['rgb'] })),
  };
}

async function listLocal(userId: string | null): Promise<LocalPatternRecord[]> {
  const all = await withStore<LocalPatternRecord[]>(PATTERN_STORE, 'readonly', (store) => store.getAll());
  return all
    .filter((record) => record.userId === userId || record.userId === null)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function apiFailureMessage(error: string | undefined): string {
  return error ?? 'Cloud sync could not be completed. The full pattern remains available on this device.';
}

async function uploadCloudRecord(record: LocalPatternRecord): Promise<{ revision: number }> {
  if (!record.userId) throw new Error('Sign in is required to save this pattern to cloud history');
  const encoded = await encodePatternProject(record.project);
  const init = await apiPost<CloudSaveInitResponse>('/api/user-patterns/grid/init', {
    id: record.id,
    title: record.title,
    width: record.width,
    height: record.height,
    totalBeads: record.totalBeads,
    manifest: encoded.manifest,
  });
  if (!init.ok || !init.data) throw new Error(apiFailureMessage(init.error));

  for (const chunk of encoded.chunks) {
    const response = await apiPost<{ accepted: boolean }>('/api/user-patterns/grid/chunk', {
      id: record.id,
      revision: init.data.revision,
      index: chunk.index,
      codec: chunk.codec,
      sha256: chunk.sha256,
      payloadBase64: bytesToBase64(chunk.payload),
    }, { timeoutMs: 20_000 });
    if (!response.ok) throw new Error(apiFailureMessage(response.error));
  }

  const finalize = await apiPost<{ revision: number }>('/api/user-patterns/grid/finalize', {
    id: record.id,
    revision: init.data.revision,
    rootSha256: encoded.manifest.rootSha256,
  });
  if (!finalize.ok || !finalize.data) throw new Error(apiFailureMessage(finalize.error));
  return { revision: finalize.data.revision };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return bytesToBase64(bytes);
}

async function sha256Blob(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function createAndStorePreview(record: LocalPatternRecord, force = false): Promise<LocalPatternRecord> {
  if (record.previewBlob && !force) return record;
  try {
    const previewBlob = await renderPatternPreview(record.project);
    const withPreview = { ...record, previewBlob, previewRevision: record.cloudRevision ?? null, hasPreview: true };
    await putLocal(withPreview);
    return withPreview;
  } catch {
    return record;
  }
}

async function uploadPreviewIfPossible(record: LocalPatternRecord): Promise<LocalPatternRecord> {
  if (!record.userId || !record.cloudRevision) return record;
  const withPreview = await createAndStorePreview(record);
  const preview = withPreview.previewBlob;
  if (!preview || (preview.type !== 'image/webp' && preview.type !== 'image/png')) return withPreview;
  try {
    const result = await apiPost<CloudPreviewUploadResponse>('/api/user-patterns/preview', {
      id: withPreview.id,
      revision: withPreview.cloudRevision,
      mimeType: preview.type,
      sha256: await sha256Blob(preview),
      payloadBase64: await blobToBase64(preview),
    }, { timeoutMs: 20_000 });
    if (!result.ok) return withPreview;
    const uploaded = { ...withPreview, hasPreview: true, previewRevision: withPreview.cloudRevision };
    await putLocal(uploaded);
    return uploaded;
  } catch {
    return withPreview;
  }
}

export async function savePatternRecord(input: SavePatternInput): Promise<SavePatternResult> {
  const now = Date.now();
  const requestedId = input.id ?? newPatternId();
  const requestedPrevious = await getLocal(requestedId);
  // A work id is scoped to its original account. Never overwrite another account's local copy.
  const previous = requestedPrevious
    && requestedPrevious.userId === input.userId
    ? requestedPrevious
    : undefined;
  const id = previous ? requestedId : (requestedPrevious ? newPatternId() : requestedId);
  const project: StoredPatternProject = {
    version: 2,
    name: input.title.trim() || 'Untitled bead pattern',
    width: input.width,
    height: input.height,
    boardSize: input.boardSize,
    brand: input.brand,
    settings: { ...input.settings },
    grid: cloneGrid(input.grid),
    palette: input.palette.map((color) => ({ ...color, rgb: [...color.rgb] as BeadColor['rgb'] })),
    createdAt: previous?.project.createdAt ?? now,
  };

  let localRecord: LocalPatternRecord = {
    id,
    userId: input.userId,
    title: project.name,
    width: project.width,
    height: project.height,
    totalBeads: input.totalBeads || countBeads(project.grid),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    syncState: input.userId ? 'pending' : 'local-only',
    cloudRevision: previous?.cloudRevision,
    thumbnailUrl: previous?.thumbnailUrl ?? null,
    previewBlob: null,
    previewRevision: null,
    hasPreview: false,
    hasLocalCopy: true,
    hasCloudCopy: previous?.hasCloudCopy ?? false,
    project,
  };

  try {
    await putLocal(localRecord);
  } catch (error) {
    throw new Error(error instanceof Error ? `Offline save failed: ${error.message}` : 'Offline save failed');
  }

  localRecord = await createAndStorePreview(localRecord, true);
  if (!input.userId) return { record: toSummary(localRecord), cloudSaved: false };

  try {
    const cloud = await uploadCloudRecord(localRecord);
    const synced: LocalPatternRecord = {
      ...localRecord,
      syncState: 'synced',
      syncError: undefined,
      cloudRevision: cloud.revision,
      hasCloudCopy: true,
    };
    await putLocal(synced);
    localRecord = await uploadPreviewIfPossible(synced);
    return { record: toSummary(localRecord), cloudSaved: true };
  } catch (error) {
    const failed: LocalPatternRecord = {
      ...localRecord,
      syncState: 'failed',
      syncError: error instanceof Error ? error.message : 'Cloud sync failed',
      hasCloudCopy: previous?.hasCloudCopy ?? false,
    };
    await putLocal(failed);
    return { record: toSummary(failed), cloudSaved: false, message: failed.syncError };
  }
}

export async function retryPatternCloudSync(id: string, userId: string | null): Promise<PatternRecordSummary> {
  const record = await getLocal(id);
  if (!record) throw new Error('The local pattern is no longer available for retry');
  if (!userId) throw new Error('Sign in is required before retrying cloud sync');
  if (record.userId !== null && record.userId !== userId) throw new Error('This local pattern belongs to another account');

  const pending = { ...record, userId, syncState: 'pending' as const, syncError: undefined };
  await putLocal(pending);
  try {
    const cloud = await uploadCloudRecord(pending);
    const synced: LocalPatternRecord = {
      ...pending,
      syncState: 'synced',
      cloudRevision: cloud.revision,
      hasCloudCopy: true,
    };
    await putLocal(synced);
    return toSummary(await uploadPreviewIfPossible(synced));
  } catch (error) {
    const failed: LocalPatternRecord = {
      ...pending,
      syncState: 'failed',
      syncError: error instanceof Error ? error.message : 'Cloud sync failed',
    };
    await putLocal(failed);
    throw error;
  }
}

/** Limits independent chunk restores without serializing a 900x900 pattern. */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const safeLimit = Math.max(1, Math.floor(limit));
  const output = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      output[index] = await mapper(values[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(safeLimit, values.length) }, () => worker()));
  return output;
}

export async function getPatternProject(id: string, userId: string | null = null): Promise<StoredPatternProject> {
  const local = await getLocal(id);
  if (local?.userId === null || local?.userId === userId) return cloneProject(local.project);

  const response = await apiGet<CloudManifestResponse>('/api/user-patterns/grid/open', { id });
  if (!response.ok || !response.data) throw new Error(apiFailureMessage(response.error));
  const chunks = await mapWithConcurrency(response.data.manifest.chunks, CLOUD_CHUNK_CONCURRENCY, async (descriptor) => {
    const chunk = await apiGet<CloudChunkResponse>('/api/user-patterns/grid/chunk', {
      id,
      revision: String(response.data.work.revision),
      index: String(descriptor.index),
    }, { timeoutMs: 20_000 });
    if (!chunk.ok || !chunk.data) throw new Error(apiFailureMessage(chunk.error));
    return { ...descriptor, codec: chunk.data.codec, payload: base64ToBytes(chunk.data.payloadBase64) };
  });

  const project = await decodePatternProject(response.data.manifest, chunks);
  const cached: LocalPatternRecord = {
    id: response.data.work.id,
    userId,
    title: response.data.work.title,
    width: response.data.work.width,
    height: response.data.work.height,
    totalBeads: response.data.work.totalBeads,
    createdAt: response.data.work.createdAt,
    updatedAt: response.data.work.updatedAt,
    syncState: 'synced',
    cloudRevision: response.data.work.revision,
    thumbnailUrl: response.data.work.thumbnailUrl,
    previewBlob: local?.previewBlob ?? null,
    previewRevision: response.data.work.previewRevision ?? null,
    hasPreview: response.data.work.hasPreview ?? false,
    hasLocalCopy: true,
    hasCloudCopy: true,
    project,
  };
  await putLocal(cached);
  return cloneProject(project);
}

export async function getPatternHistory(userId: string | null): Promise<PatternRecordSummary[]> {
  let localRecords = await listLocal(userId);
  localRecords = await mapWithConcurrency(localRecords, 2, (record) => createAndStorePreview(record));
  const merged = new Map<string, PatternRecordSummary>(localRecords.map((record) => [record.id, toSummary(record)]));

  if (userId) {
    const cloud = await apiGet<CloudPatternSummary[]>('/api/user-patterns');
    if (cloud.ok && Array.isArray(cloud.data)) {
      for (const remote of cloud.data) {
    const local = merged.get(remote.id);
    if (!Number.isInteger(remote.revision) || remote.revision < 1) continue;
    const localHasUnsyncedTitle = local?.syncState === 'pending' || local?.syncState === 'failed';
    merged.set(remote.id, {
          id: remote.id,
          userId,
          title: localHasUnsyncedTitle ? local!.title : remote.title,
          width: local?.width ?? remote.width,
          height: local?.height ?? remote.height,
          totalBeads: local?.totalBeads ?? remote.totalBeads,
          createdAt: local?.createdAt ?? remote.createdAt,
          updatedAt: Math.max(local?.updatedAt ?? 0, remote.updatedAt),
          syncState: local?.syncState ?? 'synced',
          syncError: local?.syncError,
          cloudRevision: remote.revision,
          thumbnailUrl: remote.thumbnailUrl,
          previewBlob: local?.previewBlob ?? null,
          hasPreview: remote.hasPreview ?? local?.hasPreview ?? false,
          previewRevision: remote.previewRevision ?? local?.previewRevision ?? null,
          hasLocalCopy: local?.hasLocalCopy ?? false,
          hasCloudCopy: true,
        });
      }
    }
  }

  return mergePatternRecordSummaries([...merged.values()]);
}

export async function getPatternPreview(id: string, revision: number, userId: string | null): Promise<Blob | null> {
  const local = await getLocal(id);
  if (local?.previewBlob && local.previewRevision === revision && (local.userId === null || local.userId === userId)) return local.previewBlob;
  if (!userId) return null;
  const cached = await getPreviewCache(id, revision);
  if (cached) return cached;
  const result = await apiGetBlob('/api/user-patterns/preview', { id, revision: String(revision) });
  if (!result.ok || !result.data) return null;
  await putPreviewCache(id, revision, result.data);
  if (local && (local.userId === null || local.userId === userId)) {
    await putLocal({ ...local, previewBlob: result.data, previewRevision: revision, hasPreview: true });
  }
  return result.data;
}

export function mergeRenamedPatternSummary(
  current: PatternRecordSummary,
  renamed: CloudRenameResponse,
): PatternRecordSummary {
  return {
    ...current,
    id: renamed.id,
    title: renamed.title,
    updatedAt: renamed.updatedAt,
    syncState: 'synced',
    syncError: undefined,
    hasCloudCopy: true,
  };
}

export async function renamePatternRecord(
  current: PatternRecordSummary,
  userId: string | null,
  nextTitle: string,
): Promise<PatternRecordSummary> {
  const title = normalizePatternTitle(nextTitle);
  const local = await getLocal(current.id);
  if (local?.userId !== null && local?.userId !== userId) throw new Error('This local pattern belongs to another account');
  const localOnly = !userId || !current.hasCloudCopy;
  if (localOnly) {
    if (!local) throw new Error('Pattern is no longer available on this device');
    const updated = { ...local, title, updatedAt: Date.now(), project: { ...local.project, name: title } };
    await putLocal(updated);
    return toSummary(updated);
  }

  const result = await apiPost<CloudRenameResponse>('/api/user-patterns/rename', { id: current.id, title });
  if (!result.ok || !result.data) throw new Error(apiFailureMessage(result.error));
  const merged = mergeRenamedPatternSummary(current, result.data);
  if (!local) return merged;
  const updated: LocalPatternRecord = {
    ...local,
    ...merged,
    project: { ...local.project, name: result.data.title },
  };
  await putLocal(updated);
  return toSummary(updated);
}

export function patternDeletionActions(record: PatternRecordSummary): PatternDeletionAction[] {
  if (record.hasLocalCopy && record.hasCloudCopy) return ['local', 'cloud-and-local'];
  if (record.hasCloudCopy) return ['cloud-and-local'];
  return record.hasLocalCopy ? ['local'] : [];
}

export function requiresExplicitCloudBinding(record: PatternRecordSummary, currentUserId: string | null): boolean {
  return record.userId === null
    && currentUserId !== null
    && record.hasLocalCopy
    && !record.hasCloudCopy;
}

export async function deleteLocalPatternCopy(id: string, userId: string | null): Promise<void> {
  const local = await getLocal(id);
  if (local?.userId !== null && local?.userId !== userId) {
    throw new Error('This local pattern belongs to another account');
  }
  if (local) await withStore(PATTERN_STORE, 'readwrite', (store) => store.delete(id));
  await deletePreviewCaches(id);
}

export async function deleteCloudPatternAndLocal(id: string, userId: string | null): Promise<void> {
  if (!userId) throw new Error('Sign in is required to delete a cloud pattern');
  const local = await getLocal(id);
  if (local?.userId !== null && local?.userId !== userId) {
    throw new Error('This local pattern belongs to another account');
  }

  const result = await apiPost<{ deleted: boolean }>('/api/user-patterns/delete', { id });
  if (!result.ok) throw new Error(apiFailureMessage(result.error));
  if (local) await withStore(PATTERN_STORE, 'readwrite', (store) => store.delete(id));
  await deletePreviewCaches(id);
}

/** Merges the local and cloud list by work id without allowing duplicate cards. */
export function mergePatternRecordSummaries(records: readonly PatternRecordSummary[]): PatternRecordSummary[] {
  const merged = new Map<string, PatternRecordSummary>();
  for (const record of records) {
    const existing = merged.get(record.id);
    if (!existing || record.updatedAt >= existing.updatedAt) {
      merged.set(record.id, {
        ...existing,
        ...record,
        hasLocalCopy: Boolean(existing?.hasLocalCopy || record.hasLocalCopy),
        hasCloudCopy: Boolean(existing?.hasCloudCopy || record.hasCloudCopy),
      });
      continue;
    }
    merged.set(record.id, {
      ...existing,
      hasLocalCopy: existing.hasLocalCopy || record.hasLocalCopy,
      hasCloudCopy: existing.hasCloudCopy || record.hasCloudCopy,
    });
  }
  return [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}
