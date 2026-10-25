import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CommunityPost } from '../utils/communityApi';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[] }));
const feed = vi.hoisted(() => ({ posts: [] as CommunityPost[], nextCursor: null as string | null, isLoading: false, isLoadingMore: false, error: null as string | null, refresh: vi.fn(), loadMore: vi.fn(), updatePost: vi.fn() }));
const api = vi.hoisted(() => ({ getCommunityPost: vi.fn(), reactToCommunityPost: vi.fn(), loadCommunityPattern: vi.fn(), getApiToken: vi.fn(() => 'test-token') }));
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
vi.mock('../utils/communityApi', () => ({ getCommunityPost: api.getCommunityPost, reactToCommunityPost: api.reactToCommunityPost }));
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
  });

  it('renders all actual tags without slicing and combines tag filtering with search', () => {
    const tags = Array.from({ length: 30 }, (_, i) => `真实标签${i}`);
    feed.posts.push(post('4', tags));
    let tree = render();
    for (const tag of [...tags, '人物', '游戏', '花卉']) expect(nodes(tree).some(node => node.props['aria-label'] === `筛选标签：${tag}`)).toBe(true);
    expect(text(tree)).not.toContain('#社区作品');
    button(tree, '#人物').props.onClick(); tree = render();
    expect(cards(tree).map(card => card.props.post.id)).toEqual(['1']);
    const search = nodes(tree).find(node => node.type === 'input')!;
    search.props.onChange({ target: { value: '不存在' } }); tree = render();
    expect(cards(tree)).toHaveLength(0);
    button(tree, '清空筛选').props.onClick(); tree = render();
    expect(cards(tree)).toHaveLength(4);
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
    const onOpen = vi.fn(), onReaction = vi.fn(), value = post('1', ['人物', '游戏']);
    const tree = CommunityPostCard({ post: value, pending: false, onOpen, onReaction });
    const buttons = nodes(tree).filter(node => node.type === 'button');
    expect(buttons).toHaveLength(5);
    expect(buttons.filter(node => text(node).trim() === '查看图纸')).toHaveLength(1);
    expect(buttons.filter(node => String(node.props['aria-label']).startsWith('收藏：'))).toHaveLength(1);
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
});
