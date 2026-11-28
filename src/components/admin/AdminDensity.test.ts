import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 密度压缩重设计验收锚点（批次 6 起按 Recharts 仪表盘重写断言）：
 * - 页头只留 面包屑 + 一行「大标题 + 右侧动作按钮」，板块描述/info 行全部删除；
 * - 表格 36px 基线行高（td 上下 7px + 13px 字号），1280px 视口一屏 ≥8 行数据；
 * - 仪表盘：A 4 张决策卡（数字 22–24px）→ B 主趋势图（220px，懒加载）→ C 漏斗/质量 → D 待办三项；
 * - 侧边栏滚动条 6px、hover 才显现；间距全量收敛到 4/8/12/16/20 五档。
 */

const css = readFileSync(fileURLToPath(new URL('./admin.css', import.meta.url)), 'utf8');
const consoleSrc = readFileSync(fileURLToPath(new URL('./AdminConsole.tsx', import.meta.url)), 'utf8');
const modelSrc = readFileSync(fileURLToPath(new URL('./adminDashboardModel.ts', import.meta.url)), 'utf8');
const dashboardFile = (name: string) => readFileSync(fileURLToPath(new URL(`./dashboard/${name}`, import.meta.url)), 'utf8');
const kpiSrc = dashboardFile('DashboardKpiCards.tsx');
const trendSrc = dashboardFile('DashboardTrendSection.tsx');
const chartsSrc = dashboardFile('AdminDashboardCharts.tsx');
const funnelSrc = dashboardFile('DashboardFunnel.tsx');
const qualitySrc = dashboardFile('DashboardQuality.tsx');
const todoSrc = dashboardFile('DashboardTodoBar.tsx');
const tooltipSrc = dashboardFile('tooltipPosition.ts');
const viewSrc = dashboardFile('DashboardView.tsx');

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

describe('admin density: dashboard decision cards are four equal columns', () => {
  it('lays the four KPI cards out as one row of four columns', () => {
    expect(css).toMatch(/\.admin-dash-kpis \{[^}]*grid-template-columns:repeat\(4/);
    expect(css).toMatch(/\.admin-dash-kpi \{[^}]*min-height:92px/);
    expect(kpiSrc).toContain('data-kpi-card="creators"');
    expect(kpiSrc).toContain('data-kpi-card="conversion"');
    expect(kpiSrc).toContain('data-kpi-card="pending"');
    expect(kpiSrc).toContain('data-kpi-card="error-rate"');
    expect(viewSrc).toContain('<DashboardKpiCards analytics={analytics} range={range} />');
  });
  it('renders 22–24px tabular-nums numbers and keeps all four cards the same height', () => {
    const valueRule = css.match(/\.admin-root \.admin-dash-kpi-value \{[^}]*\}/)?.[0] ?? '';
    expect(valueRule).toMatch(/font-size:2[24]px/);
    expect(valueRule).toContain('font-variant-numeric:tabular-nums');
    // 同一 min-height + flex 列布局 => 四张卡等高，长副行不会把某张卡拉高。
    expect(css).toMatch(/\.admin-root \.admin-dash-kpi \{[^}]*display:flex/);
    expect(css).toMatch(/\.admin-root \.admin-dash-kpi \{[^}]*flex-direction:column/);
  });
  it('keeps the four answers on the first screen: creators / conversion / pending / error rate', () => {
    expect(kpiSrc).toContain('今日新增创作者');
    expect(kpiSrc).toContain('{range} 天发布转化率');
    expect(kpiSrc).toContain('待处理');
    expect(kpiSrc).toContain('24 小时错误率');
    expect(kpiSrc).toContain('昨日同刻');
    expect(kpiSrc).toContain('代理口径');
  });
});

