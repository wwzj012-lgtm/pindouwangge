import type { ApiResult } from './api';
import { apiDelete, apiGet, apiPost, apiPostBlob, apiPublicUrl, apiPut } from './api';

export interface CommunityPost {
  id: string;
  assetId: string;
  imageUrl: string;
  title: string;
  workId?: string | null;
  publishedAt: number;
  author: {
    uid: string;
    displayName: string;
    photoUrl: string | null;
  };
  likeCount: number;
  favoriteCount: number;
  liked: boolean;
  favorited: boolean;
}

interface CommunityPostResponse extends Omit<CommunityPost, 'imageUrl' | 'author'> {
  imageUrl: string;
  author: CommunityPost['author'];
}

interface CommunityPostListResponse {
  posts: CommunityPostResponse[];
  nextCursor: string | null;
}

export interface CommunityAsset {
  id: string;
  contentType: 'image/png' | 'image/webp' | 'image/jpeg';
  byteLength: number;
  sha256: string;
  createdAt: number;
}

export type CommunityPostVisibility = 'public' | 'private';

export interface CommunityPublishInput {
  title: string;
  description: string;
  visibility: CommunityPostVisibility;
  tags: string[];
  workId: string;
  assetId?: string;
}

export type CommunityPublishErrorCode = 'WORK_ASSET_REQUIRED' | (string & {});

export type CommunityPublishResult = ApiResult<{
  post: Pick<CommunityPost, 'id' | 'assetId' | 'title' | 'publishedAt'>;
}>;

export function getCommunityPublishErrorCode(result: CommunityPublishResult): CommunityPublishErrorCode | null {
  if (result.ok) return null;
  const code = result.errorCode ?? result.code;
  if (code !== undefined) return code;
  // Support the Worker's message-only envelope for this recovery signal only.
  return result.status === 409 && result.error === 'WORK_ASSET_REQUIRED'
    ? 'WORK_ASSET_REQUIRED'
    : null;
}

function publicAssetUrl(assetId: string): string {
  return apiPublicUrl('/api/community/assets/public', { id: assetId });
}

function normalizePost(post: CommunityPostResponse): CommunityPost {
  return {
    ...post,
    imageUrl: publicAssetUrl(post.assetId),
    author: { ...post.author, photoUrl: post.author.photoUrl || null },
  };
}

function normalizeResult(result: ApiResult<CommunityPostResponse | { post: CommunityPostResponse }>): ApiResult<CommunityPost> {
  if (!result.ok || !result.data) return { ...result, data: undefined };
  const post = 'post' in result.data ? result.data.post : result.data;
  if (!post || typeof post.id !== 'string' || typeof post.assetId !== 'string' || !post.author) {
    return { ok: false, status: result.status, error: '社区作品详情数据无效，请重新加载' };
  }
  return { ...result, data: normalizePost(post) };
}

export async function listCommunityPosts(cursor?: string): Promise<ApiResult<{ posts: CommunityPost[]; nextCursor: string | null }>> {
  const params: Record<string, string> = { limit: '24' };
  if (cursor) params.cursor = cursor;
  const result = await apiGet<CommunityPostListResponse>('/api/community/posts', params);
  if (!result.ok || !result.data) return result;
  return {
    ...result,
    data: {
      posts: result.data.posts.map(normalizePost),
      nextCursor: result.data.nextCursor,
    },
  };
}

export async function listFavoriteCommunityPosts(cursor?: string): Promise<ApiResult<{ posts: CommunityPost[]; nextCursor: string | null }>> {
  const params: Record<string, string> = { limit: '24' };
  if (cursor) params.cursor = cursor;
  const result = await apiGet<CommunityPostListResponse>('/api/community/favorites', params);
  if (!result.ok || !result.data) return result;
  return {
    ...result,
    data: {
      posts: result.data.posts.map(normalizePost),
      nextCursor: result.data.nextCursor,
    },
  };
}

export async function getCommunityPost(id: string): Promise<ApiResult<CommunityPost>> {
  return normalizeResult(await apiGet<CommunityPostResponse | { post: CommunityPostResponse }>('/api/community/posts/detail', { id }));
}

export function reactToCommunityPost(
  postId: string,
  reaction: 'like' | 'favorite',
  active: boolean,
): Promise<ApiResult<{ active: boolean }>> {
  const path = `/api/community/posts/${reaction}`;
  return active
    ? apiPut<{ active: boolean }>(path, { id: postId })
    : apiDelete<{ active: boolean }>(path, { id: postId });
}

export function uploadCommunityAsset(file: File): Promise<ApiResult<{ asset: CommunityAsset }>> {
  if (!['image/png', 'image/webp', 'image/jpeg'].includes(file.type)) {
    return Promise.resolve({ ok: false, status: 0, error: '仅支持 PNG、WebP 或 JPEG 图片' });
  }
  if (file.size === 0 || file.size > 15 * 1024 * 1024) {
    return Promise.resolve({ ok: false, status: 0, error: '图片大小需在 15 MiB 以内' });
  }
  return apiPostBlob<{ asset: CommunityAsset }>('/api/community/assets', file, file.type);
}

export function publishCommunityPost(input: CommunityPublishInput): Promise<CommunityPublishResult>;
/** @deprecated Use the structured input overload for gallery publishing. */
export function publishCommunityPost(title: string, assetId: string, workId?: string): Promise<CommunityPublishResult>;
export function publishCommunityPost(
  inputOrTitle: CommunityPublishInput | string,
  legacyAssetId?: string,
  legacyWorkId?: string,
): Promise<CommunityPublishResult> {
  if (typeof inputOrTitle === 'string') {
    return apiPost<CommunityPublishResult['data']>('/api/community/posts', {
      title: inputOrTitle,
      assetId: legacyAssetId ?? '',
      ...(legacyWorkId ? { workId: legacyWorkId } : {}),
    });
  }
  const input = inputOrTitle;
  return apiPost<CommunityPublishResult['data']>('/api/community/posts', {
    title: input.title,
    ...{
      description: input.description,
      visibility: input.visibility,
      tags: input.tags,
    },
    ...(input.workId ? { workId: input.workId } : {}),
    ...(input.assetId ? { assetId: input.assetId } : {}),
  });
}
