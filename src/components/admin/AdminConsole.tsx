import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Archive, ArrowLeft, ArrowUpRight, CheckCircle2, ChevronRight, Coins, FileClock, Gift, KeyRound, LayoutDashboard, LogOut, Megaphone, Menu, Palette, RefreshCw, ScrollText, Settings2, ShieldAlert, ShieldCheck, ShieldEllipsis, Tags, Users, type LucideIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { clearAdminSession, setAdminSessionToken } from '../../utils/api';
import { AdminUsersRoles } from './AdminUsersRoles';
import { AdminLogsCodes } from './AdminLogsCodes';
import { AdminAnnouncementsConfig } from './AdminAnnouncementsConfig';
import { AdminBrandsColors } from './AdminBrandsColors';
import { AdminCredits } from './AdminCredits';
import { AdminWelfare } from './AdminWelfare';
import { AdminPaletteResources, type AdminAssetPreviewRequest } from './AdminPaletteResources';
import { AdminCommunityPosts } from './AdminCommunityPosts';
import { AdminBannedWords } from './AdminBannedWords';
import { AdminCommunityTagDictionary } from './AdminCommunityTagDictionary';
import { OperationLogViewer } from './OperationLogViewer';
import { RunLogsSection } from './RunLogsSection';
import { FeatureFlagsPanel } from './FeatureFlagsPanel';
import { SettingsDiffView } from './SettingsDiffView';
import { AdminBadge, AdminButton, AdminConfirmDialog, AdminDrawer, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { createAdminBlobRequest, createAdminRequest, type AdminApiResult, type AdminRequest } from './adminRequest';
import { AdminConnectionNotices } from './adminConnectionNotices';
import { parseDashboardMetrics, parseDashboardTodo, todoDrillQuery, todayRegistrations, trendBarHeights, type DashboardSection } from './adminDashboardModel';
import './admin.css';

export type { AdminApiResult, AdminRequest } from './adminRequest';
type AccessState = 'checking' | 'ready' | 'session-required' | 'forbidden' | 'signed-out' | 'unavailable';
const CAPABILITY_KEYS = ['credits.read', 'credits.adjust', 'colors.read', 'colors.write'] as const;
type CapabilityKey = typeof CAPABILITY_KEYS[number];
export interface AdminCapabilities { operatorUid: string; capabilities: Record<CapabilityKey, boolean>; }
export function parseAdminCapabilities(value: unknown, operatorUid: string): AdminCapabilities | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AdminCapabilities>;
  if (!operatorUid || candidate.operatorUid !== operatorUid || !candidate.capabilities || typeof candidate.capabilities !== 'object') return null;
  if (CAPABILITY_KEYS.some(key => typeof candidate.capabilities![key] !== 'boolean')) return null;
  return { operatorUid, capabilities: Object.fromEntries(CAPABILITY_KEYS.map(key => [key, candidate.capabilities![key]])) as Record<CapabilityKey, boolean> };
}

/**
 * 批次 5：IA 重排终态 —— 5 组 15 项（菜单总数 ≤16）。
 * - 总览[dashboard]
 * - 用户与经营[users → credits → codes → welfare]（按业务链排，福利规则末位）
 * - 内容治理[community → tagDictionary → bannedwords]
 * - 资源与色彩[brands → resources]
 * - 监控与系统[operationLogs → runLogs → announcements → config → roles]
 * 旧 logs / sessions / cronRuns 三个 SectionId 并入 runLogs 板块内 tab；
 * bookmarks 由 LEGACY_SECTION_MAP 兼容映射，不再 404。
 */
type SectionId = 'dashboard' | 'users' | 'credits' | 'codes' | 'welfare' | 'community' | 'tagDictionary' | 'bannedwords' | 'brands' | 'resources' | 'operationLogs' | 'runLogs' | 'announcements' | 'config' | 'roles';
type GroupId = 'overview' | 'business' | 'content' | 'assets' | 'system';
interface MenuItem { id: SectionId; label: string; group: GroupId; icon: LucideIcon; }
interface TrendPoint { date: string; count: number; }
interface DashboardData {
  overview: { totalUsers: number; newUsers30Days: number; activeVipUsers: number; works: number; communityPosts: number; redeemedCodes: number; recentErrors: number };
  trends: { days7: { users: TrendPoint[]; works: TrendPoint[]; communityPosts: TrendPoint[]; successfulActions: TrendPoint[]; errors: TrendPoint[] } };
  telemetry: { successfulActions24h: number; durationSamples24h: number; averageDurationMs: number; maximumDurationMs: number; errors24h: number; errorCodes: { code: string; count: number }[] };
  warnings?: string[];
  /** 批次 3：结构化分段可用性、待办与今日指标。 */
  sections?: Record<string, DashboardSection>;
  todo?: ReturnType<typeof parseDashboardTodo>;
  metrics?: ReturnType<typeof parseDashboardMetrics>;
}
const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'overview', label: '总览' },
  { id: 'business', label: '用户与经营' },
  { id: 'content', label: '内容治理' },
  { id: 'assets', label: '资源与色彩' },
  { id: 'system', label: '监控与系统' },
];
export const ADMIN_MENU_ITEMS: MenuItem[] = [
  { id: 'dashboard', label: '数据仪表盘', group: 'overview', icon: LayoutDashboard },
  { id: 'users', label: '用户管理', group: 'business', icon: Users },
  { id: 'credits', label: '积分管理', group: 'business', icon: Coins },
  { id: 'codes', label: '兑换码管理', group: 'business', icon: KeyRound },
  { id: 'welfare', label: '福利规则', group: 'business', icon: Gift },
  { id: 'community', label: '社区内容', group: 'content', icon: Activity },
  { id: 'tagDictionary', label: '标签字典', group: 'content', icon: Tags },
  { id: 'bannedwords', label: '违禁词库', group: 'content', icon: ShieldAlert },
  { id: 'brands', label: '品牌与颜色', group: 'assets', icon: Palette },
  { id: 'resources', label: '真实资源文件', group: 'assets', icon: Archive },
  { id: 'operationLogs', label: '操作审计', group: 'system', icon: ScrollText },
  { id: 'runLogs', label: '运行日志', group: 'system', icon: FileClock },
  { id: 'announcements', label: '公告系统', group: 'system', icon: Megaphone },
  { id: 'config', label: '功能配置', group: 'system', icon: Settings2 },
  { id: 'roles', label: '角色与权限', group: 'system', icon: ShieldCheck },
];
const MENU_ITEMS = ADMIN_MENU_ITEMS;

