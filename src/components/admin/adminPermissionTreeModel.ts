export interface PermissionTreeItem {
  id: string;
  code: string;
  displayName?: string;
  description?: string;
}

export interface PermissionTreeGroup {
  key: string;
  label: string;
  permissions: PermissionTreeItem[];
}

const moduleLabels: Record<string, string> = {
  dashboard: '运营概览',
  announcements: '公告管理',
  users: '用户管理',
  admins: '后台账号授权',
  roles: '角色与权限',
  community: '社区管理',
  codes: '卡密管理',
  vip: '会员管理',
  reports: '内容举报',
  config: '系统配置',
  colors: '色卡管理',
  storage: '资源管理',
  logs: '操作日志',
};

const actionLabels: Record<string, string> = {
  read: '读取',
  write: '写入',
  create: '创建',
  update: '更新',
  delete: '删除',
  moderate: '审核处理',
  publish: '发布',
  manage: '管理',
  assign: '分配',
};

export function permissionModuleLabel(key: string): string {
  return moduleLabels[key] ?? '其他权限';
}

export function permissionDisplayLabel(permission: PermissionTreeItem): string {
  const displayName = permission.displayName?.trim();
  if (displayName && /[\u3400-\u9fff]/u.test(displayName)) return displayName;
  const action = permission.code.split('.').slice(1).join('.');
  return actionLabels[action] ?? actionLabels[action.split('.').at(-1) ?? ''] ?? '其他操作';
}

export function buildPermissionGroups(permissions: readonly PermissionTreeItem[]): PermissionTreeGroup[] {
  const groups = new Map<string, PermissionTreeItem[]>();
  for (const permission of permissions) {
    const module = permission.code.split('.')[0] || 'other';
    const items = groups.get(module) ?? [];
    items.push(permission);
    groups.set(module, items);
  }
  return [...groups.entries()]
    .map(([key, items]) => ({
      key,
      label: permissionModuleLabel(key),
      permissions: items.slice().sort((a, b) => a.code.localeCompare(b.code)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN') || a.key.localeCompare(b.key));
}

export function permissionMatchesSearch(permission: PermissionTreeItem, moduleLabel: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [permission.code, permission.displayName, permission.description, moduleLabel, permissionDisplayLabel(permission)]
    .some(value => value?.toLocaleLowerCase().includes(needle));
}

export function permissionCheckState(codes: readonly string[], selected: ReadonlySet<string>): 'checked' | 'mixed' | 'empty' {
  const selectedCount = codes.reduce((count, code) => count + Number(selected.has(code)), 0);
  return selectedCount === 0 ? 'empty' : selectedCount === codes.length ? 'checked' : 'mixed';
}

export function togglePermissionCodes(
  selected: ReadonlySet<string>,
  codes: readonly string[],
  lockedCodes: ReadonlySet<string>,
  checked: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const code of codes) {
    if (lockedCodes.has(code)) continue;
    if (checked) next.add(code);
    else next.delete(code);
  }
  return next;
}

export function unknownGrantedCodes(permissions: readonly PermissionTreeItem[], selected: ReadonlySet<string>): string[] {
  const known = new Set(permissions.map(permission => permission.code));
  return [...selected].filter(code => !known.has(code)).sort((a, b) => a.localeCompare(b));
}
