import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminRequest } from './adminRequest';
import {
  AdminPaletteResources,
  adminAssetQuery,
  assetDeleteReason,
  formatAssetBytes,
  formatAssetUsage,
} from './AdminPaletteResources';

describe('AdminPaletteResources', () => {
  it('renders a real-file-only, read-only resource surface without color CRUD controls', () => {
    const request: AdminRequest = async <T,>() => ({
      ok: true,
      status: 200,
      data: { items: [], total: 0, limit: 20, offset: 0 } as T,
    });
    const html = renderToStaticMarkup(React.createElement(AdminPaletteResources, { readOnly: true, request }));
    expect(html).toContain('真实资源文件');
    expect(html).toContain('community_assets');
    expect(html).toContain('内建调色板只读');
    expect(html).not.toContain('登记资源');
    expect(html).not.toContain('type="file"');
  });

  it('constructs bounded filters and formats file/usage information', () => {
    expect(adminAssetQuery({ page: 2, limit: 20, search: 'asset/a', ownerUid: '', contentType: null }))
      .toBe('?page=2&limit=20&search=asset%2Fa');
    expect(formatAssetBytes(1536)).toBe('1.5 KB');
    expect(formatAssetUsage({ postCount: 2, activePostCount: 1, workCount: 1 })).toBe('帖子 2 · 作品 1');
  });

  it('never allows a missing, corrupt, or referenced asset to be deleted in the UI', () => {
    const base = { inUse: false, canDelete: true, usage: { postCount: 0, activePostCount: 0, workCount: 0 } };
    expect(assetDeleteReason({ ...base, availability: 'available' })).toBeNull();
    expect(assetDeleteReason({ ...base, availability: 'missing' })).toContain('文件不可用');
    expect(assetDeleteReason({ ...base, availability: 'check_failed' })).toContain('文件不可用');
    expect(assetDeleteReason({ ...base, inUse: true, availability: 'available' })).toContain('引用');
    expect(assetDeleteReason({ ...base, availability: 'available', usage: { ...base.usage, workCount: 1 } })).toContain('引用');
    expect(assetDeleteReason({ ...base, canDelete: false, availability: 'available' })).toContain('服务端');
  });
});
