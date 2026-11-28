import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
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
      '--admin-ink:#0f172a', '--admin-muted:#64748b',
      // PRD §5 对比度修正：faint 2.56:1 → 5.98:1
      '--admin-faint:#5b6472',
      '--admin-primary:#4f46e5', '--admin-primary-hover:#4338ca', '--admin-primary-soft:#eef2ff',
      // danger 4.83:1 → 6.47:1 / success 3.30:1 → 5.02:1
      '--admin-danger:#b91c1c', '--admin-danger-soft:#fef2f2',
      '--admin-warning:#b45309', '--admin-warning-soft:#fffbeb',
      '--admin-success:#15803d', '--admin-success-soft:#f0fdf4',
      '--admin-text-secondary:#475569',
      '--admin-border:#e2e8f0', '--admin-shadow:0 1px 2px rgb(15 23 42 / .06)', '--admin-radius:8px',
    ]) expect(css).toContain(token);
  });
  it('declares the five chart series variables (light) plus grid/axis glue', () => {
    for (const token of [
      '--admin-series-1:#4f46e5', '--admin-series-2:#0d9488', '--admin-series-3:#b45309',
      '--admin-series-4:#7c3aed', '--admin-series-5:#be123c',
      '--admin-grid:#e2e8f0', '--admin-axis-text:#64748b',
    ]) expect(css).toContain(token);
  });
  it('defines dark tokens behind a data attribute that is never switched on', () => {
    // P2 预留：只定义不接线（组件零改动即可切暗色），当前不设置该属性。
    expect(css).toContain(".admin-root[data-admin-theme='dark']");
    expect(css).toContain('--admin-series-1:#818cf8');
    expect(css).toContain('--admin-bg:#0f172a');
  });
  it('keeps every admin font size at or above the 11px auxiliary tier (all admin stylesheets)', () => {
    // PRD §5 字号阶梯最低档是 11px（辅助/时间戳）；10px 及以下一律整改。
    // 扫全部 admin CSS（QA 曾在 AdminBrandsColors.css 抓到 5 处 10px 漏网）。
    const dir = fileURLToPath(new URL('./', import.meta.url));
    const sheets = readdirSync(dir).filter(name => name.endsWith('.css'));
    expect(sheets.length).toBeGreaterThan(3);
    for (const name of sheets) {
      const text = readFileSync(join(dir, name), 'utf8');
      expect(text, name).not.toMatch(/font-size:(?:[0-9]|10)px/);
    }
  });
  it('declares the radius scale as 8px / 999px only', () => {
    // 权限树、登录卡等历史 10px/16px 圆角统一收敛到 8px（PRD §5 否决项）。
    expect(css).not.toMatch(/border-radius:(9|1[0-9]|2[0-9])px/);
    expect(css).toContain('border-radius:999px');
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

describe('chart panels inherit the token layer (no hardcoded colors)', () => {
  it('styles the trend/quality panels and legend from variables only', () => {
    const panel = css.match(/\.admin-root \.admin-dash-panel \{[^}]*\}/)?.[0] ?? '';
    expect(panel).toContain('border-radius:var(--admin-radius)');
    expect(panel).toContain('box-shadow:var(--admin-shadow)');
    const legend = css.match(/\.admin-root \.admin-chart-legend-item \{[^}]*\}/)?.[0] ?? '';
    expect(legend).toContain('color:var(--admin-muted)');
    // 漏斗的三段色也必须走序列变量，禁止硬编码。
    expect(css).toMatch(/\.admin-root \.admin-dash-funnel-track i\[data-tone='teal'\] \{ background:var\(--admin-series-2\)/);
    expect(css).toMatch(/\.admin-root \.admin-dash-funnel-track i\[data-tone='violet'\] \{ background:var\(--admin-series-4\)/);
  });
  it('keeps chart source free of hex color literals', () => {
    const chartsSrc = readFileSync(fileURLToPath(new URL('./dashboard/AdminDashboardCharts.tsx', import.meta.url)), 'utf8');
    expect(chartsSrc).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
  it('collapses an all-zero metric block to a single 12px gray line', () => {
    const rule = css.match(/\.admin-root \.admin-dash-empty \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('color:var(--admin-muted)');
    expect(rule).toContain('font-size:12px');
    expect(rule).toMatch(/line-height:1.5/);
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
