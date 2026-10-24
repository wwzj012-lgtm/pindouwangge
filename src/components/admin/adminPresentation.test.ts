import { describe, expect, it } from 'vitest';
import { adminErrorText, adminLabel, adminPageCount, adminPermissionLabel, adminRoleLabel } from './adminPresentation';

describe('admin display-only Chinese labels', () => {
  it.each(['active', 'disabled', 'archived', 'deleted', 'private', 'public', 'restricted', 'open', 'reviewing', 'resolved', 'rejected', 'approve', 'hide', 'remove', 'restore', 'feature', 'unfeature', 'work', 'post', 'comment', 'all', 'vip', 'pro'])('labels %s without mutating its submitted value', value => {
    const before = JSON.stringify({ status: value });
    expect(adminLabel(value)).toMatch(/[\u3400-\u9fff]/u);
    expect(JSON.stringify({ status: value })).toBe(before);
  });
  it('does not silently interpret unknown or missing values', () => {
    expect(adminLabel('future-status')).toBe('未知状态（future-status）');
    expect(adminLabel(null)).toBe('未提供');
  });
  it('maps known role codes while retaining Chinese custom names', () => {
    expect(adminRoleLabel('operations', 'Operations')).toBe('运营管理员');
    expect(adminRoleLabel('read_only', 'Read only')).toBe('只读管理员');
    expect(adminRoleLabel('custom', '特约审核员')).toBe('特约审核员');
    expect(adminRoleLabel('custom', 'Custom')).toBe('自定义角色（custom）');
    expect(adminPermissionLabel('users.read', 'Read users')).toBe('权限项（users.read）');
  });
  it('keeps an empty list on page one and computes the last page', () => {
    expect(adminPageCount(0)).toBe(1); expect(adminPageCount(21)).toBe(2);
    expect(adminPageCount(40)).toBe(2); expect(adminPageCount(21, 10)).toBe(3);
  });
  it('leads with Chinese and keeps English diagnostics in technical disclosure', () => {
    expect(adminErrorText('Forbidden')).toEqual({ summary: expect.stringContaining('操作未完成'), detail: 'Forbidden' });
    expect(adminErrorText('请稍后重试。')).toEqual({ summary: '请稍后重试。' });
  });
});
