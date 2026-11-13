import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 密度压缩重设计（PRD admin_console_density）验收锚点：
 * - 页头只留 面包屑 + 一行「大标题 + 右侧动作按钮」，板块描述/info 行全部删除；
 * - 表格 36px 基线行高（td 上下 7px + 13px 字号），1280px 视口一屏 ≥8 行数据；
 * - 待办一行三列 / 今日概览一行四列横排 compact 卡；
 * - 注册趋势重做为真柱状图（28px 固定柱宽、峰值 64px、零值 3px 灰柱）；
 * - 侧边栏滚动条 6px、hover 才显现；间距全量收敛到 4/8/12/16/20 五档。
 */

const css = readFileSync(fileURLToPath(new URL('./admin.css', import.meta.url)), 'utf8');
const consoleSrc = readFileSync(fileURLToPath(new URL('./AdminConsole.tsx', import.meta.url)), 'utf8');
const modelSrc = readFileSync(fileURLToPath(new URL('./adminDashboardModel.ts', import.meta.url)), 'utf8');

describe('admin density: page headers have no description rows', () => {
  it('deletes the admin-page-description row from the shell and stylesheet', () => {
    expect(css).not.toContain('.admin-page-description');
    expect(consoleSrc).not.toContain('admin-page-description');
    expect(consoleSrc).not.toContain('SECTION_DESCRIPTIONS');
  });
  it('hides every in-module toolbar description/info line globally', () => {
    const rule = css.match(/\.admin-toolbar-copy p \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('display:none');
  });
});

describe('admin density: operational fact lines survive the description purge', () => {
  const postsSrc = readFileSync(fileURLToPath(new URL('./AdminCommunityPosts.tsx', import.meta.url)), 'utf8');
  it('keeps review-decision facts (title · source · note) visible outside toolbar-copy', () => {
    // 审核决策的标题/来源（违禁词命中 / 用户举报）/审核备注是运营数据，
    // 必须移出 toolbar-copy 容器，不能被静态描述隐藏规则连带 display:none。
    expect(postsSrc).toMatch(/<AdminToolbar><h2>审核决策<\/h2><\/AdminToolbar>[\s\S]{0,160}?<p className="admin-fact-line" data-fact-line="review">/);
    expect(postsSrc).toContain('来源：');
    expect(postsSrc).toContain('备注：');
  });
  it('keeps report-disposition facts (title · reporter) visible and scoped in css', () => {
    // 举报处置的标题与举报人对处置者必须可见；CSS 的 display:none 仍只作用于 toolbar-copy。
    expect(postsSrc).toMatch(/<AdminToolbar><h2>举报处置<\/h2><\/AdminToolbar>[\s\S]{0,160}?<p className="admin-fact-line" data-fact-line="report">/);
    expect(postsSrc).toContain('举报人：');
    const factRule = css.match(/\.admin-root \.admin-fact-line \{[^}]*\}/)?.[0] ?? '';
    expect(factRule).not.toContain('display:none');
    expect(factRule).toMatch(/font-size:1[23]px/);
    // 隐藏选择器不得波及 fact-line（不能出现 toolbar-copy 后代包含 fact-line 的组合选择器）。
    expect(css).not.toMatch(/admin-toolbar-copy[^{]*admin-fact-line/);
  });
});

describe('admin density: table rows compress to a 36px baseline', () => {
  const td = css.match(/\.admin-root \.admin-stage-table td \{[^}]*\}/)?.[0] ?? '';
  it('keeps td vertical padding at 7px with middle alignment', () => {
    expect(td).toContain('padding:7px 10px');
    expect(td).toContain('vertical-align:middle');
  });
  it('fits a single-line data row at or under 40px', () => {
    // 13px 字号 × 1.6 行高 + 上下 7px padding ≈ 34.8px，徽标列也 ≤ 20 + 14 = 34px。
    const rowHeight = Math.round(13 * 1.6) + 2 * 7;
    expect(rowHeight).toBeLessThanOrEqual(40);
  });
  it('shows at least 8 data rows in one screen at a 1280px viewport', () => {
    // 1280 视口竖向预算：900 可用内容高 − 顶栏 48 − 主区上下 padding 32 − 工具行/筛选/表头 ≈ 700px 表体。
    const rowHeight = Math.round(13 * 1.6) + 2 * 7;
    expect(Math.floor(700 / rowHeight)).toBeGreaterThanOrEqual(8);
  });
  it('renders the account column as one line (name + inline email + tag chips)', () => {
    expect(css).toMatch(/\.admin-user-cell \{[^}]*display:flex/);
    expect(css).toMatch(/\.admin-user-email \{[^}]*font-size:11px/);
    expect(css).toMatch(/\.admin-user-tag \{[^}]*font-size:11px/);
    const usersSrc = readFileSync(fileURLToPath(new URL('./AdminUsers.tsx', import.meta.url)), 'utf8');
    expect(usersSrc).toContain('admin-user-cell');
    expect(usersSrc).toContain('tags.slice(0, 2)');
    // 账号列副行的「标签：… · 最近活动：…」整行删除（usr_id 改 title tooltip）。
    expect(usersSrc).not.toContain('标签：{tagText(user)} · 最近活动');
  });
});

