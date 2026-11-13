import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BatchActionBar, BatchOutcomeList } from './BatchActionBar';
import { buildUserBatchBody, parseBatchOutcome } from './adminUserModel';

describe('batch body building (users)', () => {
  it('wraps selected ids with the users entity', () => {
    expect(buildUserBatchBody('ban', ['a', 'b'], { reason: '违规' })).toEqual({ entity: 'users', op: 'ban', ids: ['a', 'b'], params: { reason: '违规' } });
    expect(buildUserBatchBody('unban', ['a']).params).toBeUndefined();
  });
  it('rejects empty or over-limit selections before any request is sent', () => {
    expect(() => buildUserBatchBody('ban', [])).toThrow();
    expect(() => buildUserBatchBody('ban', Array.from({ length: 101 }, (_v, i) => `u${i}`))).toThrow();
  });
});

describe('batch outcome parsing', () => {
  it('parses a partial-failure summary from the server', () => {
    const outcome = parseBatchOutcome({ total: 3, succeeded: 1, failed: [ { id: 'u1', error: '用户不存在' } ] });
    expect(outcome).toEqual({ total: 3, succeeded: 1, failed: [ { id: 'u1', error: '用户不存在' } ] });
  });
  it('returns null for malformed payloads instead of faking success', () => {
    expect(parseBatchOutcome(null)).toBeNull();
    expect(parseBatchOutcome({ total: '3', succeeded: 1, failed: [] })).toBeNull();
    expect(parseBatchOutcome({ total: 2, succeeded: 2, failed: 'nope' })).toBeNull();
  });
});

describe('BatchOutcomeList rendering', () => {
  it('summarizes successes and lists failures id by id', () => {
    const html = renderToStaticMarkup(React.createElement(BatchOutcomeList, {
      outcome: { total: 3, succeeded: 1, failed: [ { id: 'u1', error: '用户不存在' }, { id: 'u2', error: '不能操作当前管理员账号' } ] },
    }));
    expect(html).toContain('成功 1 项');
    expect(html).toContain('失败 2 项');
    expect(html).toContain('u1');
    expect(html).toContain('用户不存在');
    expect(html).toContain('不能操作当前管理员账号');
  });
  it('caps the failure list at ten entries with an overflow note', () => {
    const failed = Array.from({ length: 12 }, (_v, i) => ({ id: `u${i}`, error: '失败' }));
    const html = renderToStaticMarkup(React.createElement(BatchOutcomeList, { outcome: { total: 12, succeeded: 0, failed } }));
    expect((html.match(/u\d+/g) ?? []).length).toBeLessThanOrEqual(10);
    expect(html).toContain('其余 2 条失败');
  });
  it('shows a clean summary when nothing failed', () => {
    const html = renderToStaticMarkup(React.createElement(BatchOutcomeList, { outcome: { total: 2, succeeded: 2, failed: [] } }));
    expect(html).toContain('成功 2 项');
    expect(html).not.toContain('失败');
  });
});

describe('BatchActionBar rendering', () => {
  const actions = [ { key: 'ban', label: '封禁', requiresReason: true }, { key: 'unban', label: '解封' } ];
  it('renders nothing when nothing is selected (visual polish: no batch bar DOM at zero)', () => {
    const html = renderToStaticMarkup(React.createElement(BatchActionBar, {
      selectedCount: 0, actions, onRun: vi.fn(), onClear: vi.fn(),
    }));
    expect(html).toBe('');
    expect(html).not.toContain('data-batch-bar');
    expect(html).not.toContain('data-batch-action');
  });
  it('exposes the batch count for larger selections (fixed floating bar)', () => {
    const html = renderToStaticMarkup(React.createElement(BatchActionBar, {
      selectedCount: 7, actions, onRun: vi.fn(), onClear: vi.fn(),
    }));
    expect(html).toContain('已选 7 项');
    expect(html).toContain('data-batch-count');
    expect(html).toContain('data-batch-bar');
  });
});
