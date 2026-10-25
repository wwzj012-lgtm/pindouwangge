import { describe, expect, it } from 'vitest';
import {
  buildPermissionGroups,
  permissionCheckState,
  permissionDisplayLabel,
  permissionMatchesSearch,
  togglePermissionCodes,
  unknownGrantedCodes,
} from './adminPermissionTreeModel';

const permissions = [
  { id: 'u-read', code: 'users.read', displayName: 'Users read' },
  { id: 'u-write', code: 'users.write', displayName: '用户资料写入' },
  { id: 'r-write', code: 'roles.write', displayName: 'Roles write' },
  { id: 'future', code: 'future.unknown', displayName: 'Future capability' },
];

describe('admin permission tree model', () => {
  it('groups only real permission entries and translates known modules/actions for display', () => {
    const groups = buildPermissionGroups(permissions);
    expect(groups.find(group => group.key === 'users')?.label).toBe('用户管理');
    expect(groups.find(group => group.key === 'users')?.permissions.map(item => item.code)).toEqual(['users.read', 'users.write']);
    expect(permissionDisplayLabel(permissions[0]!)).toBe('读取');
    expect(permissionDisplayLabel(permissions[1]!)).toBe('用户资料写入');
    expect(groups.find(group => group.key === 'future')?.label).toBe('其他权限');
    expect(permissionDisplayLabel(permissions[3]!)).toBe('其他操作');
    expect(permissions.map(item => item.code)).toEqual(['users.read', 'users.write', 'roles.write', 'future.unknown']);
  });

  it('searches localized labels and unchanged server identifiers', () => {
    expect(permissionMatchesSearch(permissions[0]!, '用户管理', '读取')).toBe(true);
    expect(permissionMatchesSearch(permissions[0]!, '用户管理', 'users.read')).toBe(true);
    expect(permissionMatchesSearch(permissions[1]!, '用户管理', '用户资料')).toBe(true);
    expect(permissionMatchesSearch(permissions[3]!, '其他权限', 'Future')).toBe(true);
  });

  it('reports empty, partial, and complete checkbox states', () => {
    expect(permissionCheckState(['a', 'b'], new Set())).toBe('empty');
    expect(permissionCheckState(['a', 'b'], new Set(['a']))).toBe('mixed');
    expect(permissionCheckState(['a', 'b'], new Set(['a', 'b']))).toBe('checked');
  });

  it('bulk changes only visible unlocked codes and preserves hidden/stale grants', () => {
    const selected = new Set(['users.read', 'locked.must_keep', 'other.hidden']);
    const locked = new Set(['locked.must_keep']);
    const cleared = togglePermissionCodes(selected, ['users.read', 'users.write'], locked, false);
    expect([...cleared].sort()).toEqual(['locked.must_keep', 'other.hidden']);
    const selectedAll = togglePermissionCodes(cleared, ['users.read', 'users.write'], locked, true);
    expect([...selectedAll].sort()).toEqual(['locked.must_keep', 'other.hidden', 'users.read', 'users.write']);
  });

  it('identifies grants missing from the current server catalog so callers can preserve or block saving', () => {
    expect(unknownGrantedCodes(permissions, new Set(['users.read', 'legacy.retained']))).toEqual(['legacy.retained']);
    expect(unknownGrantedCodes(permissions, new Set(['users.read']))).toEqual([]);
  });
});
