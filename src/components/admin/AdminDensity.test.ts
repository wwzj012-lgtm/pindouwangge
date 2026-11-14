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
  it('renders fixed 28px columns centered, max 44px tall, zero days as 3px gray bars', () => {
    const trend = css.match(/\.admin-register-trend \{[^}]*\}/)?.[0] ?? '';
    expect(trend).toContain('flex-direction:column');
    const bars = css.match(/\.admin-register-bars \{[^}]*\}/)?.[0] ?? '';
    expect(bars).toContain('justify-content:center');
    const bar = css.match(/\.admin-register-bar \{[^}]*\}/)?.[0] ?? '';
    expect(bar).toContain('width:28px');
    expect(bar).toContain('flex-direction:column');
    const track = css.match(/\.admin-register-track \{[^}]*\}/)?.[0] ?? '';
    expect(track).toContain('height:44px');
    expect(track).toContain('align-items:flex-end');
    expect(css).toMatch(/\.admin-register-track i\[data-zero='true'\] \{[^}]*background:var\(--admin-border\)/);
  });
  it('computes pixel heights with a 44px peak and 3px zero baseline in the model', () => {
    expect(modelSrc).toContain('export function trendBarPixelHeights');
    expect(modelSrc).toContain('peakHeight = 44');
    expect(modelSrc).toContain('return points.map(() => 3)');
  });
  it('renders no chart when the 7-day total is zero, only a compact gray note', () => {
    // 用户反馈"这个是什么意思，一堆数字"：全 0 时旧版渲染 3px 灰柱 + 64px 空轨道。
    // 重做后 total===0 不渲染图表，只留一行 ≤24px 的灰字（不可下钻）。
    expect(modelSrc).toContain('export function registerTrendTotal');
    expect(consoleSrc).toMatch(/trendTotal === 0 && <p className="admin-register-empty" data-register-trend-empty>近 7 天无新注册<\/p>/);
    expect(consoleSrc).toMatch(/trendTotal > 0 && <div className="admin-register-trend" data-register-trend>/);
    const emptyRule = css.match(/\.admin-register-empty \{[^}]*\}/)?.[0] ?? '';
    expect(emptyRule).toContain('font-size:12px');
    expect(emptyRule).toContain('color:var(--admin-muted)');
  });
  it('shows numeric value labels above non-zero bars, marks the peak bar and tooltips MM-DD · N 人', () => {
    expect(consoleSrc).toContain('admin-register-value');
    expect(consoleSrc).toMatch(/data-peak=\{point\.count > 0 && point\.count === trendPeak \|\| undefined\}/);
    expect(consoleSrc).toContain("point.date.slice(5) + ' · ' + point.count + ' 人'");
    expect(css).toMatch(/\.admin-register-bar\[data-peak='true'\] \.admin-register-track i \{[^}]*background:var\(--admin-primary\)/);
    expect(css).toMatch(/\.admin-register-bar\[data-peak='true'\] \.admin-register-value \{[^}]*color:var\(--admin-primary\)/);
  });
  it('caps the whole trend block (title + labels + bars + dates) at 110px when data exists', () => {
    // 6*2 上下内边距 + 标题 15 + gap 2 + 数值标签 14 + gap 3 + 轨道 44 + gap 3 + 日期 13 = 106px。
    expect(2 * 6 + 15 + 2 + 14 + 3 + 44 + 3 + 13).toBeLessThanOrEqual(110);
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

describe('admin density: trend tooltip is a semantic surface card (user feedback)', () => {
  // 用户反馈：悬浮深色小框只有「11-11 1」，无语义无样式。
  // 改造后：日期 muted 12px 在上 + 「类型词 N 个」16px 600 tabular-nums 在下，
  // 白底 surface 卡（1px --admin-border + --admin-shadow + 8px 圆角）。
  const tip = css.match(/\.admin-root \.admin-chart-tip \{[^}]*\}/)?.[0] ?? '';
  it('renders one shared tooltip with the data-trend-tooltip anchor', () => {
    expect(consoleSrc).toContain('data-trend-tooltip');
    // 组件共享：TrendChart 是唯一悬浮实现（className="admin-chart-tip" 只渲染一份）。
    expect(consoleSrc.match(/className="admin-chart-tip"/g)).toHaveLength(1);
    expect(consoleSrc).toContain('admin-chart-tip-date');
    expect(consoleSrc).toContain('admin-chart-tip-value');
  });
  it('styles the tooltip as a white surface card with border, radius and shadow tokens', () => {
    expect(tip).toContain('background:var(--admin-surface)');
    expect(tip).toContain('border:1px solid var(--admin-border)');
    expect(tip).toContain('border-radius:var(--admin-radius)');
    expect(tip).toContain('box-shadow:var(--admin-shadow)');
    expect(tip).toContain('pointer-events:none');
  });
  it('stacks a 12px muted date above a 16px 600 tabular-nums value', () => {
    expect(tip).toContain('flex-direction:column');
    const dateRule = css.match(/\.admin-root \.admin-chart-tip-date \{[^}]*\}/)?.[0] ?? '';
    expect(dateRule).toContain('font-size:12px');
    expect(dateRule).toContain('color:var(--admin-muted)');
    const valueRule = css.match(/\.admin-root \.admin-chart-tip-value \{[^}]*\}/)?.[0] ?? '';
    expect(valueRule).toContain('font-size:16px');
    expect(valueRule).toContain('font-weight:600');
    expect(valueRule).toContain('font-variant-numeric:tabular-nums');
  });
  it('maps every trend chart to a semantic action word and the shared copy helpers', () => {
    expect(consoleSrc).toContain("{ label: '图纸创建趋势', action: '新建'");
    expect(consoleSrc).toContain("{ label: '社区发布趋势', action: '发布'");
    expect(consoleSrc).toContain("{ label: '成功操作趋势', action: '操作'");
    expect(consoleSrc).toContain("{ label: '服务端错误趋势', action: '错误'");
    expect(consoleSrc).toContain("{ label: '用户新增趋势', action: '注册'");
    expect(consoleSrc).toContain('trendTooltipDate(samples[hover].date)');
    expect(consoleSrc).toContain('trendTooltipValue(action, samples[hover].count)');
    expect(modelSrc).toContain('export function trendTooltipDate');
    expect(modelSrc).toContain('export function trendTooltipValue');
  });
});

