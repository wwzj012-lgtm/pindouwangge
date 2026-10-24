import {
  getPatternProject,
  markExportedPatternPublished,
  retryPatternCloudSync,
  type ExportedPatternRecord,
} from './patternHistory';
import { renderCommunityPattern } from './communityPatternSnapshot';
import { publishCommunityPost, uploadCommunityAsset, type CommunityPostVisibility } from './communityApi';

export const COMMUNITY_TAG_OPTIONS = ['像素拼豆', '人物', '动物', '风景', '动漫', '原创', '节日', '字母 Logo'];
export const COMMUNITY_MAX_TAGS = 5;
export const COMMUNITY_MAX_TAG_LENGTH = 24;

export interface CommunityPublicationMetadata {
  title: string;
  description: string;
  visibility: CommunityPostVisibility;
  tags: string[];
}

export type CommunityPublicationValidation =
  | { ok: true; metadata: CommunityPublicationMetadata }
  | { ok: false; error: string };

export type CommunityPublicationResult =
  | { ok: true; record: ExportedPatternRecord; localMark: Promise<'marked' | 'warning'> }
  | { ok: false; error: string; stale?: boolean };

function publicationError(message: string, stale = false): CommunityPublicationResult {
  return { ok: false, error: message, stale };
}

function recordBelongsToAccount(record: ExportedPatternRecord, userId: string): boolean {
  return record.status !== 2 && (record.userId === null || record.userId === userId);
}

export function isPatternPublicationUnlocked(record: ExportedPatternRecord): boolean {
  if (record.completionStatus === 'LEGACY' || record.completionStatus === undefined) return true;
  if (record.completionStatus !== 'COMPLETED') return false;
  return Number.isSafeInteger(record.paidNonEmptyBeads)
    && record.paidNonEmptyBeads >= 0
    && record.totalBeads <= record.paidNonEmptyBeads;
}

export function validateCommunityPublicationMetadata(input: CommunityPublicationMetadata): CommunityPublicationValidation {
  const title = input.title.trim();
  const description = input.description.trim();
  const tags = Array.from(new Set(input.tags.map((tag) => tag.trim()).filter(Boolean)));
  if (title.length < 1 || title.length > 60) return { ok: false, error: '作品名称需为 1 至 60 个字符。' };
  if (description.length > 500) return { ok: false, error: '作品简介不能超过 500 个字符。' };
  if (tags.length > COMMUNITY_MAX_TAGS || tags.some((tag) => tag.length > COMMUNITY_MAX_TAG_LENGTH)) return { ok: false, error: '标签不符合发布限制。' };
  if (input.visibility !== 'public' && input.visibility !== 'private') return { ok: false, error: '请选择公开或私密发布。' };
  return { ok: true, metadata: { title, description, visibility: input.visibility, tags } };
}

/** Runs the cloud-first publish flow. Callers own visible state only. */
export async function publishCommunityPattern(params: {
  record: ExportedPatternRecord;
  metadata: CommunityPublicationMetadata;
  currentUserId: string | null;
  isSessionCurrent: () => boolean;
}): Promise<CommunityPublicationResult> {
  const { record, currentUserId, isSessionCurrent } = params;
  const validated = validateCommunityPublicationMetadata(params.metadata);
  if (validated.ok === false) return publicationError(validated.error);
  if (!currentUserId || !isSessionCurrent()) return publicationError('账号已切换，本次发布未继续。', true);
  if (!recordBelongsToAccount(record, currentUserId)) return publicationError('当前账号无权发布这份图纸。');
  if (!isPatternPublicationUnlocked(record)) return publicationError('完成图纸后解锁发布。');

  const currentRecord = record;
  // The selected record is checked synchronously at submission, then the
  // resolved cloud record is checked again before upload and post creation.
  try {
    const publishRecord = currentRecord.hasCloudCopy && currentRecord.userId === currentUserId
      ? currentRecord
      : await retryPatternCloudSync(currentRecord.id, currentUserId);
    if (!isSessionCurrent()) return publicationError('账号已切换，本次发布未继续。', true);
    if (!recordBelongsToAccount(publishRecord, currentUserId)) return publicationError('图纸已删除或不属于当前账号。');
    if (!publishRecord.hasCloudCopy || publishRecord.userId !== currentUserId) return publicationError('图纸尚未同步到当前账号，请重试云端同步。');
    if (!isPatternPublicationUnlocked(publishRecord)) return publicationError('完成图纸后解锁发布。');

    const project = await getPatternProject(publishRecord.id, currentUserId);
    if (!isSessionCurrent()) return publicationError('账号已切换，本次发布未继续。', true);
    // The loaded project and its freshly read account-scoped metadata supersede
    // the selected card. Count real cells, never trust the old summary's count.
    // A known non-legacy work with missing metadata must not become LEGACY.
    const latestRecord: ExportedPatternRecord = {
      ...publishRecord,
      width: project.width,
      height: project.height,
      totalBeads: project.grid.reduce((total, row) => total + row.filter((cell) => cell !== null).length, 0),
      completionStatus: project.completionStatus ?? (publishRecord.completionStatus === undefined || publishRecord.completionStatus === 'LEGACY' ? 'LEGACY' : 'DRAFT'),
      paidNonEmptyBeads: project.paidNonEmptyBeads,
      paidUnits: project.paidUnits,
      paidBeadSavingLevel: project.paidBeadSavingLevel,
      sourceHash: project.sourceHash,
      gridHash: project.gridHash,
    };
    if (!isPatternPublicationUnlocked(latestRecord)) return publicationError('完成图纸后解锁发布。');
    const snapshot = await renderCommunityPattern(project);
    if (!isSessionCurrent()) return publicationError('账号已切换，本次发布未继续。', true);
    const upload = await uploadCommunityAsset(new File([snapshot], `${publishRecord.title}.png`, { type: 'image/png' }));
    if (!upload.ok || !upload.data?.asset?.id) throw new Error(upload.error ?? '社区图片上传失败');

    // Never create a post after the UI session has moved to another account.
    if (!isSessionCurrent()) return publicationError('账号已切换，本次发布未继续。', true);
    if (!isPatternPublicationUnlocked(latestRecord)) return publicationError('完成图纸后解锁发布。');
    const published = await publishCommunityPost({ ...validated.metadata, workId: publishRecord.id, assetId: upload.data.asset.id });
    if (!published.ok) throw new Error(published.error ?? '作品发布失败');
    const post = published.data?.post;
    if (!post?.id || (post.visibility !== 'public' && post.visibility !== 'private')) {
      throw new Error('发布结果缺少作品状态，请刷新图库核实。');
    }
    const publication = { id: post.id, visibility: post.visibility };
    const publishedRecord: ExportedPatternRecord = {
      ...latestRecord,
      status: publication.visibility === 'public' ? 1 : 0,
      communityPost: publication,
      hasCloudCopy: true,
    };
    const localMark = isSessionCurrent()
      ? Promise.resolve().then(async () => {
        if (!isSessionCurrent()) return 'warning' as const;
        await markExportedPatternPublished(publishRecord.id, currentUserId, publication);
        return 'marked' as const;
      }).catch(() => 'warning' as const)
      : Promise.resolve('warning' as const);
    return { ok: true, record: publishedRecord, localMark };
  } catch (error) {
    return publicationError(error instanceof Error ? error.message : '作品发布失败。');
  }
}
