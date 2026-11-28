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
import { parseDashboardRange, type DashboardRange } from './dashboard/dashboardRange';
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
/** 服务端 GET /api/admin/dashboard 的返回（只做加法：批次 6 新增 analytics / meta.range）。 */
interface DashboardData {
  /** 累计口径：只作页脚小字，不单独成图（PRD 禁止虚荣指标）。 */
  overview?: { totalUsers?: number; newUsers30Days?: number; activeVipUsers?: number; works?: number; communityPosts?: number; redeemedCodes?: number; recentErrors?: number };
  warnings?: string[];
  /** 批次 3：结构化分段可用性。失败时前端显示「数据暂不可用」。 */
  sections?: Record<string, { available: boolean; error?: string }>;
  todo?: unknown;
  /** 批次 6：analytics 段；解析失败为 null → 全部显示「—」，不补造 0。 */
  analytics?: unknown;
  meta?: { requests?: number; generatedAt?: number; range?: number };
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
/** 仪表盘整块懒加载：解析器 + 四个区块搬出 AdminPage 主 chunk（图表再单独一层懒加载）。 */
const LazyDashboardView = React.lazy(() => import('./dashboard/DashboardView'));
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
  // 时间范围（PRD §3）：默认 7 天，非法值回落 7；写入 URL 便于分享/刷新保持。
  const [range, setRange] = useState<DashboardRange>(() => parseDashboardRange(new URLSearchParams(window.location.search).get('range')));
  const rangeRef = useRef<DashboardRange>(range);
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
  const [loggingOut, setLoggingOut] = useState(false);
  // 退出免确认：失败（网络/服务端错误）才弹一行 toast，可点顶栏按钮重试。
  const [logoutError, setLogoutError] = useState('');
  const logoutToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (logoutToastTimer.current) clearTimeout(logoutToastTimer.current); }, []);
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
      clearAdminSession(); setMobileNavigation(false); setPendingAction(null); edits.current.clear(); setCapabilities(null); capabilityRevision.current++;
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
  /**
   * 取仪表盘。`range` 作为参数而非闭包依赖：切换范围只重取统计，
   * 不触发 verifySession（否则会把整页打回「正在验证会话」门页）。
   */
  const loadDashboard = useCallback(async (nextRange: DashboardRange = rangeRef.current) => {
    const version = generation.current;
    setDashboardLoading(true);
    try {
      const result = await adminRequest<DashboardData>(`/api/admin/dashboard?range=${nextRange}`);
      if (version !== generation.current) return result.status;
      if (result.ok && result.data) { setDashboard(result.data); setDashboardError(''); }
      else { setDashboard(null); setDashboardError(result.status === 403 ? '服务端拒绝读取概览。仍可进入其它模块，权限以服务端结果为准。' : result.error ?? '统计加载失败，请重试。'); }
      return result.status;
    } finally { if (version === generation.current) setDashboardLoading(false); }
  }, [adminRequest]);
  /** 切换时间范围：保留旧数据（PRD §4 刷新态），URL 同步，仅重取统计。 */
  const changeRange = useCallback((next: DashboardRange) => {
    if (next === rangeRef.current) return;
    rangeRef.current = next;
    setRange(next);
    const url = new URL(window.location.href);
    url.searchParams.set('range', String(next));
    window.history.replaceState(window.history.state, '', url);
    void loadDashboard(next);
  }, [loadDashboard]);
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
      if (!result.ok) {
        // 只有失败才打扰用户：一行可自动消失的 toast，顶栏按钮仍可重试。
        setLogoutError(result.error ?? '退出请求失败，请检查网络后重试。');
        if (logoutToastTimer.current) clearTimeout(logoutToastTimer.current);
        logoutToastTimer.current = setTimeout(() => setLogoutError(''), 3200);
        return;
      }
      generation.current++; clearAdminSession(); setDashboard(null); setAccess(signedIn ? 'session-required' : 'signed-out'); setAccessError('');
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
      <AdminButton iconOnly variant="ghost" aria-label="退出后台会话" title="退出后台会话" busy={loggingOut} onClick={() => { if (!loggingOut) void logout(); }}><LogOut aria-hidden="true" /></AdminButton>
    </div></header>
      <main ref={editorRoot} className="admin-main" id="admin-main" tabIndex={-1}
        onFocusCapture={event => { pruneEditorCache(edits.current); if (isEditorControl(event.target) && !edits.current.has(event.target)) edits.current.set(event.target, controlValue(event.target)); }}
        onChangeCapture={event => { pruneEditorCache(edits.current); if (isEditorControl(event.target) && !edits.current.has(event.target)) edits.current.set(event.target, '\u0000'); }}>
        {requestNotice && <AdminErrorState title="模块连接失败" message={requestNotice} retry={() => queueAction({ kind: 'refresh' })} busy={busy} />}
        {activeSection === 'dashboard' ? <React.Suspense fallback={<AdminLoading label="正在加载仪表盘…" />}><LazyDashboardView data={dashboard} error={dashboardError} loading={dashboardLoading} retry={() => void loadDashboard()} range={range} onRangeChange={changeRange} onDrill={(target, query) => navigate(target, query)} /></React.Suspense> : <div className="admin-module" data-admin-module={activeSection}>{module}</div>}
      </main>
    </div>
    <AdminDrawer open={mobileNavigation} title="后台菜单" side="left" className="admin-navigation-drawer" onClose={() => setMobileNavigation(false)}><Sidebar active={activeSection} navigate={navigate} returnToApp={returnToApp} visibleSections={visibleSections} /></AdminDrawer>
    <AdminConfirmDialog open={Boolean(pendingAction)} title="存在未保存编辑" description="取消会保留当前输入。确认后将继续刷新或切换页面。" subject={section.label} impact="尚未保存的编辑可能丢失，请先核对。" confirmLabel="放弃编辑并继续" onClose={() => { if (pendingAction?.kind === 'navigate' && pendingAction.fromHistory) { const url = new URL(window.location.href); url.searchParams.set('section', activeSection); window.history.replaceState({}, '', url); } setPendingAction(null); }} onConfirm={() => { const action = pendingAction; setPendingAction(null); edits.current.clear(); if (action) performAction(action); }} />
    {logoutError && <div className="admin-toast" role="status" aria-live="polite" data-admin-logout-toast>{logoutError}</div>}
  </div>;
}