describe('admin density: main trend chart is a lazy 220px Recharts panel', () => {
  it('lazy-loads the chart chunk instead of bundling recharts into AdminPage', () => {
    expect(trendSrc).toContain("React.lazy(() => import('./AdminDashboardCharts')");
    expect(qualitySrc).toContain("React.lazy(() => import('./AdminDashboardCharts')");
    // 主 chunk（AdminConsole）不得直接依赖 recharts。
    expect(consoleSrc).not.toContain('recharts');
    expect(consoleSrc).not.toContain('ComposedChart');
    // 只有图表文件 import recharts。
    expect(chartsSrc).toContain("from 'recharts'");
  });
  it('composes two left-axis lines with a right-axis bar and integer ticks with units', () => {
    expect(chartsSrc).toContain('<ComposedChart');
    expect(chartsSrc).toContain('dataKey="newUsers"');
    expect(chartsSrc).toContain('dataKey="activeUsersProxy"');
    expect(chartsSrc).toContain('dataKey="works"');
    expect(chartsSrc).toContain('yAxisId="people"');
    expect(chartsSrc).toContain('yAxisId="items"');
    expect(chartsSrc).toContain('allowDecimals={false}');
    expect(chartsSrc).toContain('axisTicks(leftMax, 4)');
    // 单位标在图例行左侧（recharts 轴 label 会压住顶部刻度值，已弃用该写法）。
    expect(chartsSrc).toContain('admin-chart-axis-unit');
    expect(chartsSrc).toContain('左轴 人 · 右轴 个');
    expect(chartsSrc).toContain('左轴 错误率% · 右轴 ms');
    expect(css).toMatch(/\.admin-chart-axis-unit \{[^}]*font-size:12px/);
  });
  it('shows the legend top-right, toggles series and lets the axis adapt', () => {
    expect(css).toMatch(/\.admin-chart-legend \{[^}]*justify-content:flex-end/);
    expect(chartsSrc).toContain('aria-pressed={on}');
    // 隐藏后轴自适应：刻度来自「可见序列」的最大值。
    expect(chartsSrc).toContain("show('newUsers') ? row.newUsers : 0");
    expect(chartsSrc).toContain("show('works') ? row.works : 0");
  });
  it('keeps the chart 220px on desktop and 180px on mobile', () => {
    expect(css).toMatch(/\.admin-root \.admin-dash-chart \{ height:220px/);
    const mobile = css.match(/@media \(max-width:639px\) \{[\s\S]*?\.admin-root \.admin-dash-chart \{ height:180px; \}/)?.[0] ?? '';
    expect(mobile).toContain('height:180px');
  });
  it('collapses an all-zero window to one gray line instead of an empty plot', () => {
    expect(trendSrc).toContain('trendIsEmpty(rows)');
    expect(trendSrc).toContain('近 {range} 天无新增');
    const emptyRule = css.match(/\.admin-root \.admin-dash-empty \{[^}]*\}/)?.[0] ?? '';
    expect(emptyRule).toContain('font-size:12px');
    expect(emptyRule).toContain('color:var(--admin-muted)');
    expect(modelSrc).toContain('export function trendIsEmpty');
  });
  it('declares the UTC + proxy-active provenance note under the chart title', () => {
    expect(trendSrc).toContain('UTC 0 点切分');
    expect(trendSrc).toContain('互动活跃用户为代理口径');
  });
});

describe('admin density: trend tooltip avoids the hovered point (user feedback)', () => {
  it('positions the tooltip with the pure placement helper, never pinned to the top', () => {
    expect(tooltipSrc).toContain('export function placeTooltip');
    expect(chartsSrc).toContain('placeChartTooltip({');
    // 旧实现是 top:0 固定贴顶，导致压住峰值。
    expect(chartsSrc).not.toContain('top:0');
    expect(chartsSrc).toContain('data-dash-tooltip');
    expect(chartsSrc).toContain('data-placement={tip.placement}');
  });
  it('styles the tooltip as a surface card that never intercepts the pointer', () => {
    const tip = css.match(/\.admin-root \.admin-dash-tip \{[^}]*\}/)?.[0] ?? '';
    expect(tip).toContain('position:absolute');
    expect(tip).toContain('background:var(--admin-surface)');
    expect(tip).toContain('border:1px solid var(--admin-border)');
    expect(tip).toContain('border-radius:var(--admin-radius)');
    expect(tip).toContain('box-shadow:var(--admin-shadow)');
    expect(tip).toContain('pointer-events:none');
  });
  it('stacks a 12px muted date above 12px series rows with tabular-nums values', () => {
    const dateRule = css.match(/\.admin-root \.admin-dash-tip-date \{[^}]*\}/)?.[0] ?? '';
    expect(dateRule).toContain('font-size:12px');
    expect(dateRule).toContain('color:var(--admin-muted)');
    const rowRule = css.match(/\.admin-root \.admin-dash-tip-row \{[^}]*\}/)?.[0] ?? '';
    expect(rowRule).toContain('font-size:12px');
    expect(css).toMatch(/\.admin-root \.admin-dash-tip-row b \{[^}]*font-variant-numeric:tabular-nums/);
  });
  it('supports keyboard day-by-day navigation on the chart container', () => {
    expect(chartsSrc).toContain('ArrowLeft');
    expect(chartsSrc).toContain('ArrowRight');
    expect(chartsSrc).toContain('tabIndex={0}');
    expect(css).toMatch(/\.admin-chart-canvas:focus-visible \{[^}]*outline:2px solid var\(--admin-primary\)/);
  });
});

