import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Sparkles,
  Heart,
  GitFork,
  Eye,
  Plus,
  Compass,
  Flame,
  Grid2x2,
  Palette,
  CheckCircle2,
  Share2,
  Download,
  Filter,
  ArrowRight,
  TrendingUp,
  Layers,
  Zap,
  Bookmark,
  Loader2,
  RefreshCw,
  Upload,
} from 'lucide-react';
import type { CommunityPattern } from '../data/communityData';
import { useAuth } from '../context/AuthContext';
import { getApiToken } from '../utils/api';
import {
  type CommunityPost,
  getCommunityPost,
  listCommunityPosts,
  publishCommunityPost,
  reactToCommunityPost,
  uploadCommunityAsset,
} from '../utils/communityApi';

interface CommunityViewProps {
  onRemixPattern: (pattern: CommunityPattern) => void;
  onNavigateToStudio: () => void;
  onOpenAuthModal: () => void;
}

type SortMode = 'hot' | 'new' | 'favorites';

const COMMUNITY_CATEGORIES = ['全部'];
const GUEST_COMMUNITY_MESSAGE = '游客账号仅可浏览社区。请登录或注册后再使用喜欢、收藏和发布功能。';

function isGuestCommunityUser(profile: unknown): boolean {
  if (!profile || typeof profile !== 'object') return false;
  const value = profile as Record<string, unknown>;
  return value.authProvider === 'guest' || value.auth_provider === 'guest' || value.provider === 'guest';
}

function isGuestCommunityError(error: string | undefined): boolean {
  return error?.includes('Guest accounts can only browse the community') ?? false;
}

function publishedLabel(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(timestamp));
}

function remixPattern(post: CommunityPost): CommunityPattern {
  // Public posts currently expose a source image, but not persisted bead-grid dimensions.
  return {
    id: post.id,
    title: post.title,
    description: `发布于 ${publishedLabel(post.publishedAt)}`,
    author: { name: post.author.displayName, avatar: post.author.photoUrl ?? '' },
    category: '社区作品',
    tags: [],
    imageUrl: post.imageUrl,
    width: 29,
    height: 29,
    boardCount: 1,
    beadCount: 29 * 29,
    colorCount: 0,
    likes: post.likeCount,
    forks: post.favoriteCount,
    views: 0,
    isLiked: post.liked,
  };
}

