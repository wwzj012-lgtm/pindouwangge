import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredPatternProject } from '../utils/patternGridCodec';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as unknown[][] }));
const auth = vi.hoisted(() => ({ currentUser: { uid: 'user-1', displayName: 'User one' } as { uid: string; displayName?: string } | null }));
const history = vi.hoisted(() => ({
  getUserExportedPatterns: vi.fn(), getPatternProject: vi.fn(), getExportedPatternPreview: vi.fn(),
  normalizePatternTitle: vi.fn((value: string) => value.trim()), patternDeletionActions: vi.fn(() => []),
  requiresExplicitCloudBinding: vi.fn(() => false), retryPatternCloudSync: vi.fn(), renameExportedPattern: vi.fn(),
  deleteCloudExportedPatternAndLocal: vi.fn(), deleteLocalExportedPatternCopy: vi.fn(), markExportedPatternPublished: vi.fn(),
}));
const community = vi.hoisted(() => ({
  listFavoriteCommunityPosts: vi.fn(), setCommunityPostVisibility: vi.fn(), withdrawCommunityPost: vi.fn(),
  uploadCommunityAsset: vi.fn(), publishCommunityPost: vi.fn(),
}));
const renderCommunityPattern = vi.hoisted(() => vi.fn());

vi.mock('react', () => {
  const useEffect = (effect: () => void | (() => void), dependencies: readonly unknown[]) => {
    const slot = hooks.cursor++;
    const previous = hooks.effects[slot];
    const changed = !previous || previous.length !== dependencies.length || previous.some((value, index) => value !== dependencies[index]);
    hooks.effects[slot] = [...dependencies];
    if (changed) effect();
  };
  // ErrorBoundary 是 class 组件，裸 mock 的 react 模块必须提供 Component，
  // 否则 `class ... extends Component` 在模块求值阶段就会拿到 undefined。
  class Component {
    props: any;
    state: any;
    constructor(props: any) { this.props = props; this.state = {}; }
    setState(next: any) {
      this.state = { ...this.state, ...(typeof next === 'function' ? next(this.state) : next) };
    }
  }
  return {
    Component, default: {}, useEffect, useLayoutEffect: useEffect, useRef: <T,>(initial: T) => {
      const slot = hooks.cursor++;
      if (!(slot in hooks.slots)) hooks.slots[slot] = { current: initial };
      return hooks.slots[slot] as { current: T };
    }, useState: <T,>(initial: T | (() => T)) => {
      const slot = hooks.cursor++;
      if (!(slot in hooks.slots)) hooks.slots[slot] = typeof initial === 'function' ? (initial as () => T)() : initial;
      const set = (next: T | ((current: T) => T)) => {
        const current = hooks.slots[slot] as T;
        hooks.slots[slot] = typeof next === 'function' ? (next as (current: T) => T)(current) : next;
      };
      return [hooks.slots[slot] as T, set] as const;
    }, useCallback: <T,>(fn: T) => fn, useSyncExternalStore: <T,>(_subscribe: unknown, getSnapshot: () => T) => getSnapshot(),
  };
});
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ currentUser: auth.currentUser, userProfile: null, isVip: false, isPro: false }) }));
vi.mock('../utils/patternHistory', () => history);
vi.mock('../utils/communityApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../utils/communityApi')>(), ...community }));
vi.mock('../utils/communityPatternSnapshot', () => ({ renderCommunityPattern }));
vi.mock('../utils/beadInventory', () => ({ getBeadInventorySnapshot: () => ({}), getServerBeadInventorySnapshot: () => ({}), subscribeBeadInventory: () => () => {} }));
vi.mock('../utils/dateUtils', () => ({ formatChinaDate: () => '2026-10-24' }));

import { UserProfileModal } from './UserProfileModal';

type Node = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
const project = (): StoredPatternProject & { completionStatus: 'COMPLETED'; paidNonEmptyBeads: number } => ({
  completionStatus: 'COMPLETED', paidNonEmptyBeads: 1,
  version: 2, name: 'Full project', width: 1, height: 1, boardSize: 29, brand: 'CUSTOM', grid: [['red']],
  palette: [{ id: 'red', code: 'R1', name: 'Red', hex: '#ff0000', rgb: [255, 0, 0], brand: 'CUSTOM' }], createdAt: 1,
  settings: { width: 1, height: 1, boardSize: 29, brand: 'CUSTOM', keepAspectRatio: true, dither: 'none', colorLimit: 1, brightness: 0, contrast: 0, saturation: 0, transparentCutoff: 0, colorMatchAlgo: 'rgb', sharpening: 0, outlineBoost: false, chromaKeyColor: null, chromaKeyTolerance: 0 },
});
const record = (overrides: Record<string, unknown> = {}) => ({
  id: 'profile-pattern', title: 'Profile work', width: 1, height: 1, totalBeads: 1, createdAt: 1, updatedAt: 1,
  syncState: 'synced', hasCloudCopy: true, hasLocalCopy: true, userId: 'user-1', status: 0, ...overrides,
});
const flush = async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); };
const text = (node: unknown): string => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' && 'props' in node ? text((node as Node).props?.children) : '';
const find = (node: unknown, predicate: (candidate: Node) => boolean): Node => {
  if (Array.isArray(node)) { for (const child of node) { try { return find(child, predicate); } catch { /* continue */ } } }
  if (node && typeof node === 'object' && 'props' in node) {
    const candidate = node as Node;
    if (predicate(candidate)) return candidate;
    const children = candidate.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) { try { return find(child, predicate); } catch { /* continue */ } }
  }
  throw new Error('Expected node was not found.');
};
const button = (tree: unknown, label: string) => find(tree, (node) => node.type === 'button' && text(node).trim() === label);
const dialog = (tree: unknown) => find(tree, (node) => typeof node.props?.onSubmit === 'function' && Boolean((node.props?.record as { id?: string } | null)?.id));