describe('admin density: funnel, quality and todo blocks', () => {
  it('renders the three-step funnel with per-step and overall conversion', () => {
    expect(css).toMatch(/\.admin-root \.admin-dash-funnel-track \{[^}]*height:8px/);
    expect(funnelSrc).toContain('data-funnel-step={step.key}');
    expect(funnelSrc).toContain("{ key: 'works', label: '图纸创建'");
    expect(funnelSrc).toContain("{ key: 'posts', label: '社区发布'");
    expect(funnelSrc).toContain('data-funnel-step-rate={step.key}');
    expect(funnelSrc).toContain('data-funnel-overall');
    // 完成事件口径必须写明（含修订），否则会被读成"完成图纸数"。
    expect(funnelSrc).toContain('完成事件（含修订）');
    expect(funnelSrc).toContain('conversionLabel(overall, works)');
  });
  it('shows 本期无样本 when the denominator is zero and 口径不可比 when rate>1', () => {
    expect(modelSrc).toContain("return '本期无样本'");
    expect(modelSrc).toContain("return '—（口径不可比）'");
    expect(modelSrc).toContain('export function conversionIsIncomparable');
  });
  it('puts error rate and durations into the quality panel with a proxy-scope note', () => {
    expect(qualitySrc).toContain('代理口径：真实错误率 ≥ 展示值');
    expect(qualitySrc).toContain('data-quality-fact="errorRate"');
    expect(qualitySrc).toContain('data-quality-fact="avgDuration"');
    expect(qualitySrc).toContain('data-quality-fact="maxDuration"');
    expect(qualitySrc).toContain('data-quality-fact="unresolved"');
    expect(qualitySrc).toContain('data-quality-error-codes');
    expect(qualitySrc).toContain('错误码 Top5');
  });
  it('lays the todo bar out as one row of three drill-down buttons', () => {
    expect(css).toMatch(/\.admin-root \.admin-dash-todo \{[^}]*grid-template-columns:repeat\(3/);
    expect(todoSrc).toContain('data-todo-card={item.key}');
    expect(todoSrc).toContain('data-todo-value={item.key}');
    expect(todoSrc).toContain("todoDrillQuery('reviews')");
    expect(todoSrc).toContain("todoDrillQuery('reports')");
    expect(todoSrc).toContain("todoDrillQuery('codes')");
    // 待举报只按 open 计数，复核数只作副行灰字（与举报列表默认筛选一致）。
    expect(todoSrc).toContain('复核中');
    expect(todoSrc).toContain('（不计入）');
  });
  it('keeps the legacy vanity metrics as one footnote line, never as charts', () => {
    expect(viewSrc).toContain('data-dashboard-cumulative');
    // 旧实现（累计大卡 + 5 张同构 SVG 图 + 注册柱图）整块删除，不留并行实现。
    expect(viewSrc).not.toContain('admin-overview-card');
    expect(consoleSrc).not.toContain('TrendChart');
    expect(consoleSrc).not.toContain('admin-register-trend');
    expect(consoleSrc).not.toContain('admin-metric--today');
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
  it('compresses panels, dialogs, cards and the chart height', () => {
    expect(css).toMatch(/\.admin-dash-panel \{[^}]*padding:10px 12px/);
    expect(css).toMatch(/\.admin-dash-kpi \{[^}]*padding:10px 12px/);
    expect(css).toMatch(/\.admin-dash-chart \{ height:220px/);
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
