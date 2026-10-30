import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Sparkles, Eye, Compass, Filter, ArrowRight, Zap, Loader2, RefreshCw, Crop, Crown } from 'lucide-react';
import type { CommunityPattern } from '../data/communityData';
import { useAuth } from '../context/AuthContext';
import { getApiToken } from '../utils/api';
import { loadCommunityPattern } from '../utils/communityPattern';
import { renderCommunityPattern } from '../utils/communityPatternSnapshot';
import type { StoredPatternProject } from '../utils/patternGridCodec';
import { canvasLimitForMembership, canEditCommunityPattern } from '../utils/communityPatternAccess';
import { CommunityPatternWorkspace } from './CommunityPatternWorkspace';
import { CommunityPostCard, communityPostTags } from './CommunityPostCard';
import { useCommunityFeed } from '../hooks/useCommunityFeed';
import {
  type CommunityPost,
  getCommunityPost,
  reactToCommunityPost,
} from '../utils/communityApi';

interface CommunityViewProps {
  onRemixPattern: (pattern: CommunityPattern) => boolean | void;
  onNavigateToStudio: () => void;
  onOpenAuthModal: () => void;
  onOpenVipModal?: () => void;
  onOpenInventory?: () => void;
}

type SortMode = 'hot' | 'new' | 'favorites';

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

function remixPattern(post: CommunityPost, project: StoredPatternProject): CommunityPattern {
  const cells = project.grid.flat().filter((cell) => cell !== null);
  return {
    id: post.id,
    title: post.title,
    description: `发布于 ${publishedLabel(post.publishedAt)}`,
    author: { name: post.author.displayName, avatar: post.author.photoUrl ?? '' },
    category: '',
    tags: communityPostTags(post),
    imageUrl: post.imageUrl,
    width: project.width,
    height: project.height,
    boardCount: Math.ceil(project.width / project.boardSize) * Math.ceil(project.height / project.boardSize),
    beadCount: cells.length,
    colorCount: new Set(cells).size,
    likes: post.likeCount,
    forks: post.favoriteCount,
    views: 0,
    isLiked: post.liked,
    project,
  };
}