const props = { isOpen: true, onClose: vi.fn(), onOpenAccountManagement: vi.fn(), onContinueEditing: vi.fn(), onOpenCommunity: vi.fn() };
const render = (): unknown => { hooks.cursor = 0; return UserProfileModal(props); };
const load = async (value: Record<string, unknown>): Promise<unknown> => { history.getUserExportedPatterns.mockResolvedValue([value]); const tree = render(); await flush(); return render() ?? tree; };

describe('UserProfileModal in-place publication', () => {
  beforeEach(() => {
    hooks.cursor = 0; hooks.slots = []; hooks.effects = [];
    auth.currentUser = { uid: 'user-1', displayName: 'User one' };
    Object.values(history).forEach((mock) => { if (typeof mock === 'function' && 'mockReset' in mock) mock.mockReset(); });
    Object.values(community).forEach((mock) => mock.mockReset());
    history.getExportedPatternPreview.mockResolvedValue(null);
    history.getPatternProject.mockResolvedValue(project());
    history.markExportedPatternPublished.mockResolvedValue(null);
    history.patternDeletionActions.mockReturnValue([]);
    history.requiresExplicitCloudBinding.mockReturnValue(false);
    community.publishCommunityPost.mockImplementation(async (input) => ({ ok: true, data: { post: { id: 'community-profile', visibility: input.visibility } } }));
    community.uploadCommunityAsset.mockResolvedValue({ ok: true, data: { asset: { id: 'asset-profile' } } });
    renderCommunityPattern.mockResolvedValue(new Blob(['lossless'], { type: 'image/png' }));
  });

  it('keeps the library open and shows an inline lock message for incomplete records', async () => {
    let tree = await load(record({ completionStatus: 'DRAFT' }));
    (button(tree, '发布').props?.onClick as () => void)();
    tree = render();
    expect(text(tree)).toContain('完成图纸后解锁发布。');
    expect(() => dialog(tree)).toThrow();
    expect(history.getPatternProject).not.toHaveBeenCalled();
  });

  it('publishes privately in place through the shared lossless helper', async () => {
    let tree = await load(record({ completionStatus: 'COMPLETED', paidNonEmptyBeads: 1 }));
    (button(tree, '发布').props?.onClick as () => void)();
    tree = render();
    const publish = dialog(tree);
    (publish.props?.onSubmit as (metadata: unknown) => void)({ title: 'Private profile work', description: 'profile dialog', visibility: 'private', tags: ['人物'] });
    await flush();
    tree = render();
    expect(history.getPatternProject).toHaveBeenCalledWith('profile-pattern', 'user-1');
    expect(renderCommunityPattern).toHaveBeenCalledTimes(1);
    expect(community.publishCommunityPost).toHaveBeenCalledWith({ title: 'Private profile work', description: 'profile dialog', visibility: 'private', tags: ['人物'], workId: 'profile-pattern', assetId: 'asset-profile' });
    expect(history.markExportedPatternPublished).toHaveBeenCalledWith('profile-pattern', 'user-1', { id: 'community-profile', visibility: 'private' });
    expect(text(tree)).toContain('作品已私密发布');
    expect(() => button(tree, '发布')).toThrow();
  });

  it('locks duplicate profile submits and prevents post creation after an account switch', async () => {
    let resolveProject!: (value: StoredPatternProject) => void;
    history.getPatternProject.mockImplementation(() => new Promise((resolve) => { resolveProject = resolve; }));
    let tree = await load(record({ completionStatus: 'COMPLETED', paidNonEmptyBeads: 1 }));
    (button(tree, '发布').props?.onClick as () => void)();
    tree = render();
    const submit = dialog(tree).props?.onSubmit as (metadata: unknown) => void;
    const metadata = { title: 'Switch guard', description: '', visibility: 'public' as const, tags: [] };
    submit(metadata); submit(metadata);
    expect(history.getPatternProject).toHaveBeenCalledTimes(1);
    auth.currentUser = { uid: 'user-2', displayName: 'User two' };
    render();
    resolveProject(project());
    await flush();
    expect(community.uploadCommunityAsset).not.toHaveBeenCalled();
    expect(community.publishCommunityPost).not.toHaveBeenCalled();
  });
});
