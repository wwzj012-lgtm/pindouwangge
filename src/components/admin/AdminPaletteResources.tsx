import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, FileImage, RefreshCw, Search, ShieldAlert, Trash2, X } from 'lucide-react';
import { getAdminSessionToken, getApiToken } from '../../utils/api';
import type { AdminRequest } from './adminRequest';
import { AdminBadge, AdminButton, AdminConfirmDialog, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar, AdminDrawer } from './AdminPrimitives';

export interface AdminAssetUsage {
  postCount: number;
  activePostCount: number;
  workCount: number;
}

export interface AdminCommunityAsset {
  id: string;
  ownerUid: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteSize: number;
  sha256: string;
  createdAt: number;
  availability: 'available' | 'missing' | 'check_failed';
  usage: AdminAssetUsage;
  inUse: boolean;
  canDelete: boolean;
  previewPath: string;
}

export interface AdminAssetPage {
  items: AdminCommunityAsset[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminAssetBinaryResult {
  ok: boolean;
  status: number;
  blob?: Blob;
  error?: string;
}

export type AdminAssetPreviewRequest = (path: string) => Promise<AdminAssetBinaryResult>;

export interface AdminPaletteResourcesProps {
  /** Existing admin JSON request; no color-card CRUD is duplicated here. */
  request: AdminRequest;
  /** Binary preview request must preserve the same admin session as request. */
  previewRequest?: AdminAssetPreviewRequest;
  /** Beauvoir can force read-only rendering for a read-only admin role. */
  readOnly?: boolean;
  pageSize?: number;
  className?: string;
}

const DEFAULT_PAGE_SIZE = 20;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

function asPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function formatAssetBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '未知大小';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function formatAssetUsage(usage: AdminAssetUsage): string {
  return `帖子 ${usage.postCount} · 作品 ${usage.workCount}`;
}

export function assetDeleteReason(asset: Pick<AdminCommunityAsset, 'availability' | 'inUse' | 'usage' | 'canDelete'>): string | null {
  if (asset.inUse || asset.usage.postCount > 0 || asset.usage.workCount > 0) return '已有帖子或作品引用，不能删除';
  if (asset.availability !== 'available') return '文件不可用或校验未完成，不能删除';
  if (!asset.canDelete) return '服务端未确认资源可安全删除';
  return null;
}

export function adminAssetQuery(values: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

function validAssetPage(value: unknown): value is AdminAssetPage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AdminAssetPage>;
  return Array.isArray(candidate.items) && Number.isFinite(candidate.total)
    && Number.isFinite(candidate.limit) && Number.isFinite(candidate.offset);
}

function defaultPreviewRequest(path: string): Promise<AdminAssetBinaryResult> {
  const headers = new Headers({ Accept: 'image/png, image/jpeg, image/webp' });
  const userToken = getApiToken();
  const adminToken = getAdminSessionToken();
  if (userToken) headers.set('Authorization', `Bearer ${userToken}`);
  if (adminToken) headers.set('X-Admin-Session', adminToken);
  return fetch(path, {
    method: 'GET',
    credentials: 'include',
    headers,
  }).then(async (response) => {
    if (!response.ok) return { ok: false, status: response.status, error: `预览请求失败（${response.status}）` };
    const type = response.headers.get('Content-Type')?.split(';', 1)[0]?.toLowerCase();
    if (!IMAGE_TYPES.includes(type as typeof IMAGE_TYPES[number])) return { ok: false, status: 415, error: '后台返回了不支持的文件类型' };
    return { ok: true, status: response.status, blob: await response.blob() };
  }).catch(() => ({ ok: false, status: 0, error: '无法连接后台服务，请重试' }));
}

function date(value: number): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? '-' : parsed.toLocaleString('zh-CN', { hour12: false });
}

function availabilityLabel(value: AdminCommunityAsset['availability']): { label: string; tone: 'success' | 'warning' | 'danger' } {
  if (value === 'available') return { label: 'KV 对象存在', tone: 'success' };
  if (value === 'missing') return { label: 'KV 文件缺失', tone: 'danger' };
  return { label: '校验失败', tone: 'warning' };
}

export function AdminPaletteResources({ request, previewRequest = defaultPreviewRequest, readOnly = false, pageSize = DEFAULT_PAGE_SIZE, className = '' }: AdminPaletteResourcesProps) {
  const limit = Math.min(50, asPositiveInteger(pageSize, DEFAULT_PAGE_SIZE));
  const [items, setItems] = useState<AdminCommunityAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [ownerUid, setOwnerUid] = useState('');
  const [contentType, setContentType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AdminCommunityAsset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState<{ asset: AdminCommunityAsset; url: string } | null>(null);
  const [previewDecoded, setPreviewDecoded] = useState(false);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const result = await request<AdminAssetPage>(`/api/admin/community-assets${adminAssetQuery({ page, limit, search: search.trim(), ownerUid: ownerUid.trim(), contentType })}`);
    if (!result.ok) {
      setError(result.error ?? '资源列表加载失败。');
      setLoading(false);
      return;
    }
    if (!validAssetPage(result.data)) {
      setError('后台返回的资源列表结构不完整。');
      setLoading(false);
      return;
    }
    setItems(result.data.items);
    setTotal(result.data.total);
    setLoading(false);
  }, [contentType, limit, ownerUid, page, request, search]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
  }, [preview?.url]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const canPrevious = page > 1 && !loading && !error;
  const canNext = page < pages && !loading && !error;
  const rows = useMemo(() => items, [items]);

