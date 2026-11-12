import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CommunityPost } from '../utils/communityApi';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[] }));
const feed = vi.hoisted(() => ({ posts: [] as CommunityPost[], nextCursor: null as string | null, isLoading: false, isLoadingMore: false, error: null as string | null, refresh: vi.fn(), loadMore: vi.fn(), updatePost: vi.fn() }));
const api = vi.hoisted(() => ({ getCommunityPost: vi.fn(), reactToCommunityPost: vi.fn(), fetchCommunityTags: vi.fn(), loadCommunityPattern: vi.fn(), getApiToken: vi.fn(() => 'test-token') }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(),
  useState: <T,>(initial: T) => {
    const slot = hooks.cursor++;
    if (!(slot in hooks.slots)) hooks.slots[slot] = initial;
    return [hooks.slots[slot], (next: T | ((current: T) => T)) => { hooks.slots[slot] = typeof next === 'function' ? (next as (current: T) => T)(hooks.slots[slot] as T) : next; }];
  },
  useRef: <T,>(initial: T) => { const slot = hooks.cursor++; return (hooks.slots[slot] ??= { current: initial }); },
  useMemo: <T,>(calculate: () => T) => calculate(), useCallback: <T,>(callback: T) => callback, useEffect: vi.fn(),
}));
vi.mock('../hooks/useCommunityFeed', () => ({ useCommunityFeed: () => feed }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ currentUser: { uid: 'test-user' }, userProfile: null, isVip: false, isPro: false }) }));
vi.mock('../utils/api', () => ({ getApiToken: api.getApiToken }));
vi.mock('../utils/communityApi', () => ({ getCommunityPost: api.getCommunityPost, reactToCommunityPost: api.reactToCommunityPost, fetchCommunityTags: api.fetchCommunityTags }));
vi.mock('../utils/communityPattern', () => ({ loadCommunityPattern: api.loadCommunityPattern }));
vi.mock('../utils/communityPatternSnapshot', () => ({ renderCommunityPattern: vi.fn() }));
vi.mock('./CommunityPatternWorkspace', () => ({ CommunityPatternWorkspace: () => null }));

import { CommunityView } from './CommunityView';
import { CommunityPostCard, communityPostTags } from './CommunityPostCard';