export const CommunityView: React.FC<CommunityViewProps> = ({
  onRemixPattern,
  onNavigateToStudio,
  onOpenAuthModal,
}) => {
  const { currentUser, userProfile } = useAuth();
  const [activeCategory, setActiveCategory] = useState<string>('全部');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPattern, setSelectedPattern] = useState<CommunityPost | null>(null);
  const [patternsState, setPatternsState] = useState<CommunityPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortMode>('hot');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isOpeningPattern, setIsOpeningPattern] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isPublishOpen, setIsPublishOpen] = useState(false);
  const [publishTitle, setPublishTitle] = useState('');
  const [publishFile, setPublishFile] = useState<File | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const publishSubmissionRef = useRef(false);

  const refreshPatterns = useCallback(async () => {
    setIsLoading(true);
    setRequestError(null);
    const result = await listCommunityPosts();
    if (result.ok && result.data) {
      setPatternsState(result.data.posts);
      setNextCursor(result.data.nextCursor);
    } else {
      setPatternsState([]);
      setNextCursor(null);
      setRequestError(result.error ?? '社区作品暂时无法加载');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refreshPatterns();
  }, [refreshPatterns]);

  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setRequestError(null);
    const result = await listCommunityPosts(nextCursor);
    if (result.ok && result.data) {
      setPatternsState(current => [...current, ...result.data!.posts]);
      setNextCursor(result.data.nextCursor);
    } else {
      setRequestError(result.error ?? '更多作品暂时无法加载');
    }
    setIsLoadingMore(false);
  };

  const filteredPatterns = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    const visible = patternsState.filter(pattern => !query
      || pattern.title.toLocaleLowerCase().includes(query)
      || pattern.author.displayName.toLocaleLowerCase().includes(query));
    return [...visible].sort((first, second) => {
      if (sortBy === 'new') return second.publishedAt - first.publishedAt;
      if (sortBy === 'favorites') return second.favoriteCount - first.favoriteCount || second.publishedAt - first.publishedAt;
      return second.likeCount - first.likeCount || second.publishedAt - first.publishedAt;
    });
  }, [patternsState, searchQuery, sortBy]);

  const requireRegisteredCommunityAccount = useCallback((message: string): boolean => {
    const hasFormalLogin = Boolean(currentUser)
      && Boolean(getApiToken())
      && !isGuestCommunityUser(currentUser)
      && !isGuestCommunityUser(userProfile);
    if (hasFormalLogin) return false;
    setRequestError(isGuestCommunityUser(currentUser) || isGuestCommunityUser(userProfile)
      ? GUEST_COMMUNITY_MESSAGE
      : message);
    onOpenAuthModal();
    return true;
  }, [currentUser, onOpenAuthModal, userProfile]);

  const handleGuestCommunityResponse = useCallback((error: string | undefined): boolean => {
    if (!isGuestCommunityError(error)) return false;
    setRequestError(GUEST_COMMUNITY_MESSAGE);
    onOpenAuthModal();
    return true;
  }, [onOpenAuthModal]);

  const updatePattern = (id: string, update: (pattern: CommunityPost) => CommunityPost) => {
    setPatternsState(current => current.map(pattern => pattern.id === id ? update(pattern) : pattern));
    setSelectedPattern(current => current?.id === id ? update(current) : current);
  };

  const openPattern = async (pattern: CommunityPost) => {
    setSelectedPattern(pattern);
    setIsOpeningPattern(true);
    const result = await getCommunityPost(pattern.id);
    if (result.ok && result.data) setSelectedPattern(result.data);
    else setRequestError(result.error ?? '作品详情暂时无法加载');
    setIsOpeningPattern(false);
  };

  const handleReaction = async (event: React.MouseEvent, pattern: CommunityPost, reaction: 'like' | 'favorite') => {
    event.stopPropagation();
    if (requireRegisteredCommunityAccount('登录后即可参与社区互动')) return;
    const active = reaction === 'like' ? !pattern.liked : !pattern.favorited;
    const action = `${reaction}:${pattern.id}`;
    setPendingAction(action);
    const result = await reactToCommunityPost(pattern.id, reaction, active);
    if (!result.ok) {
      if (!handleGuestCommunityResponse(result.error)) {
        setRequestError(result.error ?? '操作未完成，请重试');
      }
    } else {
      updatePattern(pattern.id, current => reaction === 'like'
        ? { ...current, liked: active, likeCount: Math.max(0, current.likeCount + (active ? 1 : -1)) }
        : { ...current, favorited: active, favoriteCount: Math.max(0, current.favoriteCount + (active ? 1 : -1)) });
    }
    setPendingAction(null);
  };

  const openPublish = () => {
    if (requireRegisteredCommunityAccount('登录后即可投稿社区作品')) return;
    setPublishError(null);
    setPublishTitle('我的拼豆作品');
    setIsPublishOpen(true);
  };

  const publishPattern = async () => {
    const title = publishTitle.trim();
    if (requireRegisteredCommunityAccount('登录后即可投稿社区作品')) {
      setIsPublishOpen(false);
      return;
    }
    if (!title || title.length > 60) {
      setPublishError('请填写 1-60 个字符的作品标题');
      return;
    }
    if (!publishFile) {
      setPublishError('请选择一张作品图片');
      return;
    }
    if (isPublishing || publishSubmissionRef.current) return;
    publishSubmissionRef.current = true;
    setIsPublishing(true);
    setPublishError(null);
    try {
      const upload = await uploadCommunityAsset(publishFile);
      if (!upload.ok || !upload.data) {
        if (handleGuestCommunityResponse(upload.error)) {
          setIsPublishOpen(false);
          return;
        }
        setPublishError(upload.error ?? '图片上传失败，请重试');
        return;
      }
      const published = await publishCommunityPost(title, upload.data.asset.id);
      if (!published.ok) {
        if (handleGuestCommunityResponse(published.error)) {
          setIsPublishOpen(false);
          return;
        }
        setPublishError(published.error ?? '作品发布失败，请重试');
        return;
      }
      setIsPublishOpen(false);
      setPublishTitle('');
      setPublishFile(null);
      await refreshPatterns();
    } catch {
      setPublishError('作品发布失败，请检查网络后重试');
    } finally {
      publishSubmissionRef.current = false;
      setIsPublishing(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gradient-to-b from-[#F5F0FD] via-[#FAF6FE] to-[#EFE7FA] min-h-screen text-purple-950 pb-16">
      {/* Community Banner Hero Section */}
      <section className="relative px-4 py-8 sm:py-12 md:py-14 overflow-hidden border-b border-purple-200/80 bg-white/60 backdrop-blur-md">
        <div className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 relative z-10 flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-purple-100/90 border border-purple-300/80 text-purple-900 text-xs font-bold shadow-xs mb-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <Sparkles className="w-4 h-4 text-purple-600 fill-purple-400" />
            <span>豆织星格 · 拼豆创客灵感社区</span>
            <span className="bg-purple-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-black">V2.0</span>
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black bg-gradient-to-r from-purple-950 via-purple-800 to-indigo-800 bg-clip-text text-transparent tracking-tight max-w-3xl leading-tight">
            探索全球拼豆高手的灵感作品<br className="hidden sm:inline" /> 一键导入做同款图纸
          </h1>

          <p className="text-xs sm:text-sm md:text-base text-purple-700 font-medium max-w-2xl mt-3 leading-relaxed">
            海量像素插画、动漫二次元、萌宠摆件与游戏图标，支持随时一键加算重构、调整像素豆板尺寸与品牌色卡匹配！
          </p>

          {/* Quick CTA Actions */}
          <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
            <button
              onClick={onNavigateToStudio}
              className="px-6 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-black text-sm shadow-lg shadow-purple-500/25 flex items-center gap-2 cursor-pointer transition-all hover:scale-102 active:scale-98"
            >
              <Zap className="w-4 h-4 fill-amber-300 text-amber-300" />
              <span>新建空白拼豆画布</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={openPublish}
              className="px-5 py-3 rounded-2xl bg-white hover:bg-purple-50 border border-purple-300/90 text-purple-900 font-bold text-sm shadow-2xs flex items-center gap-2 cursor-pointer transition-all hover:scale-102 active:scale-98"
            >
              <Plus className="w-4 h-4 text-purple-600" />
              <span>投稿灵感图纸</span>
            </button>
          </div>

          {/* Search Bar & Tag Filters */}
          <div className="w-full max-w-2xl mt-8 relative">
            <div className="relative flex items-center">
              <Search className="w-5 h-5 absolute left-4 text-purple-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索作品标题或创作者..."
                className="w-full pl-11 pr-24 py-3.5 rounded-2xl bg-white/90 border border-purple-300 text-purple-950 placeholder-purple-400 font-medium text-sm shadow-md focus:outline-none focus:ring-2 focus:ring-purple-500/30 transition-all"
              />
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 px-3 py-1.5 rounded-xl bg-purple-100 hover:bg-purple-200 text-purple-900 text-xs font-bold transition-all cursor-pointer"
              >
                {searchQuery ? '清空' : '搜索'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      <div className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 pt-5">
        {/* Category Tabs & Sorting bar */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-purple-200/80">
          {/* Categories */}
          <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto scrollbar-none pb-1">
            {COMMUNITY_CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                  activeCategory === cat
                    ? 'bg-purple-600 text-white shadow-sm scale-102'
                    : 'bg-white/80 hover:bg-purple-100 text-purple-800 border border-purple-200/80'
                }`}
              >
                {cat === '热门精选' && <Flame className="w-3.5 h-3.5 inline mr-1 text-amber-300 fill-amber-300" />}
                {cat}
              </button>
            ))}
          </div>

          {/* Sort selection */}
          <div className="flex items-center gap-1.5 bg-white/80 p-1 rounded-xl border border-purple-200 text-xs shrink-0 self-end md:self-auto">
            <span className="text-purple-500 font-medium px-2 flex items-center gap-1">
              <Filter className="w-3 h-3" />
              排序:
            </span>
            <button
              onClick={() => setSortBy('hot')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                sortBy === 'hot' ? 'bg-purple-100 text-purple-900 shadow-2xs' : 'text-purple-600 hover:text-purple-900'
              }`}
            >
              🔥 贴心热度
            </button>
            <button
              onClick={() => setSortBy('new')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                sortBy === 'new' ? 'bg-purple-100 text-purple-900 shadow-2xs' : 'text-purple-600 hover:text-purple-900'
              }`}
            >
              最新发布
            </button>
            <button
              onClick={() => setSortBy('favorites')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                sortBy === 'favorites' ? 'bg-purple-100 text-purple-900 shadow-2xs' : 'text-purple-600 hover:text-purple-900'
              }`}
            >
              最多收藏
            </button>
          </div>
        </div>

        {requestError && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
            <span>{requestError}</span>
            <button onClick={() => void refreshPatterns()} className="inline-flex items-center gap-1 font-bold text-rose-800 hover:text-rose-950 cursor-pointer">
              <RefreshCw className="w-3.5 h-3.5" />重试
            </button>
          </div>
        )}

        {/* Gallery Grid */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-purple-600">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span className="mt-3 text-sm font-bold">正在加载社区作品</span>
          </div>
        ) : filteredPatterns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white/50 rounded-3xl border border-dashed border-purple-200 my-8">
            <Compass className="w-12 h-12 text-purple-300 animate-bounce mb-3" />
            <h3 className="text-base font-bold text-purple-900">{patternsState.length === 0 ? '社区还没有公开作品' : '未找到相关拼豆灵感图纸'}</h3>
            <p className="text-xs text-purple-500 mt-1">{patternsState.length === 0 ? '成为第一位投稿的创作者吧。' : '您可以尝试更换搜索词。'}</p>
            <button
              onClick={patternsState.length === 0 ? openPublish : () => setSearchQuery('')}
              className="mt-4 px-5 py-2.5 rounded-xl bg-purple-600 text-white font-bold text-xs shadow-md cursor-pointer"
            >
              {patternsState.length === 0 ? '投稿作品' : '清空搜索'}
            </button>
          </div>
        ) : (
          <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4 md:gap-5 my-6">
            {filteredPatterns.map(pattern => (
              <div
                key={pattern.id}
                className="group bg-white rounded-3xl border border-purple-200/90 shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden flex flex-col hover:-translate-y-1"
              >
                {/* Image Cover & Badge */}
                <div className="relative aspect-4/3 overflow-hidden bg-purple-50/50 cursor-pointer" onClick={() => void openPattern(pattern)}>
                  <img
                    src={pattern.imageUrl}
                    alt={pattern.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-purple-950/60 via-transparent to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

                  <span className="absolute top-3 left-3 bg-amber-400 text-amber-950 font-black text-[10px] px-2.5 py-1 rounded-full shadow-sm flex items-center gap-1">
                    <Sparkles className="w-3 h-3 fill-amber-950" />
                    社区作品
                  </span>

                  {/* Dimensions Pill */}
                  <span className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-md text-white font-mono font-bold text-[10px] px-2.5 py-1 rounded-lg border border-white/20">
                    {publishedLabel(pattern.publishedAt)}
                  </span>

                  {/* Likes Pill */}
                  <button
                    onClick={event => void handleReaction(event, pattern, 'like')}
                    disabled={pendingAction === `like:${pattern.id}`}
                    className={`absolute top-3 right-3 p-2 rounded-full backdrop-blur-md transition-all cursor-pointer shadow-sm ${
                      pattern.liked
                        ? 'bg-rose-500 text-white'
                        : 'bg-white/80 hover:bg-white text-purple-900 hover:text-rose-500'
                    }`}
                    title="点赞本作品"
                  >
                    <Heart className={`w-4 h-4 ${pattern.liked ? 'fill-current' : ''}`} />
                  </button>
                </div>

                {/* Info Container */}
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    {/* Author & Tag Line */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        {pattern.author.photoUrl ? (
                          <img
                            src={pattern.author.photoUrl}
                            alt={pattern.author.displayName}
                            className="w-6 h-6 rounded-full object-cover border border-purple-200"
                          />
                        ) : (
                          <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 border border-purple-200 flex items-center justify-center text-[10px] font-black">
                            {pattern.author.displayName.slice(0, 1).toUpperCase() || '豆'}
                          </span>
                        )}
                        <span className="text-xs font-bold text-purple-900 truncate max-w-[110px]">
                          {pattern.author.displayName}
                        </span>
                      </div>
                      <span className="text-[10px] text-purple-500 font-mono">
                        公开作品
                      </span>
                    </div>

                    {/* Title & Description */}
                    <h3
                      onClick={() => void openPattern(pattern)}
                      className="text-base font-extrabold text-purple-950 group-hover:text-purple-600 transition-colors line-clamp-1 cursor-pointer"
                    >
                      {pattern.title}
                    </h3>
                    <p className="text-xs text-purple-600/90 mt-1 line-clamp-2 leading-relaxed">
                      发布于 {publishedLabel(pattern.publishedAt)}，可导入画板继续制作。
                    </p>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      <span className="text-[10px] bg-purple-50 border border-purple-200/80 text-purple-700 px-2 py-0.5 rounded-md font-medium">
                        #社区作品
                      </span>
                    </div>
                  </div>

                  {/* Actions & Stats */}
                  <div className="mt-4 pt-3 border-t border-purple-100 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 text-[11px] text-purple-500 font-medium">
                      <span className="flex items-center gap-1">
                        <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-100" />
                        {pattern.likeCount}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitFork className="w-3.5 h-3.5 text-indigo-500" />
                        {pattern.favoriteCount}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void openPattern(pattern)}
                        className="p-2 rounded-xl bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-800 text-xs font-bold cursor-pointer transition-colors"
                        title="查看图纸详情"
                      >
                        <Eye className="w-4 h-4" />
                      </button>

                      <button
                        onClick={event => void handleReaction(event, pattern, 'favorite')}
                        disabled={pendingAction === `favorite:${pattern.id}`}
                        className={`p-2 rounded-xl border text-xs cursor-pointer transition-colors ${
                          pattern.favorited ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-purple-50 hover:bg-purple-100 border-purple-200 text-purple-800'
                        }`}
                        title="收藏作品"
                      >
                        <Bookmark className={`w-4 h-4 ${pattern.favorited ? 'fill-current' : ''}`} />
                      </button>

                      <button
                        onClick={() => onRemixPattern(remixPattern(pattern))}
                        className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-md flex items-center gap-1.5 cursor-pointer transition-transform active:scale-95"
                      >
                        <Zap className="w-3.5 h-3.5 fill-amber-300 text-amber-300" />
                        <span>一键做同款</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {nextCursor && (
            <div className="flex justify-center pb-4">
              <button onClick={() => void loadMore()} disabled={isLoadingMore} className="px-5 py-2.5 rounded-xl bg-white border border-purple-200 text-purple-800 text-xs font-bold shadow-sm cursor-pointer disabled:cursor-wait inline-flex items-center gap-2">
                {isLoadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                {isLoadingMore ? '正在加载' : '加载更多作品'}
              </button>
            </div>
          )}
          </>
        )}
      </div>

      {/* Pattern Detail Modal */}
      {selectedPattern && (
        <div className="fixed inset-0 z-50 bg-purple-950/50 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 border border-purple-200 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setSelectedPattern(null)}
              className="absolute top-4 right-4 p-2 text-purple-400 hover:text-purple-900 rounded-xl hover:bg-purple-50 cursor-pointer"
            >
              ✕
            </button>

            <div className="flex flex-col sm:flex-row gap-5 items-start">
              <div className="w-full sm:w-1/2 aspect-square rounded-2xl overflow-hidden bg-purple-50 border border-purple-200 relative shrink-0">
                <img src={selectedPattern.imageUrl} alt={selectedPattern.title} className="w-full h-full object-cover" />
                <span className="absolute bottom-3 left-3 bg-black/70 text-white font-mono text-[10px] px-2.5 py-1 rounded-md">
                  {publishedLabel(selectedPattern.publishedAt)}
                </span>
                {isOpeningPattern && (
                  <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-purple-600 animate-spin" />
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  {selectedPattern.author.photoUrl ? (
                    <img src={selectedPattern.author.photoUrl} alt={selectedPattern.author.displayName} className="w-7 h-7 rounded-full object-cover border" />
                  ) : (
                    <span className="w-7 h-7 rounded-full bg-purple-100 text-purple-700 border border-purple-200 flex items-center justify-center text-xs font-black">
                      {selectedPattern.author.displayName.slice(0, 1).toUpperCase() || '豆'}
                    </span>
                  )}
                  <div>
                    <div className="text-xs font-extrabold text-purple-950">{selectedPattern.author.displayName}</div>
                    <div className="text-[10px] text-purple-500">发布于 {publishedLabel(selectedPattern.publishedAt)}</div>
                  </div>
                </div>

                <h2 className="text-lg font-black text-purple-950">{selectedPattern.title}</h2>
                <p className="text-xs text-purple-700 leading-relaxed">这是来自豆社的公开作品。你可以点赞、收藏，或将图片导入画板继续制作。</p>

                <div className="grid grid-cols-3 gap-2 bg-purple-50 p-3 rounded-2xl border border-purple-200/80 text-center">
                  <div>
                    <div className="text-[10px] text-purple-500">发布时间</div>
                    <div className="text-xs font-black text-purple-900">{publishedLabel(selectedPattern.publishedAt)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-purple-500">获赞</div>
                    <div className="text-xs font-black text-purple-900">{selectedPattern.likeCount}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-purple-500">收藏</div>
                    <div className="text-xs font-black text-purple-900">{selectedPattern.favoriteCount}</div>
                  </div>
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <button
                    onClick={() => {
                      const p = selectedPattern;
                      setSelectedPattern(null);
                      onRemixPattern(remixPattern(p));
                    }}
                    className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-extrabold text-xs shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                  >
                    <Zap className="w-4 h-4 fill-amber-300 text-amber-300" />
                    <span>加载至画布一键制作同款</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isPublishOpen && (
        <div className="fixed inset-0 z-50 bg-purple-950/50 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 border border-purple-200 shadow-2xl relative">
            <button
              onClick={() => !isPublishing && setIsPublishOpen(false)}
              className="absolute top-4 right-4 p-2 text-purple-400 hover:text-purple-900 rounded-xl hover:bg-purple-50 cursor-pointer disabled:cursor-wait"
              disabled={isPublishing}
            >
              ✕
            </button>
            <h2 className="text-lg font-black text-purple-950">投稿灵感图纸</h2>
            <p className="text-xs text-purple-600 mt-1">图片会先上传，再发布为公开社区作品。</p>
            <div className="mt-5 space-y-4">
              <label className="block text-xs font-bold text-purple-900">
                作品标题
                <input
                  maxLength={60}
                  value={publishTitle}
                  onChange={event => {
                    setPublishTitle(event.target.value);
                    if (publishError) setPublishError(null);
                  }}
                  className="mt-1.5 w-full rounded-xl border border-purple-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500/30"
                  placeholder="给作品起个名字"
                  disabled={isPublishing}
                />
                <span className="mt-1 block text-right text-[11px] font-medium text-purple-500">必填，1-60 个字符 · {publishTitle.trim().length}/60</span>
              </label>
              <label className="block text-xs font-bold text-purple-900">
                作品图片
                <span className="mt-1.5 flex items-center gap-2 rounded-xl border border-dashed border-purple-300 bg-purple-50 px-3 py-3 text-purple-700 cursor-pointer">
                  <Upload className="w-4 h-4 shrink-0" />
                  <span className="truncate">{publishFile?.name ?? '选择 PNG、WebP 或 JPEG（不超过 15 MiB）'}</span>
                  <input
                    type="file"
                    accept="image/png,image/webp,image/jpeg"
                    className="sr-only"
                    onChange={event => setPublishFile(event.target.files?.[0] ?? null)}
                    disabled={isPublishing}
                  />
                </span>
              </label>
              {publishError && <p className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">{publishError}</p>}
              <button
                onClick={() => void publishPattern()}
                disabled={isPublishing}
                className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm shadow-md cursor-pointer disabled:cursor-wait flex items-center justify-center gap-2"
              >
                {isPublishing && <Loader2 className="w-4 h-4 animate-spin" />}
                {isPublishing ? '正在发布' : '上传并发布'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
