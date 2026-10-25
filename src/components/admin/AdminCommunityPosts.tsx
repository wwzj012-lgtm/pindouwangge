import { useAuth } from '../../context/AuthContext';
import { contentRecoveryFor } from './adminWriteRecovery';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Eye, RefreshCw, ShieldAlert } from 'lucide-react';
import { createAdminBlobRequest, type AdminBlobRequest, type AdminRequest } from './adminRequest';
import { AdminButton, AdminConfirmDialog, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { dateText } from './adminUserModel';

type CommunityStatus = 'all' | 'public' | 'private' | 'blocked' | 'withdrawn';
type ModerationState = 'visible' | 'hidden';
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
  const writing = useRef(false), listEpoch = useRef(0), detailEpoch = useRef(0);
  const [mustRead, setMustRead] = useState(false);

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

  useEffect(() => { void load(); return () => { listEpoch.current++; }; }, [load]);
  useEffect(() => () => { detailEpoch.current++; }, []);

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
  const maxPage = useMemo(() => Math.max(0, Math.ceil((snapshot?.total ?? 0) / LIMIT) - 1), [snapshot?.total]);
  const selectedPost = selected?.post;
  const canModerate = selectedPost?.withdrawnAt === null && (selectedPost?.moderation.state === 'hidden' || selectedPost?.visibility === 'public');
  const action = selectedPost?.moderation.state === 'hidden' ? 'restore' : 'takedown';

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
      <h2>社区帖子审核</h2><p>读取真实社区帖子与审核状态；下架/恢复要求原因和服务端版本校验，不直接修改旧作品表。</p>
    </AdminToolbar>
    <form className="admin-community-filters" onSubmit={event => { event.preventDefault(); if (!loading) applyFilters(); }}>
      <label>搜索帖子、作者或标签<input value={searchDraft} maxLength={200} onChange={event => setSearchDraft(event.target.value)} placeholder="标题、帖子 ID、作者 UID" /></label>
      <label>状态<select value={statusDraft} onChange={event => setStatusDraft(event.target.value as CommunityStatus)}>{(['all', 'public', 'private', 'blocked', 'withdrawn'] as const).map(value => <option key={value} value={value}>{communityStatusLabel(value)}</option>)}</select></label>
      <AdminButton type="submit" variant="primary" disabled={loading}>查询</AdminButton>
    </form>
    {success && <p className="admin-success-message" role="status">{success}</p>}
    {error && <AdminErrorState title="社区操作未完成" message={error} retry={() => void load()} busy={loading || busy} />}
    <div className="admin-community-layout">
      <section className="admin-stage-panel" aria-busy={loading}>
        {loading && !snapshot ? <AdminLoading label="正在读取社区帖子…" /> : !snapshot ? <AdminEmptyState title="暂无成功读取结果" description="请重试读取，不把失败当作空列表。" /> : snapshot.items.length === 0 ? <AdminEmptyState title="没有匹配的社区帖子" /> : <>
          <div className="admin-community-table-wrap"><table className="admin-stage-table" aria-label="社区帖子列表"><thead><tr><th>帖子</th><th>作者</th><th>状态</th><th>审核版本</th><th>操作</th></tr></thead><tbody>{snapshot.items.map(post => <tr key={post.id} data-community-post={post.id}><td><strong>{post.title || post.id}</strong><small className="admin-mono">{post.id}</small><small>{dateText(post.publishedAt)}</small></td><td><strong>{post.author.displayName || '未提供昵称'}</strong><small className="admin-mono">{post.author.uid}</small></td><td>{postStatus(post)}{post.moderation.reason && <small>{post.moderation.reason}</small>}</td><td className="admin-mono">{post.moderation.version}</td><td><AdminButton onClick={() => void readDetail(post.id)} disabled={detailLoading}>详情</AdminButton></td></tr>)}</tbody></table></div>
          <div className="admin-community-cards">{snapshot.items.map(post => <article className="admin-community-card" key={post.id}><strong>{post.title || post.id}</strong><small className="admin-mono">{post.id}</small><p>{postStatus(post)} · 审核版本 {post.moderation.version}</p><AdminButton onClick={() => void readDetail(post.id)} disabled={detailLoading}>查看详情</AdminButton></article>)}</div>
          <div className="admin-pagination"><span>共 {snapshot.total} 条 · 第 {page + 1} / {maxPage + 1} 页</span><div><AdminButton iconOnly aria-label="上一页" disabled={loading || page <= 0} onClick={() => setPage(value => value - 1)}><ChevronLeft aria-hidden="true" /></AdminButton><AdminButton iconOnly aria-label="下一页" disabled={loading || page >= maxPage} onClick={() => setPage(value => value + 1)}><ChevronRight aria-hidden="true" /></AdminButton></div></div>
        </>}
      </section>
      <aside className="admin-stage-panel admin-community-detail" aria-busy={detailLoading}>
        <AdminToolbar><h2>帖子详情</h2><p>详情接口返回什么才展示什么；图片/图纸二进制预览暂不伪造。</p></AdminToolbar>
        {detailLoading ? <AdminLoading label="正在读取帖子详情…" /> : detailError ? <AdminErrorState title="详情暂不可用" message={detailError} retry={() => selectedPost ? void readDetail(selectedPost.id) : undefined} /> : !selectedPost ? <AdminEmptyState title="选择一个帖子" description="先从左侧列表读取服务端详情。" /> : <div className="admin-community-detail-body" data-community-version={selectedPost.moderation.version}><dl className="admin-detail-facts"><div><dt>标题</dt><dd>{selectedPost.title || '未提供'}</dd></div><div><dt>帖子 ID</dt><dd className="admin-mono">{selectedPost.id}</dd></div><div><dt>作者 UID</dt><dd className="admin-mono">{selectedPost.author.uid}</dd></div><div><dt>可见状态</dt><dd>{postStatus(selectedPost)}</dd></div><div><dt>审核原因</dt><dd>{selectedPost.moderation.reason || '未提供'}</dd></div><div><dt>审核版本</dt><dd className="admin-mono">{selectedPost.moderation.version}</dd></div></dl><p className="admin-info-box"><Eye aria-hidden="true" />{imageDecoded || patternDecoded ? '真实预览已加载。' : communityEvidenceStatus(selected!) + '。'}{selectedPost.work && selected?.snapshot == null && '缺少图纸证据，当前仅记录审核。'}不把审核记录冒充已查看内容。</p>{previewLoading && <p className="admin-result-caption" role="status">正在加载真实图片/图纸预览…</p>}{previewError && <p className="admin-field-error" role="alert">{previewError}</p>}{imagePreviewUrl && <figure className="admin-community-preview"><img src={imagePreviewUrl} onLoad={event => setImageDecoded(event.currentTarget.naturalWidth > 0)} onError={event => { URL.revokeObjectURL(event.currentTarget.src); setImagePreviewUrl(''); setImageDecoded(false); setPreviewError(value => value + ' 图片解码失败，文件可能损坏；不能作为已查看证据。'); }} alt={'社区帖子“' + (selectedPost.title || selectedPost.id) + '”的真实图片证据'} /><figcaption>图片证据：来自服务端资产接口。</figcaption></figure>}{patternPreviewUrl && <figure className="admin-community-preview"><img src={patternPreviewUrl} onLoad={event => setPatternDecoded(event.currentTarget.naturalWidth > 0)} onError={event => { URL.revokeObjectURL(event.currentTarget.src); setPatternPreviewUrl(''); setPatternDecoded(false); setPreviewError(value => value + ' 图纸预览解码失败，文件可能损坏；请查看当前快照。'); }} alt={'社区帖子“' + (selectedPost.title || selectedPost.id) + '”的当前图纸预览'} /><figcaption>当前图纸预览：服务端当前活动修订，非历史版本。</figcaption></figure>}{readableCurrentSnapshot(selected?.snapshot) && <details className="admin-community-snapshot" open><summary>当前快照（非历史版本）</summary><pre>{readableCurrentSnapshot(selected?.snapshot)}</pre></details>}{mustRead && <AdminErrorState message="状态冲突或写入结果不确定，必须重读详情后才能继续。" retry={() => { setPending(null); void readDetail(selectedPost.id); }} />}{canModerate && <AdminButton disabled={busy || detailLoading} variant={action === 'takedown' ? 'danger' : 'primary'} onClick={() => setPending({ action, post: selectedPost, reason: '' })}><ShieldAlert aria-hidden="true" />{actionLabel(action)}帖子</AdminButton>}{selected?.audit && <p className="admin-stage-footnote">已读取 {selected.audit.length} 条审核审计记录。</p>}</div>}
      </aside>
    </div>
    <AdminConfirmDialog open={Boolean(pending)} title={pending ? '确认社区帖子' + actionLabel(pending.action) : '确认社区操作'} description={pending ? '提交时将使用读取到的审核版本 ' + pending.post.moderation.version + '，版本冲突会拒绝写入。' : ''}
      subject={pending ? (pending.post.title || '未提供标题') + ' · 帖子 ID：' + pending.post.id + ' · 作者 UID：' + pending.post.author.uid : undefined}
      impact={pending?.action === 'takedown' ? '下架本次选中的社区帖子，限制公开展示；保留作者图纸与审核记录。' : '请求恢复本次选中的社区帖子，最终展示仍受发布状态与可见性规则约束。'}
      reason={pending?.reason.trim() || '请在下方填写本次审核原因（必填）'}
      confirmLabel="确认提交" confirmDisabled={mustRead || Boolean(pending && recovery.isUncertain(scope(pending.post.id))) || !pending?.reason.trim()} pending={busy} onClose={() => { if (!busy) setPending(null); }} onConfirm={() => void confirmAction()}>
      {pending && <label className="admin-stage-field">操作原因<textarea value={pending.reason} maxLength={500} disabled={busy} onChange={event => setPending(value => value ? { ...value, reason: event.target.value } : value)} placeholder="填写本次审核原因（必填）" /></label>}
      {error && <AdminErrorState message={error} />}
    </AdminConfirmDialog>
  </section>;
}
