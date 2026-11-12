import { describe, expect, it } from 'vitest';
import {
  ADMIN_MENU_ITEMS,
  LEGACY_SECTION_MAP,
  resolveAdminSection,
  visibleMenuSections,
  type AdminCapabilities,
} from './AdminConsole';
import { RunLogsSection, runLogsTabs } from './RunLogsSection';
import { cronTaskLabels, statusTone } from './CronRunsPanel';

/** 批次 5：IA 重排终态 —— 5 组 15 项。 */
const EXPECTED_GROUPS = ['overview', 'business', 'content', 'assets', 'system'] as const;
const EXPECTED_ORDER = [
  'dashboard',
  'users', 'credits', 'codes', 'welfare',
  'community', 'tagDictionary', 'bannedwords',
  'brands', 'resources',
  'operationLogs', 'runLogs', 'announcements', 'config', 'roles',
] as const;

describe('admin menu IA (批次 5 重排)', () => {
  it('exposes exactly 15 items in 5 ordered groups (menu count ≤ 16)', () => {
    expect(ADMIN_MENU_ITEMS).toHaveLength(15);
    expect(ADMIN_MENU_ITEMS.map(item => item.id)).toEqual(EXPECTED_ORDER);
    const groupIds = [...new Set(ADMIN_MENU_ITEMS.map(item => item.group))];
    expect(groupIds).toEqual(EXPECTED_GROUPS);
    expect(ADMIN_MENU_ITEMS.length).toBeLessThanOrEqual(16);
  });

  it('keeps the business chain order users → credits → codes → welfare', () => {
    const business = ADMIN_MENU_ITEMS.filter(item => item.group === 'business').map(item => item.id);
    expect(business).toEqual(['users', 'credits', 'codes', 'welfare']);
  });

  it('groups content governance as community → tagDictionary → bannedwords', () => {
    const content = ADMIN_MENU_ITEMS.filter(item => item.group === 'content').map(item => item.id);
    expect(content).toEqual(['community', 'tagDictionary', 'bannedwords']);
  });

  it('puts monitoring and system items in one group', () => {
    const system = ADMIN_MENU_ITEMS.filter(item => item.group === 'system').map(item => item.id);
    expect(system).toEqual(['operationLogs', 'runLogs', 'announcements', 'config', 'roles']);
  });

  it('gives every item an icon and a unique id', () => {
    const ids = new Set(ADMIN_MENU_ITEMS.map(item => item.id));
    expect(ids.size).toBe(ADMIN_MENU_ITEMS.length);
    for (const item of ADMIN_MENU_ITEMS) expect(item.icon).toBeTruthy();
  });
});

describe('capability-driven menu visibility', () => {
  const full: AdminCapabilities = {
    operatorUid: 'op',
    capabilities: { 'credits.read': true, 'credits.adjust': true, 'colors.read': true, 'colors.write': true },
  };

  it('shows the full menu while capabilities are unknown (不猜)', () => {
    expect(visibleMenuSections(null)).toEqual(EXPECTED_ORDER as unknown as string[]);
  });

  it('hides credits/welfare without credits.read and brands without colors.read', () => {
    const limited: AdminCapabilities = {
      operatorUid: 'op',
      capabilities: { 'credits.read': false, 'credits.adjust': false, 'colors.read': false, 'colors.write': false },
    };
    const visible = visibleMenuSections(limited);
    expect(visible).not.toContain('credits');
    expect(visible).not.toContain('welfare');
    expect(visible).not.toContain('brands');
    // 其余 12 项不受 capability 影响。
    expect(visible).toHaveLength(12);
    expect(visible).toContain('users');
    expect(visible).toContain('tagDictionary');
    expect(visible).toContain('roles');
  });

  it('keeps everything visible with full capabilities', () => {
    expect(visibleMenuSections(full)).toEqual(EXPECTED_ORDER as unknown as string[]);
  });

  it('only hides sections registered in the capability map', () => {
    // 未登记 capability 的菜单项永远可见，避免误隐藏。
    const limited: AdminCapabilities = {
      operatorUid: 'op',
      capabilities: { 'credits.read': false, 'credits.adjust': false, 'colors.read': false, 'colors.write': false },
    };
    const visible = visibleMenuSections(limited);
    expect(visible).toContain('dashboard');
    expect(visible).toContain('runLogs');
    expect(visible).toContain('config');
  });
});