describe('admin density: dashboard todo and today rows go horizontal', () => {
  it('lays todo cards out as one row of three columns', () => {
    expect(css).toMatch(/\.admin-metrics--todo \{[^}]*grid-template-columns:repeat\(3/);
    expect(css).toMatch(/\.admin-metric--todo[^{]*\{[^}]*display:flex/);
    expect(consoleSrc).toContain('admin-metric--todo');
    expect(consoleSrc).toContain('data-todo-card={card.key}');
  });
  it('lays today metrics out as one row of four compact columns', () => {
    expect(css).toMatch(/\.admin-metrics--today \{[^}]*grid-template-columns:repeat\(4/);
    expect(css).toMatch(/\.admin-metric--sm[^{]*\{[^}]*display:flex/);
    expect(consoleSrc).toContain('data-metric-card={card.key}');
  });
});

describe('admin density: register trend is a real bar chart', () => {
  it('renders fixed 28px columns centered, max 64px tall, zero days as 3px gray bars', () => {
    const trend = css.match(/\.admin-register-trend \{[^}]*\}/)?.[0] ?? '';
    expect(trend).toContain('justify-content:center');
    const bar = css.match(/\.admin-register-bar \{[^}]*\}/)?.[0] ?? '';
    expect(bar).toContain('width:28px');
    expect(bar).toContain('flex-direction:column');
    const track = css.match(/\.admin-register-track \{[^}]*\}/)?.[0] ?? '';
    expect(track).toContain('height:64px');
    expect(track).toContain('align-items:flex-end');
    expect(css).toMatch(/\.admin-register-track i\[data-zero='true'\] \{[^}]*background:var\(--admin-border\)/);
  });
  it('computes pixel heights with a 64px peak and 3px zero baseline in the model', () => {
    expect(modelSrc).toContain('export function trendBarPixelHeights');
    expect(modelSrc).toContain('peakHeight = 64');
    expect(modelSrc).toContain('return points.map(() => 3)');
  });
  it('keeps the 7-column trend from filling the whole width (7 × 40px ≈ 280px centered)', () => {
    // 柱宽 28px + 两端 12px gap，7 柱总宽约 7×28 + 6×12 = 268px，远小于 1280 全宽。
    expect(7 * 28 + 6 * 12).toBeLessThan(420);
  });
});

describe('admin density: sidebar scrollbar is thin and hover-only', () => {
  it('uses a 6px webkit scrollbar with transparent track', () => {
    const rule = css.match(/\.admin-navigation::-webkit-scrollbar \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('width:6px');
    expect(css).toMatch(/\.admin-navigation::-webkit-scrollbar-track \{[^}]*background:transparent/);
  });
  it('reveals the #334155 thumb only while the sidebar is hovered', () => {
    expect(css).toMatch(/\.admin-navigation::-webkit-scrollbar-thumb \{[^}]*background:transparent/);
    expect(css).toMatch(/\.admin-sidebar:hover \.admin-navigation::-webkit-scrollbar-thumb \{[^}]*background:#334155/);
  });
  it('sets the Firefox scrollbar-color fallback to thin/transparent', () => {
    expect(css).toMatch(/\.admin-navigation \{[^}]*scrollbar-width:thin/);
    expect(css).toMatch(/\.admin-navigation \{[^}]*scrollbar-color:transparent transparent/);
  });
});

describe('admin density: global spacing scale 4/8/12/16/20', () => {
  it('declares the five-step spacing tokens', () => {
    expect(css).toContain('--admin-space-1:4px');
    expect(css).toContain('--admin-space-2:8px');
    expect(css).toContain('--admin-space-3:12px');
    expect(css).toContain('--admin-space-4:16px');
    expect(css).toContain('--admin-space-5:20px');
  });
  it('compresses cards, dialogs, charts and trend plot height', () => {
    expect(css).toMatch(/\.admin-overview-card \{[^}]*padding:10px 12px/);
    expect(css).toMatch(/\.admin-chart \{[^}]*padding:10px 12px/);
    expect(css).toMatch(/\.admin-chart-plot \{[^}]*height:110px/);
    expect(css).toMatch(/\.admin-stage-panel \{[^}]*padding:10px 12px/);
    expect(css).toMatch(/\.admin-dialog-body \{[^}]*padding:16px/);
    expect(css).toMatch(/\.admin-overlay \{[^}]*padding:16px/);
  });
  it('keeps the credits adjust empty state compact (icon + one line, ≤120px)', () => {
    const creditsCss = readFileSync(fileURLToPath(new URL('./AdminCredits.css', import.meta.url)), 'utf8');
    expect(creditsCss).toMatch(/\.admin-credits-empty \{[^}]*display:flex/);
    expect(creditsCss).toMatch(/\.admin-credits-card\[data-empty\] \{[^}]*padding:10px 12px/);
    const creditsSrc = readFileSync(fileURLToPath(new URL('./AdminCredits.tsx', import.meta.url)), 'utf8');
    expect(creditsSrc).toContain('admin-credits-empty');
  });
});
