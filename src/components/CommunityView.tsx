import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Sparkles, Eye, Compass, Filter, ArrowRight, Zap, Loader2, RefreshCw, Heart, Bookmark, Crown, Tag, ChevronDown } from 'lucide-react';
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
  type CommunityTagSummary,
  fetchCommunityTags,
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
// 规格筛选桶（与后端 specs 快照的 beadCount 区间一一对应）。
type SpecFilter = 'all' | 'le500' | 'le1000' | 'le2000' | 'le3000' | 'le5000' | 'le8000' | 'gt8000';

// 标签抽屉默认渲染的热度前 N 个 chips；总数超出时显示"更多 (n)"，展开后内部滚动。
const TAG_CHIP_PREVIEW_COUNT = 14;

const SPEC_FILTER_OPTIONS: { value: SpecFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'le500', label: '≤500' },
  { value: 'le1000', label: '≤1k' },
  { value: 'le2000', label: '≤2k' },
  { value: 'le3000', label: '≤3k' },
  { value: 'le5000', label: '≤5k' },
  { value: 'le8000', label: '≤8k' },
  { value: 'gt8000', label: '>8k' },
];

// "未分类"筛选的哨兵值：以 \u0000 开头，不可能与真实标签名冲突（后端标签最长 24 且不允许控制字符）。
const UNCATEGORIZED_FILTER = '\u0000uncategorized';
const UNCATEGORIZED_LABEL = '未分类';

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
    description: post.description?.trim() ? post.description : '该用户很懒，没有写简介~',
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
  // 规格筛选：全部 / 小型（≤2000 豆）/ 中型（2001-6000）/ 大型（>6000）。
  const [specFilter, setSpecFilter] = useState<SpecFilter>('all');
  // 标签筛选抽屉：默认收起为紧凑入口，展开后是带全部标签 chips（含计数与"未分类"）的面板。
  const [tagDrawerOpen, setTagDrawerOpen] = useState(false);
  // 标签字典（服务端 usage_count，已按热度降序返回）；展开态是否显示全部标签。
  const [communityTags, setCommunityTags] = useState<CommunityTagSummary[]>([]);
  const [showAllTags, setShowAllTags] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPattern, setSelectedPattern] = useState<CommunityPost | null>(null);
  const [selectedProject, setSelectedProject] = useState<StoredPatternProject | null>(null);
  const [detailMessage, setDetailMessage] = useState<string | null>(null);
  const [ownerOriginal, setOwnerOriginal] = useState<StoredPatternProject | null>(null);
  const [originalPreview, setOriginalPreview] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'practice' | null>(null);
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

  // 标签字典来自服务端（GET /api/community/tags）：usage_count 已由发布/编辑/撤回
  // 与 cron 校准维护，接口按热度降序返回——本地不再统计、不再排序。
  const refreshTagDictionary = useCallback(async () => {
    const result = await fetchCommunityTags();
    if (result.ok && result.data) setCommunityTags(result.data.tags);
  }, []);
  useEffect(() => { void refreshTagDictionary(); }, [refreshTagDictionary]);

  // 标签归一化键：与后端字典一致（trim + 小写）。帖子标签按作者原样存储（可能带大写/空格），
  // 筛选与 staleness 校验都必须先归一化再比对，否则"字母 Logo"这类键永远匹配不到帖子。
  const availableTagKeys = useMemo(() => {
    const keys = new Set<string>(communityTags.map(({ tag }) => tag));
    for (const pattern of patternsState) {
      for (const tag of communityPostTags(pattern)) keys.add(tag.trim().toLocaleLowerCase());
    }
    return keys;
  }, [communityTags, patternsState]);
  // 字典键 → 展示名：chips 与选中区显示字典 name（如键"字母 logo"显示"字母 Logo"）。
  const tagNameByKey = useMemo(
    () => new Map(communityTags.map(({ tag, name }) => [tag, name])),
    [communityTags],
  );
  // 抽屉 chips 数据源：服务端字典顺序原样使用；没有作品的标签（计数 0）也保留（运营预设）。
  const tagFilters = useMemo(
    () => communityTags.map(({ tag, name, usageCount }) => ({ tag, name, count: usageCount })),
    [communityTags],
  );
  // "未分类"桶：当前列表里没有任何标签的作品数量（基于已加载帖子，与字典无关）。
  const uncategorizedCount = useMemo(
    () => patternsState.filter((pattern) => communityPostTags(pattern).length === 0).length,
    [patternsState],
  );
  useEffect(() => {
    if (!isLoading && !feedError && activeCategory !== null) {
      const stale = activeCategory === UNCATEGORIZED_FILTER
        ? uncategorizedCount === 0
        : !availableTagKeys.has(activeCategory.trim().toLocaleLowerCase());
      if (stale) setActiveCategory(null);
    }
  }, [availableTagKeys, activeCategory, uncategorizedCount, isLoading, feedError]);
  // 当前选中标签的展示名（未分类哨兵与字典外键回退为原值）。
  const selectedTagLabel = activeCategory === null || activeCategory === UNCATEGORIZED_FILTER
    ? UNCATEGORIZED_LABEL
    : tagNameByKey.get(activeCategory) ?? activeCategory;

  const filteredPatterns = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    const tagMatch = (pattern: CommunityPost) => {
      if (activeCategory === null) return true;
      if (activeCategory === UNCATEGORIZED_FILTER) return communityPostTags(pattern).length === 0;
      // 归一化键比对：帖子标签原样带大小写，字典键是小写键（如"字母 Logo" ↔ "字母 logo"）。
      const selectedKey = activeCategory.trim().toLocaleLowerCase();
      return communityPostTags(pattern).some((tag) => tag.trim().toLocaleLowerCase() === selectedKey);
    };
    const specMatch = (pattern: CommunityPost) => {
      if (specFilter === 'all') return true;
      // 规格来自后端 dto 的 specs 快照；缺失（旧数据/未回填）不进任何非"全部"桶。
      const beads = pattern.specs?.beadCount;
      if (beads === undefined) return false;
      if (specFilter === 'le500') return beads <= 500;
      if (specFilter === 'le1000') return beads > 500 && beads <= 1000;
      if (specFilter === 'le2000') return beads > 1000 && beads <= 2000;
      if (specFilter === 'le3000') return beads > 2000 && beads <= 3000;
      if (specFilter === 'le5000') return beads > 3000 && beads <= 5000;
      if (specFilter === 'le8000') return beads > 5000 && beads <= 8000;
      return beads > 8000;
    };
    const visible = patternsState.filter(pattern => tagMatch(pattern) && specMatch(pattern) && (!query
      || pattern.title.toLocaleLowerCase().includes(query)
      || pattern.author.displayName.toLocaleLowerCase().includes(query)
      || communityPostTags(pattern).some(tag => tag.toLocaleLowerCase().includes(query))));
    return [...visible].sort((first, second) => {
      if (sortBy === 'new') return second.publishedAt - first.publishedAt;
      if (sortBy === 'favorites') return second.favoriteCount - first.favoriteCount || second.publishedAt - first.publishedAt;
      return second.likeCount - first.likeCount || second.publishedAt - first.publishedAt;
    });
  }, [patternsState, activeCategory, specFilter, searchQuery, sortBy]);

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


  // 超限提示：桌面放在封面下方（那里原本空着一大块），手机仍留在按钮上方，
  // 所以同一个元素在左栏与右栏各渲染一次，靠 hidden / sm:hidden 只显示一个。
  const editLimitNotice = selectedProject && !canEditCommunityPattern(selectedProject, membership) ? (
    <div role="status" className="rounded-xl border border-purple-200 bg-purple-50 p-3 text-xs leading-6 text-purple-800">
      当前账号最多编辑 {editLimit} × {editLimit} 格。你仍可完整查看、收藏和实操；超过这个尺寸需要升级会员后才能编辑。原图不会自动缩小。
      <button type="button" onClick={openMembership} className="mt-1 inline-flex min-h-11 items-center gap-1.5 font-bold text-purple-700"><Crown size={15} />查看会员权益</button>
    </div>
  ) : null;

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
          {/* Tag filter drawer — 收起时是一个带选中摘要的紧凑入口，展开后是含全部标签
              chips（带作品计数）与"未分类"桶的面板；grid-rows 过渡保证平滑展开收起。
              面板内容始终渲染（仅视觉隐藏），标签状态不会因开合而丢失。 */}
          <div className="w-full">
            {/* 标签筛选入口按钮与展开后的 chips 内联在同一个 flex-wrap 容器：
                按钮是第一个元素，chips 跟在后面自然铺满换行；收起时只显示按钮。 */}
            <div className="flex w-full flex-wrap items-center gap-2">
              <button
                type="button"
                aria-expanded={tagDrawerOpen}
                aria-controls="community-tag-drawer"
                onClick={() => setTagDrawerOpen(value => !value)}
                className={`inline-flex min-h-11 sm:min-h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-all duration-200 ${
                  tagDrawerOpen
                    ? 'border-purple-400 bg-purple-100 text-purple-900 shadow-sm'
                    : activeCategory !== null
                      ? 'border-purple-300 bg-purple-50 text-purple-800 hover:bg-purple-100'
                      : 'border-purple-200 bg-white/80 text-purple-700 hover:bg-purple-50'
                }`}
              >
                <Tag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>标签筛选</span>
                {activeCategory !== null && (
                  <span className="inline-flex max-w-[10rem] items-center rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-bold text-white">
                    <span className="truncate">{`#${selectedTagLabel}`}</span>
                  </span>
                )}
                <span aria-hidden="true" className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-purple-200/70 text-purple-800 transition-transform duration-300 motion-reduce:transition-none ${tagDrawerOpen ? 'rotate-180' : ''}`}>
                  <ChevronDown className="h-3.5 w-3.5" />
                </span>
              </button>
              <span className="hidden min-w-0 truncate text-xs font-bold text-purple-600 sm:inline" aria-hidden="true">
                共 {tagFilters.length} 类标签 · {patternsState.length} 件作品
              </span>
              {/* 已选标签 sticky 选中区：独占一行固定在 chips 区上方，不随 chips 滚动；可单独移除当前选中。
                  收起时仅视觉隐藏（display:none），节点保留在 DOM 中，状态不会因开合丢失。 */}
              {activeCategory !== null && (
                <div className={`${tagDrawerOpen ? 'flex' : 'hidden'} w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-purple-300 bg-purple-50 px-2.5 py-1.5`}>
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-[11px] font-bold text-purple-500">已选标签</span>
                    <span className="inline-flex min-w-0 max-w-full items-center rounded-full bg-purple-600 px-2.5 py-1 text-xs font-bold text-white">
                      <span className="min-w-0 truncate">{`#${selectedTagLabel}`}</span>
                      <button
                        type="button"
                        onClick={() => setActiveCategory(null)}
                        aria-label={`移除已选标签 ${selectedTagLabel}`}
                        className="ml-1 grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-full text-white/90 transition-colors hover:bg-white/20 hover:text-white"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveCategory(null)}
                    className="inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1 text-[11px] font-bold text-purple-700 transition-colors hover:bg-purple-100"
                  >
                    <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                    清空标签筛选
                  </button>
                </div>
              )}
              <div
                id="community-tag-drawer"
                aria-hidden={!tagDrawerOpen}
                className={`min-w-0 flex-1 transition-opacity duration-200 motion-reduce:transition-none ${
                  tagDrawerOpen ? 'visible opacity-100' : 'invisible absolute h-0 w-0 overflow-hidden opacity-0'
                }`}
              >
                <div className="sm:hidden pb-2 text-[11px] font-bold text-purple-500">共 {tagFilters.length} 类标签 · {patternsState.length} 件作品</div>
                <div className="hidden sm:block pb-2 text-[11px] font-bold text-purple-500">按标签筛选，可与搜索、规格叠加使用</div>
                <div role="group" aria-label="按作品标签筛选" className="flex max-h-64 flex-wrap items-start gap-2 overflow-y-auto">
                  {[
                    { key: 'all', value: null as string | null, label: '全部', count: null as number | null, ariaLabel: '全部作品' },
                    // chips 展示字典 name（原样大小写），筛选值用归一化键 tag。
                    ...(showAllTags ? tagFilters : tagFilters.slice(0, TAG_CHIP_PREVIEW_COUNT)).map(({ tag, name, count }) => ({
                      key: `tag:${tag}`, value: tag as string | null, label: `#${name}`, count: count as number | null, ariaLabel: `筛选标签：${name}`,
                    })),
                    { key: 'uncategorized', value: UNCATEGORIZED_FILTER, label: UNCATEGORIZED_LABEL, count: uncategorizedCount as number | null, ariaLabel: `筛选标签：${UNCATEGORIZED_LABEL}` },
                  ].map(entry => (
                    <button
                      type="button"
                      key={entry.key}
                      aria-pressed={activeCategory === entry.value}
                      aria-label={entry.ariaLabel}
                      onClick={() => setActiveCategory(entry.value)}
                      className={`inline-flex min-h-11 sm:min-h-9 min-w-[4.5rem] max-w-full cursor-pointer items-center justify-center whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
                        activeCategory === entry.value
                          ? 'bg-purple-600 text-white shadow-sm'
                          : 'bg-white/80 hover:bg-purple-100 text-purple-800 border border-purple-200/80'
                      }`}
                    >
                      <span className="min-w-0 truncate">{entry.label}</span>
                      {entry.count !== null ? <span className="ml-1 shrink-0 opacity-70">({entry.count})</span> : null}
                    </button>
                  ))}
                  {tagFilters.length > TAG_CHIP_PREVIEW_COUNT && (
                    <button
                      type="button"
                      aria-expanded={showAllTags}
                      onClick={() => setShowAllTags(value => !value)}
                      className="inline-flex min-h-11 sm:min-h-9 min-w-[4.5rem] cursor-pointer items-center justify-center whitespace-nowrap rounded-full border border-dashed border-purple-300 bg-white/60 px-3.5 py-1.5 text-xs font-bold text-purple-700 transition-colors hover:bg-purple-50"
                    >
                      {showAllTags ? '收起' : `更多 (${tagFilters.length - TAG_CHIP_PREVIEW_COUNT})`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Sort + spec filters — 排序与规格 chips 在同一个筛选容器内；
              移动端规格 chips 单独另起一行自然换行，桌面端排序+规格仍同一行。 */}
          <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
          <div role="group" aria-label="作品排序" className="flex min-w-0 flex-wrap items-center gap-1 bg-white/80 p-1 rounded-xl border border-purple-200 text-xs">
            <span className="text-purple-600 font-medium px-2 flex items-center gap-1">
              <Filter className="w-3 h-3 shrink-0" />
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
            <span className="mx-1 hidden h-4 w-px bg-purple-200 sm:block" aria-hidden="true" />
            <span className="hidden px-1 font-bold text-purple-900 sm:inline">规格:</span>
            <span className="hidden min-w-0 flex-wrap items-center sm:flex">
              {SPEC_FILTER_OPTIONS.map(({ value, label }) => (
                <button
                  type="button"
                  key={`spec:${value}`}
                  aria-pressed={specFilter === value}
                  onClick={() => setSpecFilter(value)}
                  className={`min-h-11 sm:min-h-9 px-2 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    specFilter === value ? 'bg-purple-100 text-purple-900 shadow-2xs' : 'text-purple-600 hover:text-purple-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </span>
          </div>
          {/* 移动端规格 chips：与排序在同一个筛选容器内，但单独另起一行自然换行。 */}
          <div role="group" aria-label="按豆子数量筛选规格" className="flex min-w-0 flex-wrap items-center gap-1 bg-white/80 p-1 rounded-xl border border-purple-200 text-xs sm:hidden">
            <span className="text-purple-600 font-medium px-2 flex items-center gap-1">
              <Filter className="w-3 h-3 shrink-0" />
              规格:
            </span>
            {SPEC_FILTER_OPTIONS.map(({ value, label }) => (
              <button
                type="button"
                key={`m-spec:${value}`}
                aria-pressed={specFilter === value}
                onClick={() => setSpecFilter(value)}
                className={`min-h-11 px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  specFilter === value ? 'bg-purple-100 text-purple-900 shadow-2xs' : 'text-purple-600 hover:text-purple-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:contents">
            <button type="button" onClick={() => { setRequestError(null); void refreshPatterns(); void refreshTagDictionary(); }} disabled={isLoading || isLoadingMore}
              aria-label={isLoading ? '正在刷新社区' : '刷新社区'}
              title={isLoading ? '正在刷新社区' : '刷新社区'}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-purple-300 bg-white px-3 py-2 text-sm font-bold text-purple-800 hover:bg-purple-50 disabled:cursor-wait disabled:opacity-60 sm:px-4">
              <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isLoading ? 'animate-spin motion-reduce:animate-none' : ''}`} />
              <span className="hidden sm:inline">{isLoading ? '正在刷新' : '刷新社区'}</span>
            </button>
          </div>
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
          {/* 手机上三列缩略图：作品图是内容主体，一列大卡一屏只放得下一张。
              三列时卡片只留封面 + 标题 + 作者/点赞，完整信息在详情里。 */}
          <div className="grid grid-cols-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-4 my-4">
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
            {/* 关闭键：浮在弹窗右上角，不占文档流（原来那条 sticky 顶栏白吃 56px 高度）。
                圆角方形、无描边，平时只有一枚浅色 X；hover 才浮出浅紫底，按下再深一档。
                `after:-inset-1` 把热区撑到 48px，视觉 40px 不显大。 */}
            <button
              type="button" onClick={closeDetail}
              aria-label="关闭图纸详情"
              title="关闭图纸详情"
              className="absolute top-3 right-3 z-20 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-white/70 text-purple-500 backdrop-blur-sm transition-all duration-200 after:absolute after:-inset-1 after:content-[''] hover:bg-purple-100 hover:text-purple-900 active:scale-95 active:bg-purple-200 focus-visible:ring-2 focus-visible:ring-purple-600 focus-visible:ring-offset-2"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="flex flex-col sm:flex-row gap-5 items-start">
              {/* 左栏 = 封面 + （桌面）编辑上限提示。图片下方原本空着一大块，把提示挪过来补位，
                  右栏就只剩「这是谁的作品 / 能不能用 / 怎么用」三件事。 */}
              <div className="w-full shrink-0 space-y-3 sm:w-1/2">
                <div className="relative aspect-square overflow-hidden rounded-2xl border border-purple-200 bg-purple-50">
                  <img src={originalPreview ?? selectedPattern.imageUrl} alt={selectedPattern.title} decoding="async" fetchPriority="high" className="h-full w-full object-contain [image-rendering:pixelated]" />
                  {isOpeningPattern && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                      <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
                    </div>
                  )}
                </div>
                <div className="hidden sm:block">{editLimitNotice}</div>
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-center gap-2 pr-12">
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
                <p className="rounded-xl bg-purple-50 px-3 py-2.5 text-sm leading-relaxed text-purple-950">{selectedPattern.description?.trim() ? selectedPattern.description : '该用户很懒，没有写简介~'}</p>
                <div className="grid grid-cols-3 gap-2" aria-label="图纸规格">
                  {([
                    ['画板', `${selectedProject ? selectedProject.width : selectedPattern.specs ? `${selectedPattern.specs.gridWidth}×${selectedPattern.specs.gridHeight}` : '未知'} 格`],
                    ['豆子数量', `${selectedProject ? selectedProject.grid.reduce((sum, row) => sum + row.filter((cell) => cell !== null).length, 0) : selectedPattern.specs?.beadCount ?? '未知'} 颗`],
                    ['颜色数量', `${selectedProject ? new Set(selectedProject.grid.flat().filter((cell) => cell !== null)).size : selectedPattern.specs?.colorCount ?? '未知'} 种`],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-purple-200 bg-purple-50 px-2 py-2.5 text-center">
                      <div className="text-[11px] font-bold text-purple-600">{label}</div>
                      <div className="mt-1 text-sm font-black tabular-nums text-purple-950">{value}</div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-purple-700 leading-relaxed">完整查看、定位色号与计时拼豆不受图纸大小限制。进入画板编辑时，按你当前账号的尺寸权限创建独立副本。</p>
                {detailMessage && <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">{detailMessage}</p>}

                {/* 互动条：获赞 / 收藏两格，各自整格可点。
                    发布日期已经在作者行下面写过一次，这里不再重复（原来封面角标 + 作者行 +
                    第三格各写一遍，一屏三个日期）。
                    颜色约定：点赞 = 玫瑰 rose，收藏 = 靛蓝 indigo，与桌面卡片上的按钮同一套语义。
                    未激活一律中性紫，只有点亮后才上色，避免和下面「查看与实操」抢注意力。 */}
                <div className="grid grid-cols-2 gap-2 text-center">
                  <button
                    type="button"
                    onClick={event => void handleReaction(event, selectedPattern, 'like')}
                    disabled={pendingAction === `like:${selectedPattern.id}`}
                    aria-pressed={selectedPattern.liked}
                    aria-label={`${selectedPattern.liked ? '取消点赞' : '点赞'}：${selectedPattern.title}（${selectedPattern.likeCount}）`}
                    className={`flex min-h-12 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border px-1.5 py-2 transition-all duration-200 active:scale-[0.97] disabled:cursor-wait disabled:opacity-60 ${selectedPattern.liked ? 'border-rose-200 bg-rose-50' : 'border-purple-200/80 bg-purple-50 hover:border-purple-300 hover:bg-purple-100'}`}
                  >
                    <span className={`text-[10px] font-bold ${selectedPattern.liked ? 'text-rose-600' : 'text-purple-600'}`}>{selectedPattern.liked ? '已赞' : '获赞'}</span>
                    <span className={`inline-flex items-center gap-1 text-base font-black ${selectedPattern.liked ? 'text-rose-700' : 'text-purple-900'}`}>
                      <Heart size={15} aria-hidden="true" className={`shrink-0 transition-all duration-200 ${selectedPattern.liked ? 'scale-110 fill-rose-600 text-rose-600 animate-[reaction-pop_.34s_ease-out] drop-shadow-[0_0_5px_rgba(225,29,72,0.45)]' : 'scale-100 text-purple-500'}`} />
                      {selectedPattern.likeCount}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={event => void handleReaction(event, selectedPattern, 'favorite')}
                    disabled={pendingAction === `favorite:${selectedPattern.id}`}
                    aria-pressed={selectedPattern.favorited}
                    aria-label={`${selectedPattern.favorited ? '取消收藏' : '收藏'}：${selectedPattern.title}（${selectedPattern.favoriteCount}）`}
                    className={`flex min-h-12 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border px-1.5 py-2 transition-all duration-200 active:scale-[0.97] disabled:cursor-wait disabled:opacity-60 ${selectedPattern.favorited ? 'border-indigo-200 bg-indigo-50' : 'border-purple-200/80 bg-purple-50 hover:border-purple-300 hover:bg-purple-100'}`}
                  >
                    <span className={`text-[10px] font-bold ${selectedPattern.favorited ? 'text-indigo-600' : 'text-purple-600'}`}>{selectedPattern.favorited ? '已收藏' : '收藏'}</span>
                    <span className={`inline-flex items-center gap-1 text-base font-black ${selectedPattern.favorited ? 'text-indigo-700' : 'text-purple-900'}`}>
                      <Bookmark size={15} aria-hidden="true" className={`shrink-0 transition-all duration-200 ${selectedPattern.favorited ? 'scale-110 fill-indigo-600 text-indigo-600 animate-[reaction-pop_.34s_ease-out] drop-shadow-[0_0_5px_rgba(79,70,229,0.45)]' : 'scale-100 text-purple-500'}`} />
                      {selectedPattern.favoriteCount}
                    </span>
                  </button>
                </div>

                <div className="sm:hidden">{editLimitNotice}</div>
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
