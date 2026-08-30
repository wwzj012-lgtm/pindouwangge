import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Archive,
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  Crown,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Megaphone,
  Palette,
  RefreshCw,
  Settings2,
  ShieldCheck,
  ShieldEllipsis,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiPost as apiPostWithBearer, clearAdminSession, getAdminSessionToken, getApiToken, setAdminSessionToken } from '../../utils/api';
import { AdminUsersRoles } from './AdminUsersRoles';
import { AdminLogsCodes } from './AdminLogsCodes';
import { AdminAnnouncementsConfig } from './AdminAnnouncementsConfig';
import { AdminContentResources } from './AdminContentResources';

type AccessState = 'checking' | 'ready' | 'session-required' | 'forbidden' | 'signed-out' | 'unavailable';
type SectionId = 'dashboard' | 'users' | 'roles' | 'logs' | 'codes' | 'announcements' | 'config' | 'colors-assets' | 'community';

export interface AdminApiResult<T> { ok: boolean; status: number; data?: T; error?: string; }
export type AdminRequest = <T>(path: string, init?: RequestInit) => Promise<AdminApiResult<T>>;
interface TrendPoint { date: string; count: number; }
interface ErrorCodeCount { code: string; count: number; }
interface DashboardData {
  overview: { totalUsers: number; newUsers30Days: number; activeVipUsers: number; works: number; communityPosts: number; redeemedCodes: number; recentErrors: number };
  trends: { days7: { users: TrendPoint[]; works: TrendPoint[]; communityPosts: TrendPoint[]; successfulActions: TrendPoint[]; errors: TrendPoint[] } };
  telemetry: { successfulActions24h: number; durationSamples24h: number; averageDurationMs: number; maximumDurationMs: number; errors24h: number; errorCodes: ErrorCodeCount[] };
  warnings?: string[];
}
interface MenuItem { id: SectionId; label: string; description: string; endpoint: string; icon: LucideIcon; }

const MENU_ITEMS: MenuItem[] = [
  { id: 'dashboard', label: '数据仪表盘', description: '核心概览、趋势与错误监控', endpoint: '/api/admin/dashboard', icon: LayoutDashboard },
  { id: 'users', label: '用户管理', description: '用户、会员、标签与限制', endpoint: '/api/admin/users', icon: Users },
  { id: 'roles', label: '角色与权限', description: '角色、权限与管理员账号', endpoint: '/api/admin/roles', icon: ShieldCheck },
  { id: 'logs', label: '系统日志', description: '操作、用户行为与错误日志', endpoint: '/api/admin/logs', icon: ClipboardList },
  { id: 'codes', label: '兑换码管理', description: '兑换码、体验卡与使用记录', endpoint: '/api/admin/codes', icon: KeyRound },
  { id: 'announcements', label: '公告系统', description: '草稿、发布与定时公告', endpoint: '/api/admin/announcements', icon: Megaphone },
  { id: 'config', label: '功能配置', description: '功能开关与全局参数', endpoint: '/api/admin/feature-flags', icon: Settings2 },
  { id: 'colors-assets', label: '色卡与资源', description: '品牌色卡、色号与资源元数据', endpoint: '/api/admin/color-cards', icon: Palette },
  { id: 'community', label: '社区内容', description: '作品、举报与审核记录', endpoint: '/api/admin/community-content', icon: Activity },
];

const numberFormatter = new Intl.NumberFormat('zh-CN');
const number = (value: number) => numberFormatter.format(Number.isFinite(value) ? value : 0);
const milliseconds = (value: number) => `${number(Math.max(0, Math.round(value)))} ms`;
const currentMenu = (id: SectionId) => MENU_ITEMS.find((item) => item.id === id) ?? MENU_ITEMS[0]!;

