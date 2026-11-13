import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_FILTER_DEBOUNCE_MS, createFilterDebounce } from './adminPresentation';
import { AdminLoading } from './AdminPrimitives';

/**
 * 视觉与交互精修（PRD admin_console_visual_polish）验收锚点：
 * - 设计令牌单源 + dark 主题 token 块删除；
 * - 按钮三级体系（无 44px 描边按钮残留）；
 * - 7 天注册趋势横排 / 批量条浮动 / 警告条降级 / 加载骨架统一；
 * - 筛选 300ms 防抖即时生效（纯逻辑验证）。
 */

const cssPath = fileURLToPath(new URL('./admin.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

describe('admin design tokens (light single theme)', () => {
  it('deletes every dark-theme token block', () => {
    expect(css).not.toContain('prefers-color-scheme:dark');
    expect(css).not.toContain('color-scheme:dark');
    expect(css).toContain('color-scheme:light');
  });
  it('declares the single-source palette on :root .admin-root', () => {
    for (const token of [
      '--admin-bg:#f8fafc', '--admin-surface:#ffffff', '--admin-subtle:#f1f5f9',
      '--admin-ink:#0f172a', '--admin-muted:#64748b', '--admin-faint:#94a3b8',
      '--admin-primary:#4f46e5', '--admin-primary-hover:#4338ca', '--admin-primary-soft:#eef2ff',
      '--admin-danger:#dc2626', '--admin-danger-soft:#fef2f2',
      '--admin-warning:#b45309', '--admin-warning-soft:#fffbeb',
      '--admin-success:#16a34a', '--admin-success-soft:#f0fdf4',
      '--admin-border:#e2e8f0', '--admin-shadow:0 1px 2px rgb(15 23 42 / .06)', '--admin-radius:8px',
    ]) expect(css).toContain(token);
  });
  it('no longer uses the old dark palette values', () => {
    expect(css).not.toContain('#111820');
    expect(css).not.toContain('#6ed3c1');
    expect(css).not.toContain('#19232e');
  });
});

describe('three-tier button system (32px, no outlined secondary)', () => {
  it('removes every 44px control height from the admin stylesheet', () => {
    expect(css).not.toContain('min-height:44px');
    expect(css).not.toContain('width:44px');
  });
  it('keeps primary solid, secondary borderless-transparent and danger solid at 32px', () => {
    expect(css).toContain('.admin-button--primary { background:var(--admin-primary); color:#fff; }');
    expect(css).toMatch(/\.admin-button \{[^}]*min-height:32px/);
    const secondaryRule = css.match(/\.admin-button--icon \{[^}]*\}/)?.[0] ?? '';
    expect(secondaryRule).toContain('width:32px');
    expect(css).toMatch(/\.admin-button--danger \{ background:var\(--admin-danger\); color:#fff; \}/);
    // secondary/ghost 透明无描边：基础按钮边框透明，secondary 无独立描边覆盖。
    expect(css).toMatch(/\.admin-button \{[^}]*border:1px solid transparent/);
    expect(css).not.toMatch(/\.admin-button--secondary \{[^}]*border:/);
  });
});

describe('register trend horizontal mini bars (7-day registration trend fix)', () => {
  it('lays the register trend out as a horizontal non-wrapping flex row', () => {
    const rule = css.match(/\.admin-register-trend \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('display:flex');
    expect(rule).toContain('flex-wrap:nowrap');
  });
  it('renders each bar as track + single-line date under the bar', () => {
    const barRule = css.match(/\.admin-register-bar \{[^}]*\}/)?.[0] ?? '';
    expect(barRule).toContain('flex-direction:column');
    const trackRule = css.match(/\.admin-register-track \{[^}]*\}/)?.[0] ?? '';
    expect(trackRule).toContain('align-items:flex-end');
  });
});

describe('batch bar and warnings footnote surfaces', () => {
  it('floats the batch bar fixed at the bottom center without pushing layout', () => {
    const rule = css.match(/\.admin-batch-bar \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('position:fixed');
    expect(rule).toContain('left:50%');
    expect(rule).toContain('transform:translateX(-50%)');
  });
  it('downgrades the warning banner to a gray footer footnote with expand arrow', () => {
    // 整宽橙底 banner（.admin-warning 带背景块）已删除；仅保留纯文字行内警示。
    expect(css).not.toMatch(/\.admin-warning \{[^}]*background/);
    expect(css).not.toMatch(/\.admin-warning \{[^}]*border/);
    const rule = css.match(/\.admin-warnings-footnote \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('color:var(--admin-muted)');
  });
});

describe('unified loading skeleton', () => {
  it('renders AdminLoading as a shared skeleton without any spinner', () => {
    const html = renderToStaticMarkup(React.createElement(AdminLoading, { label: '正在读取' }));
    expect(html).toContain('admin-skeleton');
    expect(html).toContain('data-admin-skeleton');
    expect(html).not.toContain('admin-spin');
    expect(html).not.toContain('loader');
  });
});

describe('filter debounce (300ms auto-apply, no query button)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('applies a filter change exactly once after 300ms', () => {
    const apply = vi.fn();
    const debouncer = createFilterDebounce(apply);
    expect(ADMIN_FILTER_DEBOUNCE_MS).toBe(300);
    debouncer.schedule();
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it('coalesces rapid changes into the last one only', () => {
    const apply = vi.fn();
    const debouncer = createFilterDebounce(apply);
    debouncer.schedule();
    vi.advanceTimersByTime(200);
    debouncer.schedule();
    vi.advanceTimersByTime(200);
    debouncer.schedule();
    vi.advanceTimersByTime(300);
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it('cancel() drops the pending apply (reset / sort overrides)', () => {
    const apply = vi.fn();
    const debouncer = createFilterDebounce(apply);
    debouncer.schedule();
    debouncer.cancel();
    vi.advanceTimersByTime(1000);
    expect(apply).not.toHaveBeenCalled();
    expect(debouncer.pending()).toBe(false);
  });
  it('supports a custom delay window for tests', () => {
    const apply = vi.fn();
    const debouncer = createFilterDebounce(apply, 50);
    debouncer.schedule();
    vi.advanceTimersByTime(50);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
