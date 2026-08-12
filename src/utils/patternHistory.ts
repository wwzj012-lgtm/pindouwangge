import type { BrandKey, BeadColor } from '../types';
import {
  deleteCloudPatternAndLocal,
  deleteLocalPatternCopy,
  getPatternHistory,
  getPatternPreview,
  getPatternProject as getPatternProjectFromStore,
  normalizePatternTitle,
  patternDeletionActions,
  renamePatternRecord,
  requiresExplicitCloudBinding,
  retryPatternCloudSync as retryPatternCloudSyncFromStore,
  savePatternRecord,
  type PatternRecordSummary,
  type PatternSyncState,
} from './patternStore';
import type { GridMatrix, PatternSettingsSnapshot, StoredPatternProject } from './patternGridCodec';

export type ExportedPatternRecord = PatternRecordSummary;
export type { PatternSyncState, StoredPatternProject };

export interface EditablePatternProject extends StoredPatternProject {
  workId: string;
}
export { getPatternHistory, patternDeletionActions, requiresExplicitCloudBinding };
export { normalizePatternTitle };

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
}): Promise<ExportedPatternRecord> {
  const result = await savePatternRecord(params);
  return result.record;
}

export async function getUserExportedPatterns(userId: string | null): Promise<ExportedPatternRecord[]> {
  return getPatternHistory(userId);
}

export async function getPatternProject(id: string, userId: string | null): Promise<EditablePatternProject> {
  return { ...(await getPatternProjectFromStore(id, userId)), workId: id };
}

export async function retryPatternCloudSync(id: string, userId: string | null): Promise<ExportedPatternRecord> {
  return retryPatternCloudSyncFromStore(id, userId);
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
