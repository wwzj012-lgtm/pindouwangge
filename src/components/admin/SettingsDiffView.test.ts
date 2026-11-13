import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminRequest } from './adminRequest';
import {
  SettingsDiffView,
  fetchAllSettingKeys,
  SETTING_KEYS_MAX_PAGES,
  settingDiffLines,
  settingSnapshotText,
  type SettingHistoryItem,
  type SystemSettingItem,
} from './SettingsDiffView';

const settingKeys: SystemSettingItem[] = [
  { key: 'checkin_reward_cycle_units', value: [400, 500] },
  { key: 'site_notice', value: '欢迎' },
];

const historyItems: SettingHistoryItem[] = [{
  id: 'h1',
  actorUid: 'admin',
  action: 'settings.upsert',
  targetType: 'system_setting',
  key: 'checkin_reward_cycle_units',
  before: [400, 400],
  after: [400, 500],
  note: '调整签到奖励',
  createdAt: 1700000000000,
}];

const okRequest: AdminRequest = async <T,>(path: string) => {
  if (path.startsWith('/api/admin/system-settings/history')) {
    return { ok: true, status: 200, data: { items: historyItems, total: 1, limit: 50, offset: 0 } } as unknown as T;
  }
  return { ok: true, status: 200, data: { items: settingKeys, total: 2, limit: 200, offset: 0 } } as unknown as T;
};

describe('setting snapshot serialization', () => {
  it('formats scalars and pretty JSON and renders missing values as ∅', () => {
    expect(settingSnapshotText('文字')).toBe('文字');
    expect(settingSnapshotText([1, 2])).toBe(JSON.stringify([1, 2], null, 2));
    expect(settingSnapshotText(null)).toBe('∅');
    expect(settingSnapshotText(undefined)).toBe('∅');
  });
});

describe('settingDiffLines (红绿行 diff)', () => {
  it('marks removed lines red, added lines green and unchanged lines neutral', () => {
    const lines = settingDiffLines('a\nb\nc', 'a\nx\nc');
    expect(lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'x' },
      { kind: 'same', text: 'c' },
    ]);
  });
  it('handles pure additions and pure deletions', () => {
    expect(settingDiffLines('a', 'a\nb').map(l => l.kind)).toEqual(['same', 'added']);
    expect(settingDiffLines('a\nb', 'a').map(l => l.kind)).toEqual(['same', 'removed']);
    expect(settingDiffLines('∅', '新值').map(l => l.kind)).toEqual(['removed', 'added']);
    expect(settingDiffLines('same', 'same')).toEqual([{ kind: 'same', text: 'same' }]);
  });
});

describe('fetchAllSettingKeys（分页拉取设置键）', () => {
  const ok = (data: unknown) => ({ ok: true, status: 200, data });

  it('paginates with limit=100 and merges every page when total exceeds one page', async () => {
    const paths: string[] = [];
    const request: AdminRequest = async <T,>(path: string) => {
      paths.push(path);
      const offset = Number(new URL('https://x' + path).searchParams.get('offset'));
      const limit = Number(new URL('https://x' + path).searchParams.get('limit'));
      // total=150：第一页 100 条 + 第二页 50 条。
      const items = Array.from({ length: Math.min(100, 150 - offset) }, (_v, i) => ({ key: `setting_${offset + i}`, value: null }));
      return ok({ items, total: 150, limit, offset }) as unknown as T;
    };
    const keys = await fetchAllSettingKeys(request);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain('limit=100&offset=0');
    expect(paths[1]).toContain('limit=100&offset=100');
    expect(keys).toHaveLength(150);
    expect(keys[0]).toBe('setting_0');
    expect(keys[149]).toBe('setting_149');
  });

  it('stops after a single page when total fits, and never exceeds the safety cap', async () => {
    const paths: string[] = [];
    const request: AdminRequest = async <T,>(path: string) => {
      paths.push(path);
      const offset = Number(new URL('https://x' + path).searchParams.get('offset'));
      const items = Array.from({ length: 100 }, (_v, i) => ({ key: `setting_${offset + i}`, value: null }));
      return ok({ items, total: 9999, limit: 100, offset }) as unknown as T;
    };
    const keys = await fetchAllSettingKeys(request);
    expect(paths).toHaveLength(SETTING_KEYS_MAX_PAGES);
    expect(keys).toHaveLength(SETTING_KEYS_MAX_PAGES * 100);
  });

  it('throws with the backend error text when a page fails', async () => {
    const request: AdminRequest = async <T,>() => ({ ok: false, status: 400, error: 'limit 必须在 1-100 之间' } as unknown as T);
    await expect(fetchAllSettingKeys(request)).rejects.toThrow('limit 必须在 1-100 之间');
  });
});

describe('SettingsDiffView', () => {
  it('renders the key picker and the before/after diff with red-green rows', () => {
    const html = renderToStaticMarkup(React.createElement(SettingsDiffView, {
      request: okRequest,
      initialKeys: settingKeys.map(item => item.key),
      initialKey: 'checkin_reward_cycle_units',
      initialHistory: historyItems,
    }));
    expect(html).toContain('系统设置变更历史');
    expect(html).toContain('data-settings-key-select');
    expect(html).toContain('checkin_reward_cycle_units');
    expect(html).toContain('data-settings-diff="h1"');
    expect(html).toContain('admin-diff-row--removed');
    expect(html).toContain('admin-diff-row--added');
    expect(html).toContain('调整签到奖励');
  });

  it('renders the empty state for keys without settings.% audit rows', () => {
    const html = renderToStaticMarkup(React.createElement(SettingsDiffView, {
      request: okRequest,
      initialKeys: settingKeys.map(item => item.key),
      initialKey: 'site_notice',
      initialHistory: [],
    }));
    expect(html).toContain('data-admin-empty="settings-diff"');
    expect(html).toContain('还没有变更记录');
  });

  it('renders the error state when the history endpoint fails', () => {
    const failingRequest: AdminRequest = async <T,>(path: string) => {
      if (path.startsWith('/api/admin/system-settings/history')) {
        return { ok: false, status: 403, error: '拒绝访问' } as unknown as T;
      }
      return { ok: true, status: 200, data: { items: settingKeys, total: 2, limit: 200, offset: 0 } } as unknown as T;
    };
    // 失败在挂载 effect 中暴露（jsdom 环境）；SSR 快照只验证静态回退。
    const html = renderToStaticMarkup(React.createElement(SettingsDiffView, {
      request: failingRequest,
      initialKeys: settingKeys.map(item => item.key),
      initialKey: 'site_notice',
    }));
    expect(html).toContain('系统设置变更历史');
  });
});