function pathForTrend(points: TrendPoint[]): string {
  if (points.length === 0) return '';
  const maximum = Math.max(1, ...points.map((point) => point.count));
  return points.map((point, index) => {
    const x = points.length === 1 ? 50 : index / (points.length - 1) * 100;
    const y = 42 - Math.max(0, point.count) / maximum * 38;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: number | string; detail: string; icon: LucideIcon; tone: 'sky' | 'emerald' | 'amber' | 'rose' }) {
  const colors = {
    sky: 'bg-sky-500/10 text-sky-300 ring-sky-400/25', emerald: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/25',
    amber: 'bg-amber-500/10 text-amber-300 ring-amber-400/25', rose: 'bg-rose-500/10 text-rose-300 ring-rose-400/25',
  }[tone];
  return <article className="min-w-0 bg-slate-950/70 p-4">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-white">{typeof value === 'number' ? number(value) : value}</p><p className="mt-2 text-xs text-slate-500">{detail}</p></div><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ring-1 ${colors}`}><Icon className="h-5 w-5" aria-hidden="true" /></span></div>
  </article>;
}

function TrendChart({ label, points, color }: { label: string; points: TrendPoint[]; color: string }) {
  const latest = points.length ? points[points.length - 1]!.count : 0;
  return <article className="min-w-0 border border-slate-800 bg-slate-950/70 p-4">
    <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-medium text-slate-100">{label}</h3><p className="mt-1 text-xs text-slate-500">最近 7 天</p></div><span className="text-sm font-semibold tabular-nums text-slate-200">{number(latest)}</span></div>
    <svg className="mt-4 h-24 w-full overflow-visible" viewBox="0 0 100 48" preserveAspectRatio="none" role="img" aria-label={`${label} 最近 7 天趋势`}><path d="M0 42H100" fill="none" stroke="currentColor" strokeWidth="0.7" className="text-slate-800" vectorEffect="non-scaling-stroke" /><polyline points={pathForTrend(points)} fill="none" stroke={color} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>
    <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-600">{points.map((point) => <span key={point.date}>{point.date.slice(5)}</span>)}</div>
  </article>;
}

function Sidebar({ active, navigate, returnToApp }: { active: SectionId; navigate: (id: SectionId) => void; returnToApp: () => void }) {
  return <>
    <div className="flex h-16 items-center border-b border-slate-800 px-5"><span className="grid h-8 w-8 place-items-center rounded-md bg-sky-400 text-slate-950"><ShieldEllipsis className="h-5 w-5" /></span><div className="ml-3 min-w-0"><p className="truncate text-sm font-semibold text-white">拼豆管理后台</p><p className="mt-0.5 text-[11px] text-slate-500">运营控制台</p></div></div>
    <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="后台菜单"><p className="px-3 pb-2 text-[11px] font-medium text-slate-500">管理模块</p><div className="space-y-1">{MENU_ITEMS.map((item) => { const Icon = item.icon; const selected = active === item.id; return <button key={item.id} type="button" onClick={() => navigate(item.id)} className={`flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${selected ? 'bg-sky-500/15 text-sky-200 ring-1 ring-inset ring-sky-400/25' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{item.label}</span></button>; })}</div></nav>
    <div className="border-t border-slate-800 p-3"><button type="button" onClick={returnToApp} className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-100"><ArrowLeft className="h-4 w-4" /><span>返回前台</span></button></div>
  </>;
}

function EmptySection({ item }: { item: MenuItem }) {
  const Icon = item.icon;
  return <section className="mx-auto flex min-h-[420px] max-w-3xl flex-col justify-center py-8"><div className="border-y border-slate-800 py-10 sm:px-8"><span className="grid h-12 w-12 place-items-center rounded-md bg-slate-800 text-slate-200"><Icon className="h-6 w-6" /></span><h2 className="mt-6 text-xl font-semibold text-white">{item.label}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">{item.description}。独立操作界面将在后续阶段接入，最终权限以服务端接口结果为准。</p><div className="mt-6 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="rounded-md border border-slate-700 px-2.5 py-1.5">计划接口</span><code className="max-w-full break-all rounded-md bg-slate-950 px-2.5 py-1.5 text-sky-200">{item.endpoint}</code></div></div></section>;
}

export function AdminConsole() {
  const { currentUser } = useAuth();
  const [access, setAccess] = useState<AccessState>('checking');
  const [accessError, setAccessError] = useState('');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardError, setDashboardError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [trustedDevice, setTrustedDevice] = useState(false);
  const [mobileNavigation, setMobileNavigation] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>('dashboard');
  const section = useMemo(() => currentMenu(activeSection), [activeSection]);
  const administrator = currentUser?.displayName || currentUser?.email || '管理员';

  const adminRequest = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<AdminApiResult<T>> => {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    // The Worker accepts the normal user JWT for admin-session exchange.
    // Keep credentials:include for the HttpOnly admin cookie, while also
    // sending the bearer token so the flow works through a Pages proxy.
    const apiToken = getApiToken();
    if (apiToken && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${apiToken}`);
    // Admin routes require the short-lived server session in addition to the
    // regular user JWT.  Keep the HttpOnly cookie path as a fallback, but send
    // the token explicitly so this also works through a Pages proxy.
    if (path.startsWith('/api/admin/') && path !== '/api/admin/session') {
      const adminSession = getAdminSessionToken();
      if (adminSession && !headers.has('X-Admin-Session')) headers.set('X-Admin-Session', adminSession);
    }
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...init, credentials: 'include', headers });
    const payload: unknown = await response.json().catch(() => null);
    const envelope = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as { success?: unknown; data?: unknown; message?: unknown } : null;
    return { ok: response.ok && envelope?.success !== false, status: response.status, data: (envelope && 'data' in envelope ? envelope.data : payload) as T | undefined, error: typeof envelope?.message === 'string' ? envelope.message : undefined };
  }, []);

  const loadDashboard = useCallback(async (): Promise<number> => {
    const result = await adminRequest<DashboardData>('/api/admin/dashboard');
    if (result.ok && result.data) { setDashboard(result.data); setDashboardError(''); return result.status; }
    setDashboard(null);
    setDashboardError(result.status === 403 ? '当前角色没有查看仪表盘的权限。可从侧栏进入其他已授权模块。' : result.error ?? '仪表盘暂时无法加载，请稍后刷新。');
    return result.status;
  }, [adminRequest]);

  const verifySession = useCallback(async () => {
    setAccess('checking'); setAccessError('');
    const result = await adminRequest<{ authenticated: boolean }>('/api/admin/session');
    if (result.ok) {
      const dashboardStatus = await loadDashboard();
      if (dashboardStatus === 401) {
        clearAdminSession();
        setAccess('session-required');
        setAccessError('后台会话已过期，请重新进入后台。');
        return;
      }
      setAccess('ready');
      return;
    }
    if (result.status === 403) { setAccess('forbidden'); setAccessError('当前账号没有后台访问权限。'); return; }
    if (result.status >= 500) { setAccess('unavailable'); setAccessError('后台服务或数据库暂不可用，请稍后重试。'); return; }
    setAccess(currentUser ? 'session-required' : 'signed-out');
  }, [adminRequest, currentUser, loadDashboard]);

  useEffect(() => { void verifySession(); }, [verifySession]);

  const createSession = async () => {
    if (!currentUser) { setAccess('signed-out'); return; }
    setRefreshing(true); setAccess('checking'); setAccessError('');
    try {
      const result = await apiPostWithBearer<{ authenticated: boolean; token?: string; tokenExpiresAt?: number }>('/api/admin/session', { trustedDevice });
      if (!result.ok) {
        if (result.status === 403) { setAccess('forbidden'); setAccessError('当前账号没有后台访问权限。'); }
        else if (result.status >= 500) { setAccess('unavailable'); setAccessError('后台服务或数据库暂不可用，请稍后重试。'); }
        else { setAccess('session-required'); setAccessError(result.error ?? '后台会话创建失败，请重新登录后重试。'); }
        return;
      }
      if (result.data?.token) setAdminSessionToken(result.data.token);
      await verifySession();
    } catch (error) { setAccess('unavailable'); setAccessError(error instanceof Error ? error.message : '无法连接后台服务。'); }
    finally { setRefreshing(false); }
  };

  const refresh = async () => { setRefreshing(true); try { await verifySession(); } finally { setRefreshing(false); } };
  const logout = async () => { await adminRequest('/api/admin/session/logout', { method: 'POST', body: JSON.stringify({}) }); clearAdminSession(); setDashboard(null); setDashboardError(''); setAccess(currentUser ? 'session-required' : 'signed-out'); };
  const navigate = (id: SectionId) => { setActiveSection(id); setMobileNavigation(false); };
  const returnToApp = () => window.location.assign('/');

  if (access !== 'ready') {
    const enter = access === 'session-required';
    return <main className="grid min-h-screen place-items-center bg-slate-950 px-4 py-8 text-slate-100"><section className="w-full max-w-md border border-slate-800 bg-slate-900 p-6 shadow-2xl"><div className="flex items-start gap-3"><span className="grid h-11 w-11 place-items-center rounded-md bg-sky-400 text-slate-950"><ShieldCheck className="h-6 w-6" /></span><div><h1 className="text-lg font-semibold text-white">后台控制台</h1><p className="mt-1 text-sm text-slate-400">{access === 'checking' && '正在验证后台会话...'}{access === 'session-required' && '使用当前正式登录账号进入后台。'}{access === 'forbidden' && '此账号没有后台访问权限。'}{access === 'signed-out' && '请先登录正式账号。'}{access === 'unavailable' && '后台服务暂不可用。'}</p></div></div>{accessError && <p role="alert" className="mt-5 flex items-start gap-2 border border-rose-400/30 bg-rose-500/10 px-3 py-3 text-sm leading-5 text-rose-200"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{accessError}</p>}{enter && <div className="mt-5 space-y-3"><label className="flex min-h-11 cursor-pointer items-center gap-3 border border-slate-700 bg-slate-950 px-3 text-sm text-slate-300"><input type="checkbox" checked={trustedDevice} onChange={(event) => setTrustedDevice(event.target.checked)} className="h-4 w-4 accent-sky-400" />信任此设备 30 天</label><button type="button" onClick={() => void createSession()} disabled={refreshing} className="flex min-h-11 w-full items-center justify-center gap-2 bg-sky-400 px-4 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60">{refreshing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}进入后台</button></div>}<button type="button" onClick={returnToApp} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 border border-slate-700 px-4 text-sm text-slate-300 hover:bg-slate-800"><ArrowLeft className="h-4 w-4" />返回前台</button></section></main>;
  }

  const overview = dashboard?.overview;
  const telemetry = dashboard?.telemetry;
  return <div className="min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-800 bg-slate-900 lg:flex"><Sidebar active={activeSection} navigate={navigate} returnToApp={returnToApp} /></aside>
    {mobileNavigation && <div className="fixed inset-0 z-40 lg:hidden"><button type="button" aria-label="关闭菜单" className="absolute inset-0 bg-slate-950/75" onClick={() => setMobileNavigation(false)} /><aside className="relative flex h-full w-[min(19rem,85vw)] flex-col border-r border-slate-800 bg-slate-900 shadow-2xl"><div className="absolute right-2 top-2 z-10"><button type="button" title="关闭菜单" aria-label="关闭菜单" onClick={() => setMobileNavigation(false)} className="grid h-11 w-11 place-items-center text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button></div><Sidebar active={activeSection} navigate={navigate} returnToApp={returnToApp} /></aside></div>}
    <div className="min-h-screen lg:pl-64"><header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 backdrop-blur"><div className="flex min-h-16 items-center gap-2 px-3 sm:px-5 lg:px-7"><button type="button" title="打开菜单" aria-label="打开菜单" onClick={() => setMobileNavigation(true)} className="grid h-11 w-11 shrink-0 place-items-center text-slate-300 hover:bg-slate-800 lg:hidden"><Menu className="h-5 w-5" /></button><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{section.label}</p><p className="hidden truncate text-xs text-slate-500 sm:block">{section.description}</p></div><div className="hidden min-w-0 text-right sm:block"><p className="max-w-40 truncate text-sm text-slate-200">{administrator}</p><p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-emerald-400"><CheckCircle2 className="h-3 w-3" />会话有效</p></div><button type="button" title="刷新数据" aria-label="刷新数据" onClick={() => void refresh()} disabled={refreshing} className="grid h-11 w-11 shrink-0 place-items-center text-slate-300 hover:bg-slate-800 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></button><button type="button" title="退出后台会话" aria-label="退出后台会话" onClick={() => void logout()} className="grid h-11 w-11 shrink-0 place-items-center text-slate-300 hover:bg-slate-800 hover:text-rose-300"><LogOut className="h-4 w-4" /></button><button type="button" onClick={returnToApp} className="hidden min-h-11 items-center gap-2 border-l border-slate-800 pl-4 text-sm text-slate-300 hover:text-white md:flex"><ArrowLeft className="h-4 w-4" />返回前台</button></div></header>
      <main className="mx-auto w-full max-w-[1680px] px-3 py-5 sm:px-5 lg:px-7 lg:py-7">{activeSection === 'dashboard' ? <section aria-labelledby="dashboard-title"><div className="flex flex-col justify-between gap-3 border-b border-slate-800 pb-5 sm:flex-row sm:items-end"><div><p className="text-xs font-medium text-sky-300">运营概览</p><h1 id="dashboard-title" className="mt-2 text-2xl font-semibold text-white">数据仪表盘</h1></div><p className="text-sm text-slate-500">统计由后台实时汇总，不读取前端缓存。</p></div>{dashboardError ? <div role="alert" className="mt-5 flex items-start gap-3 border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100"><CircleAlert className="mt-1 h-4 w-4 shrink-0 text-amber-300" />{dashboardError}</div> : <><div className="mt-5 grid grid-cols-1 gap-px overflow-hidden border border-slate-800 bg-slate-800 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="注册用户" value={overview?.totalUsers ?? 0} detail={`近 30 天新增 ${number(overview?.newUsers30Days ?? 0)}`} icon={Users} tone="sky" /><MetricCard label="活跃会员" value={overview?.activeVipUsers ?? 0} detail="当前有效 VIP / Pro" icon={Crown} tone="amber" /><MetricCard label="图纸与社区作品" value={(overview?.works ?? 0) + (overview?.communityPosts ?? 0)} detail={`图纸 ${number(overview?.works ?? 0)} · 社区 ${number(overview?.communityPosts ?? 0)}`} icon={Archive} tone="emerald" /><MetricCard label="累计兑换" value={overview?.redeemedCodes ?? 0} detail={`近 24 小时错误 ${number(overview?.recentErrors ?? 0)}`} icon={Activity} tone="rose" /></div><section className="mt-6" aria-labelledby="telemetry-title"><div className="flex flex-col justify-between gap-2 border-b border-slate-800 pb-3 sm:flex-row sm:items-baseline"><div><h2 id="telemetry-title" className="text-base font-semibold text-white">性能与错误监控</h2><p className="mt-1 text-xs leading-5 text-slate-500">仅统计已采集的成功状态变更和服务端错误，不代表所有请求。</p></div></div><div className="mt-4 grid grid-cols-1 gap-px overflow-hidden border border-slate-800 bg-slate-800 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="24 小时成功操作" value={telemetry?.successfulActions24h ?? 0} detail={telemetry ? '仅计入已记录的状态变更' : '遥测数据暂不可用'} icon={Activity} tone="sky" /><MetricCard label="平均操作耗时" value={telemetry && telemetry.durationSamples24h > 0 ? milliseconds(telemetry.averageDurationMs) : '-'} detail={telemetry && telemetry.durationSamples24h > 0 ? `基于 ${number(telemetry.durationSamples24h)} 个有效样本` : '暂无可用耗时样本'} icon={Activity} tone="emerald" /><MetricCard label="最大操作耗时" value={telemetry && telemetry.durationSamples24h > 0 ? milliseconds(telemetry.maximumDurationMs) : '-'} detail="过去 24 小时的有效样本" icon={Activity} tone="amber" /><MetricCard label="24 小时服务端错误" value={telemetry?.errors24h ?? 0} detail={telemetry ? `${number(telemetry.errorCodes.length)} 类受控错误码` : '遥测数据暂不可用'} icon={Activity} tone="rose" /></div><div className="mt-4 border border-slate-800 bg-slate-950/70 p-4"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium text-slate-100">错误码分布</h3><span className="text-xs text-slate-500">最近 24 小时</span></div>{telemetry ? telemetry.errorCodes.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{telemetry.errorCodes.map((item) => <span key={item.code} className="border border-rose-400/25 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-100"><span className="font-mono">{item.code}</span> <span className="ml-1 tabular-nums">{number(item.count)}</span></span>)}</div> : <p className="mt-3 text-sm text-slate-500">近 24 小时未记录服务端错误。</p> : <p className="mt-3 text-sm text-slate-500">遥测数据暂不可用。</p>}</div></section><div className="mt-6 grid gap-4 xl:grid-cols-3"><TrendChart label="用户新增趋势" points={dashboard?.trends.days7.users ?? []} color="#38BDF8" /><TrendChart label="图纸创建趋势" points={dashboard?.trends.days7.works ?? []} color="#34D399" /><TrendChart label="社区发布趋势" points={dashboard?.trends.days7.communityPosts ?? []} color="#FBBF24" /><TrendChart label="成功操作趋势" points={dashboard?.trends.days7.successfulActions ?? []} color="#A3E635" /><TrendChart label="服务端错误趋势" points={dashboard?.trends.days7.errors ?? []} color="#FB7185" /></div></>}{dashboard?.warnings && dashboard.warnings.length > 0 && <div className="mt-6 border-l-2 border-amber-400 bg-amber-500/5 px-4 py-3 text-sm text-amber-100"><p className="font-medium">部分统计暂不可用</p><ul className="mt-2 space-y-1 text-amber-100/80">{dashboard.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}</section> : activeSection === 'users' || activeSection === 'roles' ? <AdminUsersRoles mode={activeSection} request={adminRequest} /> : activeSection === 'logs' || activeSection === 'codes' ? <AdminLogsCodes mode={activeSection} request={adminRequest} /> : activeSection === 'announcements' || activeSection === 'config' ? <AdminAnnouncementsConfig mode={activeSection} request={adminRequest} /> : activeSection === 'colors-assets' || activeSection === 'community' ? <AdminContentResources mode={activeSection} request={adminRequest} /> : <EmptySection item={section} />}</main>
    </div>
  </div>;
}
