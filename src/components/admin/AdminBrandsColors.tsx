import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Edit3, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { AdminRequest } from './adminRequest';
import { AdminBadge, AdminButton, AdminConfirmDialog, AdminDrawer, AdminEmptyState, AdminErrorState, AdminLoading } from './AdminPrimitives';
import { BRAND_CODE_PATTERN, brandDeleteReason, colorValidation, filterBrandColors, isBrandMutationReceipt, isManagedBrandCatalog,
  normalizedCatalogCode, type ManagedBrand, type ManagedBrandCatalog, type ManagedBrandColor } from './AdminBrandsColors.model';
import { refreshBrandCatalog } from '../../data/brandCatalog';
import './AdminBrandsColors.css';

export interface AdminBrandsColorsProps { request: AdminRequest; readOnly?: boolean }
type Editor = { kind: 'brand'; brand?: ManagedBrand } | { kind: 'color'; brand: ManagedBrand; color?: ManagedBrandColor };
type Deletion = { brand: ManagedBrand; color?: ManagedBrandColor };
interface PendingOperation { path: string; init: RequestInit; id: string }

export function AdminBrandsColors({ request, readOnly = false }: AdminBrandsColorsProps) {
  const [catalog, setCatalog] = useState<ManagedBrandCatalog | null>(null);
  const [selected, setSelected] = useState('MARD');
  const [brandSearch, setBrandSearch] = useState(''), [colorSearch, setColorSearch] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [writeError, setWriteError] = useState(''), [success, setSuccess] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null), [deletion, setDeletion] = useState<Deletion | null>(null);
  const [form, setForm] = useState({ code: '', name: '', hex: '#A3B18A', enabled: true, special: false });
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState<PendingOperation | null>(null);
  const writeLock = useRef(false), loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true); setLoadError('');
    try {
      const response = await request<ManagedBrandCatalog>('/api/admin/brands');
      if (generation !== loadGeneration.current) return;
      if (!response.ok || !isManagedBrandCatalog(response.data)) {
        setLoadError(response.error || '品牌目录读取失败或结构不完整；管理操作暂不可用。'); return;
      }
      setCatalog(response.data);
      setSelected(current => response.data!.items.some(brand => brand.code === current) ? current : 'MARD');
    } catch { if (generation === loadGeneration.current) setLoadError('无法连接品牌目录服务。'); }
    finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [request]);
  useEffect(() => { void load(); return () => { loadGeneration.current++; }; }, [load]);
  const brand = catalog?.items.find(item => item.code === selected);
  const needle = brandSearch.trim().toLowerCase();
  const brands = catalog?.items.filter(item => !needle || `${item.code} ${item.name}`.toLowerCase().includes(needle)) ?? [];
  const colors = brand ? filterBrandColors(brand, colorSearch) : [];
  const pages = Math.max(1, Math.ceil(colors.length / 48));
  const currentPage = Math.min(page, pages - 1);
  const locked = readOnly || busy || Boolean(unknown) || loading || Boolean(loadError) || !catalog;
  const complete = async (operation: PendingOperation, receipt: unknown) => {
    if (!isBrandMutationReceipt(receipt, operation.id)) return false;
    setUnknown(null); setEditor(null); setDeletion(null); setWriteError(''); setPage(0);
    setSuccess('操作已确认保存。前台新转换使用最新目录；已有图纸保留颜色快照。');
    if (receipt.action === 'createBrand') setSelected(receipt.brandCode);
    await load();
    void refreshBrandCatalog();
    return true;
  };
  const execute = async (operation: PendingOperation, reconciling = false) => {
    try {
      const response = await request(operation.path, operation.init);
      if (response.ok && await complete(operation, response.data)) return;
      if (reconciling || response.ok || response.status === 0 || response.status >= 500 || (response.status >= 200 && response.status < 300)) {
        setUnknown(operation); setWriteError('操作结果尚未确认。请核对回执或重试同一操作，不要重新创建。');
      } else {
        setUnknown(null); setWriteError(response.error || '操作未完成。');
        if (response.status === 409 || response.status === 404) { setEditor(null); setDeletion(null); await load(); }
      }
    } catch { setUnknown(operation); setWriteError('连接中断，操作可能已经保存。请核对结果。'); }
  };
  const submit = async (path: string, method: string, body: Record<string, unknown>) => {
    if (locked || writeLock.current) return;
    writeLock.current = true; setBusy(true); setWriteError(''); setSuccess('');
    const id = crypto.randomUUID();
    try { await execute({ path, id, init: { method, body: JSON.stringify({ ...body, operationId: id }) } }); }
    finally { writeLock.current = false; setBusy(false); }
  };
  const reconcile = async () => {
    if (!unknown || writeLock.current || readOnly) return;
    writeLock.current = true; setBusy(true);
    try {
      const response = await request(`/api/admin/brands/mutations?id=${encodeURIComponent(unknown.id)}`);
      if (response.ok && await complete(unknown, response.data)) return;
      // A write may still be in flight after a 404. Replay the exact ID/body so the DB can deduplicate it.
      if (response.status === 404) await execute(unknown, true);
      else setWriteError('尚无法确认结果，请恢复后台会话或连接后再次核对；操作 ID 已保留。');
    } catch { setWriteError('核对失败，请保留当前操作 ID，连接恢复后再核对。'); }
    finally { writeLock.current = false; setBusy(false); }
  };
  const openEditor = (next: Editor) => {
    if (locked) return;
    setWriteError(''); setSuccess(''); setEditor(next);
    setForm(next.kind === 'brand'
      ? { code: next.brand?.code ?? '', name: next.brand?.name ?? '', hex: '#A3B18A', enabled: next.brand?.enabled ?? true, special: false }
      : { code: next.color?.code ?? '', name: next.color?.name ?? '', hex: next.color?.hex ?? '#A3B18A', enabled: true, special: next.color?.screenReferenceOnly ?? false });
  };
  const saveEditor = (event: React.FormEvent) => {
    event.preventDefault(); if (!editor || locked) return;
    if (editor.kind === 'brand') {
      const code = normalizedCatalogCode(form.code);
      if (!BRAND_CODE_PATTERN.test(code) || code === 'CUSTOM') { setWriteError('品牌 code 以字母开头，限 32 位大写字母、数字或下划线；CUSTOM 为保留值。'); return; }
      if (!form.name.trim() || form.name.trim().length > 100) { setWriteError('品牌名称须为 1–100 字。'); return; }
      void submit('/api/admin/brands', editor.brand ? 'PATCH' : 'POST', { brandCode: code, name: form.name.trim(), enabled: form.enabled,
        ...(editor.brand ? { expectedVersion: editor.brand.version } : {}) });
    } else {
      const error = colorValidation(form.code, form.name, form.hex); if (error) { setWriteError(error); return; }
      void submit('/api/admin/brands/colors', editor.color ? 'PATCH' : 'POST', { brandCode: editor.brand.code,
        expectedVersion: editor.brand.version, ...(editor.color ? { colorId: editor.color.id } : {}),
        code: normalizedCatalogCode(form.code), name: form.name.trim(), hex: form.hex.trim().toUpperCase(), screenReferenceOnly: form.special });
    }
  };
  const deleteTarget = () => {
    if (!deletion || locked) return;
    void submit(`/api/admin/brands${deletion.color ? '/colors' : ''}`, 'DELETE', { brandCode: deletion.brand.code,
      expectedVersion: deletion.brand.version, ...(deletion.color ? { colorId: deletion.color.id } : {}) });
  };
  const mutationNotice = <>{writeError && <p className="admin-brand-message admin-brand-message--error" role="alert">{writeError}</p>}
    {unknown && <div className="admin-brand-message" role="status"><p>待核对操作：<code>{unknown.id}</code></p><p>核对前暂停其他写入，请勿刷新页面后重复新建。</p><AdminButton busy={busy} onClick={() => void reconcile()} disabled={readOnly}>核对结果 / 重试同一操作</AdminButton></div>}</>;
  return <section className="admin-brands" aria-label="品牌与子颜色管理" aria-busy={loading || busy}>
    <div className="admin-brand-heading"><div><p className="admin-brand-eyebrow">COLOR LIBRARY</p><h2>品牌与颜色</h2><p>管理实际用于新转换的品牌目录。历史图纸始终保留自己的颜色快照。</p></div><AdminButton onClick={() => void load()} busy={loading} disabled={busy || Boolean(unknown)}><RefreshCw aria-hidden="true" />刷新目录</AdminButton></div>
    {readOnly && <p className="admin-brand-message">当前账号只有读取权限。</p>}
    {loadError && <AdminErrorState message={loadError} retry={() => void load()} busy={loading} />}
    {!editor && !deletion && mutationNotice}
    {success && <p className="admin-brand-message admin-brand-message--success" role="status">{success}</p>}
    {loading && !catalog ? <AdminLoading label="正在读取品牌与子颜色…" /> : catalog && <div className="admin-brand-layout">
      <aside className="admin-brand-sidebar" aria-label="品牌列表">
        <div className="admin-brand-sidebar-title"><h3>品牌 <span>{catalog.items.length}</span></h3><AdminButton iconOnly aria-label="新增品牌" title="新增品牌" disabled={locked} onClick={() => openEditor({ kind: 'brand' })}><Plus aria-hidden="true" /></AdminButton></div>
        <label className="admin-brand-search"><Search aria-hidden="true" /><span className="sr-only">搜索品牌</span><input value={brandSearch} onChange={event => setBrandSearch(event.target.value)} placeholder="搜索品牌 / code" /></label>
        <nav className="admin-brand-list" aria-label="选择品牌">{brands.map(item => <button type="button" key={item.code} aria-current={item.code === selected ? 'true' : undefined} disabled={busy || Boolean(unknown)} onClick={() => { setSelected(item.code); setColorSearch(''); setPage(0); }}>
          <span><strong>{item.name}</strong><small>{item.code}{!item.enabled ? ' · 已禁用' : ''}{item.protected ? ' · 默认' : ''}</small></span><span className="admin-brand-count">{item.colorCount}<small>色</small></span></button>)}</nav>
        {!brands.length && <p className="admin-brand-muted">没有匹配的品牌</p>}
      </aside>
      <div className="admin-brand-detail">{brand && <>
        <div className="admin-brand-detail-heading"><div><div className="admin-brand-title"><h3>{brand.name}</h3><AdminBadge tone={brand.enabled ? 'success' : 'warning'}>{brand.enabled ? '已启用' : '已禁用'}</AdminBadge><AdminBadge>{brand.builtin ? '内建初始化' : '新增品牌'}</AdminBadge></div><p>{brand.code} · {brand.colorCount} 个颜色{brand.protected ? ' · 默认品牌须保留至少一个颜色' : ''}</p></div>
          <div className="admin-brand-actions"><AdminButton disabled={locked} onClick={() => openEditor({ kind: 'brand', brand })}><Edit3 aria-hidden="true" />编辑品牌</AdminButton><AdminButton variant="danger" disabled={locked || Boolean(brandDeleteReason(brand))} title={brandDeleteReason(brand) ?? '删除空品牌'} onClick={() => { setWriteError(''); setDeletion({ brand }); }}><Trash2 aria-hidden="true" />删除品牌</AdminButton></div></div>
        {!brand.enabled && <p className="admin-brand-message">此品牌已停止用于前台新转换。历史图纸仍使用保存的颜色快照。</p>}
        {!brand.colorCount && <p className="admin-brand-message">新增第一个颜色后，已启用的品牌才会出现在前台品牌选项中。</p>}
        <div className="admin-brand-colors-toolbar"><label className="admin-brand-search"><Search aria-hidden="true" /><span className="sr-only">搜索当前品牌颜色</span><input value={colorSearch} onChange={event => { setColorSearch(event.target.value); setPage(0); }} placeholder="搜索色号、名称或 HEX" /></label><AdminButton variant="primary" disabled={locked || brand.colorCount >= 1023} onClick={() => openEditor({ kind: 'color', brand })}><Plus aria-hidden="true" />新增颜色</AdminButton></div>
        <p className="admin-brand-muted" role="status">{colors.length} 个匹配颜色 · 每页 48 色</p>
        {colors.length ? <div className="admin-brand-color-grid">{colors.slice(currentPage * 48, (currentPage + 1) * 48).map(color => <article className="admin-brand-color" key={color.id}>
          <div className="admin-brand-swatch" style={{ backgroundColor: color.hex }} role="img" aria-label={`颜色 ${color.code} ${color.hex}`} />
          <div className="admin-brand-color-copy"><strong>{color.code}</strong><span title={color.name}>{color.name}</span><code>{color.hex}</code>{color.screenReferenceOnly && <small>特殊材质 · 屏幕参考</small>}</div>
          <div className="admin-brand-color-actions"><AdminButton iconOnly variant="ghost" aria-label={`编辑颜色 ${color.code}`} disabled={locked} onClick={() => openEditor({ kind: 'color', brand, color })}><Edit3 aria-hidden="true" /></AdminButton><AdminButton iconOnly variant="ghost" aria-label={`删除颜色 ${color.code}`} disabled={locked || (brand.protected && brand.colorCount <= 1)} title={brand.protected && brand.colorCount <= 1 ? '默认 MARD 不能删除最后一个颜色' : '删除颜色'} onClick={() => { setWriteError(''); setDeletion({ brand, color }); }}><Trash2 aria-hidden="true" /></AdminButton></div>
        </article>)}</div> : <AdminEmptyState title={colorSearch ? '没有匹配的颜色' : '这个品牌还没有颜色'} description={colorSearch ? '试试其他色号、名称或 HEX。' : '添加颜色后，前台即可使用这个品牌。'} />}
        {pages > 1 && <div className="admin-brand-pagination"><span>{currentPage + 1} / {pages}</span><div><AdminButton disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</AdminButton><AdminButton disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</AdminButton></div></div>}
      </>}</div>
    </div>}
    <AdminDrawer open={Boolean(editor)} title={editor?.kind === 'brand' ? (editor.brand ? '编辑品牌' : '新增品牌') : (editor?.color ? '编辑颜色' : '新增颜色')} onClose={() => { if (!busy && !unknown) { setEditor(null); setWriteError(''); } }} pending={busy} dismissible={!unknown} className="admin-brand-editor">
      {editor && <form className="admin-brand-form" onSubmit={saveEditor}>
        {mutationNotice}
        <label>{editor.kind === 'brand' ? '品牌 code' : '色号'}<input data-admin-autofocus value={form.code} maxLength={editor.kind === 'brand' ? 32 : 64} disabled={busy || Boolean(unknown) || (editor.kind === 'brand' && Boolean(editor.brand))} onChange={event => setForm({ ...form, code: event.target.value })} required autoComplete="off" /></label>
        {editor.kind === 'brand' && <p className="admin-brand-muted">code 创建后固定，用于稳定引用；字母会统一为大写。已删除品牌 code 不可复用。</p>}
        <label>{editor.kind === 'brand' ? '品牌名称' : '颜色名称'}<input value={form.name} maxLength={100} disabled={busy || Boolean(unknown)} onChange={event => setForm({ ...form, name: event.target.value })} required /></label>
        {editor.kind === 'brand' ? <><label className="admin-brand-checkbox"><input type="checkbox" checked={form.enabled} disabled={busy || Boolean(unknown) || editor.brand?.protected} onChange={event => setForm({ ...form, enabled: event.target.checked })} />启用品牌</label><p className="admin-brand-muted">禁用后不再出现在前台新转换中；不会修改历史图纸。默认 MARD 不能禁用。</p></> : <>
          <label>HEX<div className="admin-brand-hex-input"><input type="color" aria-label="选择颜色" value={/^#[0-9A-Fa-f]{6}$/.test(form.hex) ? form.hex : '#000000'} disabled={busy || Boolean(unknown)} onChange={event => setForm({ ...form, hex: event.target.value.toUpperCase() })} /><input aria-label="HEX" value={form.hex} maxLength={7} disabled={busy || Boolean(unknown)} onChange={event => setForm({ ...form, hex: event.target.value })} placeholder="#A3B18A" required /></div></label>
          <label className="admin-brand-checkbox"><input type="checkbox" checked={form.special} disabled={busy || Boolean(unknown)} onChange={event => setForm({ ...form, special: event.target.checked })} />特殊材质，仅作屏幕颜色参考</label><p className="admin-brand-muted">同品牌下色号唯一，不区分大小写。不同材料可以使用相同 HEX。</p>
        </>}
        <div className="admin-brand-actions"><AdminButton disabled={busy || Boolean(unknown)} onClick={() => { setEditor(null); setWriteError(''); }}>取消</AdminButton><AdminButton type="submit" variant="primary" busy={busy} disabled={locked}>保存{editor.kind === 'brand' ? '品牌' : '颜色'}</AdminButton></div>
      </form>}
    </AdminDrawer>
    <AdminConfirmDialog open={Boolean(deletion)} title={deletion?.color ? '删除这个颜色？' : '删除这个空品牌？'}
      description={deletion ? `${deletion.brand.name}${deletion.color ? ` / ${deletion.color.code} · ${deletion.color.name} · ${deletion.color.hex}` : ` / ${deletion.brand.code}`}：删除后不再用于前台新转换。历史图纸的 palette 快照保持不变。` : ''}
      confirmLabel="确认删除" onConfirm={deleteTarget} onClose={() => { if (!busy && !unknown) { setDeletion(null); setWriteError(''); } }} pending={busy} confirmDisabled={locked}>
      {mutationNotice}
      {deletion && !deletion.color && <p>删除后品牌 code 仍保留，不能重复创建同名 code。</p>}
    </AdminConfirmDialog>
  </section>;
}