type Node = { type?: unknown; props: Record<string, any> };
const nodes = (tree: unknown): Node[] => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' && 'props' in tree ? [tree as Node, ...nodes((tree as Node).props.children)] : [];
const text = (tree: unknown): string => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' && 'props' in tree ? text((tree as Node).props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const button = (tree: unknown, label: string) => { const node = nodes(tree).find(node => node.type === 'button' && text(node).trim() === label); if (!node) throw Error(`Missing button: ${label}`); return node; };
const post = (id: string, tags?: string[]): CommunityPost => ({ id, assetId: id, imageUrl: '/test.png', title: `作品${id}`, author: { uid: id, displayName: `作者${id}`, photoUrl: null }, publishedAt: 1, likeCount: 3, favoriteCount: 2, liked: false, favorited: false, tags });
const props = { onRemixPattern: vi.fn(), onNavigateToStudio: vi.fn(), onOpenAuthModal: vi.fn() };
const render = () => { hooks.cursor = 0; return CommunityView(props); };
const cards = (tree: unknown) => nodes(tree).filter(node => node.type === CommunityPostCard);
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('CommunityView UI, real tags and removed image-only publication', () => {
  beforeEach(() => {
    hooks.cursor = 0; hooks.slots = []; vi.clearAllMocks();
    feed.posts = [post('1', ['人物', '游戏']), post('2', ['花卉']), post('3')];
    feed.nextCursor = null; feed.isLoading = false; feed.isLoadingMore = false; feed.error = null;
    api.getApiToken.mockReturnValue('test-token');
    // 标签字典来自服务端（GET /api/community/tags），默认给一份与帖子对应的最小字典。
    api.fetchCommunityTags.mockResolvedValue({ ok: true, data: { tags: [{ tag: '人物', name: '人物', usageCount: 1 }, { tag: '游戏', name: '游戏', usageCount: 1 }, { tag: '花卉', name: '花卉', usageCount: 1 }] } });
  });

  // useEffect 在本测试里被 mock 成 no-op，抽屉字典通过"刷新社区"按钮触发加载。
  const loadTags = async (tree: unknown): Promise<unknown> => {
    button(tree, '刷新社区').props.onClick();
    await flush();
    return render();
  };

  it('renders the server dictionary hot-first, previews 14 chips and expands via 更多', async () => {
    const remoteTags = Array.from({ length: 20 }, (_, i) => ({ tag: `真实标签${i}`, name: `真实标签${i}`, usageCount: 20 - i }));
    api.fetchCommunityTags.mockResolvedValue({ ok: true, data: { tags: remoteTags } });
    let tree = await loadTags(render());
    // 服务端已按 usage_count 降序返回：默认渲染前 14 个，其余收进"更多 (6)"。
    for (const tag of remoteTags.slice(0, 14)) expect(nodes(tree).some(node => node.props['aria-label'] === `筛选标签：${tag.tag}`)).toBe(true);
    for (const tag of remoteTags.slice(14)) expect(nodes(tree).some(node => node.props['aria-label'] === `筛选标签：${tag.tag}`)).toBe(false);
    expect(text(tree)).toContain('更多 (6)');
    // 本地不再排序：chips 顺序与服务端字典一致（热度降序）。
    const chipOrder = nodes(tree)
      .filter(node => typeof node.props['aria-label'] === 'string' && node.props['aria-label'].startsWith('筛选标签：真实标签'))
      .map(node => Number(String(node.props['aria-label']).replace('筛选标签：真实标签', '')));
    expect(chipOrder).toEqual([...Array(14).keys()]);
    // 展开后全部标签可见，且可收起。
    button(tree, '更多 (6)').props.onClick(); tree = render();
    for (const tag of remoteTags) expect(nodes(tree).some(node => node.props['aria-label'] === `筛选标签：${tag.tag}`)).toBe(true);
    button(tree, '收起').props.onClick(); tree = render();
    expect(nodes(tree).some(node => node.props['aria-label'] === `筛选标签：真实标签19`)).toBe(false);
  });

  it('selects a tag from the drawer, pins it in the sticky selected area and removes it there', async () => {
    let tree = await loadTags(render());
    button(tree, '#人物(1)').props.onClick(); tree = render();
    expect(cards(tree).map(card => card.props.post.id)).toEqual(['1']);
    // 选中区固定在抽屉顶部：带移除按钮，点击后单独移除当前选中。
    const remove = nodes(tree).find(node => node.props['aria-label'] === '移除已选标签 人物');
    expect(remove).toBeTruthy();
    remove!.props.onClick(); tree = render();
    expect(cards(tree)).toHaveLength(3);
    expect(nodes(tree).some(node => node.props['aria-label'] === '移除已选标签 人物')).toBe(false);
  });

  it('offers an uncategorized bucket and a collapsible tag filter drawer, combined with search', async () => {
    feed.posts = [post('1', ['人物']), post('2'), post('3', [])];
    let tree = await loadTags(render());
    // 抽屉默认收起，入口按钮切换 aria-expanded；面板内容（chips）始终在 DOM 中。
    const trigger = button(tree, '标签筛选');
    expect(trigger.props['aria-expanded']).toBe(false);
    trigger.props.onClick(); tree = render();
    expect(nodes(tree).find(node => node.props['aria-controls'] === 'community-tag-drawer')!.props['aria-expanded']).toBe(true);
    // "未分类"桶带作品计数，选中后只显示没有任何标签的作品。
    const uncategorized = button(tree, '未分类(2)');
    expect(uncategorized.props['aria-label']).toBe('筛选标签：未分类');
    uncategorized.props.onClick(); tree = render();
    expect(cards(tree).map(card => card.props.post.id)).toEqual(['2', '3']);
    // 未分类与真实标签互斥（同一个 activeCategory 机制，可与搜索/规格叠加）。
    button(tree, '#人物(1)').props.onClick(); tree = render();
    expect(cards(tree).map(card => card.props.post.id)).toEqual(['1']);
    // 标签筛选可与搜索叠加。
    const search = nodes(tree).find(node => node.type === 'input')!;
    search.props.onChange({ target: { value: '不存在' } }); tree = render();
    expect(cards(tree)).toHaveLength(0);
    // "清空筛选"清空搜索词与标签筛选。
    button(tree, '清空筛选').props.onClick(); tree = render();
    expect(cards(tree)).toHaveLength(3);
    // 面板内支持单独一键清空标签筛选（保留其它筛选状态）。
    button(tree, '#人物(1)').props.onClick(); tree = render();
    expect(cards(tree)).toHaveLength(1);
    button(tree, '清空标签筛选').props.onClick(); tree = render();
    expect(cards(tree)).toHaveLength(3);
  });

  it('flows chips in the same flex-wrap container as the trigger and shows only the button when collapsed', async () => {
    let tree = await loadTags(render());
    const drawerNode = (current: unknown) => nodes(current).find(node => node.props.id === 'community-tag-drawer')!;
    const childButtons = (drawer: Node) => [drawer.props.children]
      .flat(Infinity)
      .filter((child): child is Node => Boolean(child) && typeof child === 'object' && (child as Node).type === 'button');
    // 收起态：容器里只有「标签筛选」按钮可见，chips 全部 display:none（DOM 保留防状态丢失），
    // 且容器没有内部滚动高度。
    expect(String(drawerNode(tree).props.className)).not.toContain('max-h-64');
    const collapsed = childButtons(drawerNode(tree));
    expect(collapsed[0].props['aria-expanded']).toBe(false);
    expect(String(collapsed[0].props.className)).not.toContain('hidden');
    for (const chip of collapsed.slice(1)) expect(String(chip.props.className)).toContain('hidden');
    // 展开态：按钮与 chips 是同一容器的兄弟节点——按钮是流里第一个元素，chips 紧跟其后
    // 流动铺满换行（无 flex-1 嵌套子容器），容器 max-h-64 内部滚动。
    button(tree, '标签筛选').props.onClick(); tree = render();
    const expandedDrawer = drawerNode(tree);
    expect(String(expandedDrawer.props.className)).toContain('max-h-64');
    expect(String(expandedDrawer.props.className)).toContain('overflow-y-auto');
    const expanded = childButtons(expandedDrawer);
    expect(expanded[0].props['aria-expanded']).toBe(true);
    expect(expanded[1].props['aria-label']).toBe('全部作品');
    for (const chip of expanded.slice(1)) {
      expect(String(chip.props.className)).toContain('inline-flex');
      expect(String(chip.props.className)).not.toContain('hidden');
    }
  });

  it('refreshes through the shared hook and keeps existing cards during refresh failures', () => {
    button(render(), '刷新社区').props.onClick();
    expect(feed.refresh).toHaveBeenCalledTimes(1);
    feed.isLoading = true;
    expect(button(render(), '正在刷新').props.disabled).toBe(true);
    expect(cards(render())).toHaveLength(3);
    feed.isLoading = false; feed.error = '刷新失败，请重试';
    expect(text(render())).toContain('刷新失败，请重试');
    expect(cards(render())).toHaveLength(3);
  });

  it('keeps pagination available when search has no matches in loaded posts', () => {
    let tree = render();
    nodes(tree).find(node => node.type === 'input')!.props.onChange({ target: { value: '尚未加载的作品' } });
    feed.nextCursor = 'next'; tree = render();
    expect(cards(tree)).toHaveLength(0);
    button(tree, '加载更多作品').props.onClick();
    expect(feed.loadMore).toHaveBeenCalledTimes(1);
  });

  it('does not render the retired community submission flow or any of its child windows', () => {
    const source = readFileSync(new URL('./CommunityView.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/投稿灵感图纸|isPublishOpen|publishFile|publishPattern|openPublish|uploadCommunityAsset|publishCommunityPost|type="file"/);
    const tree = render();
    const renderedNodes = nodes(tree);
    expect(renderedNodes.some(node => node.type === 'form')).toBe(false);
    expect(renderedNodes.some(node => node.type === 'input' && node.props.type === 'file')).toBe(false);
    expect(renderedNodes.some(node => node.type === 'dialog' || node.props.role === 'dialog')).toBe(false);
    expect(text(tree)).not.toContain('确认发布');
    expect(text(tree)).not.toContain('投稿灵感图纸');
  });

  it('keeps the community empty-state navigation to the normal drawing workspace', () => {
    feed.posts = [];
    button(render(), '前往画板创作').props.onClick();
    expect(props.onNavigateToStudio).toHaveBeenCalledTimes(1);
  });

  it('uses one primary card CTA, one favorite and one like; image/title use the same opener', () => {
    const onOpen = vi.fn(), onReaction = vi.fn(), base = post('1', ['人物', '游戏']);
    const value = { ...base, author: { ...base.author, photoUrl: '/avatar.png' } };
    const tree = CommunityPostCard({ post: value, pending: false, onOpen, onReaction });
    const buttons = nodes(tree).filter(node => node.type === 'button');
    const images = nodes(tree).filter(node => node.type === 'img');
    expect(buttons).toHaveLength(5);
    expect(buttons.filter(node => text(node).trim() === '查看图纸')).toHaveLength(1);
    expect(buttons.filter(node => String(node.props['aria-label']).startsWith('收藏：'))).toHaveLength(1);
    expect(images).toHaveLength(2);
    expect(images.every(node => node.props.loading === 'lazy' && node.props.decoding === 'async' && node.props.fetchPriority === 'low')).toBe(true);
    expect(buttons[0]!.props.className).toContain('aspect-4/3');
    expect(text(tree)).toContain('#人物#游戏');
    for (const node of buttons.filter(node => node.props['aria-pressed'] === undefined)) node.props.onClick();
    expect(onOpen).toHaveBeenCalledTimes(3);
    const like = buttons.find(node => String(node.props['aria-label']).startsWith('点赞：'))!;
    expect(like.props['aria-pressed']).toBe(false);
    like.props.onClick({ stopPropagation: vi.fn() });
    expect(onReaction).toHaveBeenCalledWith(expect.anything(), value, 'like');
    expect(buttons.every(node => node.props.type === 'button')).toBe(true);
  });

  it('shows no invented tag for legacy posts and preserves every selected real tag', () => {
    expect(communityPostTags({})).toEqual([]);
    expect(communityPostTags({ tags: [' 人物 ', '人物', null, '', '游戏'] })).toEqual(['人物', '游戏']);
    const tree = CommunityPostCard({ post: post('legacy'), pending: true, onOpen: vi.fn(), onReaction: vi.fn() });
    expect(text(tree)).not.toContain('#');
    expect(nodes(tree).filter(node => node.props['aria-pressed'] !== undefined).every(node => node.props.disabled)).toBe(true);
  });

  it('loads detail through the sole card entry and retains real tags when remixing a full project', async () => {
    const value = feed.posts[0];
    const project = { width: 1, height: 1, boardSize: 29, grid: [['red']], name: '图纸' };
    api.getCommunityPost.mockResolvedValue({ ok: true, data: value });
    api.loadCommunityPattern.mockResolvedValue({ project, fromOwnerLibrary: false });
    cards(render())[0].props.onOpen(value); await flush();
    let tree = render();
    expect(api.getCommunityPost).toHaveBeenCalledWith(value.id);
    const detail = nodes(tree).find(node => node.type === 'dialog')!;
    expect(detail.props['aria-labelledby']).toBe('community-detail-title');
    expect(text(detail)).toContain('#人物#游戏');
    button(tree, '载入完整图纸').props.onClick();
    expect(props.onRemixPattern).toHaveBeenCalledWith(expect.objectContaining({ tags: ['人物', '游戏'], project }));
  });

  it('matches post tags by normalized key and shows the dictionary display name (字母 Logo case)', async () => {
    // 帖子标签按作者原样带大写存储，字典键是归一化小写键；chips 必须用字典 name 展示。
    feed.posts = [post('1', ['字母 Logo']), post('2', ['人物'])];
    api.fetchCommunityTags.mockResolvedValue({
      ok: true,
      data: { tags: [{ tag: '字母 logo', name: '字母 Logo', usageCount: 1 }, { tag: '人物', name: '人物', usageCount: 1 }] },
    });
    let tree = await loadTags(render());
    // chips 展示字典展示名而非归一化键。
    const chip = button(tree, '#字母 Logo(1)');
    expect(chip.props['aria-label']).toBe('筛选标签：字母 Logo');
    chip.props.onClick(); tree = render();
    // 归一化键比对：原样大写存储的帖子标签能命中，选中不会被清空。
    expect(cards(tree).map(card => card.props.post.id)).toEqual(['1']);
    expect(nodes(tree).find(node => node.props['aria-label'] === '移除已选标签 字母 Logo')).toBeTruthy();
    // 入口按钮摘要与移除都展示字典名。
    expect(text(tree)).toContain('#字母 Logo');
  });

  it('keeps desktop spec chips and restores mobile spec chips (no MobileSelect dropdown)', () => {
    let tree = render();
    // 桌面规格 chips 仍在（specButton 依赖它）；移动端回归 chips，不再用 MobileSelect 下拉。
    const specButton = (current: unknown, label: string) => {
      const node = nodes(current).find(node => node.type === 'button' && text(node).trim() === label && node.props['aria-label'] === undefined);
      if (!node) throw Error(`Missing spec button: ${label}`);
      return node;
    };
    specButton(tree, '≤500');
    // 移动端规格 chips 行：同一筛选容器内的独立一行，8 个规格桶齐全。
    const mobileSpecGroup = nodes(tree).find(node => node.props['aria-label'] === '按豆子数量筛选规格');
    expect(mobileSpecGroup).toBeTruthy();
    const mobileSpecValues = nodes(mobileSpecGroup)
      .filter(node => node.type === 'button' && node.props['aria-label'] === undefined)
      .map(node => text(node).trim());
    expect(mobileSpecValues).toEqual(['全部', '≤500', '≤1k', '≤2k', '≤3k', '≤5k', '≤8k', '>8k']);
    // 触控目标 ≥44px：移动端规格 chips 用 min-h-11。
    for (const chip of nodes(mobileSpecGroup).filter(node => node.type === 'button')) {
      expect(String(chip.props.className)).toContain('min-h-11');
    }
    // 点击移动端规格 chips 可筛选。
    nodes(mobileSpecGroup)
      .find(node => node.type === 'button' && text(node).trim() === '≤500')!.props.onClick();
    tree = render();
    const mobileGroup = nodes(tree).find(node => node.props['aria-label'] === '按豆子数量筛选规格')!;
    const pressed = nodes(mobileGroup).find(node => node.type === 'button' && node.props['aria-pressed'] === true);
    expect(text(pressed).trim()).toBe('≤500');
    specButton(tree, '全部').props.onClick(); tree = render();
    const resetGroup = nodes(tree).find(node => node.props['aria-label'] === '按豆子数量筛选规格')!;
    const pressedAll = nodes(resetGroup).find(node => node.type === 'button' && node.props['aria-pressed'] === true);
    expect(text(pressedAll).trim()).toBe('全部');
  });

  it('filters posts by the specs bead count and keeps unknown-spec posts only in 全部', () => {
    feed.posts = [post('1'), post('2'), post('3')];
    feed.posts[0]!.specs = { gridWidth: 10, gridHeight: 10, beadCount: 400, colorCount: 5 };
    feed.posts[1]!.specs = { gridWidth: 60, gridHeight: 60, beadCount: 7000, colorCount: 12 };
    // 规格按钮没有 aria-label；用这一点区分同为"全部"文案的标签筛选按钮。
    const specButton = (tree: unknown, label: string) => {
      const node = nodes(tree).find(node => node.type === 'button' && text(node).trim() === label && node.props['aria-label'] === undefined);
      if (!node) throw Error(`Missing spec button: ${label}`);
      return node;
    };
    specButton(render(), '≤500').props.onClick();
    let tree = render();
    expect(cards(tree).map(card => card.props.post.id)).toEqual(['1']);
    specButton(tree, '≤8k').props.onClick(); tree = render();
    expect(cards(tree).map(card => card.props.post.id)).toEqual(['2']);
    // 规格未知（旧数据未回填）的作品不进任何非"全部"桶。
    specButton(tree, '>8k').props.onClick(); tree = render();
    expect(cards(tree)).toHaveLength(0);
    specButton(tree, '全部').props.onClick(); tree = render();
    expect(cards(tree)).toHaveLength(3);
  });

  it('falls back to post specs (or 未知) in the detail dialog when no grid project loads', async () => {
    const withSpecs = { ...feed.posts[0]!, specs: { gridWidth: 12, gridHeight: 34, beadCount: 456, colorCount: 7 } };
    api.getCommunityPost.mockResolvedValue({ ok: true, data: withSpecs });
    api.loadCommunityPattern.mockResolvedValue({ project: null, fromOwnerLibrary: false });
    cards(render())[0].props.onOpen(withSpecs); await flush();
    let tree = render();
    const specOf = (dialog: Node) => nodes(dialog).find(node => node.props['aria-label'] === '图纸规格')!;
    expect(text(specOf(nodes(tree).find(node => node.type === 'dialog')!))).toContain('12×34 格');
    expect(text(specOf(nodes(tree).find(node => node.type === 'dialog')!))).toContain('456 颗');
    expect(text(specOf(nodes(tree).find(node => node.type === 'dialog')!))).toContain('7 种');
    const { specs: _omitted, ...legacy } = withSpecs;
    void _omitted;
    api.getCommunityPost.mockResolvedValue({ ok: true, data: legacy });
    cards(render())[0].props.onOpen(legacy); await flush();
    tree = render();
    const specText = text(specOf(nodes(tree).find(node => node.type === 'dialog')!));
    expect(specText).toContain('未知 格');
    expect(specText).toContain('未知 颗');
    expect(specText).toContain('未知 种');
  });
});