/** 需要 effective capability 才显示的菜单项（能力未知时全部可见，不猜）。 */
const CAPABILITY_SECTIONS: Partial<Record<SectionId, CapabilityKey>> = {
  credits: 'credits.read',
  welfare: 'credits.read',
  brands: 'colors.read',
};
export function visibleMenuSections(capabilities: AdminCapabilities | null): SectionId[] {
  if (!capabilities) return MENU_ITEMS.map(item => item.id);
  return MENU_ITEMS
    .filter(item => {
      const required = CAPABILITY_SECTIONS[item.id];
      return !required || capabilities.capabilities[required];
    })
    .map(item => item.id);
}

const SECTION_DESCRIPTIONS: Record<SectionId, string> = {
  dashboard: '查看用户增长、内容数据与服务运行情况；不可用项标记为 —。',
  users: '查找用户，管理账号、会员与访问权限；筛选变更后 300ms 自动生效。',
  credits: '查看真实积分余额与消费流水，核对账户快照和原因后调整积分。',
  codes: '生成、查询与管理兑换码，操作前核对范围。',
  welfare: '配置新注册自动赠送等福利规则，查看每条规则的发放统计。',
  community: '查看帖子与图纸证据，填写原因后进行审核；审核队列与举报在板块内 tab。',
  tagDictionary: '管理标签展示名与启停状态；隐藏即时生效，存量帖子上的标签保留。',
  bannedwords: '管理发布拦截违禁词；只拦新增与编辑，修改后最多 5 分钟生效。',
  brands: '先选择品牌，再管理该品牌的子颜色。已有图纸保留颜色快照。',
  resources: '查看实际存储对象与预览，资源删除保持禁用。',
  operationLogs: '结构化管理写操作审计；展开行查看改动前后字段级对比。',
  runLogs: '运行日志 / 定时任务 / 管理会话合并板块；旧系统日志按数据源分流检索。',
  announcements: '管理公告草稿、发布状态与展示范围。',
  config: '查看功能配置，核对差异后提交变更；支持设置变更历史 diff。',
  roles: '管理角色与权限，授权结果以服务端为准。',
};
const formatter = new Intl.NumberFormat('zh-CN');
export function formatAdminMetric(value: unknown): string { return typeof value === 'number' && Number.isFinite(value) ? formatter.format(value) : '—'; }
export function sumAdminMetrics(a: unknown, b: unknown): number | undefined { return typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) ? a + b : undefined; }
/** 批次 5：旧 SectionId 兼容映射（书签不 404）。 */
export const LEGACY_SECTION_MAP: Record<string, SectionId> = {
  logs: 'runLogs',
  sessions: 'runLogs',
  cronRuns: 'runLogs',
  'colors-assets': 'brands',
};
export function resolveAdminSection(value: string | null): SectionId {
  if (value && LEGACY_SECTION_MAP[value]) return LEGACY_SECTION_MAP[value];
  return MENU_ITEMS.some(item => item.id === value) ? value as SectionId : 'dashboard';
}
export function adminAccessFailure(status: number, signedIn: boolean): AccessState { return status === 403 ? 'forbidden' : status === 401 ? signedIn ? 'session-required' : 'signed-out' : 'unavailable'; }
const currentMenu = (id: SectionId) => MENU_ITEMS.find(item => item.id === id)!;
function normalizeLegacySectionUrl() {
  const url = new URL(window.location.href);
  const raw = url.searchParams.get('section');
  const mapped = raw ? LEGACY_SECTION_MAP[raw] : undefined;
  if (!mapped) return;
  url.searchParams.set('section', mapped);
  window.history.replaceState(window.history.state, '', url);
}