export const CommunityView: React.FC<CommunityViewProps> = ({
  onRemixPattern,
  onNavigateToStudio,
  onOpenAuthModal,
  onOpenVipModal,
  onOpenInventory,
}) => {
  const { currentUser, userProfile, isVip, isPro } = useAuth();
  const membership = { isVip, isPro };
  const editLimit = canvasLimitForMembership(membership);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPattern, setSelectedPattern] = useState<CommunityPost | null>(null);
  const [selectedProject, setSelectedProject] = useState<StoredPatternProject | null>(null);
  const [detailMessage, setDetailMessage] = useState<string | null>(null);
  const [ownerOriginal, setOwnerOriginal] = useState<StoredPatternProject | null>(null);
  const [originalPreview, setOriginalPreview] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'practice' | 'crop' | null>(null);
  const detailRequestRef = useRef(0);
  const { posts: patternsState, nextCursor, isLoading, isLoadingMore, error: feedError, refresh: refreshPatterns, loadMore, updatePost } = useCommunityFeed(currentUser?.uid ?? null);
  const [sortBy, setSortBy] = useState<SortMode>('hot');
  const [isOpeningPattern, setIsOpeningPattern] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const detailDialogRef = useRef<HTMLDialogElement>(null);
  const reactionEpochRef = useRef(0);
  const reactionPendingRef = useRef(false);

  useEffect(() => {
    // A former owner's legacy private fallback must not stay visible after logout.
    detailRequestRef.current++;
    setWorkspaceMode(null);
    setSelectedPattern(null);
    setSelectedProject(null);
    setOwnerOriginal(null);
    setOriginalPreview(null);
    setPendingAction(null);
    setRequestError(null);
    reactionPendingRef.current = false;
    reactionEpochRef.current++;
    return () => { detailRequestRef.current++; reactionEpochRef.current++; };
  }, [currentUser?.uid]);

  const closeDetail = () => {
    detailRequestRef.current++;
    setSelectedPattern(null);
    setOwnerOriginal(null);
  };

  useEffect(() => {
    if (!selectedPattern) return;
    const dialog = detailDialogRef.current;
    const previousFocus = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [selectedPattern?.id]);

  const openMembership = () => {
    setWorkspaceMode(null);
    setSelectedPattern(null);
    if (onOpenVipModal) onOpenVipModal(); else onOpenAuthModal();
  };
  const editPublicCopy = (project: StoredPatternProject): boolean => {
    if (!selectedPattern || !canEditCommunityPattern(project, membership)) return false;
    const accepted = onRemixPattern({ ...remixPattern(selectedPattern, project), title: project === selectedProject ? selectedPattern.title : project.name });
    if (accepted === false) return false;
    setWorkspaceMode(null);
    setSelectedPattern(null);
    return true;
  };

  useEffect(() => {
    setOriginalPreview(null);
    if (!ownerOriginal) return;
    let disposed = false;
    let previewUrl: string | undefined;
    void renderCommunityPattern(ownerOriginal).then((blob) => {
      if (disposed) return;
      previewUrl = URL.createObjectURL(blob);
      setOriginalPreview(previewUrl);
    }).catch(() => {
      if (!disposed) setDetailMessage('原稿已载入，但预览生成失败。你仍可载入完整图纸，当前图片是旧版发布缩略图。');
    });
    return () => { disposed = true; if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [ownerOriginal]);

  const availableTags = useMemo(() => [...new Set(patternsState.flatMap(communityPostTags))], [patternsState]);
  useEffect(() => {
    if (!isLoading && !feedError && activeCategory !== null && !availableTags.includes(activeCategory)) setActiveCategory(null);
  }, [availableTags, activeCategory, isLoading, feedError]);

  const filteredPatterns = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    const visible = patternsState.filter(pattern => (activeCategory === null || communityPostTags(pattern).includes(activeCategory)) && (!query
      || pattern.title.toLocaleLowerCase().includes(query)
      || pattern.author.displayName.toLocaleLowerCase().includes(query)
      || communityPostTags(pattern).some(tag => tag.toLocaleLowerCase().includes(query))));
    return [...visible].sort((first, second) => {
      if (sortBy === 'new') return second.publishedAt - first.publishedAt;
      if (sortBy === 'favorites') return second.favoriteCount - first.favoriteCount || second.publishedAt - first.publishedAt;
      return second.likeCount - first.likeCount || second.publishedAt - first.publishedAt;
    });
  }, [patternsState, activeCategory, searchQuery, sortBy]);

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
    updatePost(id, update);
    setSelectedPattern(current => current?.id === id ? update(current) : current);
  };

  const openPattern = async (pattern: CommunityPost) => {
    const requestId = ++detailRequestRef.current;
    setSelectedPattern(pattern);
    setSelectedProject(null);
    setOwnerOriginal(null);
    setOriginalPreview(null);
    setDetailMessage(null);
    setIsOpeningPattern(true);
    try {
      const result = await getCommunityPost(pattern.id);
      if (!result.ok || !result.data) throw new Error(result.error ?? '作品详情暂时无法加载');
      if (requestId !== detailRequestRef.current) return;
      setSelectedPattern(result.data);
      const source = await loadCommunityPattern(result.data, currentUser?.uid);
      if (requestId !== detailRequestRef.current) return;
      setSelectedProject(source.project);
      setOwnerOriginal(source.fromOwnerLibrary ? source.project : null);
      setDetailMessage(source.fromOwnerLibrary
        ? '这条旧版发布只保存了缩略图，将载入你图库中保留的原稿。撤回后重新发布可分享完整图纸。'
        : source.project ? null : '这条作品只包含展示图片，没有原始网格和色号。请作者从图库重新发布完整图纸。');
    } catch (error) {
      if (requestId === detailRequestRef.current) setDetailMessage(error instanceof Error ? error.message : '图纸加载失败，请重试');
    } finally {
      if (requestId === detailRequestRef.current) setIsOpeningPattern(false);
    }
  };

  const handleReaction = async (event: React.MouseEvent, pattern: CommunityPost, reaction: 'like' | 'favorite') => {
    event.stopPropagation();
    if (reactionPendingRef.current) return;
    if (requireRegisteredCommunityAccount('登录后即可参与社区互动')) return;
    const active = reaction === 'like' ? !pattern.liked : !pattern.favorited;
    const action = `${reaction}:${pattern.id}`;
    const epoch = reactionEpochRef.current;
    reactionPendingRef.current = true;
    setPendingAction(action);
    setRequestError(null);
    try {
      const result = await reactToCommunityPost(pattern.id, reaction, active);
      if (epoch !== reactionEpochRef.current) return;
      if (!result.ok) {
        if (!handleGuestCommunityResponse(result.error)) setRequestError(result.error ?? '操作未完成，请重试');
      } else {
        updatePattern(pattern.id, current => reaction === 'like'
          ? { ...current, liked: active, likeCount: Math.max(0, current.likeCount + (active ? 1 : -1)) }
          : { ...current, favorited: active, favoriteCount: Math.max(0, current.favoriteCount + (active ? 1 : -1)) });
      }
    } catch {
      if (epoch === reactionEpochRef.current) setRequestError('操作未完成，请检查网络后重试');
    } finally {
      if (epoch === reactionEpochRef.current) {
        reactionPendingRef.current = false;
        setPendingAction(null);
      }
    }
  };


  return (
    <div className="flex-1 overflow-y-auto bg-gradient-to-b from-[#F5F0FD] via-[#FAF6FE] to-[#EFE7FA] min-h-0 text-purple-950 mobile-nav-clearance lg:pb-16 [&_button]:focus-visible:outline-none [&_button]:focus-visible:ring-2 [&_button]:focus-visible:ring-purple-600 [&_button]:focus-visible:ring-offset-2">
      {/* Community Banner Hero Section */}
      <section className="relative px-4 py-4 sm:py-12 md:py-14 overflow-hidden border-b border-purple-200/80 bg-white/60 backdrop-blur-md">
        <div className="max-w-[1600px] w-full mx-auto px-0 sm:px-6 lg:px-8 relative z-10 flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 sm:px-3.5 sm:py-1.5 rounded-full bg-purple-100/90 border border-purple-300/80 text-purple-900 text-xs sm:text-xs font-bold shadow-xs mb-2.5 sm:mb-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-purple-600 fill-purple-400" />
            <span>豆织星格 · 拼豆创客灵感社区</span>
            <span className="bg-purple-600 text-white text-xs lg:text-[10px] px-1.5 py-0.5 rounded-full font-black">V2.0</span>
          </div>

          <h1 className="text-balance text-xl sm:text-4xl md:text-5xl font-black bg-gradient-to-r from-purple-950 via-purple-800 to-indigo-800 bg-clip-text text-transparent tracking-tight max-w-3xl leading-snug sm:leading-tight">
            发现豆友的拼豆作品<br className="hidden sm:inline" /> 查看图纸，动手做同款
          </h1>

          <p className="hidden sm:block text-xs sm:text-sm md:text-base text-purple-700 font-medium max-w-2xl mt-3 leading-relaxed">
            浏览真实作品与创作标签；完成自己的图纸后，可从我的图库发布到豆社。
          </p>

          {/* Quick CTA Actions */}
          <div className="flex flex-wrap items-center justify-center gap-3 mt-3 sm:mt-6">
            <button
              onClick={onNavigateToStudio}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 sm:px-6 sm:py-3 sm:rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-black text-sm sm:text-sm shadow-lg shadow-purple-500/25 cursor-pointer transition-all hover:scale-102 active:scale-98"
            >
              <Zap className="w-4 h-4 fill-amber-300 text-amber-300" />
              <span>新建空白拼豆画布</span>
              <ArrowRight className="w-4 h-4" />
            </button>


          </div>

          {/* Search Bar & Tag Filters */}
          <div className="w-full max-w-2xl mt-3 sm:mt-5 relative">
            <div className="relative flex items-center">
              <Search aria-hidden="true" className="w-5 h-5 absolute left-3.5 text-purple-600" />
              <input
                type="search"
                aria-label="搜索作品标题、创作者或标签"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索作品标题、创作者或标签..."
                enterKeyHint="search"
                className="w-full pl-10 pr-20 py-3 sm:py-3.5 rounded-xl sm:rounded-2xl bg-white/90 border border-purple-300 text-purple-950 placeholder-purple-400 font-medium text-base sm:text-sm shadow-md focus:outline-none focus:ring-2 focus:ring-purple-500/30 transition-all"
              />
              {searchQuery && <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 min-h-11 min-w-11 px-3 rounded-xl bg-purple-100 hover:bg-purple-200 text-purple-900 text-xs font-bold transition-all cursor-pointer"
              >
                清空
              </button>}
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      <div className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        {/* Category Tabs & Sorting bar */}
        <div className="flex flex-col items-start gap-2.5 pb-3 border-b border-purple-200/80 sm:gap-3 sm:pb-3">
          {/* Categories — a single swipeable row on phones so a long tag list
              never pushes the first artwork below the fold. */}
          <div role="group" aria-label="按作品标签筛选" className="-mx-4 flex w-[calc(100%+2rem)] flex-nowrap items-center gap-2 overflow-x-auto scrollbar-none px-4 sm:mx-0 sm:w-full sm:flex-wrap sm:overflow-visible sm:px-0">
            {[null, ...availableTags].map(cat => (
              <button
                type="button"
                key={cat === null ? 'all' : `tag:${cat}`}
                aria-pressed={activeCategory === cat}
                aria-label={cat === null ? '全部作品' : `筛选标签：${cat}`}
                onClick={() => setActiveCategory(cat)}
                className={`inline-flex min-h-11 sm:min-h-9 min-w-[4.5rem] shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                  activeCategory === cat
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-white/80 hover:bg-purple-100 text-purple-800 border border-purple-200/80'
                }`}
              >
                {cat === null ? '全部' : `#${cat}`}
              </button>
            ))}
          </div>

          {/* Sort selection */}
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="作品排序" className="flex flex-wrap items-center gap-1 bg-white/80 p-1 rounded-xl border border-purple-200 text-xs">
            <span className="text-purple-600 font-medium px-2 flex items-center gap-1">
              <Filter className="w-3 h-3" />
              排序:
            </span>
            <button
              aria-pressed={sortBy === 'hot'}
              onClick={() => setSortBy('hot')}
              className={`min-h-11 sm:min-h-9 px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                sortBy === 'hot' ? 'bg-purple-100 text-purple-900 shadow-2xs' : 'text-purple-600 hover:text-purple-900'
              }`}
            >
              热度
            </button>
            <button
              aria-pressed={sortBy === 'new'}
              onClick={() => setSortBy('new')}
              className={`min-h-11 sm:min-h-9 px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                sortBy === 'new' ? 'bg-purple-100 text-purple-900 shadow-2xs' : 'text-purple-600 hover:text-purple-900'
              }`}
            >
              最新发布
            </button>
            <button
              aria-pressed={sortBy === 'favorites'}
              onClick={() => setSortBy('favorites')}
              className={`min-h-11 sm:min-h-9 px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                sortBy === 'favorites' ? 'bg-purple-100 text-purple-900 shadow-2xs' : 'text-purple-600 hover:text-purple-900'
              }`}
            >
              最多收藏
            </button>
          </div>
          <button type="button" onClick={() => { setRequestError(null); void refreshPatterns(); }} disabled={isLoading || isLoadingMore}
            aria-label={isLoading ? '正在刷新社区' : '刷新社区'}
            title={isLoading ? '正在刷新社区' : '刷新社区'}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-purple-300 bg-white px-3 py-2 text-sm font-bold text-purple-800 hover:bg-purple-50 disabled:cursor-wait disabled:opacity-60 sm:px-4">
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isLoading ? 'animate-spin motion-reduce:animate-none' : ''}`} />
            <span className="hidden sm:inline">{isLoading ? '正在刷新' : '刷新社区'}</span>
          </button>
          </div>
        </div>

        {(requestError || feedError) && (
          <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
            <span>{requestError || feedError}</span>
          </div>
        )}
        {/* The status line duplicates the loading block below during the first
            fetch, so only show it once there is something to count. */}
        {!(isLoading && patternsState.length === 0) && (
          <p role="status" aria-live="polite" className="mt-3 text-xs text-purple-700">
            {isLoading ? '正在刷新社区作品与标签…' : `已加载 ${patternsState.length} 件作品 · 当前显示 ${filteredPatterns.length} 件`}
            {nextCursor && ' · 加载更多可发现更多作品和标签'}
          </p>
        )}

        {/* Gallery Grid */}
        {isLoading && patternsState.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-purple-600 sm:py-20">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span className="mt-3 text-sm font-bold">正在加载社区作品</span>
          </div>
        ) : filteredPatterns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white/50 rounded-3xl border border-dashed border-purple-200 my-8">
            <Compass className="w-12 h-12 text-purple-300 animate-bounce mb-3" />
            <h3 className="text-base font-bold text-purple-900">{patternsState.length === 0 ? '社区还没有公开作品' : '未找到相关拼豆灵感图纸'}</h3>
            <p className="text-xs text-purple-600 mt-1">{patternsState.length === 0 ? '从画板创作后，可在我的图库发布完整图纸。' : '您可以尝试其他标签或搜索词。'}</p>
            <button
              onClick={patternsState.length === 0 ? onNavigateToStudio : () => { setSearchQuery(''); setActiveCategory(null); }}
              className="mt-4 min-h-11 px-5 py-2.5 rounded-xl bg-purple-600 text-white font-bold text-xs shadow-md cursor-pointer"
            >
              {patternsState.length === 0 ? '前往画板创作' : '清空筛选'}
            </button>
          </div>
        ) : (
          <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 my-4">
            {filteredPatterns.map(pattern => (
              <CommunityPostCard key={pattern.id} post={pattern} pending={pendingAction !== null}
                onOpen={pattern => void openPattern(pattern)} onReaction={(event, post, reaction) => void handleReaction(event, post, reaction)} />
            ))}
          </div>
          </>
        )}
          {nextCursor && (
            <div className="flex justify-center pb-4">
              <button type="button" onClick={() => void loadMore()} disabled={isLoading || isLoadingMore} className="min-h-11 px-5 py-2.5 rounded-xl bg-white border border-purple-200 text-purple-800 text-xs font-bold shadow-sm cursor-pointer disabled:cursor-wait inline-flex items-center gap-2">
                {isLoadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                {isLoadingMore ? '正在加载' : '加载更多作品'}
              </button>
            </div>
          )}
      </div>

      {/* Pattern Detail Modal */}
      {selectedPattern && (
        <dialog ref={detailDialogRef} aria-labelledby="community-detail-title" onCancel={closeDetail}
          className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-2xl max-h-[90dvh] overflow-y-auto rounded-3xl border border-purple-200 bg-white p-6 text-purple-950 shadow-2xl backdrop:bg-purple-950/50 backdrop:backdrop-blur-md">
            <button
              type="button" onClick={closeDetail}
              aria-label="关闭图纸详情"
              className="absolute top-4 right-4 z-10 min-h-11 min-w-11 bg-white/95 p-2 text-purple-700 hover:text-purple-900 rounded-xl shadow-sm hover:bg-purple-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-purple-600"
              title="关闭图纸详情"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="flex flex-col sm:flex-row gap-5 items-start">
              <div className="w-full sm:w-1/2 aspect-square rounded-2xl overflow-hidden bg-purple-50 border border-purple-200 relative shrink-0">
                <img src={originalPreview ?? selectedPattern.imageUrl} alt={selectedPattern.title} decoding="async" fetchPriority="high" className="w-full h-full object-contain [image-rendering:pixelated]" />
                <span className="absolute bottom-3 left-3 bg-black/70 text-white font-mono text-xs lg:text-[10px] px-2.5 py-1 rounded-md">
                  {publishedLabel(selectedPattern.publishedAt)}
                </span>
                {isOpeningPattern && (
                  <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-purple-600 animate-spin" />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  {selectedPattern.author.photoUrl ? (
                    <img src={selectedPattern.author.photoUrl} alt={selectedPattern.author.displayName} loading="lazy" decoding="async" fetchPriority="low" className="w-7 h-7 rounded-full object-cover border" />
                  ) : (
                    <span className="w-7 h-7 rounded-full bg-purple-100 text-purple-700 border border-purple-200 flex items-center justify-center text-xs font-black">
                      {selectedPattern.author.displayName.slice(0, 1).toUpperCase() || '豆'}
                    </span>
                  )}
                  <div>
                    <div className="text-xs font-extrabold text-purple-950">{selectedPattern.author.displayName}</div>
                    <div className="text-xs lg:text-[10px] text-purple-600">发布于 {publishedLabel(selectedPattern.publishedAt)}</div>
                  </div>
                </div>

                <h2 id="community-detail-title" className="break-words text-lg font-black text-purple-950">{selectedPattern.title}</h2>
                {communityPostTags(selectedPattern).length > 0 && <ul aria-label="作品标签" className="flex flex-wrap gap-1.5">
                  {communityPostTags(selectedPattern).map(tag => <li key={tag} className="max-w-full break-words rounded-md border border-purple-200 bg-purple-50 px-2 py-1 text-xs text-purple-800">#{tag}</li>)}
                </ul>}
                <p className="text-xs text-purple-700 leading-relaxed">完整查看、定位色号与计时拼豆不受图纸大小限制。进入画板编辑时，按你当前账号的尺寸权限创建独立副本。</p>
                {detailMessage && <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">{detailMessage}</p>}
                {selectedProject && <p className="text-xs text-purple-700">{selectedProject.width} × {selectedProject.height} 格 · {selectedProject.grid.reduce((sum, row) => sum + row.filter((cell) => cell !== null).length, 0)} 颗豆 · {new Set(selectedProject.grid.flat().filter((cell) => cell !== null)).size} 种颜色</p>}

                <div className="grid grid-cols-3 gap-2 bg-purple-50 p-3 rounded-2xl border border-purple-200/80 text-center">
                  <div>
                    <div className="text-xs lg:text-[10px] text-purple-600">发布时间</div>
                    <div className="text-xs font-black text-purple-900">{publishedLabel(selectedPattern.publishedAt)}</div>
                  </div>
                  <div>
                    <div className="text-xs lg:text-[10px] text-purple-600">获赞</div>
                    <div className="text-xs font-black text-purple-900">{selectedPattern.likeCount}</div>
                  </div>
                  <div>
                    <div className="text-xs lg:text-[10px] text-purple-600">收藏</div>
                    <div className="text-xs font-black text-purple-900">{selectedPattern.favoriteCount}</div>
                  </div>
                </div>

                {selectedProject && !canEditCommunityPattern(selectedProject, membership) && <div role="status" className="rounded-xl border border-purple-200 bg-purple-50 p-3 text-xs leading-6 text-purple-800">
                  当前账号最多编辑 {editLimit} × {editLimit} 格。你仍可完整查看、收藏和实操；编辑可框选区域副本，或升级会员。原图不会自动缩小。
                  <button type="button" onClick={openMembership} className="mt-1 inline-flex min-h-11 items-center gap-1.5 font-bold text-purple-700"><Crown size={15} />查看会员权益</button>
                </div>}
                <div className="grid gap-2 pt-2">
                  <button type="button" onClick={() => setWorkspaceMode('practice')} disabled={isOpeningPattern || !selectedProject}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-3 text-xs font-bold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50">
                    <Eye size={16} />查看与实操
                  </button>
                  <button
                    onClick={() => {
                      if (selectedProject) editPublicCopy(selectedProject);
                    }}
                    disabled={isOpeningPattern || !selectedProject || !canEditCommunityPattern(selectedProject, membership)}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-purple-200 bg-white px-4 py-3 text-xs font-bold text-purple-800 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Zap className="w-4 h-4" />
                    <span>{isOpeningPattern ? '正在加载原始图纸…' : selectedProject && !canEditCommunityPattern(selectedProject, membership) ? '超出当前账号编辑上限' : '载入完整图纸'}</span>
                  </button>
                  <button type="button" disabled={isOpeningPattern || !selectedProject} onClick={() => setWorkspaceMode('crop')}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-purple-700 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-50"><Crop size={15} />框选区域副本</button>
                </div>
              </div>
            </div>
        </dialog>
      )}

      {workspaceMode && selectedPattern && selectedProject && <CommunityPatternWorkspace
        project={selectedProject} title={selectedPattern.title} postId={selectedPattern.id} initialMode={workspaceMode}
        onClose={() => setWorkspaceMode(null)} onEdit={editPublicCopy} onUpgrade={openMembership}
        onOpenInventory={() => {
          setWorkspaceMode(null);
          setSelectedPattern(null);
          if (onOpenInventory) onOpenInventory(); else onOpenAuthModal();
        }} />}


    </div>
  );
};
