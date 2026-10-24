import type { BrandKey, BeadColor } from '../types';
import {
  deleteCloudPatternAndLocal,
  deleteLocalPatternCopy,
  getPatternHistory,
  getLocalPatternSummary,
  getPatternPreview,
  getPatternProject as getPatternProjectFromStore,
  markPatternPublished as markPatternPublishedInStore,
  normalizePatternTitle,
  patternDeletionActions,
  renamePatternRecord,
  requiresExplicitCloudBinding,
  retryPatternCloudSync as retryPatternCloudSyncFromStore,
  savePatternRecord,
  type PatternRecordSummary,
  type PatternCommunityPublication,
  type PatternSyncState,
} from './patternStore';
import type { GridMatrix, PatternSettingsSnapshot, StoredPatternProject } from './patternGridCodec';

export type PatternCompletionStatus = 'DRAFT' | 'COMPLETED' | 'LEGACY';

export interface PatternCompletionMetadata {
  completionStatus?: PatternCompletionStatus;
  paidNonEmptyBeads?: number | null;
  paidUnits?: number | null;
  paidBeadSavingLevel?: number | null;
  sourceHash?: string;
  gridHash?: string;
}

export type ExportedPatternRecord = PatternRecordSummary & PatternCompletionMetadata;
export type { PatternCommunityPublication, PatternSyncState, StoredPatternProject };

export interface EditablePatternProject extends StoredPatternProject, PatternCompletionMetadata {
  workId: string;
}
export { getPatternHistory, patternDeletionActions, requiresExplicitCloudBinding };
export { normalizePatternTitle };

const COMPLETION_METADATA_KEY_PREFIX = 'beadgrid_pattern_completion_v1:';

type PatternCompletionMetadataMap = Record<string, PatternCompletionMetadata>;

function completionMetadataKey(userId: string | null): string {
  return `${COMPLETION_METADATA_KEY_PREFIX}${encodeURIComponent(userId ?? 'local')}`;
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isCompletionStatus(value: unknown): value is PatternCompletionStatus {
  return value === 'DRAFT' || value === 'COMPLETED' || value === 'LEGACY';
}

function optionalNonNegativeNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseCompletionMetadata(value: unknown): PatternCompletionMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const metadata: PatternCompletionMetadata = {};
  if (isCompletionStatus(source.completionStatus)) metadata.completionStatus = source.completionStatus;
  const paidNonEmptyBeads = optionalNonNegativeNumber(source.paidNonEmptyBeads);
  const paidUnits = optionalNonNegativeNumber(source.paidUnits);
  const paidBeadSavingLevel = optionalNonNegativeNumber(source.paidBeadSavingLevel);
  if (paidNonEmptyBeads !== undefined) metadata.paidNonEmptyBeads = paidNonEmptyBeads;
  if (paidUnits !== undefined) metadata.paidUnits = paidUnits;
  if (paidBeadSavingLevel !== undefined) metadata.paidBeadSavingLevel = paidBeadSavingLevel;
  if (typeof source.sourceHash === 'string' && source.sourceHash.trim()) metadata.sourceHash = source.sourceHash;
  if (typeof source.gridHash === 'string' && source.gridHash.trim()) metadata.gridHash = source.gridHash;
  return Object.keys(metadata).length > 0 ? metadata : null;
}