describe('admin density: leaving the admin console needs no confirmation (user feedback)', () => {
  // 用户反馈：点顶栏退出还要再弹 AdminConfirmDialog 确认一遍。改为直接执行
  // logout（接口/数据流不变），只有失败才弹自动消失的 toast，按钮可重试。
  it('removes the logout confirm dialog and fires logout directly from the header button', () => {
    expect(consoleSrc).not.toContain('logoutOpen');
    expect(consoleSrc).not.toMatch(/AdminConfirmDialog open=\{logoutOpen\}/);
    expect(consoleSrc).not.toContain('确认后将请求撤销当前后台会话');
    expect(consoleSrc).toMatch(/aria-label="退出后台会话"[^>]*busy=\{loggingOut\} onClick=\{\(\) => \{ if \(!loggingOut\) void logout\(\); \}\}/);
    // 退出接口与清理流程保持不变。
    expect(consoleSrc).toContain("adminRequest('/api/admin/session/logout'");
    expect(consoleSrc).toContain('clearAdminSession()');
  });
  it('shows failures as an auto-dismissing toast instead of a dialog', () => {
    expect(consoleSrc).toContain('data-admin-logout-toast');
    expect(consoleSrc).toContain('setTimeout(() => setLogoutError(\'\'), 3200)');
    expect(consoleSrc).toMatch(/className="admin-toast" role="status" aria-live="polite" data-admin-logout-toast/);
    const toastRule = css.match(/\.admin-root \.admin-toast \{[^}]*\}/)?.[0] ?? '';
    expect(toastRule).toContain('position:fixed');
    expect(toastRule).toContain('border-radius:var(--admin-radius)');
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
  it('keeps the credits adjust dialog compact (fixed ~480px, big balances, mini ledger)', () => {
    const creditsCss = readFileSync(fileURLToPath(new URL('./AdminCredits.css', import.meta.url)), 'utf8');
    expect(creditsCss).toMatch(/\.admin-credit-dialog \{[^}]*width:min\(480px,100vw\)/);
    expect(creditsCss).toMatch(/\.admin-credit-dialog input[^{]*\{[^}]*min-height:32px/);
    const creditsSrc = readFileSync(fileURLToPath(new URL('./AdminCredits.tsx', import.meta.url)), 'utf8');
    expect(creditsSrc).toContain('admin-credit-dialog');
    expect(creditsSrc).toContain('data-credit-balance-available');
  });
});
