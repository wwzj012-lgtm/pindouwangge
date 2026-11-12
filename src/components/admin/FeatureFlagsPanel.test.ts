import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminRequest } from './adminRequest';
import {
  FeatureFlagsPanel,
  MANAGED_FLAG_KEYS,
  flagExplanations,
  flagTitles,
  parseManagedFlags,
  type FeatureFlagItem,
} from './FeatureFlagsPanel';

const flag = (key: string, enabled: boolean): FeatureFlagItem => ({
  key, enabled, description: '种子说明', updatedBy: 'admin', updatedAt: 1700000000000,
});

const okRequest: AdminRequest = async <T,>() => ({
  ok: true,
  status: 200,
  data: {
    items: [
      flag('community_post_enabled', true),
      flag('register_enabled', false),
      flag('maintenance_mode', false),
      { key: 'public.community', enabled: true, description: '不受本面板管理' },
    ],
  } as unknown as T,
});

describe('FeatureFlagsPanel', () => {
  it('keeps exactly the three managed keys with explanations in a fixed order', () => {
    expect(MANAGED_FLAG_KEYS).toEqual(['register_enabled', 'community_post_enabled', 'maintenance_mode']);
    for (const key of MANAGED_FLAG_KEYS) {
      expect(flagExplanations[key].length).toBeGreaterThan(0);
      expect(flagTitles[key].length).toBeGreaterThan(0);
    }
    expect(flagExplanations.maintenance_mode).toContain('/api/admin');
    expect(flagExplanations.register_enabled).toContain('403');
  });

  it('parses enabled managed flags and ignores unrelated keys', () => {
    expect(parseManagedFlags([
      flag('register_enabled', true), flag('community_post_enabled', false),
      flag('maintenance_mode', false), flag('public.community', true),
    ])).toEqual(['register_enabled']);
  });

  it('renders the three managed flags with effect notes and toggle buttons', () => {
    const html = renderToStaticMarkup(React.createElement(FeatureFlagsPanel, {
      request: okRequest,
      initialFlags: [
        flag('community_post_enabled', true),
        flag('register_enabled', false),
        flag('maintenance_mode', false),
      ],
    }));
    expect(html).toContain('运营功能开关');
    expect(html).toContain('开放注册');
    expect(html).toContain('开放社区发帖');
    expect(html).toContain('站点维护模式');
    expect(html).toContain('data-flag-toggle="register_enabled"');
    expect(html).toContain('data-flag-toggle="community_post_enabled"');
    expect(html).toContain('data-flag-toggle="maintenance_mode"');
    // 不受管的 public.community 不出现在本面板。
    expect(html).not.toContain('public.community');
  });
});
