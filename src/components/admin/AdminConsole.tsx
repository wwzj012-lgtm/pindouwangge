import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Archive, ArrowLeft, CheckCircle2, ChevronRight, ClipboardList, Crown, KeyRound, LayoutDashboard, LogOut, Menu, Megaphone, Palette, RefreshCw, Settings2, ShieldCheck, ShieldEllipsis, Users, type LucideIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { clearAdminSession, setAdminSessionToken } from '../../utils/api';
import { AdminUsersRoles } from './AdminUsersRoles';
import { AdminLogsCodes } from './AdminLogsCodes';
import { AdminAnnouncementsConfig } from './AdminAnnouncementsConfig';
import { AdminContentResources } from './AdminContentResources';
import { AdminPaletteResources, type AdminAssetPreviewRequest } from './AdminPaletteResources';
import { AdminCommunityPosts } from './AdminCommunityPosts';
import { AdminBadge, AdminButton, AdminConfirmDialog, AdminDrawer, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { createAdminBlobRequest, createAdminRequest, type AdminApiResult, type AdminRequest } from './adminRequest';
import './admin.css';

export type { AdminApiResult, AdminRequest } from './adminRequest';
type AccessState = 'checking' | 'ready' | 'session-required' | 'forbidden' | 'signed-out' | 'unavailable';
type SectionId = 'dashboard' | 'users' | 'roles' | 'logs' | 'codes' | 'announcements' | 'config' | 'colors-assets' | 'community';
type GroupId = 'overview' | 'operations' | 'content' | 'system';
interface MenuItem { id: SectionId; label: string; group: GroupId; icon: LucideIcon; }
interface TrendPoint { date: string; count: number; }
interface DashboardData {
  overview: { totalUsers: number; newUsers30Days: number; activeVipUsers: number; works: number; communityPosts: number; redeemedCodes: number; recentErrors: number };
  trends: { days7: { users: TrendPoint[]; works: TrendPoint[]; communityPosts: TrendPoint[]; successfulActions: TrendPoint[]; errors: TrendPoint[] } };
  telemetry: { successfulActions24h: number; durationSamples24h: number; averageDurationMs: number; maximumDurationMs: number; errors24h: number; errorCodes: { code: string; count: number }[] };
  warnings?: string[];
}
const GROUPS: { id: GroupId; label: string }[] = [{ id: 'overview', label: '概览' }, { id: 'operations', label: '经营' }, { id: 'content', label: '内容' }, { id: 'system', label: '系统' }];
const MENU_ITEMS: MenuItem[] = [
  { id: 'dashboard', label: '数据仪表盘', group: 'overview', icon: LayoutDashboard },
  { id: 'users', label: '用户管理', group: 'operations', icon: Users },
  { id: 'codes', label: '兑换码管理', group: 'operations', icon: KeyRound },
  { id: 'community', label: '社区内容', group: 'content', icon: Activity },
  { id: 'announcements', label: '公告系统', group: 'content', icon: Megaphone },
  { id: 'colors-assets', label: '色卡与资源', group: 'content', icon: Palette },
  { id: 'logs', label: '系统日志', group: 'system', icon: ClipboardList },
  { id: 'config', label: '功能配置', group: 'system', icon: Settings2 },
  { id: 'roles', label: '角色与权限', group: 'system', icon: ShieldCheck },
];
const formatter = new Intl.NumberFormat('zh-CN');
export function formatAdminMetric(value: unknown): string { return typeof value === 'number' && Number.isFinite(value) ? formatter.format(value) : '—'; }
export function sumAdminMetrics(a: unknown, b: unknown): number | undefined { return typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) ? a + b : undefined; }
export function resolveAdminSection(value: string | null): SectionId { return MENU_ITEMS.some(item => item.id === value) ? value as SectionId : 'dashboard'; }
export function adminAccessFailure(status: number, signedIn: boolean): AccessState { return status === 403 ? 'forbidden' : status === 401 ? signedIn ? 'session-required' : 'signed-out' : 'unavailable'; }
const currentMenu = (id: SectionId) => MENU_ITEMS.find(item => item.id === id)!;

