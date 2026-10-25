import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { adminAccessFailure, formatAdminMetric, parseAdminCapabilities, resolveAdminSection, sumAdminMetrics } from './AdminConsole';
import { AdminButton, AdminConfirmDialog, AdminDrawer, AdminEmptyState, AdminErrorState, AdminLoading } from './AdminPrimitives';

describe('admin shell state boundaries', () => {
  it('accepts only explicit server capability booleans for the authenticated operator', () => {
    const capabilities = { 'credits.read': true, 'credits.adjust': false, 'colors.read': true, 'colors.write': false };
    expect(parseAdminCapabilities({ operatorUid: 'operator', capabilities }, 'operator')?.capabilities).toEqual(capabilities);
    expect(parseAdminCapabilities({ operatorUid: 'other', capabilities }, 'operator')).toBeNull();
    expect(parseAdminCapabilities({ operatorUid: 'operator', role: 'admin', isVip: true }, 'operator')).toBeNull();
    expect(parseAdminCapabilities({ operatorUid: 'operator', capabilities: { ...capabilities, 'credits.adjust': 'true' } }, 'operator')).toBeNull();
    expect(parseAdminCapabilities({ operatorUid: 'operator', capabilities: { 'credits.read': true } }, 'operator')).toBeNull();
  });
  it('retains real zero and formats only finite numeric statistics', () => {
    expect(formatAdminMetric(0)).toBe('0'); expect(formatAdminMetric(1234)).toBe('1,234');
    for (const value of [undefined, null, NaN, Infinity, '20']) expect(formatAdminMetric(value)).toBe('—');
  });
  it('does not invent aggregate statistics when either source is missing', () => {
    expect(sumAdminMetrics(3, 1)).toBe(4); expect(sumAdminMetrics(0, 0)).toBe(0);
    expect(sumAdminMetrics(undefined, 1)).toBeUndefined(); expect(sumAdminMetrics(1, NaN)).toBeUndefined();
  });
  it('accepts all nine existing module identifiers', () => {
    for (const section of ['dashboard', 'users', 'roles', 'logs', 'codes', 'credits', 'announcements', 'config', 'brands', 'resources', 'community']) expect(resolveAdminSection(section)).toBe(section);
    expect(resolveAdminSection('colors-assets')).toBe('brands');
  });
  it('rejects unknown module identifiers rather than treating them as authorized routes', () => {
    expect(resolveAdminSection(null)).toBe('dashboard'); expect(resolveAdminSection('../users')).toBe('dashboard'); expect(resolveAdminSection('invented')).toBe('dashboard');
  });
  it('distinguishes logged-out and expired admin sessions', () => {
    expect(adminAccessFailure(401, false)).toBe('signed-out'); expect(adminAccessFailure(401, true)).toBe('session-required');
  });
  it('does not equate network/server failure with permission denial', () => {
    expect(adminAccessFailure(403, true)).toBe('forbidden'); expect(adminAccessFailure(0, true)).toBe('unavailable'); expect(adminAccessFailure(500, true)).toBe('unavailable');
  });
});

describe('dedicated admin semantic primitives', () => {
  it('disables a busy button and announces busy state', () => {
    const html = renderToStaticMarkup(React.createElement(AdminButton, { busy: true, children: '保存' }));
    expect(html).toContain('disabled=""'); expect(html).toContain('aria-busy="true"'); expect(html).toContain('保存');
  });
  it('provides a named status for loading', () => {
    const html = renderToStaticMarkup(React.createElement(AdminLoading, { label: '正在验证' }));
    expect(html).toContain('role="status"'); expect(html).toContain('正在验证');
  });
  it('renders empty and error states distinctly', () => {
    const empty = renderToStaticMarkup(React.createElement(AdminEmptyState, { title: '没有匹配记录' }));
    const error = renderToStaticMarkup(React.createElement(AdminErrorState, { message: '断网', retry: () => {} }));
    expect(empty).toContain('没有匹配记录'); expect(empty).not.toContain('role="alert"'); expect(error).toContain('role="alert"'); expect(error).toContain('重试');
  });
  it('does not render a closed drawer', () => {
    expect(renderToStaticMarkup(React.createElement(AdminDrawer, { open: false, title: '菜单', children: '项目', onClose: () => {} }))).toBe('');
  });
  it('labels an open modal and defaults focus to cancel', () => {
    const html = renderToStaticMarkup(React.createElement(AdminConfirmDialog, { open: true, title: '确认退出', description: '只退出后台', onClose: () => {}, onConfirm: () => {} }));
    expect(html).toContain('role="dialog"'); expect(html).toContain('aria-modal="true"'); expect(html).toContain('aria-labelledby='); expect(html).toContain('data-admin-autofocus'); expect(html).toContain('取消');
  });
  it('locks close, cancel and confirm during a pending operation', () => {
    const html = renderToStaticMarkup(React.createElement(AdminConfirmDialog, { open: true, pending: true, title: '确认退出', description: '处理中', onClose: () => {}, onConfirm: () => {} }));
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
});
