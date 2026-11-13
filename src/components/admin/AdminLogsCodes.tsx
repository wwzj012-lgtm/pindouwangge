import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCopy, Copy, Download, KeyRound, Trash2, Undo2 } from 'lucide-react';
import { maskCardCode } from '../../utils/vipCodeUtils';
import type { AdminRequest } from './adminRequest';
import { adminLabel, adminPageCount } from './adminPresentation';
import { AdminBadge, AdminButton, AdminConfirmDialog, AdminDrawer, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { AdminDataTable, type AdminDataTableColumn } from './shared/AdminDataTable';
import { AdminPagination } from './shared/AdminPagination';
import { defaultTriggerDownload } from './CsvExportButton';
import { LatestRequest, dateText, requestError } from './adminUserModel';
import { CodeWriteLocks, codeSaleLabel, codeSaleRowClassName, codeWriteFeedback, freezeGeneration, logDates, logDuration, logOutcome, type GenerationDraft } from './adminCodesLogsModel';

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

/** 批次 5：本批生成结果导出明文 CSV。行数=生成数；带 BOM 便于 Excel 打开。 */
export function generatedCodesCsv(codes: string[]): string {
  const escape = (code: string) => /[",\r\n]/.test(code) ? '"' + code.replace(/"/g, '""') + '"' : code;
  return '\uFEFF' + codes.map(escape).join('\r\n');
}
export function generatedCodesFilename(count: number, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return `generated-codes-${stamp}-${count}.csv`;
}

const LIST_SIZE_OPTIONS = [10, 20, 50, 100] as const;

function Pager({ page, total, limit, loading, change, onLimitChange, label }: { page: number; total: number; limit: number; loading: boolean; change: (page: number) => void; onLimitChange?: (limit: number) => void; label: string }) {
  return <AdminPagination label={label} total={total} limit={limit} offset={(page - 1) * limit} busy={loading}
    onPageChange={nextOffset => change(Math.floor(nextOffset / limit) + 1)}
    pageSizeOptions={LIST_SIZE_OPTIONS} onLimitChange={onLimitChange} />;
}
export function AdminLogsCodes({ mode, request }: { mode: Mode; request: AdminRequest }) {
  return <div className="admin-codes-logs">{mode === 'logs' ? <LogsPanel request={request} /> : <CodesPanelV2 request={request} />}</div>;
}

interface LogQuery { kind: LogKind; from: string; to: string; operatorUid: string; level: string; page: number; limit: number; }
const emptyLogQuery = (): LogQuery => ({ kind: 'admin', from: '', to: '', operatorUid: '', level: '', page: 1, limit: 20 });
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
      const params = new URLSearchParams({ type: query.kind, page: String(query.page), limit: String(query.limit) });
      if (dates.start !== null) params.set('from', String(dates.start)); if (dates.end !== null) params.set('to', String(dates.end));
      if (query.operatorUid.trim()) params.set('operatorUid', query.operatorUid.trim()); if (query.level.trim()) params.set('level', query.level.trim());
      const result = await request<Paged<LogEntry>>('/api/admin/logs?' + params);
      if (!epoch.current.current(version)) return;
      if (!result.ok || !result.data || !Array.isArray(result.data.items) || !Number.isFinite(result.data.total) || result.data.total < 0) { setError(requestError(result, '读取日志')); return; }
      const lastPage = adminPageCount(result.data.total, query.limit);
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
  // 批次 5：共享表格列定义（机械替换，行为不变）。
  const logColumns: Array<AdminDataTableColumn<LogEntry>> = [
    { key: 'timestamp', label: '时间', render: item => dateText(item.timestamp) },
    {
      key: 'operator',
      label: '操作者 / 对象',
      render: item => <><span className="admin-mono">{item.operatorEmail ?? item.operatorUid ?? '未提供'}</span><small>{item.entityType}{item.entityId ? ' · ' + item.entityId : ''}</small></>,
    },
    { key: 'level', label: '动作 / 级别', render: item => item.level ?? '未提供' },
    {
      key: 'outcome',
      label: '结果状态',
      render: item => <AdminBadge tone={logOutcome(item.type, item.metadata, item.resolvedAt).includes('成功') ? 'success' : logOutcome(item.type, item.metadata, item.resolvedAt).includes('失败') ? 'danger' : item.type === 'error' ? 'warning' : 'neutral'}>{logOutcome(item.type, item.metadata, item.resolvedAt).replace('已记录 · ', '')}</AdminBadge>,
    },
    { key: 'duration', label: '采集耗时', render: item => logDuration(item.metadata) },
    {
      key: 'actions',
      label: '操作',
      sticky: 'right',
      render: item => <AdminButton data-log-detail={item.id} onClick={() => setSelected(item)}>详情</AdminButton>,
    },
  ];
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
        <AdminDataTable columns={logColumns} rows={snapshot.items} rowKey={item => item.id} ariaLabel="日志列表" minWidth={760} />
        <Pager page={snapshot.page} total={snapshot.total} limit={snapshot.limit} loading={loading || Boolean(error)} label="日志列表分页"
          change={page => setQuery(value => ({ ...value, page }))} onLimitChange={limit => setQuery(value => ({ ...value, limit, page: 1 }))} />
      </> : <AdminEmptyState title="没有匹配日志" description="调整查询条件或重置后重试。" />}
    </div>
    <p className="admin-stage-footnote">表中每一行都是已记录的动作；「结果未提供」表示服务端没有写入 success 字段，不等于失败。</p>
    <AdminDrawer open={Boolean(selected)} title="日志详情" description={selected ? dateText(selected.timestamp) : undefined} onClose={() => setSelected(null)} className="admin-log-drawer">
      {selected && <><dl className="admin-detail-facts"><div><dt>分类 / 动作</dt><dd>{adminLabel(selected.type)} · {selected.level ?? '未提供'}</dd></div><div><dt>操作者</dt><dd>{selected.operatorEmail ?? selected.operatorUid ?? '未提供'}</dd></div><div><dt>结果状态</dt><dd>{logOutcome(selected.type, selected.metadata, selected.resolvedAt)}</dd></div><div><dt>采集耗时</dt><dd>{logDuration(selected.metadata)}</dd></div>{selected.source && <div><dt>来源</dt><dd>{selected.source}</dd></div>}{selected.fingerprint && <div><dt>指纹</dt><dd className="admin-mono">{selected.fingerprint}</dd></div>}</dl><h2 className="admin-detail-title">内容与上下文</h2><pre className="admin-log-payload">{selected.type === 'admin' ? selected.details || '未提供' : selected.type === 'error' ? selected.message || '未提供' : JSON.stringify(selected.metadata ?? {}, null, 2)}</pre></>}
    </AdminDrawer>
  </section>;
}