function readCompletionMetadata(userId: string | null, failClosed = false): PatternCompletionMetadataMap {
  const storage = browserStorage();
  if (!storage) {
    if (failClosed) throw new Error('无法读取图纸权益状态，请恢复浏览器存储后重试。');
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(storage.getItem(completionMetadataKey(userId)) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: PatternCompletionMetadataMap = {};
    for (const [id, value] of Object.entries(parsed)) {
      const metadata = parseCompletionMetadata(value);
      if (id && metadata) result[id] = metadata;
    }
    return result;
  } catch {
    if (failClosed) throw new Error('无法读取图纸权益状态，请恢复浏览器存储后重试。');
    return {};
  }
}

function recordCompletionMetadata(
  record: PatternRecordSummary,
  userId: string | null,
  scoped: PatternCompletionMetadataMap,
  anonymous: PatternCompletionMetadataMap,
): PatternCompletionMetadata | undefined {
  if (record.userId === null) return anonymous[record.id];
  if (record.userId !== userId) return undefined;
  // A verified local record may be left bound by an older failed migration.
  // Keep its anonymous rights readable until the scoped write can be retried.
  return scoped[record.id] ?? (record.hasLocalCopy ? anonymous[record.id] : undefined);
}

function writeCompletionMetadata(userId: string | null, metadata: PatternCompletionMetadataMap): void {
  const storage = browserStorage();
  if (!storage) throw new Error('浏览器本地存储不可用，旧作品状态未修改');
  storage.setItem(completionMetadataKey(userId), JSON.stringify(metadata));
}

function metadataFromSaveParams(params: PatternCompletionMetadata): PatternCompletionMetadata | null {
  return parseCompletionMetadata(params);
}

function validateRequestedPatternId(id: string | undefined): void {
  if (id === undefined) return;
  if (!id || id !== id.trim() || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new Error('作品 ID 格式无效，未执行保存');
  }
}

/**
 * Saves an editable grid locally first, then attempts cloud revision sync.
 * A cloud failure is returned as a visible state and never treated as success.
 */
export async function saveExportedPatternRecord(params: {
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
  completionStatus?: PatternCompletionStatus;
  paidNonEmptyBeads?: number | null;
  paidUnits?: number | null;
  paidBeadSavingLevel?: number | null;
  sourceHash?: string;
  gridHash?: string;
}): Promise<ExportedPatternRecord> {
  // `savePatternRecord` already treats `id` as the requested record identity
  // and enforces its user binding. Preserve that identity for a first save so
  // a draft entitlement never needs rebinding or another credit operation.
  validateRequestedPatternId(params.id);
  const result = await savePatternRecord(params);
  if (params.id !== undefined && result.record.id !== params.id) {
    throw new Error('保存层未保留作品 ID，已停止更新本地授权状态');
  }
  const metadata = metadataFromSaveParams(params);
  if (metadata) {
    try {
      const allMetadata = readCompletionMetadata(params.userId);
      allMetadata[result.record.id] = metadata;
      writeCompletionMetadata(params.userId, allMetadata);
    } catch {
      // The pattern itself remains safely stored even if optional entitlement
      // metadata cannot be mirrored in browser storage.
    }
  }
  return { ...result.record, ...metadata };
}

export async function getUserExportedPatterns(userId: string | null): Promise<ExportedPatternRecord[]> {
  const records = await getPatternHistory(userId);
  const metadata = readCompletionMetadata(userId, true);
  const anonymous = userId === null ? metadata : readCompletionMetadata(null, true);
  return records.map(record => ({ ...record, ...recordCompletionMetadata(record, userId, metadata, anonymous) }));
}

export async function getPatternProject(id: string, userId: string | null): Promise<EditablePatternProject> {
  const project = await getPatternProjectFromStore(id, userId);
  const local = await getLocalPatternSummary(id, userId);
  const scoped = readCompletionMetadata(userId, true);
  const anonymous = userId === null ? scoped : readCompletionMetadata(null, true);
  const metadata = local ? recordCompletionMetadata(local, userId, scoped, anonymous) : scoped[id];
  return { ...project, ...metadata, workId: id };
}

export interface LegacyPatternMarkInput {
  workKey: string;
  sourceHash: string;
  gridHash: string;
}

/**
 * Marks only still-unclassified local records as legacy in one metadata write.
 * The project/grid/blob and cloud-sync records are never rewritten.
 */
export async function markLegacyByWorkKeys(
  userId: string,
  items: readonly LegacyPatternMarkInput[],
): Promise<string[]> {
  if (items.length === 0) return [];
  const records = await getUserExportedPatterns(userId);
  const recordIds = new Set(records
    .filter(record => record.completionStatus === undefined)
    .map(record => record.id));
  const metadata = readCompletionMetadata(userId);
  const marked: string[] = [];
  for (const item of items) {
    // Raw record IDs are canonical. Keep a read-only fallback for callers
    // from an older frontend that still supplied `work:<id>`.
    const legacyId = item.workKey.startsWith('work:')
      ? item.workKey.slice('work:'.length)
      : '';
    const id = recordIds.has(item.workKey)
      ? item.workKey
      : legacyId && recordIds.has(legacyId)
        ? legacyId
        : '';
    if (!id || !recordIds.has(id)) continue;
    metadata[id] = {
      ...metadata[id],
      completionStatus: 'LEGACY',
      sourceHash: item.sourceHash,
      gridHash: item.gridHash,
    };
    marked.push(id);
  }
  if (marked.length > 0) writeCompletionMetadata(userId, metadata);
  return marked;
}

export async function retryPatternCloudSync(id: string, userId: string | null): Promise<ExportedPatternRecord> {
  const previous = await getLocalPatternSummary(id, userId);
  if (!userId || !previous) throw new Error('图纸不存在或不属于当前账号');
  const scoped = readCompletionMetadata(userId, true);
  const metadata = recordCompletionMetadata(previous, userId, scoped, readCompletionMetadata(null, true));
  if (metadata && (previous.userId === null || !scoped[id])) {
    // Commit rights BEFORE binding identity. Quota failure leaves an unbound
    // record retryable; already-bound partial migrations take this path too.
    scoped[id] = metadata;
    writeCompletionMetadata(userId, scoped);
  }
  const record = await retryPatternCloudSyncFromStore(id, userId);
  if (record.userId !== userId) throw new Error('同步后的图纸不属于当前账号');
  // An edit performed while syncing must win over old metadata, but missing
  // rights after a known migration must never silently become LEGACY.
  const latest = readCompletionMetadata(userId, true)[record.id];
  if (metadata && !latest) throw new Error('图纸权益状态未保存，请恢复浏览器存储后重试。');
  return { ...record, ...latest };
}

export async function markExportedPatternPublished(id: string, userId: string, publication?: PatternCommunityPublication): Promise<ExportedPatternRecord | null> {
  const record = await markPatternPublishedInStore(id, userId, publication);
  return record ? { ...record, ...readCompletionMetadata(userId)[id] } : null;
}

export function getExportedPatternPreview(id: string, revision: number, userId: string | null): Promise<Blob | null> {
  return getPatternPreview(id, revision, userId);
}

export function renameExportedPattern(record: ExportedPatternRecord, userId: string | null, title: string): Promise<ExportedPatternRecord> {
  return renamePatternRecord(record, userId, title);
}

export async function deleteLocalExportedPatternCopy(id: string, userId: string | null): Promise<boolean> {
  await deleteLocalPatternCopy(id, userId);
  return true;
}

export async function deleteCloudExportedPatternAndLocal(id: string, userId: string | null): Promise<boolean> {
  await deleteCloudPatternAndLocal(id, userId);
  return true;
}
