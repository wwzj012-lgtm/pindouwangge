import { apiGetBlob } from './api';
import type { CommunityPost } from './communityApi';
import { readCommunitySnapshot } from './communityPatternSnapshot';
import { getPatternProject } from './patternHistory';
import type { StoredPatternProject } from './patternGridCodec';

export interface CommunityPatternSource {
  project: StoredPatternProject | null;
  fromOwnerLibrary: boolean;
}

export async function loadCommunityPattern(post: CommunityPost, currentUserId?: string): Promise<CommunityPatternSource> {
  const result = await apiGetBlob('/api/community/assets/public', { id: post.assetId });
  if (!result.ok || !result.data) throw new Error(result.error ?? '图纸原始数据加载失败，请重试');
  const project = await readCommunitySnapshot(result.data);
  if (project) return { project, fromOwnerLibrary: false };
  // Old publications only contained thumbnails. Only the authenticated owner may
  // recover their original; never expose a mutable private project to visitors.
  if (currentUserId && post.author.uid === currentUserId && post.workId) {
    const original = await getPatternProject(post.workId, currentUserId);
    return { project: original, fromOwnerLibrary: true };
  }
  return { project: null, fromOwnerLibrary: false };
}
