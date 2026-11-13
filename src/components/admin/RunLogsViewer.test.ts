import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminRequest } from './adminRequest';
import { AdminButton } from './AdminPrimitives';
import { AdminPagination } from './shared/AdminPagination';
import { RunLogsViewer, isActivityItem, runLogQuery, runLogSources } from './RunLogsViewer';

// 复用 CommunityView.ui.test.ts 的 hooks 垫片模式：组件以普通函数直调、
// setState 写回 slot、useEffect 同步执行回调，使 load() 发出的请求可在 node
// 环境下被录制（renderToStaticMarkup 不运行 effect，无法断言请求参数）。
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[] }));
const calls = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(),
  useState: <T,>(initial: T | (() => T)) => {
    const slot = hooks.cursor++;
    if (!(slot in hooks.slots)) hooks.slots[slot] = typeof initial === 'function' && initial.length === 0 ? (initial as () => T)() : initial;
    return [hooks.slots[slot], (next: T | ((current: T) => T)) => { hooks.slots[slot] = typeof next === 'function' ? (next as (current: T) => T)(hooks.slots[slot] as T) : next; }];
  },
  useRef: <T,>(initial: T) => { const slot = hooks.cursor++; return (hooks.slots[slot] ??= { current: initial }); },
  useMemo: <T,>(calculate: () => T) => calculate(),
  useCallback: <T,>(callback: T) => callback,
  // effect 同步执行（忽略 cleanup）：让请求在渲染内即被录制，断言最新一次 URL。
  useEffect: (effect: () => unknown) => { void effect(); },
}));

const okRequest: AdminRequest = async <T,>() => ({
  ok: true,
  status: 200,
  data: {
    type: 'activity',
    items: [{
      id: 'a1', actorUid: 'normal', eventType: 'community_post.published',
      entityType: 'community_post', entityId: 'post_1', metadata: {}, occurredAt: 1700000000000,
    }],
    total: 1,
    limit: 30,
    offset: 0,
  } as unknown as T,
});

/** 按请求参数回显数据源的录制 mock：total=400 保证分页为多页。 */
const echoRequest: AdminRequest = async <T,>(path: string) => {
  calls.urls.push(path);
  const params = new URLSearchParams(path.slice(path.indexOf('?')));
  const type = params.get('type') === 'audit' ? 'audit' : 'activity';
  const limit = Number(params.get('limit') ?? '30');
  const offset = Number(params.get('offset') ?? '0');
  const items = type === 'audit'
    ? [{ id: 'b1', operatorUid: 'admin', operatorEmail: 'ops@example.com', action: 'roles.update', details: null, timestamp: 1700000000000 }]
    : [{ id: 'a1', actorUid: 'normal', eventType: 'community_post.published', entityType: 'community_post', entityId: 'post_1', metadata: {}, occurredAt: 1700000000000 }];
  return { ok: true, status: 200, data: { type, items, total: 400, limit, offset } as unknown as T };
};

type Node = { type?: unknown; props: Record<string, any> };
const nodes = (tree: unknown): Node[] => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' && 'props' in tree ? [tree as Node, ...nodes((tree as Node).props.children)] : [];
const text = (tree: unknown): string => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' && 'props' in tree ? text((tree as Node).props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
/** 直调组件函数重建元素树（hooks.cursor 归零复用同一组 slot）。 */
const renderViewer = (props: Record<string, unknown>) => { hooks.cursor = 0; return RunLogsViewer(props as any); };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const lastUrl = (): string => calls.urls[calls.urls.length - 1] ?? '';

describe('RunLogsViewer', () => {
  beforeEach(() => { hooks.cursor = 0; hooks.slots = []; calls.urls = []; });

  it('serializes the split-source query', () => {
    expect(runLogQuery('audit', 50, 10)).toBe('?type=audit&limit=50&offset=10');
    expect(runLogQuery('activity', 30, 0)).toBe('?type=activity&limit=30&offset=0');
  });

  it('discriminates activity rows from audit rows', () => {
    expect(isActivityItem({ id: '1', actorUid: null, eventType: 'x', entityType: null, entityId: null, metadata: {}, occurredAt: 1 })).toBe(true);
    expect(isActivityItem({ id: '2', operatorUid: null, operatorEmail: null, action: 'A', details: null, timestamp: 1 })).toBe(false);
    expect(runLogSources.map(source => source.id)).toEqual(['activity', 'audit']);
  });

  it('renders source tabs and the activity table', () => {
    const html = renderToStaticMarkup(React.createElement(RunLogsViewer, {
      request: okRequest,
      initialItems: [{ id: 'a1', actorUid: 'normal', eventType: 'community_post.published', entityType: 'community_post', entityId: 'post_1', metadata: {}, occurredAt: 1700000000000 }],
    }));
    expect(html).toContain('运行日志');
    expect(html).toContain('用户活动');
    expect(html).toContain('管理审计');
    expect(html).toContain('community_post.published');
    expect(html).toContain('normal');
  });

  it('resets the offset to 0 when switching log sources', async () => {
    const props = { request: echoRequest };
    let tree = renderViewer(props);
    await flush();
    tree = renderViewer(props);
    expect(lastUrl()).toBe('/api/admin/run-logs?type=activity&limit=30&offset=0');
    // 翻到 offset=150，模拟用户已深入第 6 页。
    const pagination = nodes(tree).find(node => node.type === AdminPagination);
    expect(pagination).toBeTruthy();
    pagination!.props.onPageChange(150);
    tree = renderViewer(props);
    await flush();
    expect(lastUrl()).toBe('/api/admin/run-logs?type=activity&limit=30&offset=150');
    // 切换数据源：onClick 必须同时重置 offset，否则以陈旧 offset=150 请求 audit 源。
    const auditTab = nodes(tree).find(node => node.type === AdminButton && text(node) === '管理审计');
    expect(auditTab).toBeTruthy();
    auditTab!.props.onClick();
    tree = renderViewer(props);
    await flush();
    expect(lastUrl()).toBe('/api/admin/run-logs?type=audit&limit=30&offset=0');
  });
});