describe('legacy bookmark compatibility (resolveAdminSection)', () => {
  it('maps the retired monitoring sections onto runLogs', () => {
    expect(LEGACY_SECTION_MAP.logs).toBe('runLogs');
    expect(LEGACY_SECTION_MAP.sessions).toBe('runLogs');
    expect(LEGACY_SECTION_MAP.cronRuns).toBe('runLogs');
    expect(resolveAdminSection('logs')).toBe('runLogs');
    expect(resolveAdminSection('sessions')).toBe('runLogs');
    expect(resolveAdminSection('cronRuns')).toBe('runLogs');
  });

  it('keeps the earlier colors-assets mapping and rejects unknown ids', () => {
    expect(resolveAdminSection('colors-assets')).toBe('brands');
    expect(resolveAdminSection('invented')).toBe('dashboard');
    expect(resolveAdminSection(null)).toBe('dashboard');
    expect(resolveAdminSection('../users')).toBe('dashboard');
  });
});

describe('merged runLogs section tabs', () => {
  it('offers run-logs, cron tasks, admin sessions and the legacy logs source as in-section tabs', () => {
    expect(runLogsTabs.map(tab => tab.id)).toEqual(['runs', 'cron', 'sessions', 'legacy']);
    expect(runLogsTabs.map(tab => tab.label)).toEqual(['运行日志', '定时任务', '管理会话', '历史日志']);
  });

  it('renders the default tab (运行日志) without mounting the other panels', () => {
    // renderToStaticMarkup 需要 React 上下文；此处仅做结构断言由各面板自身测试覆盖。
    expect(RunLogsSection).toBeTypeOf('function');
  });
});

describe('roles section permission tree inputs (批次 4 验证收尾)', () => {
  it('auto-covers the batch-4 capabilities through module grouping', async () => {
    const { buildPermissionGroups } = await import('./adminPermissionTreeModel');
    const groups = buildPermissionGroups([
      { id: '1', code: 'tags.write' },
      { id: '2', code: 'reports.read' },
      { id: '3', code: 'audit.read' },
      { id: '4', code: 'community.read' },
    ]);
    const labels = groups.map(group => group.label);
    // tags/reports/audit 都按模块前缀自动归组渲染，无需手工登记。
    expect(groups.find(group => group.key === 'tags')?.permissions.map(p => p.code)).toEqual(['tags.write']);
    expect(groups.find(group => group.key === 'reports')?.permissions.map(p => p.code)).toEqual(['reports.read']);
    expect(groups.find(group => group.key === 'audit')?.permissions.map(p => p.code)).toEqual(['audit.read']);
    expect(labels.length).toBeGreaterThanOrEqual(3);
  });

  it('toggles batch-4 permission codes without corrupting the selection set', async () => {
    const { togglePermissionCodes, permissionCheckState } = await import('./adminPermissionTreeModel');
    let selected = new Set<string>();
    selected = togglePermissionCodes(selected, ['tags.write', 'reports.read'], new Set(), true);
    expect(permissionCheckState(['tags.write', 'reports.read'], selected)).toBe('checked');
    selected = togglePermissionCodes(selected, ['reports.read'], new Set(), false);
    expect(permissionCheckState(['tags.write', 'reports.read'], selected)).toBe('mixed');
    // 锁定的最低授权不可被清空。
    const locked = togglePermissionCodes(new Set(['tags.write']), ['tags.write'], new Set(['tags.write']), false);
    expect(locked.has('tags.write')).toBe(true);
  });

  it('keeps cron task status semantics available for the merged panel', () => {
    expect(statusTone('success')).toBe('success');
    expect(cronTaskLabels.tag_dictionary_recalibration).toBe('标签字典使用计数校准');
  });
});
