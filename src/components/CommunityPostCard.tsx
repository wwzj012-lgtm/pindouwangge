import React from 'react';
import { ArrowRight, Bookmark, Heart } from 'lucide-react';
import type { CommunityPost } from '../utils/communityApi';

/** Only show the author's real tags; missing metadata is not a category. */
export function communityPostTags(post: { tags?: unknown }): string[] {
  return Array.isArray(post.tags)
    ? [...new Set(post.tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean))]
    : [];
}

export interface CommunityPostCardProps {
  post: CommunityPost;
  pending: boolean;
  onOpen: (post: CommunityPost) => void;
  onReaction: (event: React.MouseEvent, post: CommunityPost, reaction: 'like' | 'favorite') => void;
}

export const CommunityPostCard: React.FC<CommunityPostCardProps> = ({ post, pending, onOpen, onReaction }) => {
  const tags = communityPostTags(post);
  const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(post.publishedAt));
  const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-600 focus-visible:ring-offset-2';
  return (
    <article aria-label={post.title} className="group flex min-w-0 flex-col overflow-hidden rounded-3xl border border-purple-200/90 bg-white shadow-sm transition-shadow duration-200 hover:shadow-lg">
      <button type="button" onClick={() => onOpen(post)} aria-label={`查看作品：${post.title}`} className={`relative block aspect-4/3 w-full overflow-hidden bg-purple-50/50 ${focus}`}>
        <img src={post.imageUrl} alt={post.title} loading="lazy" decoding="async" fetchPriority="low" className="h-full w-full object-contain [image-rendering:pixelated]" />
      </button>
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-1.5 flex min-w-0 items-center gap-2 text-xs font-bold text-purple-900">
          {post.author.photoUrl ? <img src={post.author.photoUrl} alt="" loading="lazy" decoding="async" fetchPriority="low" className="h-6 w-6 rounded-full border border-purple-200 object-cover" />
            : <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700">{post.author.displayName.slice(0, 1).toUpperCase() || '豆'}</span>}
          <span className="min-w-0 truncate">{post.author.displayName}</span>
        </div>
        <h3 className="text-sm sm:text-base font-extrabold leading-snug text-purple-950">
          <button type="button" onClick={() => onOpen(post)} className={`min-h-11 sm:min-h-0 w-full break-words rounded-lg text-left hover:text-purple-700 ${focus}`}>{post.title}</button>
        </h3>
        <p className="text-xs leading-relaxed text-purple-700">发布于 {date}</p>
        {tags.length > 0 && <ul aria-label="作品标签" className="mt-2 flex flex-wrap gap-1.5">
          {tags.map(tag => <li key={tag} className="max-w-full break-words rounded-md border border-purple-200/80 bg-purple-50 px-2 py-1 text-xs font-medium text-purple-800">#{tag}</li>)}
        </ul>}
        <div className="mt-auto pt-2">
          <div className="flex flex-wrap items-center gap-1 border-t border-purple-100 pt-2">
            <button type="button" onClick={event => onReaction(event, post, 'like')} disabled={pending} aria-pressed={post.liked}
              aria-label={`${post.liked ? '取消点赞' : '点赞'}：${post.title}（${post.likeCount}）`}
              className={`inline-flex min-h-11 sm:min-h-9 min-w-11 sm:min-w-9 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-bold disabled:opacity-50 ${post.liked ? 'bg-rose-50 text-rose-700' : 'text-purple-800 hover:bg-purple-50'} ${focus}`}>
              <Heart size={16} aria-hidden="true" className={post.liked ? 'fill-current' : ''} /><span>{post.liked ? '已赞' : '点赞'} {post.likeCount}</span>
            </button>
            <button type="button" onClick={event => onReaction(event, post, 'favorite')} disabled={pending} aria-pressed={post.favorited}
              aria-label={`${post.favorited ? '取消收藏' : '收藏'}：${post.title}（${post.favoriteCount}）`}
              className={`inline-flex min-h-11 sm:min-h-9 min-w-11 sm:min-w-9 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-bold disabled:opacity-50 ${post.favorited ? 'bg-indigo-50 text-indigo-800' : 'text-purple-800 hover:bg-purple-50'} ${focus}`}>
              <Bookmark size={16} aria-hidden="true" className={post.favorited ? 'fill-current' : ''} /><span>{post.favorited ? '已收藏' : '收藏'} {post.favoriteCount}</span>
            </button>
          </div>
          <button type="button" onClick={() => onOpen(post)} className={`mt-2 inline-flex min-h-11 sm:min-h-9 w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-3 py-1.5 text-xs sm:text-sm font-bold text-white transition-colors hover:bg-purple-700 ${focus}`}>
            查看图纸<ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
};