interface CodeQuery { search: string; channel: string; memberType: 'all' | '1' | '2'; copied: 'all' | 'true' | 'false'; status: 'all' | 'delete-pending' | 'redeemed' | 'available'; page: number; limit: number; }
const emptyCodeQuery = (): CodeQuery => ({ search: '', channel: '', memberType: 'all', copied: 'all', status: 'all', page: 1, limit: 20 });
type Review = { kind: 'generation'; value: ReturnType<typeof freezeGeneration> } | { kind: 'row'; code: VipCode; updates: { copied?: boolean; deletePendingAt?: number | null }; label: string; impact: string };
function CodesPanelV2({ request }: { request: AdminRequest }) {
  const [draft, setDraft] = useState(emptyCodeQuery), [query, setQuery] = useState(emptyCodeQuery);
  const [snapshot, setSnapshot] = useState<CodePage | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [records, setRecords] = useState<(Paged<Redemption> & { page: number; stats?: { total: number; vip: number; pro: number } }) | null>(null);
  const [redemptionPage, setRedemptionPage] = useState(1), [redemptionLimit, setRedemptionLimit] = useState(20), [recordsLoading, setRecordsLoading] = useState(false), [recordsError, setRecordsError] = useState('');
  const [generation, setGeneration] = useState<GenerationDraft>({ days: 30, memberType: 1, count: 1, channel: '' });
  const [generationForm, setGenerationForm] = useState(0), [review, setReview] = useState<Review | null>(null), [reviewError, setReviewError] = useState('');
  const [result, setResult] = useState<{ codes: string[]; confirmed?: number } | null>(null), [copiedAll, setCopiedAll] = useState(false), [copyAllError, setCopyAllError] = useState('');
  const [rowFeedback, setRowFeedback] = useState<Record<string, { error?: string; success?: string; warning?: string }>>({});
  const [lockView, setLockView] = useState({ batch: false, rows: new Set<string>() });
  const [closeResult, setCloseResult] = useState(false);
  const epoch = useRef(new LatestRequest()), redemptionEpoch = useRef(new LatestRequest()), locks = useRef(new CodeWriteLocks());
  const loadCodes = useCallback(async (): Promise<boolean> => {
    const version = epoch.current.next(); setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
      if (query.search.trim()) params.set('search', query.search.trim()); if (query.channel.trim()) params.set('channel', query.channel.trim());
      if (query.memberType !== 'all') params.set('memberType', query.memberType); if (query.copied !== 'all') params.set('copied', query.copied); if (query.status !== 'all') params.set('status', query.status);
      const response = await request<CodePage>('/api/admin/codes?' + params);
      if (!epoch.current.current(version)) return false;
      if (!response.ok || !response.data || !Array.isArray(response.data.items) || !Number.isFinite(response.data.total) || response.data.total < 0) { setError(requestError(response, '读取兑换码')); return false; }
      const lastPage = adminPageCount(response.data.total, query.limit);
      if (query.page > lastPage) {
        setQuery(current => current === query ? { ...current, page: lastPage } : current);
        return false;
      }
      setSnapshot({ ...response.data, page: query.page });
      return true;
    } catch { if (epoch.current.current(version)) setError('兑换码读取失败；查询和上次列表保留。'); return false; }
    finally { if (epoch.current.current(version)) setLoading(false); }
  }, [query, request]);
  const loadRedemptions = useCallback(async () => {
    const version = redemptionEpoch.current.next(); setRecordsLoading(true); setRecordsError('');
    try {
      const params = new URLSearchParams({ page: String(redemptionPage), limit: String(redemptionLimit) }); if (query.search.trim()) params.set('code', query.search.trim());
      const response = await request<Paged<Redemption> & { stats?: { total: number; vip: number; pro: number } }>('/api/admin/code-redemptions?' + params);
      if (!redemptionEpoch.current.current(version)) return;
      if (!response.ok || !response.data || !Array.isArray(response.data.items) || !Number.isFinite(response.data.total) || response.data.total < 0) { setRecordsError(requestError(response, '读取兑换记录')); return; }
      const lastPage = adminPageCount(response.data.total, redemptionLimit);
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
      const rereadSucceeded = await loadCodes();
      setRowFeedback(previous => ({ ...previous, [value.code.id]: codeWriteFeedback(value.label, rereadSucceeded) }));
    } catch { setRowFeedback(previous => ({ ...previous, [value.code.id]: { error: value.label + '失败；原状态保留，可明确重试。' } })); }
    finally { locks.current.endRow(value.code.id); syncLocks(); }
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
      <AdminButton data-code-mark={code.id} className={code.copied ? 'admin-code-mark-button--active' : ''} disabled={busy} busy={lockView.rows.has(code.id)} onClick={() => reviewRow(code, 'mark')}><KeyRound aria-hidden="true" />{code.copied ? '取消发售标记' : '标记为发售'}</AdminButton>
      <AdminButton data-code-delete={code.id} iconOnly variant="danger-quiet" aria-label={code.deletePendingAt ? '撤销删除申请' : '申请删除'} disabled={busy} onClick={() => reviewRow(code, code.deletePendingAt ? 'restore' : 'delete')}>{code.deletePendingAt ? <Undo2 aria-hidden="true" /> : <Trash2 aria-hidden="true" />}</AdminButton>
    </div>{feedback?.error && <p className="admin-field-error" role="alert" data-code-feedback={code.id}>{feedback.error}</p>}{feedback?.success && <p className="admin-code-feedback" role="status" data-code-feedback={code.id}>{feedback.success}</p>}{feedback?.warning && <p className="admin-code-feedback admin-code-feedback--pending" role="status" data-code-feedback={code.id}>{feedback.warning}</p>}</div>;
  };
  // 批次 5：共享表格列定义（机械替换，行为不变）。
  const codeColumns: Array<AdminDataTableColumn<VipCode>> = [
    {
      key: 'code',
      label: '兑换码 / 渠道',
      render: code => <><span className="admin-mono admin-code-mono">{maskCardCode(code.code)}</span><small>{code.channel ?? '渠道未提供'}</small></>,
    },
    { key: 'term', label: '权益', render: code => <span className="admin-code-term">{codeType(code)} · {code.days}天</span> },
    {
      key: 'used',
      label: '兑换状态',
      render: code => <><AdminBadge tone={code.used ? 'neutral' : 'success'}>{code.used ? '已兑换' : '未兑换'}</AdminBadge>{code.usedBy && <small>{code.usedBy}</small>}</>,
    },
    {
      key: 'marks',
      label: '发售 / 删除标记',
      render: code => <span className="admin-code-sale-cell"><AdminBadge tone={code.copied ? 'warning' : 'neutral'}>{codeSaleLabel(code.copied)}</AdminBadge>{code.copied && <small className="admin-code-sale-note">仅表示发售标记，不代表真实付款</small>}{code.deletePendingAt && <AdminBadge tone="danger">删除等待至 {dateText(code.deletePendingAt).split(' ')[0]}</AdminBadge>}</span>,
    },
    {
      key: 'actions',
      label: '明确操作',
      sticky: 'right',
      render: code => operations(code),
    },
  ];
  const redemptionColumns: Array<AdminDataTableColumn<Redemption>> = [
    { key: 'code', label: '卡密', render: item => <span className="admin-mono">{maskCardCode(item.code)}</span> },
    { key: 'userUid', label: '用户UID', render: item => item.userUid ?? '未提供' },
    { key: 'memberType', label: '权益', render: item => `${item.memberType === 2 ? '商家Pro' : '普通VIP'} · ${item.days}天` },
    { key: 'redeemedAt', label: '兑换时间', render: item => dateText(item.redeemedAt) },
  ];
  const anyWrite = lockView.batch || lockView.rows.size > 0;
  return <section>
    <AdminToolbar actions={<AdminButton busy={loading} disabled={anyWrite} onClick={refresh}>刷新兑换数据</AdminButton>}><h2>兑换码发行与管理</h2><p>复制和发售标记是两件事；同一张码同一时间只处理一项，不同码可以同时处理。</p></AdminToolbar>
    <form className="admin-stage-panel admin-code-generation" key={generationForm} onSubmit={event => { event.preventDefault(); previewGeneration(); }}>
      <label>权益类型<select data-generation-type value={generation.memberType} disabled={anyWrite} onChange={event => setGeneration(value => ({ ...value, memberType: Number(event.target.value) as 1 | 2 }))}><option value={1}>普通VIP</option><option value={2} disabled={generation.days === 7}>商家Pro</option></select></label>
      <label>开通时长<select data-generation-days value={generation.days} disabled={anyWrite} onChange={event => { const days = Number(event.target.value); setGeneration(value => ({ ...value, days, memberType: days === 7 ? 1 : value.memberType })); }}>{[7,30,90,365].map(days => <option key={days} value={days}>{days}天{days === 7 ? '体验卡（仅VIP）' : ''}</option>)}</select></label>
      <label>生成数量<input data-generation-count type="number" min={1} max={500} value={generation.count} disabled={anyWrite} onChange={event => setGeneration(value => ({ ...value, count: Number(event.target.value) }))} /></label>
      <label>发行渠道<input data-generation-channel value={generation.channel} maxLength={100} disabled={anyWrite} onChange={event => setGeneration(value => ({ ...value, channel: event.target.value }))} placeholder="可选" title="不填则沿用既有渠道，系统不会新建渠道" /></label>
      <AdminButton data-generation-review type="submit" variant="primary" disabled={anyWrite}>确认参数并生成</AdminButton>
      <p className="admin-code-scope">本次：{generation.memberType === 2 ? '商家Pro' : '普通VIP'} · {generation.days}天 · 数量 {number(generation.count)}。7天体验卡只支持普通VIP，单批最多 500 张。</p>
    </form>
    {error && <AdminErrorState title="兑换码未更新" message={error + ' 输入与上次成功列表保留。'} retry={refresh} busy={loading || anyWrite} />}
    <div className="admin-code-statistics" aria-label="服务端筛选统计">{[['筛选总数',snapshot?.stats?.total],['可用',snapshot?.stats?.available],['已兑换',snapshot?.stats?.redeemed],['删除等待',snapshot?.stats?.deletePending],['发售标记',snapshot?.stats?.copied]].map(([label,value]) => <div className="admin-stage-panel" key={String(label)}><small>{label}</small><strong>{number(value)}</strong></div>)}</div>
    <p className="admin-stage-footnote">上面四个数字是打开页面时的统计，改动后点「刷新兑换数据」才会更新；「发售标记」不等于真实支付。</p>
    <div className="admin-stage-panel admin-code-filters" role="search" aria-label="兑换码查询">
      <label>卡密搜索<input data-code-search value={draft.search} onChange={event => setDraft(value => ({ ...value, search: event.target.value }))} placeholder="卡密搜索" /></label><label>发行渠道<input value={draft.channel} onChange={event => setDraft(value => ({ ...value, channel: event.target.value }))} /></label>
      <label>权益<select value={draft.memberType} onChange={event => setDraft(value => ({ ...value, memberType: event.target.value as CodeQuery['memberType'] }))}><option value="all">全部</option><option value="1">普通VIP</option><option value="2">商家Pro</option></select></label>
      <label>发售标记<select value={draft.copied} onChange={event => setDraft(value => ({ ...value, copied: event.target.value as CodeQuery['copied'] }))}><option value="all">全部</option><option value="true">有标记</option><option value="false">无标记</option></select></label>
      <label>兑换 / 删除状态<select value={draft.status} onChange={event => setDraft(value => ({ ...value, status: event.target.value as CodeQuery['status'] }))}><option value="all">全部</option><option value="available">可用</option><option value="redeemed">已兑换</option><option value="delete-pending">删除等待</option></select></label>
      <div className="admin-filter-actions"><AdminButton data-code-query variant="primary" disabled={anyWrite} onClick={apply}>查询</AdminButton><AdminButton disabled={anyWrite} onClick={() => { setDraft(emptyCodeQuery()); setQuery(emptyCodeQuery()); setRedemptionPage(1); }}>重置</AdminButton></div>
    </div>
    <section className="admin-stage-panel" aria-busy={loading}><h2 className="admin-detail-title">兑换码列表</h2>{loading && snapshot && <p role="status" className="admin-result-caption">正在读取，旧列表保留…</p>}
      {!snapshot ? loading ? <AdminLoading label="正在读取兑换码…" /> : <AdminEmptyState title="尚无成功读取结果" /> : snapshot.items.length ? <>
        <AdminDataTable columns={codeColumns} rows={snapshot.items} rowKey={code => code.id} ariaLabel="兑换码列表" minWidth={850}
          rowAttrs={code => ({ className: codeSaleRowClassName(code.copied), 'data-code-row': code.id })} />
        <Pager page={snapshot.page ?? query.page} total={snapshot.total} limit={snapshot.limit} loading={loading || anyWrite || Boolean(error)} label="兑换码列表分页"
          change={page => setQuery(value => ({ ...value, page }))} onLimitChange={limit => setQuery(value => ({ ...value, limit, page: 1 }))} />
      </> : <AdminEmptyState title="没有匹配兑换码" description="调整已提交筛选或重置后重试。" />}
    </section>
    <section className="admin-stage-panel" aria-busy={recordsLoading}><AdminToolbar><h2>兑换使用记录</h2><p>按当前卡密搜索条件分页；其它发行筛选不冒充兑换记录筛选。</p></AdminToolbar>
      {recordsError && <AdminErrorState message={recordsError} retry={() => void loadRedemptions()} busy={recordsLoading} />}
      <p className="admin-result-caption">服务端累计兑换 {number(records?.stats?.total)} · VIP {number(records?.stats?.vip)} · Pro {number(records?.stats?.pro)}</p>
      {!records ? recordsLoading ? <AdminLoading label="正在读取兑换记录…" /> : <AdminEmptyState title="尚无成功读取结果" /> : records.items.length ? <><AdminDataTable columns={redemptionColumns} rows={records.items} rowKey={item => item.id} ariaLabel="兑换使用记录" minWidth={640} /><Pager page={records.page} total={records.total} limit={records.limit} loading={recordsLoading || Boolean(recordsError)} label="兑换记录分页" change={setRedemptionPage} onLimitChange={limit => { setRedemptionLimit(limit); setRedemptionPage(1); }} /></> : <AdminEmptyState title="暂无匹配兑换记录" />}
    </section>
    <AdminConfirmDialog open={Boolean(review)} title={review?.kind === 'generation' ? '确认生成这一批兑换码' : review?.label ?? '确认操作'} description="参数在打开确认时冻结，请核对范围后提交。"
      subject={review?.kind === 'generation' ? '新发行批次 · ' + number(review.value.quantity) + ' 张兑换码' : review ? maskCardCode(review.code.code) + ' · 记录 ID：' + review.code.id + ' · 本次仅 1 条' : undefined}
      impact={review?.kind === 'row' ? review.impact : '按冻结的数量、权益与渠道生成兑换码，使用资格沿现有服务端规则。'}
      reason={undefined}
      confirmLabel="确认提交" pending={lockView.batch} onClose={() => { if (!lockView.batch) setReview(null); }} onConfirm={() => void confirm()}>
      {review?.kind === 'generation'
        ? <div className="admin-change-summary"><p>数量：{review.value.quantity}张；{review.value.memberType === 2 ? '商家Pro' : '普通VIP'} · {review.value.days}天</p><p>渠道：{review.value.channel || '未指定'}</p></div>
        : review && <div className="admin-change-summary">
          {'copied' in review.updates && <p>发售标记：{review.code.copied ? '有' : '无'} → {review.updates.copied ? '有' : '无'}</p>}
          {'deletePendingAt' in review.updates && <p>删除等待：{review.code.deletePendingAt ? dateText(review.code.deletePendingAt) : '未设置'} → {review.updates.deletePendingAt ? dateText(review.updates.deletePendingAt) : '未设置'}</p>}
        </div>}
      {reviewError && <AdminErrorState message={reviewError} />}
    </AdminConfirmDialog>
    <AdminDrawer open={Boolean(result)} title="本批生成结果" description={result ? '服务端确认数量：' + number(result.confirmed) + '；本次提交明文 ' + result.codes.length + '条。' : undefined} onClose={() => { if (copiedAll) setResult(null); else setCloseResult(true); }} className="admin-code-result-drawer">
      <p>明文只在本次结果窗口展示。复制仅剪贴板操作，不自动标记发售。</p><pre className="admin-log-payload" data-generation-result>{result?.codes.join('\n')}</pre>
      <div className="admin-toolbar-actions">
        <AdminButton data-result-copy onClick={() => { void navigator.clipboard.writeText(result?.codes.join('\n') ?? '').then(() => { setCopiedAll(true); setCopyAllError(''); }, () => { setCopyAllError('复制失败；明文结果仍保留，请重试。'); }); }}><ClipboardCopy aria-hidden="true" />复制本批全部</AdminButton>
        {/* 批次 5：一键下载本批明文 CSV（行数=生成数；本地 blob，不经服务端）。 */}
        <AdminButton data-result-download disabled={!result || result.codes.length === 0}
          onClick={() => { if (!result) return; defaultTriggerDownload(new Blob([generatedCodesCsv(result.codes)], { type: 'text/csv;charset=utf-8' }), generatedCodesFilename(result.codes.length)); }}>
          <Download aria-hidden="true" />下载明文 CSV
        </AdminButton>
      </div>
      {copiedAll && <p role="status" className="admin-code-feedback">本批已复制，未修改发售标记。</p>}{copyAllError && <AdminErrorState message={copyAllError} />}
    </AdminDrawer>
    <AdminConfirmDialog open={closeResult} title="关闭尚未复制的结果？" description="不会自动导出或发售；关闭后只能通过现有列表逐条复制。取消可保留本批明文。" confirmLabel="关闭结果" onClose={() => setCloseResult(false)} onConfirm={() => { setCloseResult(false); setResult(null); }} />
  </section>;
}
