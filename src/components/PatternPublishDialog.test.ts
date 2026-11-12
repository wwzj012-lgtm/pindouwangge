import { beforeEach, describe, expect, it, vi } from 'vitest';

// 与 CommunityView.ui.test.ts 同款 hook mock：useState/useRef 跨渲染持久槽位，
// useEffect 真执行（依赖变化才跑），保证编辑模式的预填 effect 能写入状态。
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as unknown[][] }));
const communityApi = vi.hoisted(() => ({ checkCommunityModeration: vi.fn() }));
vi.mock('react', () => ({
  default: {},
  useState: <T,>(initial: T | (() => T)) => {
    const slot = hooks.cursor++;
    if (!(slot in hooks.slots)) hooks.slots[slot] = typeof initial === 'function' ? (initial as () => T)() : initial;
    const set = (next: T | ((current: T) => T)) => {
      hooks.slots[slot] = typeof next === 'function' ? (next as (current: T) => T)(hooks.slots[slot] as T) : next;
    };
    return [hooks.slots[slot], set] as const;
  },
  useRef: <T,>(initial: T) => {
    const slot = hooks.cursor++;
    if (!(slot in hooks.slots)) hooks.slots[slot] = { current: initial };
    return hooks.slots[slot] as { current: T };
  },
  useEffect: (effect: () => void | (() => void), dependencies: readonly unknown[]) => {
    const slot = hooks.cursor++;
    const previous = hooks.effects[slot];
    const changed = !previous || previous.length !== dependencies.length || previous.some((value, index) => value !== dependencies[index]);
    hooks.effects[slot] = [...dependencies];
    if (changed) effect();
  },
  useCallback: <T,>(fn: T) => fn,
}));

vi.mock('../utils/communityApi', () => ({ checkCommunityModeration: communityApi.checkCommunityModeration }));

import { PatternPublishDialog, moderationViolationMessage, type PatternEditingPost } from './PatternPublishDialog';

type Node = { type?: unknown; props: Record<string, any> };
const nodes = (tree: unknown): Node[] => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' && 'props' in tree ? [tree as Node, ...nodes((tree as Node).props.children)] : [];
const text = (tree: unknown): string => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' && 'props' in tree ? text((tree as Node).props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const button = (tree: unknown, label: string) => { const node = nodes(tree).find(node => node.type === 'button' && text(node).trim() === label); if (!node) throw Error(`Missing button: ${label}`); return node; };

const editingPost: PatternEditingPost = {
  id: 'post_abc123456789',
  patternId: 'pattern-1',
  title: '妲己·时之彼端',
  description: '',
  visibility: 'public',
  tags: ['像素拼豆', '自定标签甲'],
};
const props = { record: null, busy: false, error: null, onClose: vi.fn(), onSubmit: vi.fn() };
const render = () => { hooks.cursor = 0; return PatternPublishDialog({ ...props, editingPost }) ?? null; };
// 首渲跑预填 effect 写入状态，二渲才携带新状态建树（真实 React 里 effect 触发重渲染）。
const renderPrimed = () => { render(); return render(); };

describe('PatternPublishDialog custom tag chips', () => {
  beforeEach(() => {
    hooks.cursor = 0; hooks.slots = []; hooks.effects = [];
    vi.clearAllMocks();
    communityApi.checkCommunityModeration.mockResolvedValue({ ok: true, status: 200, data: { violations: [] } });
  });

  it('renders custom tags as removable chips instead of swallowing them silently', () => {
    const tree = renderPrimed();
    // 预设标签选中态照旧
    const preset = nodes(tree).find(node => node.type === 'button' && text(node).trim() === '像素拼豆');
    expect(preset?.props['aria-pressed']).toBe(true);
    // 自定义标签必须以可移除 chip 的形式可见——这是“点了没反应”的回归点
    const remove = nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === '移除标签 自定标签甲');
    expect(remove).toBeTruthy();
    expect(text(tree)).toContain('自定标签甲');
    expect(text(tree)).toContain('标签（2/5）');
  });

  it('adds a typed custom tag via the plus button and clears the draft', () => {
    let tree = renderPrimed();
    const input = nodes(tree).find(node => node.type === 'input' && node.props['aria-label'] === '自定义标签');
    expect(input).toBeTruthy();
    input!.props.onChange({ target: { value: '星际' } });
    tree = render();
    const add = nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === '添加标签');
    expect(add).toBeTruthy();
    add!.props.onClick();
    tree = render();
    expect(nodes(tree).some(node => node.props['aria-label'] === '移除标签 星际')).toBe(true);
    expect(text(tree)).toContain('标签（3/5）');
    const draft = nodes(tree).find(node => node.type === 'input' && node.props['aria-label'] === '自定义标签');
    expect(draft!.props.value).toBe('');
  });

  it('removes a custom tag via its chip button', () => {
    let tree = renderPrimed();
    const remove = nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === '移除标签 自定标签甲')!;
    remove.props.onClick();
    tree = render();
    expect(nodes(tree).some(node => node.props['aria-label'] === '移除标签 自定标签甲')).toBe(false);
    expect(text(tree)).toContain('标签（1/5）');
  });
});

describe('PatternPublishDialog moderation pre-check', () => {
  beforeEach(() => {
    hooks.cursor = 0; hooks.slots = []; hooks.effects = [];
    vi.clearAllMocks();
    communityApi.checkCommunityModeration.mockResolvedValue({ ok: true, status: 200, data: { violations: [] } });
  });

  const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const confirm = async (tree: unknown): Promise<unknown> => {
    button(tree, '保存修改').props.onClick();
    await flush();
    return render();
  };

  it('blocks submit and lists every matched word when the pre-check hits banned words', async () => {
    communityApi.checkCommunityModeration.mockResolvedValue({
      ok: true, status: 200,
      data: { violations: [{ field: 'title', word: '坏词' }, { field: 'tag', word: '黑词' }] },
    });
    const tree = await confirm(renderPrimed());
    expect(communityApi.checkCommunityModeration).toHaveBeenCalledWith({ title: editingPost.title, tags: editingPost.tags });
    expect(props.onSubmit).not.toHaveBeenCalled();
    // role="alert" 错误区逐词提示（字段 + 命中词）。
    expect(text(tree)).toContain('作品名称包含违禁词“坏词”');
    expect(text(tree)).toContain('标签包含违禁词“黑词”');
    expect(moderationViolationMessage([{ field: 'tag', word: '黑词' }])).toContain('标签包含违禁词“黑词”');
  });

  it('submits normally when the pre-check passes', async () => {
    const tree = await confirm(renderPrimed());
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: editingPost.title, tags: editingPost.tags }));
    expect(text(tree)).not.toContain('违禁词');
  });

  it('does not block publish when the moderation service is unavailable (backend still enforces)', async () => {
    communityApi.checkCommunityModeration.mockResolvedValue({ ok: false, status: 0, error: '无法连接后台服务' });
    const tree = await confirm(renderPrimed());
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(text(tree)).not.toContain('违禁词');
    void tree;
  });
});