  const openPreview = async (asset: AdminCommunityAsset) => {
    setPreviewLoading(asset.id);
    setError('');
    const result = await previewRequest(`/api/admin/community-assets/preview${adminAssetQuery({ id: asset.id })}`);
    setPreviewLoading(null);
    if (!result.ok || !result.blob) {
      setError(result.error ?? '资源预览失败。');
      return;
    }
    const objectUrl = URL.createObjectURL(result.blob);
    setPreviewDecoded(false); setPreview({ asset, url: objectUrl });
  };

  const deleteAsset = async () => {
    if (!deleteTarget || readOnly || assetDeleteReason(deleteTarget)) return;
    setDeleting(true);
    setError('');
    const result = await request(`/api/admin/community-assets${adminAssetQuery({ id: deleteTarget.id })}`, { method: 'DELETE' });
    if (!result.ok) {
      setError(result.error ?? (result.status === 409 ? '资源已被引用，删除被保护性拒绝。' : '删除资源失败。'));
      setDeleting(false);
      return;
    }
    setDeleteTarget(null);
    setDeleting(false);
    setSuccess('资源已从 KV 和目录中删除。');
    if (items.length === 1 && page > 1) setPage((value) => value - 1);
    else void load();
  };

  return <section className={className} aria-label="真实资源管理">
    <AdminToolbar actions={<AdminButton busy={loading} onClick={() => void load()}><RefreshCw aria-hidden="true" />刷新</AdminButton>}>
      <h2>真实资源文件</h2>
      <p>基于 community_assets 与 KV 实际对象；不登记虚假元数据，不提供上传或导入。</p>
    </AdminToolbar>
    <div className="admin-final-notice mt-4" role="note"><ShieldAlert aria-hidden="true" /><span>当前接入为只读：删除暂时关闭，KV 与 D1 跨存储操作不保证原子性。色卡 CRUD 仍由现有“色卡与资源”模块处理；内建调色板只读，本模块只管理真实社区文件。</span></div>
    {error && <div className="mt-4"><AdminErrorState message={error} retry={() => void load()} busy={loading} /></div>}
    {success && <p className="admin-success-message" role="status">{success}</p>}
    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)_12rem]">
      <label className="relative block"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 admin-muted" aria-hidden="true" /><span className="sr-only">搜索资源 ID 或所属用户</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索资源 ID / 用户 UID" className="min-h-11 w-full border admin-final-surface py-2 pl-9 pr-3 text-sm" /></label>
      <label><span className="sr-only">所属用户 UID</span><input value={ownerUid} onChange={(event) => { setOwnerUid(event.target.value); setPage(1); }} placeholder="所属用户 UID" className="min-h-11 w-full border admin-final-surface px-3 text-sm" /></label>
      <label><span className="sr-only">文件类型</span><select value={contentType} onChange={(event) => { setContentType(event.target.value); setPage(1); }} className="min-h-11 w-full border admin-final-surface px-3 text-sm"><option value="">全部类型</option>{IMAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
    </div>
    <div className="mt-5">
      {loading ? <AdminLoading label="正在检查 KV 文件与引用关系…" /> : rows.length === 0 ? <AdminEmptyState title={error ? "尚无成功读取结果，请重试" : "暂无真实资源"} description="列表只显示 community_assets 中有记录的真实资源。" /> : <>
        <div className="hidden overflow-x-auto border md:block"><table className="w-full min-w-[1060px] text-left text-sm"><thead className="admin-final-surface text-xs admin-muted"><tr><th className="px-4 py-3">预览</th><th className="px-4 py-3">资源 / 所属用户</th><th className="px-4 py-3">类型 / 大小</th><th className="px-4 py-3">关联使用</th><th className="px-4 py-3">文件状态</th><th className="px-4 py-3 text-right">安全操作</th></tr></thead><tbody>{rows.map((asset) => { const availability = availabilityLabel(asset.availability); const deleteReason = assetDeleteReason(asset); return <tr key={asset.id} className="border-t"><td className="px-4 py-3"><button type="button" className="grid h-14 w-14 place-items-center border admin-final-surface" onClick={() => void openPreview(asset)} disabled={previewLoading === asset.id || asset.availability !== 'available'} aria-label={`预览资源 ${asset.id}`}>{previewLoading === asset.id ? <RefreshCw className="admin-spin" aria-hidden="true" /> : <Eye aria-hidden="true" />}</button></td><td className="max-w-[18rem] px-4 py-3"><p className="truncate font-mono text-xs">{asset.id}</p><p className="mt-1 truncate text-xs admin-muted">{asset.ownerUid}</p><p className="mt-1 text-xs admin-muted">{date(asset.createdAt)}</p></td><td className="px-4 py-3"><p>{asset.contentType}</p><p className="mt-1 text-xs admin-muted">{formatAssetBytes(asset.byteSize)}</p></td><td className="px-4 py-3"><p>{formatAssetUsage(asset.usage)}</p><p className="mt-1 text-xs admin-muted">活跃帖子 {asset.usage.activePostCount}</p></td><td className="px-4 py-3"><AdminBadge tone={availability.tone}>{availability.label}</AdminBadge></td><td className="px-4 py-3"><div className="flex justify-end"><AdminButton variant="danger" disabled={readOnly || Boolean(deleteReason) || deleting} onClick={() => setDeleteTarget(asset)} title={deleteReason ?? '删除真实 KV 文件及其目录记录'}><Trash2 aria-hidden="true" />{deleteReason ? '受保护' : '删除'}</AdminButton></div></td></tr>; })}</tbody></table></div>
        <div className="space-y-2 md:hidden">{rows.map((asset) => { const availability = availabilityLabel(asset.availability); const deleteReason = assetDeleteReason(asset); return <article key={asset.id} className="border admin-final-surface p-3"><div className="flex gap-3"><button type="button" className="grid h-14 w-14 shrink-0 place-items-center border" onClick={() => void openPreview(asset)} disabled={previewLoading === asset.id || asset.availability !== 'available'} aria-label={`预览资源 ${asset.id}`}><Eye aria-hidden="true" /></button><div className="min-w-0 flex-1"><p className="truncate font-mono text-xs">{asset.id}</p><p className="mt-1 truncate text-xs admin-muted">{asset.ownerUid}</p><p className="mt-2 text-sm">{asset.contentType} · {formatAssetBytes(asset.byteSize)}</p><p className="mt-1 text-xs admin-muted">{formatAssetUsage(asset.usage)} · {availability.label}</p></div></div><div className="mt-3 flex justify-end"><AdminButton variant="danger" disabled={readOnly || Boolean(deleteReason) || deleting} onClick={() => setDeleteTarget(asset)}>{deleteReason ? '受保护' : '删除真实文件'}</AdminButton></div></article>; })}</div>
        <div className="admin-pagination mt-4"><span>共{total}条 · {page}/{pages}页</span><div className="flex gap-2"><AdminButton disabled={!canPrevious} onClick={() => setPage((value) => value - 1)}>上一页</AdminButton><AdminButton disabled={!canNext} onClick={() => setPage((value) => value + 1)}>下一页</AdminButton></div></div>
      </>}
    </div>
    <AdminConfirmDialog open={Boolean(deleteTarget)} title="删除真实资源文件？" description={deleteTarget ? `对象 ${deleteTarget.id} 将从 KV 删除，且 D1 目录记录也会删除。服务端会再次检查帖子和作品引用；任何引用都会拒绝操作。` : ''} confirmLabel="删除文件" onClose={() => { if (!deleting) setDeleteTarget(null); }} onConfirm={() => void deleteAsset()} pending={deleting} confirmDisabled={Boolean(deleteTarget && (readOnly || assetDeleteReason(deleteTarget)))}>
      {deleteTarget && <div className="admin-final-notice"><FileImage aria-hidden="true" /><span>{deleteTarget.contentType} · {formatAssetBytes(deleteTarget.byteSize)} · {formatAssetUsage(deleteTarget.usage)}</span></div>}
    </AdminConfirmDialog>
    <AdminDrawer open={Boolean(preview)} title="资源预览" description={preview ? `${preview.asset.id} · ${preview.asset.contentType}` : undefined} onClose={() => setPreview(null)}><div className="grid min-h-64 place-items-center p-5"><button type="button" className="absolute right-4 top-4" onClick={() => setPreview(null)} aria-label="关闭预览"><X aria-hidden="true" /></button>{preview && <>{!previewDecoded && <p role="status">正在解码真实资源图片…</p>}<img onLoad={event => setPreviewDecoded(event.currentTarget.naturalWidth > 0)} onError={event => { URL.revokeObjectURL(event.currentTarget.src); setPreview(null); setPreviewDecoded(false); setError('资源图片解码失败，文件可能损坏；预览未成功。'); }} src={preview.url} alt={`资源 ${preview.asset.id}`} className="max-h-[70vh] max-w-full object-contain" /></>}</div></AdminDrawer>
  </section>;
}