function Sidebar({ active, navigate, returnToApp, visibleSections }: { active: SectionId; navigate: (id: SectionId) => void; returnToApp: () => void; visibleSections: ReadonlySet<SectionId> }) {
  return <>
    <div className="admin-brand"><span className="admin-brand-mark"><ShieldEllipsis aria-hidden="true" /></span><div><strong>拼豆管理工作台</strong><small>运营与平台管理</small></div></div>
    <nav className="admin-navigation" aria-label="后台菜单">{GROUPS.map(group => {
      const items = MENU_ITEMS.filter(item => item.group === group.id && visibleSections.has(item.id));
      if (items.length === 0) return null;
      return <section className="admin-nav-group" key={group.id}>
        <h2>{group.label}</h2>{items.map(item => { const Icon = item.icon;
          return <button type="button" className="admin-nav-item" key={item.id} data-admin-section={item.id} aria-current={active === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon aria-hidden="true" /><span>{item.label}</span></button>;
        })}</section>;
    })}</nav>
    <div className="admin-sidebar-footer"><AdminButton variant="ghost" onClick={returnToApp}><ArrowLeft aria-hidden="true" />返回前台</AdminButton></div>
  </>;
}
function TrendChart({ label, points }: { label: string; points?: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const samples = (Array.isArray(points) ? points : []).filter(point => typeof point.date === 'string' && Number.isFinite(point.count));
  const count = samples.length;
  const peak = Math.max(0, ...samples.map(point => point.count));
  const flat = peak === 0;
  // 给峰值留 15% 的顶空，否则最大值那一天会顶到上边框，看着像被裁掉。
  const scale = flat ? 1 : peak * 1.15;
  const total = samples.reduce((sum, point) => sum + Math.max(0, point.count), 0);
  // 92 是基线，向上 80 个单位留给最大值；顶部再留 12 给 hover 气泡。
  const at = (index: number): [number, number] => {
    const x = count <= 1 ? 50 : (index / (count - 1)) * 100;
    const y = 92 - (Math.max(0, samples[index].count) / scale) * 80;
    return [Number(x.toFixed(2)), Number(y.toFixed(2))];
  };
  const polyline = samples.map((_, index) => at(index).join(' ')).join(' L ');
  const area = count ? 'M ' + at(0)[0] + ' 100 L ' + polyline + ' L ' + at(count - 1)[0] + ' 100 Z' : '';
  return <article className="admin-chart">
    <div className="admin-chart-head">
      <h3>{label}</h3>
      {count > 0 && <p><span>{count}日合计</span><strong>{formatAdminMetric(total)}</strong></p>}
    </div>
    {count ? <>
      <div className="admin-chart-plot" onMouseLeave={() => setHover(null)}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label + '，最近' + count + '天合计' + formatAdminMetric(total)}>
          {[12, 52, 92].map(y => <line key={y} x1="0" y1={y} x2="100" y2={y} className="admin-chart-grid" vectorEffect="non-scaling-stroke" />)}
          <path d={area} className="admin-chart-area" />
          <path d={'M ' + polyline} className="admin-chart-line" vectorEffect="non-scaling-stroke" />
          {hover !== null && <line x1={at(hover)[0]} y1="4" x2={at(hover)[0]} y2="100" className="admin-chart-cursor" vectorEffect="non-scaling-stroke" />}
        </svg>
        {flat && <p className="admin-chart-flat">{count} 天内没有新增</p>}
        <div className="admin-chart-hits">
          {samples.map((point, index) => <button key={point.date} type="button" className="admin-chart-hit"
            aria-label={point.date + '：' + formatAdminMetric(point.count)}
            onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} />)}
        </div>
        {hover !== null && <div className="admin-chart-tip"
          style={{ left: at(hover)[0] + '%', transform: 'translateX(' + (at(hover)[0] < 14 ? '0' : at(hover)[0] > 86 ? '-100%' : '-50%') + ')' }}>
          <span>{samples[hover].date.slice(5)}</span><b>{formatAdminMetric(samples[hover].count)}</b>
        </div>}
      </div>
      <div className="admin-chart-axis">{samples.map(point => <span key={point.date}>{point.date.slice(5)}</span>)}</div>
    </> : <AdminEmptyState title="暂无趋势样本" description="未收到可用数据，不补造趋势。" />}
  </article>;
}
/** 批次 3：待办卡。数字来自服务端 todo 分段；缺失时不渲染（不伪造 0）。 */
function TodoCards({ todo, navigate }: { todo: DashboardData['todo']; navigate: (id: SectionId, query?: Record<string, string>) => void }) {
  if (!todo) return null;
  const cards: { key: string; label: string; value: number; detail: string; tone: 'danger' | 'warning' | 'neutral'; target: SectionId; query: Record<string, string> }[] = [
    { key: 'pendingReviews', label: '待审核帖子', value: todo.pendingReviews, detail: '命中违禁词或被举报后进入人工审核', tone: todo.pendingReviews > 0 ? 'warning' : 'neutral', target: 'community', query: todoDrillQuery('reviews') },
    { key: 'pendingReports', label: '待处理举报', value: todo.pendingReports, detail: 'open 状态的内容举报', tone: todo.pendingReports > 0 ? 'danger' : 'neutral', target: 'community', query: todoDrillQuery('reports') },
    { key: 'codes', label: '兑换码库存', value: todo.availableCodes ?? 0, detail: todo.lowStockCodes ? `低于阈值 ${todo.lowStockThreshold ?? '—'}，建议补充` : `阈值 ${todo.lowStockThreshold ?? '—'} 内，库存正常`, tone: todo.lowStockCodes ? 'danger' : 'neutral', target: 'codes', query: todoDrillQuery('codes') },
  ];
  return <section className="admin-dashboard-section" aria-labelledby="admin-todo-title" data-dashboard-todo>
    <AdminToolbar><h2 id="admin-todo-title">待办事项</h2><p>点击卡片下钻到对应板块（带预置筛选）。</p></AdminToolbar>
    <div className="admin-metrics">
      {cards.map((card) => <button type="button" key={card.key} className="admin-metric" data-todo-card={card.key}
        aria-label={card.label + ' ' + card.value + '，去处理'}
        onClick={() => navigate(card.target, card.query)}>
        <div className="admin-metric-head"><span>{card.label}</span><AdminBadge tone={card.tone}>{card.tone === 'neutral' ? '正常' : '待处理'}</AdminBadge></div>
        <p className="admin-metric-value" data-todo-value={card.key}>{formatAdminMetric(card.value)}</p>
        <p>{card.detail}</p>
        <ArrowUpRight className="admin-metric-open" aria-hidden="true" />
      </button>)}
    </div>
  </section>;
}

