import type { ApiResult } from './api';
import { apiDelete, apiGet, apiPost, apiPostBlob, apiPublicUrl, apiPut } from './api';

export interface CommunityPost {
  id: string;
  assetId: string;
  imageUrl: string;
  title: string;
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

function normalizeResult(result: ApiResult<CommunityPostResponse>): ApiResult<CommunityPost> {
  if (!result.ok || !result.data) return result;
  return { ...result, data: normalizePost(result.data) };
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
  return normalizeResult(await apiGet<CommunityPostResponse>('/api/community/posts/detail', { id }));
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

export function publishCommunityPost(title: string, assetId: string, workId?: string): Promise<ApiResult<{ post: Pick<CommunityPost, 'id' | 'assetId' | 'title' | 'publishedAt'> }>> {
  return apiPost('/api/community/posts', { title, assetId, ...(workId ? { workId } : {}) });
}
