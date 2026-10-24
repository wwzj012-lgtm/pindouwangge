import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardCopy, Copy, KeyRound, Trash2, Undo2 } from 'lucide-react';
import { maskCardCode } from '../../utils/vipCodeUtils';
import type { AdminRequest } from './adminRequest';
import { adminLabel, adminPageCount } from './adminPresentation';
import { AdminBadge, AdminButton, AdminConfirmDialog, AdminDrawer, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { LatestRequest, dateText, requestError } from './adminUserModel';
import { CodeWriteLocks, freezeGeneration, logDates, logDuration, logOutcome, type GenerationDraft } from './adminCodesLogsModel';

type Mode = 'logs' | 'codes';
type LogKind = 'admin' | 'user' | 'error';
interface Paged<T> { items: T[]; total: number; limit: number; offset: number; }
interface LogEntry { id: string; type: LogKind; operatorUid?: string | null; operatorEmail?: string | null; level?: string | null; details?: string | null; entityType?: string | null; entityId?: string | null; metadata?: unknown; source?: string | null; message?: string | null; fingerprint?: string | null; resolvedAt?: number | null; timestamp: number; }
interface VipCode { id: string; code: string; days: number; channel?: string | null; member_type?: 1 | 2; used: boolean; usedBy?: string | null; usedAt?: number | null; copied?: boolean; deletePendingAt?: number | null; createdAt: number; }
interface Redemption { id: string; code: string; userUid?: string | null; days: number; memberType: 1 | 2; channel?: string | null; redeemedAt: number; }
interface CodeStats { total: number; redeemed: number; available: number; deletePending: number; copied: number; }
interface CodePage { items: VipCode[]; total: number; page: number; limit: number; stats?: CodeStats; }
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('zh-CN').format(value) : '—';
const codeType = (code: VipCode) => code.member_type === 2 ? '商家 Pro' : '普通 VIP';

function Pager({ page, total, loading, change }: { page: number; total: number; loading: boolean; change: (page: number) => void }) {
  return <div className="admin-pagination"><span>共 {number(total)} 条 · 第 {page} / {Math.max(1, Math.ceil(total / 20))} 页</span><div><AdminButton iconOnly aria-label="上一页" disabled={loading || page <= 1} onClick={() => change(page - 1)}><ChevronLeft aria-hidden="true" /></AdminButton><AdminButton iconOnly aria-label="下一页" disabled={loading || page >= Math.ceil(total / 20)} onClick={() => change(page + 1)}><ChevronRight aria-hidden="true" /></AdminButton></div></div>;
}
export function AdminLogsCodes({ mode, request }: { mode: Mode; request: AdminRequest }) {
  return <div className="admin-codes-logs">{mode === 'logs' ? <LogsPanel request={request} /> : <CodesPanelV2 request={request} />}</div>;
}

interface LogQuery { kind: LogKind; from: string; to: string; operatorUid: string; level: string; page: number; }
const emptyLogQuery = (): LogQuery => ({ kind: 'admin', from: '', to: '', operatorUid: '', level: '', page: 1 });
function LogsPanel({ request }: { request: AdminRequest }) {
  const [draft, setDraft] = useState(emptyLogQuery), [query, setQuery] = useState(emptyLogQuery);
  const [snapshot, setSnapshot] = useState<(Paged<LogEntry> & { page: number }) | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [validation, setValidation] = useState('');
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const epoch = useRef(new LatestRequest());
  const load = useCallback(async () => {
    const version = epoch.current.next(); setLoading(true); setError('');
    try {
      const dates = logDates(query.from, query.to);
      const params = new URLSearchParams({ type: query.kind, page: String(query.page), limit: '20' });
      if (dates.start !== null) params.set('from', String(dates.start)); if (dates.end !== null) params.set('to', String(dates.end));
      if (query.operatorUid.trim()) params.set('operatorUid', query.operatorUid.trim()); if (query.level.trim()) params.set('level', query.level.trim());
      const result = await request<Paged<LogEntry>>('/api/admin/logs?' + params);
      if (!epoch.current.current(version)) return;
      if (!result.ok || !result.data || !Array.isArray(result.data.items) || !Number.isFinite(result.data.total) || result.data.total < 0) { setError(requestError(result, '读取日志')); return; }
      const lastPage = adminPageCount(result.data.total);
      if (query.page > lastPage) {
        setQuery(current => current === query ? { ...current, page: lastPage } : current);
        return; // Retain last successful snapshot until the effective last page is reread.
      }
      setSnapshot({ ...result.data, page: query.page });
    } catch { if (epoch.current.current(version)) setError('日志读取失败，筛选输入和上次成功结果已保留。'); }
    finally { if (epoch.current.current(version)) setLoading(false); }
  }, [query, request]);
  useEffect(() => { void load(); return () => epoch.current.invalidate(); }, [load]);
  const apply = () => { const dates = logDates(draft.from, draft.to); setValidation(dates.error); if (!dates.error) setQuery({ ...draft, page: 1 }); };
  const changeKind = (kind: LogKind) => { setDraft(value => ({ ...value, kind })); setQuery(value => ({ ...value, kind, page: 1 })); setSelected(null); };
  return <section>
    <AdminToolbar actions={<AdminButton busy={loading} onClick={() => void load()}>刷新日志</AdminButton>}><h2>可追溯操作记录</h2><p>分类、结果状态与已采集耗时分开展示；未采集耗时为 —。</p></AdminToolbar>
    <div className="admin-module-tabs" role="group" aria-label="日志类别">{(['admin','user','error'] as LogKind[]).map(kind => <AdminButton key={kind} data-log-kind={kind} variant={query.kind === kind ? 'primary' : 'secondary'} aria-pressed={query.kind === kind} onClick={() => changeKind(kind)}>{kind === 'admin' ? '管理员操作' : kind === 'user' ? '用户行为' : '错误事件'}</AdminButton>)}</div>
    <div className="admin-stage-panel admin-log-filters" role="search" aria-label="日志查询">
      <label>开始日期<input type="date" value={draft.from} onChange={event => setDraft(value => ({ ...value, from: event.target.value }))} /></label>
      <label>结束日期<input type="date" value={draft.to} onChange={event => setDraft(value => ({ ...value, to: event.target.value }))} /></label>
      <label>操作者UID<input data-log-operator value={draft.operatorUid} maxLength={128} onChange={event => setDraft(value => ({ ...value, operatorUid: event.target.value }))} /></label>
      <label>级别 / 动作<input data-log-level value={draft.level} maxLength={64} onChange={event => setDraft(value => ({ ...value, level: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') apply(); }} /></label>
      <div className="admin-filter-actions"><AdminButton data-log-query variant="primary" onClick={apply}>查询</AdminButton><AdminButton onClick={() => { setDraft(emptyLogQuery()); setQuery(emptyLogQuery()); setValidation(''); }}>重置</AdminButton></div>
    </div>
    {validation && <p className="admin-field-error" role="alert">{validation}</p>}
    {error && <AdminErrorState message={error + ' 上次成功结果未丢弃。'} retry={() => void load()} busy={loading} />}
    <div className="admin-stage-panel" aria-busy={loading}>
      {loading && snapshot && <p role="status" className="admin-result-caption">正在查询，暂时保留已有记录…</p>}
      {!snapshot ? loading ? <AdminLoading label="正在读取日志…" /> : <AdminEmptyState title="尚无成功读取结果" /> : snapshot.items.length ? <>
        <div className="admin-table-scroll"><table className="admin-stage-table" aria-label="日志列表"><thead><tr><th>时间</th><th>操作者 / 对象</th><th>动作 / 级别</th><th>结果状态</th><th>采集耗时</th><th>操作</th></tr></thead><tbody>{snapshot.items.map(item => <tr key={item.id}><td>{dateText(item.timestamp)}</td><td><span className="admin-mono">{item.operatorEmail ?? item.operatorUid ?? '未提供'}</span><small>{item.entityType}{item.entityId ? ' · ' + item.entityId : ''}</small></td><td>{item.level ?? '未提供'}</td><td><AdminBadge tone={item.type === 'error' ? 'warning' : 'neutral'}>{logOutcome(item.type, item.metadata, item.resolvedAt)}</AdminBadge></td><td>{logDuration(item.metadata)}</td><td><AdminButton data-log-detail={item.id} onClick={() => setSelected(item)}>详情</AdminButton></td></tr>)}</tbody></table></div>
        <Pager page={snapshot.page} total={snapshot.total} loading={loading || Boolean(error)} change={page => setQuery(value => ({ ...value, page }))} />
      </> : <AdminEmptyState title="没有匹配日志" description="调整查询条件或重置后重试。" />}
    </div>
    <AdminDrawer open={Boolean(selected)} title="日志详情" description={selected ? dateText(selected.timestamp) : undefined} onClose={() => setSelected(null)} className="admin-log-drawer">
      {selected && <><dl className="admin-detail-facts"><div><dt>分类 / 动作</dt><dd>{adminLabel(selected.type)} · {selected.level ?? '未提供'}</dd></div><div><dt>操作者</dt><dd>{selected.operatorEmail ?? selected.operatorUid ?? '未提供'}</dd></div><div><dt>结果状态</dt><dd>{logOutcome(selected.type, selected.metadata, selected.resolvedAt)}</dd></div><div><dt>采集耗时</dt><dd>{logDuration(selected.metadata)}</dd></div>{selected.source && <div><dt>来源</dt><dd>{selected.source}</dd></div>}{selected.fingerprint && <div><dt>指纹</dt><dd className="admin-mono">{selected.fingerprint}</dd></div>}</dl><h2 className="admin-detail-title">内容与上下文</h2><pre className="admin-log-payload">{selected.type === 'admin' ? selected.details || '未提供' : selected.type === 'error' ? selected.message || '未提供' : JSON.stringify(selected.metadata ?? {}, null, 2)}</pre></>}
    </AdminDrawer>
  </section>;
}

interface CodeQuery { search: string; channel: string; memberType: 'all' | '1' | '2'; copied: 'all' | 'true' | 'false'; status: 'all' | 'delete-pending' | 'redeemed' | 'available'; page: number; }
const emptyCodeQuery = (): CodeQuery => ({ search: '', channel: '', memberType: 'all', copied: 'all', status: 'all', page: 1 });
type Review = { kind: 'generation'; value: ReturnType<typeof freezeGeneration> } | { kind: 'row'; code: VipCode; updates: { copied?: boolean; deletePendingAt?: number | null }; label: string; impact: string };
function CodesPanelV2({ request }: { request: AdminRequest }) {
  const [draft, setDraft] = useState(emptyCodeQuery), [query, setQuery] = useState(emptyCodeQuery);
  const [snapshot, setSnapshot] = useState<CodePage | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [records, setRecords] = useState<(Paged<Redemption> & { page: number; stats?: { total: number; vip: number; pro: number } }) | null>(null);
  const [redemptionPage, setRedemptionPage] = useState(1), [recordsLoading, setRecordsLoading] = useState(false), [recordsError, setRecordsError] = useState('');
  const [generation, setGeneration] = useState<GenerationDraft>({ days: 30, memberType: 1, count: 1, channel: '' });
  const [generationForm, setGenerationForm] = useState(0), [review, setReview] = useState<Review | null>(null), [reviewError, setReviewError] = useState('');
  const [result, setResult] = useState<{ codes: string[]; confirmed?: number } | null>(null), [copiedAll, setCopiedAll] = useState(false), [copyAllError, setCopyAllError] = useState('');
  const [rowFeedback, setRowFeedback] = useState<Record<string, { error?: string; success?: string }>>({});
  const [lockView, setLockView] = useState({ batch: false, rows: new Set<string>() });
  const [closeResult, setCloseResult] = useState(false);
  const epoch = useRef(new LatestRequest()), redemptionEpoch = useRef(new LatestRequest()), locks = useRef(new CodeWriteLocks());
  const loadCodes = useCallback(async () => {
    const version = epoch.current.next(); setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ page: String(query.page), limit: '20' });
      if (query.search.trim()) params.set('search', query.search.trim()); if (query.channel.trim()) params.set('channel', query.channel.trim());
      if (query.memberType !== 'all') params.set('memberType', query.memberType); if (query.copied !== 'all') params.set('copied', query.copied); if (query.status !== 'all') params.set('status', query.status);
      const response = await request<CodePage>('/api/admin/codes?' + params);
      if (!epoch.current.current(version)) return;
      if (!response.ok || !response.data || !Array.isArray(response.data.items) || !Number.isFinite(response.data.total) || response.data.total < 0) { setError(requestError(response, '读取兑换码')); return; }
      const lastPage = adminPageCount(response.data.total);
      if (query.page > lastPage) {
        setQuery(current => current === query ? { ...current, page: lastPage } : current);
        return;
      }
      setSnapshot({ ...response.data, page: query.page });
    } catch { if (epoch.current.current(version)) setError('兑换码读取失败；查询和上次列表保留。'); }
    finally { if (epoch.current.current(version)) setLoading(false); }
  }, [query, request]);
  const loadRedemptions = useCallback(async () => {
    const version = redemptionEpoch.current.next(); setRecordsLoading(true); setRecordsError('');
    try {
      const params = new URLSearchParams({ page: String(redemptionPage), limit: '20' }); if (query.search.trim()) params.set('code', query.search.trim());
      const response = await request<Paged<Redemption> & { stats?: { total: number; vip: number; pro: number } }>('/api/admin/code-redemptions?' + params);
      if (!redemptionEpoch.current.current(version)) return;
      if (!response.ok || !response.data || !Array.isArray(response.data.items) || !Number.isFinite(response.data.total) || response.data.total < 0) { setRecordsError(requestError(response, '读取兑换记录')); return; }
      const lastPage = adminPageCount(response.data.total);
      if (redemptionPage > lastPage) {
        setRedemptionPage(current => current === redemptionPage ? lastPage : current);
        return;
      }
      setRecords({ ...response.data, page: redemptionPage });
    } catch { if (redemptionEpoch.current.current(version)) setRecordsError('兑换记录读取失败，旧记录保留。'); }
    finally { if (redemptionEpoch.current.current(version)) setRecordsLoading(false); }
  }, [query.search, redemptionPage, request]);
  useEffect(() => { void loadCodes(); return () => epoch.current.invalidate(); }, [loadCodes]);
  useEffect(() => { void loadRedemptions(); return () => redemptionEpoch.current.invalidate(); }, [loadRedemptions]);
  const syncLocks = () => setLockView(locks.current.snapshot());
  const apply = () => { if (locks.current.any()) return; setQuery({ ...draft, page: 1 }); setRedemptionPage(1); };
  const refresh = () => { if (!locks.current.any()) { void loadCodes(); void loadRedemptions(); } };
  const previewGeneration = () => {
    if (locks.current.any()) return;
    try { setReviewError(''); setReview({ kind: 'generation', value: freezeGeneration(generation) }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '生成参数无效。'); }
  };
  const writeRow = async (value: Extract<Review, { kind: 'row' }>) => {
    if (!locks.current.beginRow(value.code.id)) return; syncLocks();
    setRowFeedback(previous => ({ ...previous, [value.code.id]: {} }));
    try {
      const response = await request('/api/admin/update-code', { method: 'POST', body: JSON.stringify({ codeId: value.code.id, updates: value.updates }) });
      if (!response.ok) { setRowFeedback(previous => ({ ...previous, [value.code.id]: { error: requestError(response, value.label) } })); return; }
      setSnapshot(previous => previous ? { ...previous, items: previous.items.map(code => code.id === value.code.id ? { ...code, ...value.updates } : code) } : previous);
      setRowFeedback(previous => ({ ...previous, [value.code.id]: { success: value.label + '已确认。' } }));
    } catch { setRowFeedback(previous => ({ ...previous, [value.code.id]: { error: value.label + '失败；原状态保留，可明确重试。' } })); }
    finally { locks.current.endRow(value.code.id); syncLocks(); if (!locks.current.any()) void loadCodes(); }
  };
  const confirm = async () => {
    if (!review) return;
    if (review.kind === 'row') { const value = review; setReview(null); void writeRow(value); return; }
    if (!locks.current.beginBatch()) return; syncLocks(); setReviewError('');
    try {
      const response = await request<{ count?: number }>('/api/admin/generate-codes', { method: 'POST', body: JSON.stringify({ codes: review.value.codes }) });
      if (!response.ok) { setReviewError(requestError(response, '生成兑换码') + (response.status === 0 ? ' 写入结果不确定，请先核对列表；不会自动重试。' : '')); return; }
      setResult({ codes: review.value.codes.map(code => code.code), confirmed: response.data?.count }); setCopiedAll(false); setCopyAllError(''); setReview(null); setGenerationForm(value => value + 1);
      await loadCodes();
    } catch { setReviewError('生成失败；参数和本次待提交码已保留，不自动生成另一批重试。'); }
    finally { locks.current.endBatch(); syncLocks(); }
  };
  const copyCode = async (code: VipCode) => {
    try { await navigator.clipboard.writeText(code.code); setRowFeedback(value => ({ ...value, [code.id]: { success: '已复制；未改变发售标记。' } })); }
    catch { setRowFeedback(value => ({ ...value, [code.id]: { error: '复制失败，请检查剪贴板权限；未更改任何后台状态。' } })); }
  };
  const reviewRow = (code: VipCode, action: 'mark' | 'delete' | 'restore') => {
    if (locks.current.rowBusy(code.id)) return;
    const updates = action === 'mark' ? { copied: !code.copied } : action === 'delete' ? { deletePendingAt: Date.now() + 3 * 86_400_000 } : { deletePendingAt: null };
    setReviewError(''); setReview({ kind: 'row', code, updates, label: action === 'mark' ? code.copied ? '取消发售标记' : '设置发售标记' : action === 'delete' ? '申请删除' : '撤销删除申请', impact: action === 'mark' ? '只改既有发售标记；不复制、不兑换、不代表支付收入。' : action === 'delete' ? '设置原三天删除等待标记，不直接删除；执行以服务端为准。' : '清空原删除等待标记，不改变兑换或发售状态。' });
  };
  const operations = (code: VipCode) => {
    const busy = lockView.batch || lockView.rows.has(code.id), feedback = rowFeedback[code.id];
    return <div className="admin-code-actions"><div>
      <AdminButton data-code-copy={code.id} iconOnly aria-label="复制兑换码" disabled={busy} onClick={() => void copyCode(code)}><Copy aria-hidden="true" /></AdminButton>
      <AdminButton data-code-mark={code.id} disabled={busy} busy={lockView.rows.has(code.id)} onClick={() => reviewRow(code, 'mark')}><KeyRound aria-hidden="true" />{code.copied ? '取消标记' : '发售标记'}</AdminButton>
      <AdminButton data-code-delete={code.id} iconOnly variant="danger" aria-label={code.deletePendingAt ? '撤销删除申请' : '申请删除'} disabled={busy} onClick={() => reviewRow(code, code.deletePendingAt ? 'restore' : 'delete')}>{code.deletePendingAt ? <Undo2 aria-hidden="true" /> : <Trash2 aria-hidden="true" />}</AdminButton>
    </div>{feedback?.error && <p className="admin-field-error" role="alert" data-code-feedback={code.id}>{feedback.error}</p>}{feedback?.success && <p className="admin-code-feedback" role="status" data-code-feedback={code.id}>{feedback.success}</p>}</div>;
  };
  const anyWrite = lockView.batch || lockView.rows.size > 0;
  return <section>
    <AdminToolbar actions={<AdminButton busy={loading} disabled={anyWrite} onClick={refresh}>刷新兑换数据</AdminButton>}><h2>兑换码发行与管理</h2><p>复制与发售标记分离；批次独占，同一行只允许一笔写，不同行可并行。</p></AdminToolbar>
    <form className="admin-stage-panel admin-code-generation" key={generationForm} onSubmit={event => { event.preventDefault(); previewGeneration(); }}>
      <label>权益类型<select data-generation-type value={generation.memberType} disabled={anyWrite} onChange={event => setGeneration(value => ({ ...value, memberType: Number(event.target.value) as 1 | 2 }))}><option value={1}>普通VIP</option><option value={2} disabled={generation.days === 7}>商家Pro</option></select></label>
      <label>开通时长<select data-generation-days value={generation.days} disabled={anyWrite} onChange={event => { const days = Number(event.target.value); setGeneration(value => ({ ...value, days, memberType: days === 7 ? 1 : value.memberType })); }}>{[7,30,90,365].map(days => <option key={days} value={days}>{days}天{days === 7 ? '体验卡（仅VIP）' : ''}</option>)}</select></label>
      <label>生成数量<input data-generation-count type="number" min={1} max={500} value={generation.count} disabled={anyWrite} onChange={event => setGeneration(value => ({ ...value, count: Number(event.target.value) }))} /></label>
      <label>发行渠道<input data-generation-channel value={generation.channel} maxLength={100} disabled={anyWrite} onChange={event => setGeneration(value => ({ ...value, channel: event.target.value }))} placeholder="可选，仅记录既有渠道" /></label>
      <AdminButton data-generation-review type="submit" variant="primary" disabled={anyWrite}>确认参数并生成</AdminButton>
      <p className="admin-code-scope">本次：{generation.memberType === 2 ? '商家Pro' : '普通VIP'} · {generation.days}天 · 数量 {number(generation.count)}。使用资格沿既有服务端兑换规则；不新增渠道/账号限制。7天只支持VIP，最多500张。</p>
    </form>
    {error && <AdminErrorState title="兑换码未更新" message={error + ' 输入与上次成功列表保留。'} retry={refresh} busy={loading || anyWrite} />}
    <div className="admin-code-statistics" aria-label="服务端筛选统计">{[['筛选总数',snapshot?.stats?.total],['可用',snapshot?.stats?.available],['已兑换',snapshot?.stats?.redeemed],['删除等待',snapshot?.stats?.deletePending],['发售标记',snapshot?.stats?.copied]].map(([label,value]) => <div className="admin-stage-panel" key={String(label)}><small>{label}</small><strong>{number(value)}</strong></div>)}</div>
    <p className="admin-stage-footnote">统计为服务端读取快照，修改完成后重读；未知为—，发售标记不代表真实支付收入。</p>
    <div className="admin-stage-panel admin-code-filters" role="search" aria-label="兑换码查询">
      <label>卡密搜索<input data-code-search value={draft.search} onChange={event => setDraft(value => ({ ...value, search: event.target.value }))} placeholder="卡密搜索" /></label><label>发行渠道<input value={draft.channel} onChange={event => setDraft(value => ({ ...value, channel: event.target.value }))} /></label>
      <label>权益<select value={draft.memberType} onChange={event => setDraft(value => ({ ...value, memberType: event.target.value as CodeQuery['memberType'] }))}><option value="all">全部</option><option value="1">普通VIP</option><option value="2">商家Pro</option></select></label>
      <label>发售标记<select value={draft.copied} onChange={event => setDraft(value => ({ ...value, copied: event.target.value as CodeQuery['copied'] }))}><option value="all">全部</option><option value="true">有标记</option><option value="false">无标记</option></select></label>
      <label>兑换 / 删除状态<select value={draft.status} onChange={event => setDraft(value => ({ ...value, status: event.target.value as CodeQuery['status'] }))}><option value="all">全部</option><option value="available">可用</option><option value="redeemed">已兑换</option><option value="delete-pending">删除等待</option></select></label>
      <div className="admin-filter-actions"><AdminButton data-code-query variant="primary" disabled={anyWrite} onClick={apply}>查询</AdminButton><AdminButton disabled={anyWrite} onClick={() => { setDraft(emptyCodeQuery()); setQuery(emptyCodeQuery()); setRedemptionPage(1); }}>重置</AdminButton></div>
    </div>
    <section className="admin-stage-panel" aria-busy={loading}><h2 className="admin-detail-title">兑换码列表</h2>{loading && snapshot && <p role="status" className="admin-result-caption">正在读取，旧列表保留…</p>}
      {!snapshot ? loading ? <AdminLoading label="正在读取兑换码…" /> : <AdminEmptyState title="尚无成功读取结果" /> : snapshot.items.length ? <>
        <div className="admin-table-scroll"><table className="admin-stage-table" aria-label="兑换码列表"><thead><tr><th>兑换码 / 渠道</th><th>权益</th><th>兑换状态</th><th>发售 / 删除标记</th><th>明确操作</th></tr></thead><tbody>{snapshot.items.map(code => <tr key={code.id} data-code-row={code.id}><td><span className="admin-mono">{maskCardCode(code.code)}</span><small>{code.channel ?? '渠道未提供'}</small></td><td>{codeType(code)} · {code.days}天</td><td><AdminBadge tone={code.used ? 'neutral' : 'success'}>{code.used ? '已兑换' : '未兑换'}</AdminBadge>{code.usedBy && <small>{code.usedBy}</small>}</td><td>{code.copied ? '有发售标记' : '无发售标记'}{code.deletePendingAt && <small>删除等待至 {dateText(code.deletePendingAt)}</small>}</td><td>{operations(code)}</td></tr>)}</tbody></table></div>
        <Pager page={snapshot.page ?? query.page} total={snapshot.total} loading={loading || anyWrite || Boolean(error)} change={page => setQuery(value => ({ ...value, page }))} />
      </> : <AdminEmptyState title="没有匹配兑换码" description="调整已提交筛选或重置后重试。" />}
    </section>
    <section className="admin-stage-panel" aria-busy={recordsLoading}><AdminToolbar><h2>兑换使用记录</h2><p>按当前卡密搜索条件分页；其它发行筛选不冒充兑换记录筛选。</p></AdminToolbar>
      {recordsError && <AdminErrorState message={recordsError} retry={() => void loadRedemptions()} busy={recordsLoading} />}
      <p className="admin-result-caption">服务端累计兑换 {number(records?.stats?.total)} · VIP {number(records?.stats?.vip)} · Pro {number(records?.stats?.pro)}</p>
      {!records ? recordsLoading ? <AdminLoading label="正在读取兑换记录…" /> : <AdminEmptyState title="尚无成功读取结果" /> : records.items.length ? <><div className="admin-table-scroll"><table className="admin-stage-table" aria-label="兑换使用记录"><thead><tr><th>卡密</th><th>用户UID</th><th>权益</th><th>兑换时间</th></tr></thead><tbody>{records.items.map(item => <tr key={item.id}><td className="admin-mono">{maskCardCode(item.code)}</td><td>{item.userUid ?? '未提供'}</td><td>{item.memberType === 2 ? '商家Pro' : '普通VIP'} · {item.days}天</td><td>{dateText(item.redeemedAt)}</td></tr>)}</tbody></table></div><Pager page={records.page} total={records.total} loading={recordsLoading || Boolean(recordsError)} change={setRedemptionPage} /></> : <AdminEmptyState title="暂无匹配兑换记录" />}
    </section>
    <AdminConfirmDialog open={Boolean(review)} title={review?.kind === 'generation' ? '确认生成这一批兑换码' : review?.label ?? '确认操作'} description={review?.kind === 'generation' ? '数量、权益、渠道和待提交码已经冻结；确认才调用现有生成接口。' : review ? '对象：' + maskCardCode(review.code.code) + '，本次仅1条。' : ''} confirmLabel="确认提交" pending={lockView.batch} onClose={() => { if (!lockView.batch) setReview(null); }} onConfirm={() => void confirm()}>
      {review?.kind === 'generation' ? <div className="admin-change-summary"><p>数量：{review.value.quantity}张；{review.value.memberType === 2 ? '商家Pro' : '普通VIP'} · {review.value.days}天</p><p>渠道：{review.value.channel || '未指定'}</p><p>使用范围：沿现有兑换资格规则；不是新增定向授权或销售收入。</p></div> : review && <div className="admin-change-summary"><p>当前发售标记：{review.code.copied ? '有' : '无'}；删除等待：{dateText(review.code.deletePendingAt)}</p><p>待提交：{JSON.stringify(review.updates)}</p><p>影响：{review.impact}</p></div>}
      {reviewError && <AdminErrorState message={reviewError} />}
    </AdminConfirmDialog>
    <AdminDrawer open={Boolean(result)} title="本批生成结果" description={result ? '服务端确认数量：' + number(result.confirmed) + '；本次提交明文 ' + result.codes.length + '条。' : undefined} onClose={() => { if (copiedAll) setResult(null); else setCloseResult(true); }} className="admin-code-result-drawer">
      <p>明文只在本次结果窗口展示。复制仅剪贴板操作，不自动标记发售。</p><pre className="admin-log-payload" data-generation-result>{result?.codes.join('\n')}</pre>
      <AdminButton data-result-copy onClick={() => { void navigator.clipboard.writeText(result?.codes.join('\n') ?? '').then(() => { setCopiedAll(true); setCopyAllError(''); }, () => { setCopyAllError('复制失败；明文结果仍保留，请重试。'); }); }}><ClipboardCopy aria-hidden="true" />复制本批全部</AdminButton>
      {copiedAll && <p role="status" className="admin-code-feedback">本批已复制，未修改发售标记。</p>}{copyAllError && <AdminErrorState message={copyAllError} />}
    </AdminDrawer>
    <AdminConfirmDialog open={closeResult} title="关闭尚未复制的结果？" description="不会自动导出或发售；关闭后只能通过现有列表逐条复制。取消可保留本批明文。" confirmLabel="关闭结果" onClose={() => setCloseResult(false)} onConfirm={() => { setCloseResult(false); setResult(null); }} />
  </section>;
}