/** 批次 3：今日指标 + 7 天注册趋势 mini bar。 */
function MetricsPanel({ metrics }: { metrics: DashboardData['metrics'] }) {
  if (!metrics) return null;
  const registered = todayRegistrations(metrics);
  const heights = trendBarHeights(metrics.registerTrend7d);
  const cards: { key: string; label: string; value: number | null; icon: LucideIcon }[] = [
    { key: 'works', label: '今日新作品', value: metrics.todayNewWorks, icon: Archive },
    { key: 'posts', label: '今日新帖子', value: metrics.todayNewPosts, icon: Activity },
    { key: 'reports', label: '今日新举报', value: metrics.todayNewReports, icon: ShieldAlert },
    { key: 'registrations', label: '今日新注册', value: registered, icon: Users },
  ];
  return <section className="admin-dashboard-section" aria-labelledby="admin-metrics-title" data-dashboard-metrics>
    <AdminToolbar><h2 id="admin-metrics-title">今日概览</h2><p>统计自今日 0 点起（UTC）；7 天注册趋势横轴为最近 7 天。</p></AdminToolbar>
    <div className="admin-metrics">
      {cards.map((card) => <article className="admin-metric admin-metric--sm" key={card.key} data-metric-card={card.key}>
        <div className="admin-metric-head"><span>{card.label}</span><card.icon aria-hidden="true" /></div>
        <p className="admin-metric-value" data-metric-value={card.key}>{formatAdminMetric(card.value)}</p>
      </article>)}
    </div>
    {/* 7 天注册趋势：横向 flex mini bar（CSS 落地横排），柱高按峰值归一。 */}
    {metrics.registerTrend7d.length > 0 && <div className="admin-register-trend" data-register-trend>
      {metrics.registerTrend7d.map((point, index) => <div key={point.date} className="admin-register-bar" title={point.date + '：' + point.count}>
        <span className="admin-register-track" aria-hidden="true"><i style={{ height: heights[index] + '%' }} /></span>
        <small>{point.date.slice(5)}</small>
      </div>)}
    </div>}
  </section>;
}

function Dashboard({ data, error, loading, retry, navigate }: { data: DashboardData | null; error: string; loading: boolean; retry: () => void; navigate: (id: SectionId, query?: Record<string, string>) => void }) {
  if (loading && !data) return <AdminLoading label="正在加载服务端统计…" />;
  if (error) return <AdminErrorState title="统计暂不可用" message={error} retry={retry} busy={loading} />;
  if (!data) return <AdminEmptyState title="尚无统计结果" description="未知值不会显示为零。" action={<AdminButton onClick={retry}>刷新统计</AdminButton>} />;
  const overview = data.overview, telemetry = data.telemetry;
  const trendDefs = ([
    { label: '用户新增趋势', points: data.trends?.days7?.users },
    { label: '图纸创建趋势', points: data.trends?.days7?.works },
    { label: '社区发布趋势', points: data.trends?.days7?.communityPosts },
    { label: '成功操作趋势', points: data.trends?.days7?.successfulActions },
    { label: '服务端错误趋势', points: data.trends?.days7?.errors },
  ] as { label: string; points?: TrendPoint[] }[]).map(item => {
    const samples = (Array.isArray(item.points) ? item.points : []).filter(point => typeof point.date === 'string' && Number.isFinite(point.count));
    // 全 0 的图不再占一张大卡：它只是"这段时间没发生"，折叠成一行说明。
    return { ...item, zero: samples.length > 0 && samples.every(point => point.count <= 0) };
  });
  const duration = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? formatAdminMetric(Math.max(0, Math.round(value))) + ' ms' : '—';
  // 运营总览两级分层（PRD B6）：4 项核心指标合并为一张大卡（数字 ≥24px），不再 4 张独立小卡。
  const overviewItems: { key: string; label: string; value: unknown; detail: string; target?: SectionId }[] = [
    { key: 'totalUsers', label: '注册用户', value: overview?.totalUsers, detail: '近30天新增 ' + formatAdminMetric(overview?.newUsers30Days), target: 'users' },
    { key: 'activeVipUsers', label: '活跃会员', value: overview?.activeVipUsers, detail: '当前有效 VIP / Pro', target: 'users' },
    { key: 'works', label: '图纸与社区作品', value: sumAdminMetrics(overview?.works, overview?.communityPosts), detail: '图纸 ' + formatAdminMetric(overview?.works) + ' · 社区 ' + formatAdminMetric(overview?.communityPosts), target: 'community' },
    { key: 'redeemedCodes', label: '累计兑换', value: overview?.redeemedCodes, detail: '近24小时错误 ' + formatAdminMetric(overview?.recentErrors), target: 'codes' },
  ];
  return <section aria-label="运营概览" aria-busy={loading}>
    <AdminToolbar><h2>运营概览</h2></AdminToolbar>
    {loading && <p role="status" className="admin-muted">正在更新统计，当前结果暂时保留…</p>}
    <TodoCards todo={data.todo} navigate={navigate} />
    <MetricsPanel metrics={data.metrics} />
    <div className="admin-overview-card" data-overview-card>
      {overviewItems.map(item => {
        const text = typeof item.value === 'string' ? item.value : formatAdminMetric(item.value);
        return item.target
          ? <button type="button" key={item.key} className="admin-overview-item" data-overview-item={item.key} aria-label={item.label + ' ' + text + '，查看明细'} onClick={() => navigate(item.target!)}>
            <span>{item.label}</span><strong>{text}</strong><small>{item.detail}</small>
          </button>
          : <div key={item.key} className="admin-overview-item" data-overview-item={item.key}><span>{item.label}</span><strong>{text}</strong><small>{item.detail}</small></div>;
      })}
    </div>
    <section className="admin-dashboard-section" aria-labelledby="admin-telemetry-title"><AdminToolbar><h2 id="admin-telemetry-title">性能与错误监控</h2><p>仅统计已采集的状态变更和服务端错误，不代表所有请求。</p></AdminToolbar>
      <div className="admin-ops">
        <div><span>24小时成功操作</span><strong>{formatAdminMetric(telemetry?.successfulActions24h)}</strong></div>
        <div><span>平均耗时</span><strong>{telemetry && telemetry.durationSamples24h > 0 ? duration(telemetry.averageDurationMs) : '—'}</strong></div>
        <div><span>最大耗时</span><strong>{telemetry && telemetry.durationSamples24h > 0 ? duration(telemetry.maximumDurationMs) : '—'}</strong></div>
        <div><span>24小时服务端错误</span><strong>{formatAdminMetric(telemetry?.errors24h)}</strong></div>
        {telemetry && Array.isArray(telemetry.errorCodes)
          ? telemetry.errorCodes.length === 0 && <p className="admin-ops-note"><CheckCircle2 aria-hidden="true" />近 24 小时未记录服务端错误</p>
          : <p className="admin-ops-note" data-tone="muted">遥测暂不可用</p>}
      </div>
      {telemetry && Array.isArray(telemetry.errorCodes) && telemetry.errorCodes.length > 0 && <div className="admin-telemetry"><h3>错误码分布</h3><div className="admin-toolbar-actions">{telemetry.errorCodes.map(item => <AdminBadge key={item.code} tone="danger">{item.code} · {formatAdminMetric(item.count)}</AdminBadge>)}</div></div>}
    </section>
    <div className="admin-charts">{trendDefs.filter(item => !item.zero).map(item => <React.Fragment key={item.label}><TrendChart label={item.label} points={item.points} /></React.Fragment>)}</div>
    {trendDefs.some(item => item.zero) && <p className="admin-zero-note">近 7 天没有新增：{trendDefs.filter(item => item.zero).map(item => item.label.replace('趋势', '')).join('、')}。产生数据后这里会出现对应趋势图。</p>}
    {/* 警告条降级（PRD B7）：页脚 footnote 灰字 + 展开箭头；展开后显示分段级 error 详情。 */}
    {Boolean(data.warnings?.length) && <details className="admin-warnings-footnote" role="status" data-dashboard-warnings>
      <summary>部分统计暂不可用（{data.warnings!.length} 项）</summary>
      <ul>{data.warnings!.map(warning => <li key={warning}>{warning}</li>)}</ul>
      {data.sections && Object.entries(data.sections).filter(([, section]) => section.available === false && section.error).map(([key, section]) => <p key={key}><span className="admin-mono">{key}</span>：{section.error}</p>)}
    </details>}
  </section>;
}
type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const controlValue = (control: Control) => control instanceof HTMLInputElement && control.type === 'checkbox' ? String(control.checked) : control.value;
export function isEditorControl(target: EventTarget | null): target is Control {
  // Secret inputs must never enter the generic dirty-editor value cache.
  return target instanceof HTMLElement && !target.matches('input[type="password"]') && !target.closest('[data-admin-sensitive]') && target.matches('input, textarea, select') && (target.matches('textarea, input[type="checkbox"]') || Boolean(target.closest('form, [role="dialog"], .fixed')));
}
function pruneEditorCache(cache: Map<Control, string>) {
  for (const control of cache.keys()) {
    if (!control.isConnected || !isEditorControl(control)) cache.delete(control);
  }
}
type PendingAction = { kind: 'refresh' } | { kind: 'navigate'; section: SectionId; fromHistory?: boolean; query?: Record<string, string> };

