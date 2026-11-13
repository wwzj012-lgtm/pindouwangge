import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminUsers, UserOperationsOverview } from './AdminUsers';
import { emptyUserQuery, toggleUserSort, userQueryString, type UserQuery } from './adminUserModel';

vi.mock('../../context/AuthContext', () => ({useAuth:()=>({currentUser:{uid:'render-test'}})}));

describe('user list query serialization (batch 3 filters)', () => {
  it('serializes role/vip/memberType/date-range/sort into the users endpoint query', () => {
    const query: UserQuery = { ...emptyUserQuery(), role: 'admin', vip: 'false', memberType: '2', registeredFrom: '2026-07-01', registeredTo: '2026-07-12', sortBy: 'credit_balance', sortDir: 'asc' };
    const params = new URLSearchParams(userQueryString(query));
    expect(params.get('role')).toBe('admin');
    expect(params.get('vip')).toBe('false');
    expect(params.get('memberType')).toBe('2');
    expect(params.get('registeredFrom')).toBe('2026-07-01');
    expect(params.get('registeredTo')).toBe('2026-07-12');
    expect(params.get('sortBy')).toBe('credit_balance');
    expect(params.get('sortDir')).toBe('asc');
  });
  it('omits unset filters and keeps default sort', () => {
    const params = new URLSearchParams(userQueryString(emptyUserQuery()));
    expect(params.has('role')).toBe(false);
    expect(params.has('vip')).toBe(false);
    expect(params.has('memberType')).toBe(false);
    expect(params.get('sortBy')).toBe('registered_at');
    expect(params.get('sortDir')).toBe('desc');
  });
  it('toggles sort direction on the same column and starts ascending on a new one', () => {
    const base = emptyUserQuery();
    expect(toggleUserSort(base, 'registered_at')).toEqual({ sortBy: 'registered_at', sortDir: 'asc' });
    expect(toggleUserSort({ ...base, sortBy: 'registered_at', sortDir: 'asc' }, 'registered_at')).toEqual({ sortBy: 'registered_at', sortDir: 'desc' });
    expect(toggleUserSort({ ...base, sortBy: 'registered_at', sortDir: 'desc' }, 'credit_balance')).toEqual({ sortBy: 'credit_balance', sortDir: 'asc' });
  });
});

describe('AdminUsers filter and batch surface', () => {
  it('renders the new filters, sortable header and CSV export entry', () => {
    const html = renderToStaticMarkup(React.createElement(AdminUsers, { request: vi.fn() as never }));
    expect(html).toContain('data-filter-role');
    expect(html).toContain('data-filter-vip');
    expect(html).toContain('data-filter-member-type');
    expect(html).toContain('data-filter-registered-from');
    expect(html).toContain('data-filter-registered-to');
    expect(html).toContain('data-filter-sort-by');
    expect(html).toContain('data-filter-sort-dir');
    expect(html).toContain('data-csv-export="users"');
  });
  it('visual polish: no query button, batch bar hidden at zero selection, page title deduplicated', () => {
    const html = renderToStaticMarkup(React.createElement(AdminUsers, { request: vi.fn() as never }));
    // 筛选收敛：无"查询"提交按钮（防抖即时生效），重置保留，更多筛选折叠存在。
    expect(html).not.toContain('data-users-query');
    expect(html).toContain('data-users-reset');
    expect(html).toContain('data-more-filters');
    // 批量条：selectedCount = 0 时不渲染。
    expect(html).not.toContain('data-batch-bar');
    // 页头去重："用户与会员"卡片标题已删除（页内唯一大标题在顶栏）。
    expect(html).not.toContain('用户与会员');
  });
});

describe('UserOperationsOverview batch-3 additions', () => {
  it('shows explicit counts, last-active and recent credit adjustments when provided', () => {
    const detail = {
      user: { uid: 'u1', email: 'u1@example.invalid' },
      tags: [], notes: [], moderation: { status: 'active' as const, reason: '' },
      worksCount: 3, postsCount: 5, lastActiveAt: 1_800_000_000_000,
      recentCreditLedger: [
        { id: 'aca_1', uid: 'u1', operatorUid: 'op', deltaUnits: 120, reason: '补偿发放', beforeAvailableUnits: 0, afterAvailableUnits: 120, createdAt: 1_799_000_000_000 },
        { id: 'aca_2', uid: 'u1', operatorUid: 'op', deltaUnits: -30, reason: '误发回收', beforeAvailableUnits: 120, afterAvailableUnits: 90, createdAt: 1_798_000_000_000 },
      ],
    };
    const html = renderToStaticMarkup(React.createElement(UserOperationsOverview, { detail }));
    expect(html).toContain('data-user-works-count');
    expect(html).toContain('>3<');
    expect(html).toContain('data-user-posts-count');
    expect(html).toContain('data-user-last-active');
    expect(html).toContain('data-recent-credit-ledger');
    expect(html).toContain('补偿发放');
    expect(html).toContain('+120');
    expect(html).toContain('0 → 120');
  });
  it('does not invent ledger entries or last-active when the server omits them', () => {
    const detail = {
      user: { uid: 'u1', email: 'u1@example.invalid' },
      tags: [], notes: [], moderation: { status: 'active' as const, reason: '' },
    };
    const html = renderToStaticMarkup(React.createElement(UserOperationsOverview, { detail }));
    expect(html).toContain('data-user-last-active');
    expect(html).toContain('暂无积分调整记录');
    expect(html).not.toContain('data-recent-credit-ledger');
  });
});