function Sidebar({ active, navigate, returnToApp }: { active: SectionId; navigate: (id: SectionId) => void; returnToApp: () => void }) {
  return <>
    <div className="admin-brand"><span className="admin-brand-mark"><ShieldEllipsis aria-hidden="true" /></span><div><strong>拼豆管理工作台</strong><small>运营与平台管理</small></div></div>
    <nav className="admin-navigation" aria-label="后台菜单">{GROUPS.map(group => <section className="admin-nav-group" key={group.id}>
      <h2>{group.label}</h2>{MENU_ITEMS.filter(item => item.group === group.id).map(item => { const Icon = item.icon;
        return <button type="button" className="admin-nav-item" key={item.id} data-admin-section={item.id} aria-current={active === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon aria-hidden="true" /><span>{item.label}</span></button>;
      })}</section>)}</nav>
    <div className="admin-sidebar-footer"><AdminButton variant="ghost" onClick={returnToApp}><ArrowLeft aria-hidden="true" />返回前台</AdminButton></div>
  </>;
}
function MetricCard({ label, value, detail, icon: Icon }: { label: string; value: unknown; detail: string; icon: LucideIcon }) {
  return <article className="admin-metric"><div className="admin-metric-head"><span>{label}</span><Icon aria-hidden="true" /></div><p className="admin-metric-value" data-metric={label}>{typeof value === 'string' ? value : formatAdminMetric(value)}</p><p>{detail}</p></article>;
}
function TrendChart({ label, points }: { label: string; points?: TrendPoint[] }) {
  const samples = (Array.isArray(points) ? points : []).filter(point => typeof point.date === 'string' && Number.isFinite(point.count));
  const maximum = Math.max(1, ...samples.map(point => point.count));
  const line = samples.map((point, index) => (samples.length === 1 ? 50 : index / (samples.length - 1) * 100) + ',' + (42 - Math.max(0, point.count) / maximum * 38)).join(' ');
  return <article className="admin-chart"><div className="admin-chart-head"><h3>{label}</h3><span>{formatAdminMetric(samples.at(-1)?.count)}</span></div>
    {samples.length ? <><svg viewBox="0 0 100 48" preserveAspectRatio="none" role="img" aria-label={label + '，最近' + samples.length + '个样本，末次' + formatAdminMetric(samples.at(-1)?.count)}><path d="M0 42H100" fill="none" stroke="var(--admin-border)" strokeWidth=".7" /><polyline points={line} fill="none" stroke="var(--admin-primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg><div className="admin-chart-axis">{samples.map(point => <span key={point.date}>{point.date.slice(5)}</span>)}</div></> : <AdminEmptyState title="暂无趋势样本" description="未收到可用数据，不补造趋势。" />}
  </article>;
}
function Dashboard({ data, error, loading, retry }: { data: DashboardData | null; error: string; loading: boolean; retry: () => void }) {
  if (loading && !data) return <AdminLoading label="正在加载服务端统计…" />;
  if (error) return <AdminErrorState title="统计暂不可用" message={error} retry={retry} busy={loading} />;
  if (!data) return <AdminEmptyState title="尚无统计结果" description="未知值不会显示为零。" action={<AdminButton onClick={retry}>刷新统计</AdminButton>} />;
  const overview = data.overview, telemetry = data.telemetry;
  const duration = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? formatAdminMetric(Math.max(0, Math.round(value))) + ' ms' : '—';
  return <section aria-label="运营概览" aria-busy={loading}>
    <AdminToolbar><h2>运营概览</h2><p>来自后台的汇总数据；不可用项目标记为 —。</p></AdminToolbar>
    {loading && <p role="status" className="admin-muted">正在更新统计，当前结果暂时保留…</p>}
    <div className="admin-metrics"><MetricCard label="注册用户" value={overview?.totalUsers} detail={'近30天新增 ' + formatAdminMetric(overview?.newUsers30Days)} icon={Users} /><MetricCard label="活跃会员" value={overview?.activeVipUsers} detail="当前有效 VIP / Pro" icon={Crown} /><MetricCard label="图纸与社区作品" value={sumAdminMetrics(overview?.works, overview?.communityPosts)} detail={'图纸 ' + formatAdminMetric(overview?.works) + ' · 社区 ' + formatAdminMetric(overview?.communityPosts)} icon={Archive} /><MetricCard label="累计兑换" value={overview?.redeemedCodes} detail={'近24小时错误 ' + formatAdminMetric(overview?.recentErrors)} icon={KeyRound} /></div>
    <section className="admin-dashboard-section" aria-labelledby="admin-telemetry-title"><AdminToolbar><h2 id="admin-telemetry-title">性能与错误监控</h2><p>仅统计已采集的状态变更和服务端错误，不代表所有请求。</p></AdminToolbar>
      <div className="admin-metrics"><MetricCard label="24小时成功操作" value={telemetry?.successfulActions24h} detail="仅计入已记录的状态变更" icon={Activity} /><MetricCard label="平均操作耗时" value={telemetry?.durationSamples24h > 0 ? duration(telemetry.averageDurationMs) : '—'} detail={'有效样本 ' + formatAdminMetric(telemetry?.durationSamples24h)} icon={Activity} /><MetricCard label="最大操作耗时" value={telemetry?.durationSamples24h > 0 ? duration(telemetry.maximumDurationMs) : '—'} detail="过去24小时的有效样本" icon={Activity} /><MetricCard label="24小时服务端错误" value={telemetry?.errors24h} detail={telemetry ? formatAdminMetric(telemetry.errorCodes?.length) + '类受控错误码' : '遥测暂不可用'} icon={Activity} /></div>
      <div className="admin-telemetry"><h3>错误码分布</h3>{telemetry && Array.isArray(telemetry.errorCodes) ? telemetry.errorCodes.length ? <div className="admin-toolbar-actions">{telemetry.errorCodes.map(item => <AdminBadge key={item.code} tone="danger">{item.code} · {formatAdminMetric(item.count)}</AdminBadge>)}</div> : <p className="admin-muted">近24小时未记录服务端错误。</p> : <p className="admin-muted">遥测数据暂不可用。</p>}</div>
    </section>
    <div className="admin-charts"><TrendChart label="用户新增趋势" points={data.trends?.days7?.users} /><TrendChart label="图纸创建趋势" points={data.trends?.days7?.works} /><TrendChart label="社区发布趋势" points={data.trends?.days7?.communityPosts} /><TrendChart label="成功操作趋势" points={data.trends?.days7?.successfulActions} /><TrendChart label="服务端错误趋势" points={data.trends?.days7?.errors} /></div>
    {Boolean(data.warnings?.length) && <div className="admin-warning" role="status"><strong>部分统计暂不可用</strong><ul>{data.warnings?.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
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
type PendingAction = { kind: 'refresh' } | { kind: 'navigate'; section: SectionId; fromHistory?: boolean };

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
  const [trustedDevice, setTrustedDevice] = useState(false);
  const [mobileNavigation, setMobileNavigation] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>(() => resolveAdminSection(new URLSearchParams(window.location.search).get('section')));
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [modulePending, setModulePending] = useState(0);
  const [requestNotice, setRequestNotice] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const generation = useRef(0);
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
      clearAdminSession(); setMobileNavigation(false); setLogoutOpen(false); setPendingAction(null); edits.current.clear();
      setAccess(signedIn ? 'session-required' : 'signed-out'); setAccessError('后台会话已过期。请重新进入后台，或返回前台登录。');
    }
    return result;
  }, [fetchAdmin, signedIn, userUid]);
  // Reload existing module effects without replacing the mounted component tree.
  const moduleRequest = useMemo<AdminRequest>(() => async <T,>(path: string, init?: RequestInit) => {
    setModulePending(value => value + 1);
    try { const result = await adminRequest<T>(path, init); if (result.status === 0) setRequestNotice(result.error ?? '后台连接失败，请重试。'); return result; }
    finally { setModulePending(value => Math.max(0, value - 1)); }
  }, [adminRequest, refreshRevision]);
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
  useEffect(() => {
    const popstate = () => {
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
    setRequestNotice('');
    if (action.kind === 'refresh') { if (activeSection === 'dashboard') void loadDashboard(); else setRefreshRevision(value => value + 1); }
    else { edits.current.clear(); setActiveSection(action.section); if (!action.fromHistory) { const url = new URL(window.location.href); url.searchParams.set('section', action.section); window.history.pushState({}, '', url); } }
  };
  const queueAction = (action: PendingAction) => {
    setMobileNavigation(false);
    const dirty = hasDirtyEdits();
    if (dirty) setPendingAction(action); else performAction(action);
  };
  const navigate = (id: SectionId) => { if (id === activeSection) { setMobileNavigation(false); return; } queueAction({ kind: 'navigate', section: id }); };
  const returnToApp = () => window.location.assign('/');
  const logout = async () => {
    setLoggingOut(true); setLogoutError('');
    try {
      const result = await adminRequest('/api/admin/session/logout', { method: 'POST', body: JSON.stringify({}) });
      if (!result.ok) { setLogoutError(result.error ?? '退出请求失败，后台会话尚未确认撤销。'); return; }
      generation.current++; clearAdminSession(); setDashboard(null); setLogoutOpen(false); setAccess(signedIn ? 'session-required' : 'signed-out'); setAccessError('');
    } finally { setLoggingOut(false); }
  };

  if (access !== 'ready') return <div className="admin-root"><main className="admin-access"><section className="admin-access-card" aria-busy={checking}>
    <span className="admin-brand-mark"><ShieldCheck aria-hidden="true" /></span><h1>管理工作台</h1>
    <p>{access === 'checking' ? '正在验证后台会话。' : access === 'forbidden' ? '当前账号没有后台访问权限。' : access === 'signed-out' ? '请先登录正式账号。' : access === 'session-required' ? '当前后台会话不可用，请重新进入。' : '暂时无法连接后台服务。'}</p>
    {access === 'checking' ? <AdminLoading label="正在验证后台会话…" /> : <>{accessError && <AdminErrorState title={access === 'forbidden' ? '无后台访问权限' : '会话尚未就绪'} message={accessError} retry={() => void verifySession()} busy={checking} />}
      <div className="admin-access-actions">{access === 'session-required' && <><label className="admin-check"><input type="checkbox" checked={trustedDevice} onChange={event => setTrustedDevice(event.target.checked)} />信任此设备30天</label><AdminButton variant="primary" busy={checking} onClick={() => void createSession()}>重新进入后台</AdminButton></>}
        {!accessError && <AdminButton onClick={() => void verifySession()} busy={checking}>重试</AdminButton>}
        <AdminButton onClick={() => window.location.assign('/workspace')}>返回前台登录</AdminButton><AdminButton variant="ghost" onClick={returnToApp}><ArrowLeft aria-hidden="true" />返回前台</AdminButton>
      </div></>}
  </section></main></div>;

  const busy = dashboardLoading || modulePending > 0;
  const module = activeSection === 'users' || activeSection === 'roles' ? <AdminUsersRoles mode={activeSection} request={moduleRequest} />
    : activeSection === 'logs' || activeSection === 'codes' ? <AdminLogsCodes mode={activeSection} request={moduleRequest} />
    : activeSection === 'announcements' || activeSection === 'config' ? <AdminAnnouncementsConfig mode={activeSection} request={moduleRequest} />
    : activeSection === 'colors-assets' ? <AdminContentResources mode={activeSection} request={moduleRequest} resourcesPanel={<AdminPaletteResources request={moduleRequest} previewRequest={assetPreviewRequest} readOnly />} />
    : activeSection === 'community' ? <AdminCommunityPosts request={moduleRequest} previewRequest={previewRequest} /> : null;
  return <div className="admin-root">
    <a className="admin-skip-link" href="#admin-main">跳到主要内容</a>
    <aside className="admin-sidebar"><Sidebar active={activeSection} navigate={navigate} returnToApp={returnToApp} /></aside>
    <div className="admin-layout"><header className="admin-header"><div className="admin-header-title">
      <AdminButton className="admin-mobile-menu" iconOnly variant="ghost" aria-label="打开菜单" aria-expanded={mobileNavigation} onClick={() => setMobileNavigation(true)}><Menu aria-hidden="true" /></AdminButton>
      <div><nav className="admin-breadcrumb" aria-label="面包屑"><span>管理工作台</span><ChevronRight aria-hidden="true" /><span>{GROUPS.find(group => group.id === section.group)?.label}</span></nav><h1>{section.label}</h1></div>
    </div><div className="admin-header-actions"><div className="admin-account"><span className="admin-account-name">{currentUser?.displayName || currentUser?.email || '管理员'}</span><AdminBadge tone="success"><CheckCircle2 aria-hidden="true" />后台会话有效</AdminBadge></div>
      <AdminButton data-admin-refresh data-admin-focus-fallback iconOnly variant="ghost" aria-label={'刷新' + section.label} title={'只刷新' + section.label} busy={busy} onClick={() => queueAction({ kind: 'refresh' })}>{!busy && <RefreshCw aria-hidden="true" />}</AdminButton>
      <AdminButton iconOnly variant="ghost" aria-label="退出后台会话" title="退出后台会话" onClick={() => { setLogoutError(''); setLogoutOpen(true); }}><LogOut aria-hidden="true" /></AdminButton>
    </div></header>
      <main ref={editorRoot} className="admin-main" id="admin-main" tabIndex={-1}
        onFocusCapture={event => { pruneEditorCache(edits.current); if (isEditorControl(event.target) && !edits.current.has(event.target)) edits.current.set(event.target, controlValue(event.target)); }}
        onChangeCapture={event => { pruneEditorCache(edits.current); if (isEditorControl(event.target) && !edits.current.has(event.target)) edits.current.set(event.target, '\u0000'); }}>
        {requestNotice && <AdminErrorState title="模块连接失败" message={requestNotice} retry={() => queueAction({ kind: 'refresh' })} busy={busy} />}
        {activeSection === 'dashboard' ? <Dashboard data={dashboard} error={dashboardError} loading={dashboardLoading} retry={() => void loadDashboard()} /> : <div className="admin-module" data-admin-module={activeSection}>{module}</div>}
      </main>
    </div>
    <AdminDrawer open={mobileNavigation} title="后台菜单" side="left" className="admin-navigation-drawer" onClose={() => setMobileNavigation(false)}><Sidebar active={activeSection} navigate={navigate} returnToApp={returnToApp} /></AdminDrawer>
    <AdminConfirmDialog open={Boolean(pendingAction)} title="存在未保存编辑" description="刷新或切换可能覆盖模块中的编辑。取消会保留当前内容；只有明确放弃后才继续。" confirmLabel="放弃编辑并继续" onClose={() => { if (pendingAction?.kind === 'navigate' && pendingAction.fromHistory) { const url = new URL(window.location.href); url.searchParams.set('section', activeSection); window.history.replaceState({}, '', url); } setPendingAction(null); }} onConfirm={() => { const action = pendingAction; setPendingAction(null); edits.current.clear(); if (action) performAction(action); }} />
    <AdminConfirmDialog open={logoutOpen} title="退出后台会话" description="将请求撤销当前后台会话；不会退出前台账号。未保存编辑可能丢失，请先确认。" confirmLabel="退出后台会话" pending={loggingOut} onClose={() => setLogoutOpen(false)} onConfirm={() => void logout()}>{logoutError && <AdminErrorState message={logoutError} />}</AdminConfirmDialog>
  </div>;
}