export function AdminConsole() {
  const { currentUser } = useAuth();
  // A different operator must receive a new shell, editor cache and request state.
  return <AdminConsoleSession key={currentUser?.uid ?? 'signed-out'} />;
}

function AdminConsoleSession(_props: { key?: string }) {
  const { currentUser } = useAuth();
  const signedIn = Boolean(currentUser), userUid = currentUser?.uid;
  const [access, setAccess] = useState<AccessState>('checking');
  const [accessError, setAccessError] = useState('');
  const [checking, setChecking] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardError, setDashboardError] = useState('');
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [capabilities, setCapabilities] = useState<AdminCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState('');
  const [capabilityLoading, setCapabilityLoading] = useState(false);
  const [trustedDevice, setTrustedDevice] = useState(false);
  const [mobileNavigation, setMobileNavigation] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>(() => resolveAdminSection(new URLSearchParams(window.location.search).get('section')));
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [modulePending, setModulePending] = useState(0);
  const [requestNotices, setRequestNotices] = useState<Record<string, string>>({});
  const requestNotice = requestNotices[activeSection] ?? '';
  const connectionNotices = useRef(new AdminConnectionNotices());
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const generation = useRef(0);
  const capabilityRevision = useRef(0);
  const edits = useRef(new Map<Control, string>());
  const editorRoot = useRef<HTMLElement | null>(null);
  const hasDirtyEdits = useCallback(() => {
    pruneEditorCache(edits.current);
    return Array.from(edits.current).some(([control, initial]) => controlValue(control) !== initial);
  }, []);
  useEffect(() => {
    const root = editorRoot.current;
    pruneEditorCache(edits.current);
    if (!root) return;
    const observer = new MutationObserver(() => pruneEditorCache(edits.current));
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'data-admin-sensitive'] });
    return () => { observer.disconnect(); edits.current.clear(); };
  }, [access]);
  const section = currentMenu(activeSection);
  const previewRequest = useMemo(() => createAdminBlobRequest(), []);
  const assetPreviewRequest = useCallback<AdminAssetPreviewRequest>(async path => {
    const result = await previewRequest(path);
    return { ok: result.ok, status: result.status, blob: result.data, error: result.error };
  }, [previewRequest]);
  const fetchAdmin = useMemo(() => createAdminRequest(), []);
  const adminRequest = useCallback(async <T,>(path: string, init?: RequestInit): Promise<AdminApiResult<T>> => {
    const requestGeneration = generation.current;
    const result = await fetchAdmin<T>(path, init);
    if (result.status === 401 && path !== '/api/admin/session' && requestGeneration === generation.current) {
      clearAdminSession(); setMobileNavigation(false); setLogoutOpen(false); setPendingAction(null); edits.current.clear(); setCapabilities(null); capabilityRevision.current++;
      setAccess(signedIn ? 'session-required' : 'signed-out'); setAccessError('后台会话已过期。请重新进入后台，或返回前台登录。');
    }
    return result;
  }, [fetchAdmin, signedIn, userUid]);
  const loadCapabilities = useCallback(async () => {
    const version = generation.current;
    const revision = ++capabilityRevision.current;
    const isCurrent = () => version === generation.current && revision === capabilityRevision.current;
    setCapabilityLoading(true); setCapabilityError('');
    try {
      const result = await adminRequest<AdminCapabilities>('/api/admin/capabilities');
      if (!isCurrent()) return;
      const parsed = result.ok ? parseAdminCapabilities(result.data, userUid ?? '') : null;
      setCapabilities(parsed);
      if (!parsed) setCapabilityError(result.error ?? '无法确认当前操作者权限，请重试读取。');
    } catch { if (isCurrent()) { setCapabilities(null); setCapabilityError('权限读取失败，请重试。'); } }
    finally { if (isCurrent()) setCapabilityLoading(false); }
  }, [adminRequest, userUid]);
  useEffect(() => { if (access === 'ready') void loadCapabilities(); }, [access, loadCapabilities, activeSection]);
  // Reload existing module effects without replacing the mounted component tree.
  const moduleRequest = useMemo<AdminRequest>(() => async <T,>(path: string, init?: RequestInit) => {
    const version = generation.current;
    const tracked = connectionNotices.current.begin(activeSection, path, init);
    setModulePending(value => value + 1);
    try {
      const result = await adminRequest<T>(path, init);
      if (version === generation.current) {
        connectionNotices.current.settle(tracked, result, userUid ?? '');
        setRequestNotices(connectionNotices.current.messages());
      }
      return result;
    }
    finally { setModulePending(value => Math.max(0, value - 1)); }
  }, [adminRequest, refreshRevision, activeSection, userUid]);
  const loadDashboard = useCallback(async () => {
    const version = generation.current;
    setDashboardLoading(true);
    try {
      const result = await adminRequest<DashboardData>('/api/admin/dashboard');
      if (version !== generation.current) return result.status;
      if (result.ok && result.data) { setDashboard(result.data); setDashboardError(''); }
      else { setDashboard(null); setDashboardError(result.status === 403 ? '服务端拒绝读取概览。仍可进入其它模块，权限以服务端结果为准。' : result.error ?? '统计加载失败，请重试。'); }
      return result.status;
    } finally { if (version === generation.current) setDashboardLoading(false); }
  }, [adminRequest]);
  const verifySession = useCallback(async () => {
    const version = ++generation.current;
    setChecking(true); setAccess('checking'); setAccessError('');
    try {
      const result = await adminRequest<{ authenticated: boolean }>('/api/admin/session');
      if (version !== generation.current) return;
      if (!result.ok || result.data?.authenticated !== true) {
        setAccess(adminAccessFailure(result.ok ? 401 : result.status, signedIn));
        setAccessError(result.status === 403 ? '此账号没有后台访问权限；授权以服务端结果为准。' : result.status === 401 ? '后台会话无效或已过期，请重新进入或返回前台登录。' : result.error ?? '无法验证后台会话，请重试。');
        return;
      }
      const status = await loadDashboard();
      if (version === generation.current && status !== 401) setAccess('ready');
    } catch {
      if (version === generation.current) { setAccess('unavailable'); setAccessError('会话验证失败，请检查网络后重试。'); }
    } finally { if (version === generation.current) setChecking(false); }
  }, [adminRequest, loadDashboard, signedIn]);
  useEffect(() => { void verifySession(); return () => { generation.current++; }; }, [verifySession]);
  useEffect(() => { normalizeLegacySectionUrl(); }, []);
  useEffect(() => {
    const popstate = () => {
      normalizeLegacySectionUrl();
      const next = resolveAdminSection(new URLSearchParams(window.location.search).get('section'));
      const dirty = hasDirtyEdits();
      if (dirty) setPendingAction({ kind: 'navigate', section: next, fromHistory: true });
      else { edits.current.clear(); setActiveSection(next); }
    };
    window.addEventListener('popstate', popstate); return () => window.removeEventListener('popstate', popstate);
  }, []);
  const createSession = async () => {
    if (!signedIn) { setAccess('signed-out'); return; }
    setChecking(true); setAccessError('');
    try {
      const result = await adminRequest<{ token?: string }>('/api/admin/session', { method: 'POST', body: JSON.stringify({ trustedDevice }) });
      if (!result.ok) { setAccess(adminAccessFailure(result.status, signedIn)); setAccessError(result.error ?? '后台会话创建失败，请重试。'); return; }
      if (result.data?.token) setAdminSessionToken(result.data.token);
      await verifySession();
    } catch { setAccess('unavailable'); setAccessError('后台会话创建失败，请重试。'); }
    finally { setChecking(false); }
  };
  const performAction = (action: PendingAction) => {
    if (action.kind === 'refresh') { if (activeSection === 'dashboard') void loadDashboard(); else { if (activeSection === 'brands' || activeSection === 'credits' || activeSection === 'welfare') void loadCapabilities(); setRefreshRevision(value => value + 1); } }
    else {
      edits.current.clear(); setActiveSection(action.section);
      if (!action.fromHistory) {
        const url = new URL(window.location.href);
        url.searchParams.set('section', action.section);
        // 批次 3：待办卡下钻的预置筛选参数；先清掉旧的再写入新的。
        url.searchParams.delete('preset');
        for (const [key, value] of Object.entries(action.query ?? {})) url.searchParams.set(key, value);
        window.history.pushState({}, '', url);
      }
    }
  };
  const queueAction = (action: PendingAction) => {
    setMobileNavigation(false);
    const dirty = hasDirtyEdits();
    if (dirty) setPendingAction(action); else performAction(action);
  };
  const navigate = (id: SectionId, query?: Record<string, string>) => { if (id === activeSection && !query) { setMobileNavigation(false); return; } queueAction({ kind: 'navigate', section: id, query }); };
  const returnToApp = () => window.location.assign('/');
  const logout = async () => {
    setLoggingOut(true); setLogoutError('');
    try {
      const result = await adminRequest('/api/admin/session/logout', { method: 'POST', body: JSON.stringify({}) });
      if (!result.ok) { setLogoutError(result.error ?? '退出请求失败，后台会话尚未确认撤销。'); return; }
      generation.current++; clearAdminSession(); setDashboard(null); setLogoutOpen(false); setAccess(signedIn ? 'session-required' : 'signed-out'); setAccessError('');
    } finally { setLoggingOut(false); }
  };
  // Hook order must stay unconditional: this memo sits above the early gate return.
  const visibleSections = useMemo(() => new Set(visibleMenuSections(capabilities)), [capabilities]);

  if (access !== 'ready') {
    // 四种进不来的原因要分开说：没登录却被告知"会话已过期"是最容易让人卡住的一种。
    const gate = access === 'forbidden'
      ? { title: '无后台访问权限', message: accessError || '当前账号没有后台访问权限，授权以服务端结果为准。' }
      : access === 'signed-out'
        ? { title: '还没有登录', message: '请先登录正式账号。后台只对正式账号开放，登录后回到这个页面即可。' }
        : access === 'session-required'
          ? { title: '后台会话已过期', message: '为安全起见后台会话会定时失效。重新进入即可继续，不需要重新登录。' }
          : access === 'unavailable'
            ? { title: '暂时连不上后台', message: accessError || '无法连接后台服务，请检查网络后重试。' }
            : null;
    // 门页原来是一张 460px 的白卡浮在大片空白上：品牌、状态、操作三层挤在 240px 宽里，
    // 红色错误块和主按钮互相抢。改成"深色品牌栏 + 浅色操作栏"，状态标题直接当 h1。
    return <div className="admin-root"><main className="admin-access"><section className="admin-access-card" aria-busy={checking}>
      <aside className="admin-gate-brand">
        <div className="admin-gate-lockup"><span className="admin-gate-mark"><ShieldCheck aria-hidden="true" /></span><div><strong>拼豆管理工作台</strong><span>运营与平台管理</span></div></div>
        <ul className="admin-gate-scope"><li>用户与会员</li><li>卡密与积分</li><li>内容与色彩</li></ul>
        <p className="admin-gate-note">仅限授权运营人员使用。后台会话会定时失效，到时重新进入即可。</p>
      </aside>
      <div className="admin-gate-panel">
        <h1>{gate ? gate.title : '正在验证会话'}</h1>
        <p className="admin-gate-lead" role={gate ? 'alert' : undefined}>{gate ? gate.message : '正在确认后台会话，请稍候。'}</p>
        {checking ? <AdminLoading label="正在验证后台会话…" /> : <div className="admin-gate-actions">
          {access === 'session-required' && <>
            <label className="admin-check admin-gate-trust"><input type="checkbox" checked={trustedDevice} onChange={event => setTrustedDevice(event.target.checked)} /><span>信任此设备 30 天<small>仅对当前浏览器生效，期间免去重复进入。</small></span></label>
            <AdminButton variant="primary" busy={checking} onClick={() => void createSession()}>重新进入后台</AdminButton>
          </>}
          {access === 'signed-out' && <AdminButton variant="primary" onClick={() => window.location.assign('/workspace')}>去登录</AdminButton>}
          {access === 'unavailable' && <AdminButton variant="primary" onClick={() => void verifySession()} busy={checking}>重试连接</AdminButton>}
          {access === 'forbidden' && <AdminButton variant="primary" onClick={() => void verifySession()} busy={checking}>重新验证权限</AdminButton>}
          <div className="admin-gate-secondary">
            {(access === 'forbidden' || access === 'session-required') && <AdminButton variant="ghost" onClick={() => void verifySession()} busy={checking}>重新验证会话</AdminButton>}
            <AdminButton variant="ghost" onClick={returnToApp}><ArrowLeft aria-hidden="true" />返回前台</AdminButton>
          </div>
        </div>}
      </div>
    </section></main></div>;
  }

  const busy = dashboardLoading || modulePending > 0;
  const module = activeSection === 'users' || activeSection === 'roles' ? <AdminUsersRoles mode={activeSection} request={moduleRequest} />
    : activeSection === 'codes' ? <AdminLogsCodes mode="codes" request={moduleRequest} />
    : activeSection === 'announcements' ? <AdminAnnouncementsConfig mode="announcements" request={moduleRequest} />
    : activeSection === 'config' ? <div className="admin-final-modules"><AdminAnnouncementsConfig mode="config" request={moduleRequest} /><FeatureFlagsPanel request={moduleRequest} /><SettingsDiffView request={moduleRequest} /></div>
    : activeSection === 'operationLogs' ? <OperationLogViewer request={moduleRequest} />
    : activeSection === 'runLogs' ? <RunLogsSection request={moduleRequest} operatorUid={capabilities?.operatorUid ?? userUid ?? ''} />
    : activeSection === 'credits' ? capabilityError ? <AdminErrorState title="权限尚未确认" message={capabilityError} retry={() => void loadCapabilities()} busy={capabilityLoading} />
      : !capabilities ? <AdminLoading label="正在确认积分管理权限…" />
      : capabilities.capabilities['credits.read'] ? <AdminCredits request={moduleRequest} canRead={capabilities.capabilities['credits.read']} canAdjust={capabilities.capabilities['credits.adjust']} operatorUid={capabilities.operatorUid} />
      : <AdminErrorState title="无积分读取权限" message="当前操作者缺少 credits.read 权限，请联系有授权能力的管理员。" retry={() => void loadCapabilities()} busy={capabilityLoading} />
    : activeSection === 'welfare' ? capabilityError ? <AdminErrorState title="权限尚未确认" message={capabilityError} retry={() => void loadCapabilities()} busy={capabilityLoading} />
      : !capabilities ? <AdminLoading label="正在确认福利规则权限…" />
      : capabilities.capabilities['credits.read'] ? <AdminWelfare request={moduleRequest} canAdjust={capabilities.capabilities['credits.adjust']} />
      : <AdminErrorState title="无积分读取权限" message="当前操作者缺少 credits.read 权限，请联系有授权能力的管理员。" retry={() => void loadCapabilities()} busy={capabilityLoading} />
    : activeSection === 'brands' ? capabilityError ? <AdminErrorState title="权限尚未确认" message={capabilityError} retry={() => void loadCapabilities()} busy={capabilityLoading} />
      : !capabilities ? <AdminLoading label="正在确认品牌管理权限…" />
      : capabilities.capabilities['colors.read'] ? <AdminBrandsColors request={moduleRequest} readOnly={!capabilities.capabilities['colors.write']} operatorUid={capabilities.operatorUid} />
      : <AdminErrorState title="无品牌读取权限" message="当前操作者缺少 colors.read 权限，请联系有授权能力的管理员。" retry={() => void loadCapabilities()} busy={capabilityLoading} />
    : activeSection === 'resources' ? <AdminPaletteResources request={moduleRequest} previewRequest={assetPreviewRequest} readOnly />
    : activeSection === 'community' ? <AdminCommunityPosts request={moduleRequest} previewRequest={previewRequest} />
    : activeSection === 'tagDictionary' ? <AdminCommunityTagDictionary request={moduleRequest} />
    : activeSection === 'bannedwords' ? <AdminBannedWords request={moduleRequest} /> : null;
  return <div className="admin-root">
    <a className="admin-skip-link" href="#admin-main">跳到主要内容</a>
    <aside className="admin-sidebar"><Sidebar active={activeSection} navigate={navigate} returnToApp={returnToApp} visibleSections={visibleSections} /></aside>
    <div className="admin-layout"><header className="admin-header"><div className="admin-header-title">
      <AdminButton className="admin-mobile-menu" iconOnly variant="ghost" aria-label="打开菜单" aria-expanded={mobileNavigation} onClick={() => setMobileNavigation(true)}><Menu aria-hidden="true" /></AdminButton>
      <div><nav className="admin-breadcrumb" aria-label="面包屑"><span>管理工作台</span><ChevronRight aria-hidden="true" /><span>{GROUPS.find(group => group.id === section.group)?.label}</span></nav><h1>{section.label}</h1></div>
    </div><div className="admin-header-actions"><div className="admin-account"><span className="admin-account-name">{currentUser?.displayName || currentUser?.email || '管理员'}</span><span className="admin-account-session" title="后台会话有效；会话会定时失效，届时需重新进入"><i aria-hidden="true" />会话有效</span></div>
      <AdminButton data-admin-refresh data-admin-focus-fallback iconOnly variant="ghost" aria-label={'刷新' + section.label} title={'只刷新' + section.label} busy={busy} onClick={() => queueAction({ kind: 'refresh' })}>{!busy && <RefreshCw aria-hidden="true" />}</AdminButton>
      <AdminButton iconOnly variant="ghost" aria-label="退出后台会话" title="退出后台会话" onClick={() => { setLogoutError(''); setLogoutOpen(true); }}><LogOut aria-hidden="true" /></AdminButton>
    </div></header>
      <main ref={editorRoot} className="admin-main" id="admin-main" tabIndex={-1}
        onFocusCapture={event => { pruneEditorCache(edits.current); if (isEditorControl(event.target) && !edits.current.has(event.target)) edits.current.set(event.target, controlValue(event.target)); }}
        onChangeCapture={event => { pruneEditorCache(edits.current); if (isEditorControl(event.target) && !edits.current.has(event.target)) edits.current.set(event.target, '\u0000'); }}>
        <p className="admin-page-description">{SECTION_DESCRIPTIONS[activeSection]}</p>
        {requestNotice && <AdminErrorState title="模块连接失败" message={requestNotice} retry={() => queueAction({ kind: 'refresh' })} busy={busy} />}
        {activeSection === 'dashboard' ? <Dashboard data={dashboard} error={dashboardError} loading={dashboardLoading} retry={() => void loadDashboard()} navigate={navigate} /> : <div className="admin-module" data-admin-module={activeSection}>{module}</div>}
      </main>
    </div>
    <AdminDrawer open={mobileNavigation} title="后台菜单" side="left" className="admin-navigation-drawer" onClose={() => setMobileNavigation(false)}><Sidebar active={activeSection} navigate={navigate} returnToApp={returnToApp} visibleSections={visibleSections} /></AdminDrawer>
    <AdminConfirmDialog open={Boolean(pendingAction)} title="存在未保存编辑" description="取消会保留当前输入。确认后将继续刷新或切换页面。" subject={section.label} impact="尚未保存的编辑可能丢失，请先核对。" confirmLabel="放弃编辑并继续" onClose={() => { if (pendingAction?.kind === 'navigate' && pendingAction.fromHistory) { const url = new URL(window.location.href); url.searchParams.set('section', activeSection); window.history.replaceState({}, '', url); } setPendingAction(null); }} onConfirm={() => { const action = pendingAction; setPendingAction(null); edits.current.clear(); if (action) performAction(action); }} />
    <AdminConfirmDialog open={logoutOpen} title="退出后台会话" description="确认后将请求撤销当前后台会话。" subject={currentUser?.displayName || currentUser?.email || '当前管理员'} impact="退出后台管理，保留前台登录；未保存编辑可能丢失。" confirmLabel="退出后台会话" pending={loggingOut} onClose={() => setLogoutOpen(false)} onConfirm={() => void logout()}>{logoutError && <AdminErrorState message={logoutError} />}</AdminConfirmDialog>
  </div>;
}
