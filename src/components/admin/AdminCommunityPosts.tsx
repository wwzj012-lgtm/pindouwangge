import { useAuth } from '../../context/AuthContext';
import { contentRecoveryFor } from './adminWriteRecovery';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Eye, RefreshCw, ShieldAlert } from 'lucide-react';
import { createAdminBlobRequest, type AdminBlobRequest, type AdminRequest } from './adminRequest';
import { AdminButton, AdminConfirmDialog, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { AdminDataTable, type AdminDataTableColumn } from './shared/AdminDataTable';
import { AdminPagination } from './shared/AdminPagination';
import { dateText } from './adminUserModel';

type CommunityStatus = 'all' | 'public' | 'private' | 'blocked' | 'withdrawn';
type ModerationState = 'visible' | 'hidden' | 'pending' | 'rejected';
type AdminCommunityTab = 'posts' | 'queue' | 'reports';
type QueueStatusFilter = 'pending' | 'rejected' | 'all';
type ReportStatusFilter = 'open' | 'reviewing' | 'resolved' | 'rejected' | 'all';
type ReviewDecisionValue = 'approve' | 'reject';
type ReportResolution = 'delete_post' | 'dismiss' | 'ban_user';
interface CommunityPost {
  id: string;
  title: string;
  description?: string;
  publishedAt: number;
  withdrawnAt: number | null;
  visibility: 'public' | 'private';
  publiclyVisible: boolean;
  author: { uid: string; displayName?: string | null };
  moderation: { state: ModerationState; version: number; reason: string };
  work: { id: string; status: number | null; width: number | null; height: number | null; totalBeads: number | null } | null;
  imageUrl?: string;
  publicationToken: string | null;
}
interface CommunityPage { items: CommunityPost[]; total: number; limit: number; offset: number; }
interface CommunityDetail { post: CommunityPost; asset?: { content_type?: string; byte_length?: number } | null; snapshot?: unknown; audit?: unknown[]; }
interface PendingAction { action: 'takedown' | 'restore'; post: CommunityPost; reason: string; }

export interface CommunityQueueItem {
  postId: string;
  title: string;
  description?: string;
  author: { uid: string; displayName?: string | null };
  state: ModerationState;
  reviewSource: 'banned_word' | 'report' | null;
  reviewNote: string | null;
  queuedAt: number | null;
  tags?: string[];
}
interface CommunityQueuePage { items: CommunityQueueItem[]; total: number; limit: number; offset: number; }

export interface CommunityReportItem {
  id: string;
  reporter: { uid: string; displayName?: string | null } | null;
  entityId: string;
  reasonCode: string;
  description: string;
  status: 'open' | 'reviewing' | 'resolved' | 'rejected';
  createdAt: number;
  post: { title: string; authorUid: string | null; moderationState: ModerationState | null } | null;
}
interface CommunityReportsPage { items: CommunityReportItem[]; total: number; limit: number; offset: number; }

const TAB_LIMIT = 20;

/** 批次 2（临时挂载）：审核队列/举报 tab 的请求契约与帖子列表共用同一封装。 */
export function communityTabLabel(tab: AdminCommunityTab): string {
  return tab === 'posts' ? '帖子列表' : tab === 'queue' ? '审核队列' : '举报';
}

export function reviewQueuePath(status: QueueStatusFilter, page: number): string {
  const params = new URLSearchParams({ status, limit: String(TAB_LIMIT), offset: String(Math.max(0, page) * TAB_LIMIT) });
  return '/api/admin/community/review-queue?' + params.toString();
}

export function reviewBody(postId: string, decision: ReviewDecisionValue, note?: string): Record<string, unknown> {
  return note && note.trim() ? { postId, decision, note: note.trim() } : { postId, decision };
}

export function reportsPath(status: ReportStatusFilter, page: number): string {
  const params = new URLSearchParams({ status, limit: String(TAB_LIMIT), offset: String(Math.max(0, page) * TAB_LIMIT) });
  return '/api/admin/reports?' + params.toString();
}

export function resolveReportBody(reportId: string, resolution: ReportResolution, note?: string): Record<string, unknown> {
  return note && note.trim() ? { reportId, resolution, note: note.trim() } : { reportId, resolution };
}

const QUEUE_STATE_LABEL: Record<ModerationState, string> = {
  visible: '已放行', hidden: '已下架', pending: '待审核', rejected: '已驳回',
};
const REPORT_RESOLUTION_LABEL: Record<ReportResolution, string> = {
  delete_post: '删除帖子', dismiss: '驳回举报', ban_user: '封禁作者',
};

const LIMIT = 20;

export function communityStatusLabel(status: CommunityStatus): string {
  return status === 'all' ? '全部状态' : status === 'public' ? '公开可见' : status === 'private' ? '私有未撤回' : status === 'blocked' ? '已下架' : '已撤回';
}

export function communityQueryString(search: string, status: CommunityStatus, page: number): string {
  const params = new URLSearchParams({ limit: String(LIMIT), offset: String(Math.max(0, page) * LIMIT), status });
  if (search.trim()) params.set('q', search.trim());
  return params.toString();
}

export function communityDetailPath(id: string): string {
  return '/api/admin/community-posts/detail?id=' + encodeURIComponent(id);
}

export function communityModerationPath(action: 'takedown' | 'restore'): string {
  return '/api/admin/community-posts/' + action;
}

export function communityModerationBody(post: Pick<CommunityPost, 'id' | 'moderation' | 'publicationToken'>, reason: string): Record<string, unknown> {
  return { id: post.id, reason: reason.trim(), expectedVersion: post.moderation.version, expectedPublicationToken: post.publicationToken };
}

export function communityEvidenceStatus(detail: Pick<CommunityDetail, 'post' | 'asset' | 'snapshot'>): string {
  if (detail.post.work && detail.snapshot == null) return '缺少图纸证据，当前仅记录审核';
  if (!detail.asset) return '缺少图片证据，当前仅记录审核';
  if (detail.post.work) return '图纸清单已返回，预览未加载，当前仅记录审核';
  return '图片元数据已返回，图片预览未加载，当前仅记录审核';
}

export function snapshotPreviewPath(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const value = (snapshot as { previewUrl?: unknown }).previewUrl;
  return typeof value === 'string' && value.startsWith('/api/admin/') ? value : null;
}

export function readableCurrentSnapshot(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const value = snapshot as { kind?: unknown; source?: unknown; revision?: unknown; manifest?: unknown; data?: unknown };
  const readable = value.kind === 'grid'
    ? { kind: value.kind, source: value.source, revision: value.revision, manifest: value.manifest }
    : value.kind === 'legacy'
      ? { kind: value.kind, source: value.source, data: value.data }
      : snapshot;
  try { return JSON.stringify(readable, null, 2) ?? null; } catch { return null; }
}

function actionLabel(action: PendingAction['action']): string { return action === 'takedown' ? '下架' : '恢复'; }
function postStatus(post: CommunityPost): string {
  if (post.withdrawnAt !== null) return '已撤回';
  if (post.moderation.state === 'hidden') return '已下架';
  if (post.moderation.state === 'pending') return '待人工审核';
  if (post.moderation.state === 'rejected') return '审核驳回';
  return post.visibility === 'public' ? '公开可见' : '私有未撤回';
}

export function AdminCommunityPosts({ request, previewRequest }: { request: AdminRequest; previewRequest?: AdminBlobRequest }) {
  const { currentUser } = useAuth();
  const recovery = contentRecoveryFor(currentUser?.uid ?? 'signed-out');
  useSyncExternalStore(recovery.subscribe, recovery.snapshot, recovery.snapshot);
  const scope = (id: string) => '/api/admin/community-review/' + id;
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [statusDraft, setStatusDraft] = useState<CommunityStatus>('all');
  const [status, setStatus] = useState<CommunityStatus>('all');
  const [page, setPage] = useState(0);
  const [snapshot, setSnapshot] = useState<CommunityPage | null>(null);
  const [selected, setSelected] = useState<CommunityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [patternPreviewUrl, setPatternPreviewUrl] = useState('');
  const [imageDecoded, setImageDecoded] = useState(false), [patternDecoded, setPatternDecoded] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const defaultPreview = useMemo(() => createAdminBlobRequest(), []);
  const blobRequest = previewRequest ?? defaultPreview;
  const writing = useRef(false), listEpoch = useRef(0), detailEpoch = useRef(0), queueEpoch = useRef(0), reportEpoch = useRef(0);
  const [mustRead, setMustRead] = useState(false);
  // 批次 2（临时挂载）：审核队列与举报两个 tab；正式视觉批次 5 重做。
  const [tab, setTab] = useState<AdminCommunityTab>('posts');
  const [queueStatusDraft, setQueueStatusDraft] = useState<QueueStatusFilter>('pending');
  const [queueStatus, setQueueStatus] = useState<QueueStatusFilter>('pending');
  const [queuePage, setQueuePage] = useState(0);
  const [queueData, setQueueData] = useState<CommunityQueuePage | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState('');
  const [queueSelected, setQueueSelected] = useState<CommunityQueueItem | null>(null);
  const [queueNote, setQueueNote] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reportStatusDraft, setReportStatusDraft] = useState<ReportStatusFilter>('open');
  const [reportStatus, setReportStatus] = useState<ReportStatusFilter>('open');
  const [reportPage, setReportPage] = useState(0);
  const [reportData, setReportData] = useState<CommunityReportsPage | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [reportSelected, setReportSelected] = useState<CommunityReportItem | null>(null);
  const [reportResolution, setReportResolution] = useState<ReportResolution>('dismiss');
  const [reportNote, setReportNote] = useState('');
  const [resolveBusy, setResolveBusy] = useState(false);
  const [tabMessage, setTabMessage] = useState('');

  const load = useCallback(async () => {
    const version = ++listEpoch.current;
    setLoading(true); setError('');
    try {
      const result = await request<CommunityPage>('/api/admin/community-posts?' + communityQueryString(search, status, page));
      if (version !== listEpoch.current) return;
      if (!result.ok || !result.data || !Array.isArray(result.data.items) || !Number.isFinite(result.data.total)) {
        setError((result.status === 403 ? '读取社区帖子被服务端拒绝（403）' : '读取社区帖子失败') + '：' + (result.error ?? '请重试。'));
        return;
      }
      setSnapshot(result.data);
    } catch { setError('社区帖子读取失败，已有列表保留，可重试。'); }
    finally { if (version === listEpoch.current) setLoading(false); }
  }, [page, request, search, status]);

  const readDetail = useCallback(async (id: string) => {
    const version = ++detailEpoch.current;
    const ticket = recovery.beginRead(scope(id));
    setDetailLoading(true); setDetailError('');
    try {
      const result = await request<CommunityDetail>(communityDetailPath(id));
      if (version !== detailEpoch.current) return;
      if (!result.ok || !result.data?.post || result.data.post.id !== id) { setDetailError('详情读取失败：' + (result.error ?? '返回内容不完整，请重试。')); return; }
      setSelected(result.data); recovery.readSucceeded(ticket); setMustRead(false);
    } catch { setDetailError('详情读取失败，请重试。'); }
    finally { if (version === detailEpoch.current) setDetailLoading(false); }
  }, [request]);

  useEffect(() => { if (tab === 'posts') { void load(); } return () => { listEpoch.current++; }; }, [load, tab]);
  useEffect(() => { return () => { detailEpoch.current++; }; }, []);

  // 审核队列读取：与帖子列表同一 request 封装、同一错误口径（失败不当作空列表）。
  const loadQueue = useCallback(async () => {
    const version = ++queueEpoch.current;
    setQueueLoading(true); setQueueError('');
    try {
      const result = await request<CommunityQueuePage>(reviewQueuePath(queueStatus, queuePage));
      if (version !== queueEpoch.current) return;
      if (!result.ok || !result.data || !Array.isArray(result.data.items) || !Number.isFinite(result.data.total)) {
        setQueueError((result.status === 403 ? '读取审核队列被服务端拒绝（403）' : '读取审核队列失败') + '：' + (result.error ?? '请重试。'));
        return;
      }
      setQueueData(result.data); setQueueSelected(null);
    } catch { setQueueError('审核队列读取失败，已有列表保留，可重试。'); }
    finally { if (version === queueEpoch.current) setQueueLoading(false); }
  }, [queuePage, queueStatus, request]);

  const submitReview = async (decision: ReviewDecisionValue) => {
    if (!queueSelected || writing.current) return;
    writing.current = true; setReviewBusy(true); setTabMessage(''); setQueueError('');
    const postIdValue = queueSelected.postId;
    try {
      const result = await request('/api/admin/community/review', { method: 'POST', body: JSON.stringify(reviewBody(postIdValue, decision, queueNote)) });
      if (!result.ok) { setQueueError('审核决策提交失败：' + (result.error ?? '请刷新队列后重试。')); return; }
      setTabMessage('已提交' + (decision === 'approve' ? '放行' : '驳回') + '决策，服务端已确认。');
      setQueueSelected(null); setQueueNote('');
      await loadQueue();
    } catch { setQueueError('审核提交结果不确定；请先刷新队列核对状态，不要重复提交。'); }
    finally { writing.current = false; setReviewBusy(false); }
  };

  const loadReports = useCallback(async () => {
    const version = ++reportEpoch.current;
    setReportLoading(true); setReportError('');
    try {
      const result = await request<CommunityReportsPage>(reportsPath(reportStatus, reportPage));
      if (version !== reportEpoch.current) return;
      if (!result.ok || !result.data || !Array.isArray(result.data.items) || !Number.isFinite(result.data.total)) {
        setReportError((result.status === 403 ? '读取举报列表被服务端拒绝（403）' : '读取举报列表失败') + '：' + (result.error ?? '请重试。'));
        return;
      }
      setReportData(result.data); setReportSelected(null);
    } catch { setReportError('举报列表读取失败，已有列表保留，可重试。'); }
    finally { if (version === reportEpoch.current) setReportLoading(false); }
  }, [reportPage, reportStatus, request]);

  const submitResolve = async () => {
    if (!reportSelected || writing.current) return;
    writing.current = true; setResolveBusy(true); setTabMessage(''); setReportError('');
    const reportIdValue = reportSelected.id;
    try {
      const result = await request('/api/admin/reports/resolve', { method: 'POST', body: JSON.stringify(resolveReportBody(reportIdValue, reportResolution, reportNote)) });
      if (!result.ok) { setReportError('举报处置提交失败：' + (result.error ?? '请刷新列表后重试。')); return; }
      setTabMessage('举报处置已由服务端确认：' + REPORT_RESOLUTION_LABEL[reportResolution] + '。');
      setReportSelected(null); setReportNote('');
      await loadReports();
    } catch { setReportError('处置提交结果不确定；请先刷新列表核对状态，不要重复提交。'); }
    finally { writing.current = false; setResolveBusy(false); }
  };

  useEffect(() => { if (tab === 'queue') { void loadQueue(); } return () => { queueEpoch.current++; }; }, [loadQueue, tab]);
  useEffect(() => { if (tab === 'reports') { void loadReports(); } return () => { reportEpoch.current++; }; }, [loadReports, tab]);

  useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    setImagePreviewUrl(''); setPatternPreviewUrl(''); setImageDecoded(false); setPatternDecoded(false); setPreviewError('');
    if (!selected) return () => controller.abort();
    const paths = [selected.post.imageUrl ?? `/api/admin/community-posts/asset?id=${encodeURIComponent(selected.post.id)}`, snapshotPreviewPath(selected.snapshot)].filter((path): path is string => Boolean(path));
    if (paths.length === 0) return () => controller.abort();
    let active = true;
    setPreviewLoading(true);
    void (async () => {
      const results = await Promise.all(paths.map(path => blobRequest(path, controller.signal)));
      if (!active) return;
      const failures: string[] = [];
      for (const [index, result] of results.entries()) {
        if (result.ok && result.data) {
          const url = URL.createObjectURL(result.data); urls.push(url);
          if (index === 0) setImagePreviewUrl(url); else setPatternPreviewUrl(url);
        } else failures.push(index === 0 ? '图片' : '图纸预览');
      }
      setPreviewError(failures.length ? failures.join('、') + '加载失败，当前仅记录审核。' : '');
      setPreviewLoading(false);
    })();
    return () => { active = false; controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [blobRequest, selected]);

  const applyFilters = () => { setPage(0); setSearch(searchDraft.trim()); setStatus(statusDraft); };
  const selectedPost = selected?.post;
  const canModerate = selectedPost?.withdrawnAt === null && (selectedPost?.moderation.state === 'hidden' || selectedPost?.visibility === 'public');
  const action = selectedPost?.moderation.state === 'hidden' ? 'restore' : 'takedown';

  // 批次 5：三个 tab 的共享表格列定义（机械替换，行为不变）。
  const postColumns: Array<AdminDataTableColumn<CommunityPost>> = [
    {
      key: 'title', label: '帖子', width: '38%',
      render: post => <><strong>{post.title || post.id}</strong><small className="admin-mono block truncate" title={post.id}>{post.id}</small><small>{dateText(post.publishedAt)}</small></>,
    },
    {
      key: 'author', label: '作者', width: '22%',
      render: post => <><strong>{post.author.displayName || '未提供昵称'}</strong><small className="admin-mono block truncate" title={post.author.uid}>{post.author.uid}</small></>,
    },
    {
      key: 'status', label: '状态', width: '16%',
      render: post => <>{postStatus(post)}{post.moderation.reason && <small className="line-clamp-2" title={post.moderation.reason}>{post.moderation.reason}</small>}</>,
    },
    { key: 'version', label: '审核版本', width: '10%', render: post => <span className="admin-mono">{post.moderation.version}</span> },
    {
      key: 'actions', label: '操作', width: '14%', sticky: 'right',
      render: post => <AdminButton onClick={() => void readDetail(post.id)} disabled={detailLoading}>详情</AdminButton>,
    },
  ];
  const queueColumns: Array<AdminDataTableColumn<CommunityQueueItem>> = [
    {
      key: 'title', label: '帖子', width: '30%',
      render: item => <><strong>{item.title || item.postId}</strong><small className="admin-mono block truncate" title={item.postId}>{item.postId}</small></>,
    },
    {
      key: 'author', label: '作者', width: '16%',
      render: item => <><strong>{item.author.displayName || '未提供昵称'}</strong><small className="admin-mono block truncate">{item.author.uid}</small></>,
    },
    { key: 'source', label: '来源', width: '12%', render: item => item.reviewSource === 'banned_word' ? '违禁词命中' : item.reviewSource === 'report' ? '用户举报' : '其他' },
    { key: 'state', label: '状态', width: '14%', render: item => QUEUE_STATE_LABEL[item.state] ?? item.state },
    { key: 'queuedAt', label: '入队时间', width: '14%', render: item => item.queuedAt ? dateText(item.queuedAt) : '未提供' },
    {
      key: 'actions', label: '操作', width: '14%', sticky: 'right',
      render: item => <AdminButton onClick={() => { setQueueSelected(item); setQueueNote(''); }} disabled={item.state !== 'pending'}>审核</AdminButton>,
    },
  ];
  const reportColumns: Array<AdminDataTableColumn<CommunityReportItem>> = [
    {
      key: 'post', label: '被举报帖', width: '22%',
      render: item => <><strong>{item.post?.title || '未提供'}</strong><small className="admin-mono block truncate" title={item.entityId}>{item.entityId}</small></>,
    },
    {
      key: 'reporter', label: '举报人', width: '18%',
      render: item => <><strong>{item.reporter?.displayName || '匿名'}</strong><small className="admin-mono block truncate">{item.reporter?.uid ?? '—'}</small></>,
    },
    {
      key: 'reason', label: '理由', width: '14%',
      render: item => <>{item.reasonCode}{item.description && <small className="line-clamp-2" title={item.description}>{item.description}</small>}</>,
    },
    { key: 'moderation', label: '帖子治理状态', width: '14%', render: item => item.post?.moderationState ? QUEUE_STATE_LABEL[item.post.moderationState] ?? item.post.moderationState : '—' },
    { key: 'status', label: '举报状态', width: '12%', render: item => item.status === 'open' ? '待处理' : item.status },
    {
      key: 'actions', label: '操作', width: '20%', sticky: 'right',
      render: item => <AdminButton onClick={() => { setReportSelected(item); setReportNote(''); }} disabled={item.status !== 'open'}>处置</AdminButton>,
    },
  ];

  const confirmAction = async () => {
    if (!pending || writing.current || recovery.isUncertain(scope(pending.post.id)) || mustRead || !pending.reason.trim()) return;
    writing.current = true;
    setBusy(true); setError(''); setSuccess('');
    try {
      const result = await request(communityModerationPath(pending.action), {
        method: 'POST',
        body: JSON.stringify(communityModerationBody(pending.post, pending.reason)),
      });
      if (!result.ok) { if (result.status === 0 || result.status >= 500 || result.status === 409)  { setMustRead(true); recovery.markUncertain(scope(pending.post.id)); } setError((result.status === 403 ? '社区审核操作被服务端拒绝（403）' : '社区审核操作失败') + '：' + (result.error ?? '请刷新后重试。')); return; }
      setPending(null); setSuccess('社区帖子' + actionLabel(pending.action) + '已由服务端确认成功。');
      await Promise.all([load(), readDetail(pending.post.id)]);
    } catch { setMustRead(true); recovery.markUncertain(scope(pending.post.id)); setError('操作结果不确定；请先刷新并核对状态，不要重复提交。'); }
    finally { writing.current = false; setBusy(false); }
  };

  return <section className="admin-community-posts">
    <AdminToolbar actions={<AdminButton onClick={() => void load()} busy={loading}><RefreshCw aria-hidden="true" />刷新</AdminButton>}>
      <h2>社区帖子审核</h2><p>读取真实社区帖子与审核状态；先从左侧列表读取服务端详情，下架/恢复要求原因和服务端版本校验。</p>
    </AdminToolbar>
    <div className="admin-community-filters" role="tablist" aria-label="社区治理视图">
      {(['posts', 'queue', 'reports'] as const).map((value) => (
        <AdminButton key={value} role="tab" aria-selected={tab === value} variant={tab === value ? 'primary' : 'secondary'}
          onClick={() => { setTab(value); setTabMessage(''); }}>{communityTabLabel(value)}</AdminButton>
      ))}
    </div>
    {tabMessage && <p className="admin-success-message" role="status">{tabMessage}</p>}
    {tab === 'posts' && <>
    <form className="admin-community-filters" onSubmit={event => { event.preventDefault(); if (!loading) applyFilters(); }}>
      <label>搜索帖子、作者或标签<input value={searchDraft} maxLength={200} onChange={event => setSearchDraft(event.target.value)} placeholder="标题、帖子 ID、作者 UID" /></label>
      <label>状态<select value={statusDraft} onChange={event => setStatusDraft(event.target.value as CommunityStatus)}>{(['all', 'public', 'private', 'blocked', 'withdrawn'] as const).map(value => <option key={value} value={value}>{communityStatusLabel(value)}</option>)}</select></label>
      <AdminButton type="submit" variant="primary" disabled={loading}>查询</AdminButton>
    </form>
    {success && <p className="admin-success-message" role="status">{success}</p>}
    {error && <AdminErrorState title="社区操作未完成" message={error} retry={() => void load()} busy={loading || busy} />}
    <div className="admin-community-layout" data-detail={(selectedPost || detailLoading || detailError) ? 'true' : undefined}>
      <section className="admin-stage-panel" aria-busy={loading}>
        {loading && !snapshot ? <AdminLoading label="正在读取社区帖子…" /> : !snapshot ? <AdminEmptyState title="暂无成功读取结果" description="请重试读取，不把失败当作空列表。" /> : snapshot.items.length === 0 ? <AdminEmptyState title="没有匹配的社区帖子" description="清空搜索或切换状态筛选后再试。" /> : <>
          <div className="admin-community-table-wrap"><AdminDataTable className="table-fixed" columns={postColumns} rows={snapshot.items} rowKey={post => post.id} ariaLabel="社区帖子列表" minWidth={680}
            rowAttrs={post => ({ 'data-community-post': post.id })} /></div>
          <div className="admin-community-cards">{snapshot.items.map(post => <article className="admin-community-card" key={post.id}><strong>{post.title || post.id}</strong><small className="admin-mono" title={post.id}>{post.id}</small><p>{postStatus(post)} · 审核版本 {post.moderation.version}</p><AdminButton onClick={() => void readDetail(post.id)} disabled={detailLoading}>查看详情</AdminButton></article>)}</div>
          <AdminPagination label="社区帖子分页" total={snapshot.total} limit={LIMIT} offset={page * LIMIT} busy={loading}
            onPageChange={nextOffset => setPage(Math.floor(nextOffset / LIMIT))} />
        </>}
      </section>
      {/* 没有选中帖子时不渲染右栏：原来固定占 380px 只放一句"选择一个帖子"，大半屏被空面板吃掉。选中后才展开，列表自动收窄。 */}
      {(selectedPost || detailLoading || detailError) && <aside className="admin-stage-panel admin-community-detail" aria-busy={detailLoading}>
        <AdminToolbar><h2>帖子详情</h2><p>从左侧列表选一个帖子，可查看证据、审核记录并下架或恢复。</p></AdminToolbar>
        {detailLoading ? <AdminLoading label="正在读取帖子详情…" /> : detailError ? <AdminErrorState title="详情暂不可用" message={detailError} retry={() => selectedPost ? void readDetail(selectedPost.id) : undefined} /> : !selectedPost ? <AdminEmptyState title="选择一个帖子" description="先从左侧列表读取服务端详情。" /> : <div className="admin-community-detail-body" data-community-version={selectedPost.moderation.version}><dl className="admin-detail-facts"><div><dt>标题</dt><dd>{selectedPost.title || '未提供'}</dd></div><div><dt>帖子 ID</dt><dd className="admin-mono">{selectedPost.id}</dd></div><div><dt>作者 UID</dt><dd className="admin-mono">{selectedPost.author.uid}</dd></div><div><dt>可见状态</dt><dd>{postStatus(selectedPost)}</dd></div><div><dt>审核原因</dt><dd>{selectedPost.moderation.reason || '未提供'}</dd></div><div><dt>审核版本</dt><dd className="admin-mono">{selectedPost.moderation.version}</dd></div></dl><p className="admin-info-box"><Eye aria-hidden="true" />{imageDecoded || patternDecoded ? '真实预览已加载。' : communityEvidenceStatus(selected!) + '。'}{selectedPost.work && selected?.snapshot == null && '缺少图纸证据，当前仅记录审核。'}不把审核记录冒充已查看内容。</p>{previewLoading && <p className="admin-result-caption" role="status">正在加载真实图片/图纸预览…</p>}{previewError && <p className="admin-field-error" role="alert">{previewError}</p>}{imagePreviewUrl && <figure className="admin-community-preview"><img src={imagePreviewUrl} onLoad={event => setImageDecoded(event.currentTarget.naturalWidth > 0)} onError={event => { URL.revokeObjectURL(event.currentTarget.src); setImagePreviewUrl(''); setImageDecoded(false); setPreviewError(value => value + ' 图片解码失败，文件可能损坏；不能作为已查看证据。'); }} alt={'社区帖子“' + (selectedPost.title || selectedPost.id) + '”的真实图片证据'} /><figcaption>图片证据：来自服务端资产接口。</figcaption></figure>}{patternPreviewUrl && <figure className="admin-community-preview"><img src={patternPreviewUrl} onLoad={event => setPatternDecoded(event.currentTarget.naturalWidth > 0)} onError={event => { URL.revokeObjectURL(event.currentTarget.src); setPatternPreviewUrl(''); setPatternDecoded(false); setPreviewError(value => value + ' 图纸预览解码失败，文件可能损坏；请查看当前快照。'); }} alt={'社区帖子“' + (selectedPost.title || selectedPost.id) + '”的当前图纸预览'} /><figcaption>当前图纸预览：服务端当前活动修订，非历史版本。</figcaption></figure>}{readableCurrentSnapshot(selected?.snapshot) && <details className="admin-community-snapshot" open><summary>当前快照（非历史版本）</summary><pre>{readableCurrentSnapshot(selected?.snapshot)}</pre></details>}{mustRead && <AdminErrorState message="状态冲突或写入结果不确定，必须重读详情后才能继续。" retry={() => { setPending(null); void readDetail(selectedPost.id); }} />}{canModerate && <AdminButton disabled={busy || detailLoading} variant={action === 'takedown' ? 'danger' : 'primary'} onClick={() => setPending({ action, post: selectedPost, reason: '' })}><ShieldAlert aria-hidden="true" />{actionLabel(action)}帖子</AdminButton>}{selected?.audit && <p className="admin-stage-footnote">已读取 {selected.audit.length} 条审核审计记录。</p>}</div>}
      </aside>}
    </div>
    <AdminConfirmDialog open={Boolean(pending)} title={pending ? '确认社区帖子' + actionLabel(pending.action) : '确认社区操作'} description={pending ? '提交后会记录本次审核原因与操作人；如果帖子在此期间被其他人改过，提交会被拒绝并要求重读。' : ''}
      subject={pending ? (pending.post.title || '未提供标题') + ' · 帖子 ID：' + pending.post.id + ' · 作者 UID：' + pending.post.author.uid : undefined}
      impact={pending?.action === 'takedown' ? '下架本次选中的社区帖子，限制公开展示；保留作者图纸与审核记录。' : '请求恢复本次选中的社区帖子，最终展示仍受发布状态与可见性规则约束。'}
      reason={pending?.reason.trim() || undefined}
      confirmLabel="确认提交" confirmDisabled={mustRead || Boolean(pending && recovery.isUncertain(scope(pending.post.id))) || !pending?.reason.trim()} pending={busy} onClose={() => { if (!busy) setPending(null); }} onConfirm={() => void confirmAction()}>
      {pending && <label className="admin-stage-field">操作原因<textarea value={pending.reason} maxLength={500} disabled={busy} onChange={event => setPending(value => value ? { ...value, reason: event.target.value } : value)} placeholder="填写本次审核原因（必填）" /></label>}
      {error && <AdminErrorState message={error} />}
    </AdminConfirmDialog>
    </>}
    {tab === 'queue' && <section className="admin-stage-panel" aria-busy={queueLoading}>
      <AdminToolbar actions={<AdminButton onClick={() => void loadQueue()} busy={queueLoading}><RefreshCw aria-hidden="true" />刷新</AdminButton>}>
        <h2>审核队列</h2><p>违禁词命中与被举报帖子在此等待人工决策；放行/驳回会记录操作人与审核意见。</p>
      </AdminToolbar>
      <form className="admin-community-filters" onSubmit={event => { event.preventDefault(); setQueuePage(0); setQueueStatus(queueStatusDraft); }}>
        <label>队列状态<select value={queueStatusDraft} onChange={event => setQueueStatusDraft(event.target.value as QueueStatusFilter)}>
          {(['pending', 'rejected', 'all'] as const).map(value => <option key={value} value={value}>{value === 'pending' ? '待审核' : value === 'rejected' ? '已驳回' : '全部队列'}</option>)}
        </select></label>
        <AdminButton type="submit" variant="primary" disabled={queueLoading}>查询</AdminButton>
      </form>
      {tabMessage && <p className="admin-success-message" role="status">{tabMessage}</p>}
      {queueError && <AdminErrorState title="审核队列读取未完成" message={queueError} retry={() => void loadQueue()} busy={queueLoading} />}
      {queueLoading && !queueData ? <AdminLoading label="正在读取审核队列…" /> : !queueData ? <AdminEmptyState title="暂无成功读取结果" description="请重试读取，不把失败当作空列表。" />
        : queueData.items.length === 0 ? <AdminEmptyState title="队列为空" description="当前筛选下没有待处理的帖子。" />
        : <div className="admin-community-table-wrap"><AdminDataTable className="table-fixed" columns={queueColumns} rows={queueData.items} rowKey={item => item.postId} ariaLabel="审核队列列表" minWidth={680}
          rowAttrs={item => ({ 'data-review-queue-item': item.postId })} /></div>}
      <AdminPagination label="审核队列分页" total={queueData?.total ?? 0} limit={TAB_LIMIT} offset={queuePage * TAB_LIMIT} busy={queueLoading}
        onPageChange={nextOffset => setQueuePage(Math.floor(nextOffset / TAB_LIMIT))} />
      {queueSelected && <div className="admin-community-detail" data-review-target={queueSelected.postId}>
        <AdminToolbar><h2>审核决策</h2></AdminToolbar>
        {/* 运营事实行（标题·来源·备注）不用 toolbar-copy：display:none 只隐藏静态描述，不能连带运营数据。 */}
        <p className="admin-fact-line" data-fact-line="review"><strong>{queueSelected.title || queueSelected.postId}</strong> · 来源：{queueSelected.reviewSource === 'banned_word' ? '违禁词命中' : '用户举报'}{queueSelected.reviewNote ? ' · 备注：' + queueSelected.reviewNote : ''}</p>
        <label className="admin-stage-field">审核意见<textarea value={queueNote} maxLength={500} disabled={reviewBusy} onChange={event => setQueueNote(event.target.value)} placeholder="留空使用服务端默认文案" /></label>
        <div className="admin-toolbar-actions">
          <AdminButton variant="primary" busy={reviewBusy} disabled={queueSelected.state !== 'pending'} onClick={() => void submitReview('approve')}>放行</AdminButton>
          <AdminButton variant="danger" busy={reviewBusy} disabled={queueSelected.state !== 'pending'} onClick={() => void submitReview('reject')}>驳回</AdminButton>
        </div>
      </div>}
    </section>}
    {tab === 'reports' && <section className="admin-stage-panel" aria-busy={reportLoading}>
      <AdminToolbar actions={<AdminButton onClick={() => void loadReports()} busy={reportLoading}><RefreshCw aria-hidden="true" />刷新</AdminButton>}>
        <h2>举报处理</h2><p>待处理举报默认为 open 状态；处置会同时更新举报与帖子治理状态，同一事务提交。</p>
      </AdminToolbar>
      <form className="admin-community-filters" onSubmit={event => { event.preventDefault(); setReportPage(0); setReportStatus(reportStatusDraft); }}>
        <label>举报状态<select value={reportStatusDraft} onChange={event => setReportStatusDraft(event.target.value as ReportStatusFilter)}>
          {(['open', 'reviewing', 'resolved', 'rejected', 'all'] as const).map(value => <option key={value} value={value}>{value === 'open' ? '待处理' : value === 'reviewing' ? '处理中' : value === 'resolved' ? '已解决' : value === 'rejected' ? '已驳回' : '全部'}</option>)}
        </select></label>
        <AdminButton type="submit" variant="primary" disabled={reportLoading}>查询</AdminButton>
      </form>
      {tabMessage && <p className="admin-success-message" role="status">{tabMessage}</p>}
      {reportError && <AdminErrorState title="举报列表读取未完成" message={reportError} retry={() => void loadReports()} busy={reportLoading} />}
      {reportLoading && !reportData ? <AdminLoading label="正在读取举报列表…" /> : !reportData ? <AdminEmptyState title="暂无成功读取结果" description="请重试读取，不把失败当作空列表。" />
        : reportData.items.length === 0 ? <AdminEmptyState title="没有匹配的举报" description="当前筛选下没有举报记录。" />
        : <div className="admin-community-table-wrap"><AdminDataTable className="table-fixed" columns={reportColumns} rows={reportData.items} rowKey={item => item.id} ariaLabel="举报列表" minWidth={680}
          rowAttrs={item => ({ 'data-report-item': item.id })} /></div>}
      <AdminPagination label="举报列表分页" total={reportData?.total ?? 0} limit={TAB_LIMIT} offset={reportPage * TAB_LIMIT} busy={reportLoading}
        onPageChange={nextOffset => setReportPage(Math.floor(nextOffset / TAB_LIMIT))} />
      {reportSelected && <div className="admin-community-detail" data-report-target={reportSelected.id}>
        <AdminToolbar><h2>举报处置</h2></AdminToolbar>
        <p className="admin-fact-line" data-fact-line="report"><strong>{reportSelected.post?.title || reportSelected.entityId}</strong> · 举报人：{reportSelected.reporter?.displayName || '匿名'}</p>
        <label className="admin-stage-field">处置方式<select value={reportResolution} disabled={resolveBusy} onChange={event => setReportResolution(event.target.value as ReportResolution)}>
          {(['delete_post', 'dismiss', 'ban_user'] as const).map(value => <option key={value} value={value}>{REPORT_RESOLUTION_LABEL[value]}</option>)}
        </select></label>
        <label className="admin-stage-field">处置备注<textarea value={reportNote} maxLength={500} disabled={resolveBusy} onChange={event => setReportNote(event.target.value)} placeholder="留空使用服务端默认文案" /></label>
        <div className="admin-toolbar-actions">
          <AdminButton variant={reportResolution === 'ban_user' || reportResolution === 'delete_post' ? 'danger' : 'primary'} busy={resolveBusy} disabled={reportSelected.status !== 'open'} onClick={() => void submitResolve()}>确认处置</AdminButton>
        </div>
      </div>}
    </section>}
  </section>;
}
