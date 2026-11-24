import React, { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Download, Upload } from 'lucide-react';
import { BRAND_NAMES, BRAND_PALETTES } from '../data/palettes';
import type { BrandKey } from '../types';
import {
  assignLegacyInventory, getBeadInventorySnapshot, getBrandInventory, getInventoryColor,
  getServerBeadInventorySnapshot, INVENTORY_BRANDS, isValidBeadCount, MAX_BEAD_COUNT,
  subscribeBeadInventory, updateBrandInventory, writeBeadInventory, type BeadInventory, type CatalogStockItem,
} from '../utils/beadInventory';
import { exportInventoryExcel, parseInventoryExcel } from '../utils/excelExport';

export const INVENTORY_PAGE_SIZE = 36;
const PAGE_SIZE_OPTIONS = [24, 36, 48, 96] as const;
const groupOf = (code: string) => code.match(/^[A-Za-z]+/)?.[0].toUpperCase() ?? '数字';

/** 页码折叠：总页数 < 8 全量展示；否则保留首/尾/当前±1，中间折叠省略号（点按向该方向跳 5 页）。 */
type PageItem = number | 'ellipsis-left' | 'ellipsis-right';
function paginationItems(current: number, pages: number): PageItem[] {
  if (pages < 8) return Array.from({ length: pages }, (_v, i) => i + 1);
  const window = new Set<number>([1, pages, current - 1, current, current + 1]);
  const list = Array.from({ length: pages }, (_v, i) => i + 1).filter(value => window.has(value));
  const items: PageItem[] = [];
  let previous = 0;
  for (const value of list) {
    if (previous && value - previous > 1) items.push(value < current ? 'ellipsis-left' : 'ellipsis-right');
    items.push(value);
    previous = value;
  }
  return items;
}

/** 紧凑分页：页码可点、省略号跳 5 页、跳页输入、每页条数。置于网格上方，免滚底。 */
function StockPagination({ page, pages, total, pageSize, onPage, onPageSize }: {
  page: number; pages: number; total: number; pageSize: number;
  onPage: (next: number) => void; onPageSize: (next: number) => void;
}) {
  const [jump, setJump] = useState('');
  const [jumpInvalid, setJumpInvalid] = useState(false);
  const items = useMemo(() => paginationItems(page + 1, pages), [page, pages]);
  if (pages <= 1) return <nav className="bead-stock__pagination" aria-label="库存分页"><span className="bead-stock__pagination-info">共 {total} 色</span></nav>;
  const submitJump = () => {
    const text = jump.trim();
    const parsed = /^\d+$/.test(text) ? Number(text) : NaN;
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > pages) { setJumpInvalid(true); return; }
    setJumpInvalid(false); setJump('');
    onPage(parsed - 1);
  };
  return <nav className="bead-stock__pagination" aria-label="库存分页">
    <div className="bead-stock__pagination-pages" role="group" aria-label="页码">
      <button disabled={page === 0} onClick={() => onPage(page - 1)}>上一页</button>
      {items.map((item, index) => item === 'ellipsis-left' || item === 'ellipsis-right'
        ? <button key={`${item}-${index}`} className="bead-stock__ellipsis" title={item === 'ellipsis-left' ? '向前跳 5 页' : '向后跳 5 页'}
          aria-label={item === 'ellipsis-left' ? '向前跳 5 页' : '向后跳 5 页'}
          onClick={() => onPage(Math.min(Math.max(1, (page + 1) + (item === 'ellipsis-left' ? -5 : 5)), pages) - 1)}>…</button>
        : <button key={item} aria-current={item === page + 1 ? 'page' : undefined} className={item === page + 1 ? 'bead-stock__page--current' : undefined}
          onClick={() => { if (item !== page + 1) onPage(item - 1); }}>{item}</button>)}
      <button disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>下一页</button>
    </div>
    <span className="bead-stock__pagination-info">{total} 色 · 第 {page + 1}/{pages} 页</span>
    <label className="bead-stock__pagination-jump">跳至
      <input inputMode="numeric" value={jump} placeholder={`${page + 1}/${pages}`} aria-invalid={jumpInvalid || undefined}
        title={jumpInvalid ? `请输入 1–${pages} 的页码` : undefined}
        onChange={event => { setJump(event.target.value); setJumpInvalid(false); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submitJump(); } }}
        onBlur={() => { if (jump.trim()) submitJump(); else setJumpInvalid(false); }} />页</label>
    <label className="bead-stock__pagination-size">每页
      <select aria-label="每页条数" value={pageSize} onChange={event => onPageSize(Number(event.target.value))}>
        {[...new Set([...PAGE_SIZE_OPTIONS, pageSize])].sort((a, b) => a - b).map(size => <option key={size} value={size}>{size}</option>)}
      </select></label>
  </nav>;
}

function QuantityInput({ count, code, onSave }: { count: number; code: string; onSave: (count: number) => boolean }) {
  const [draft, setDraft] = useState(String(count));
  const parsed = draft.trim() === '' ? NaN : Number(draft);
  const valid = isValidBeadCount(parsed);
  const changed = draft !== String(count);
  return <form className="bead-stock__quantity" onSubmit={event => {
    event.preventDefault();
    if (valid && onSave(parsed)) setDraft(String(parsed));
  }}>
    <label>
      <span className="sr-only">{code} 库存数量</span>
      <input aria-label={`${code} 库存数量`} type="number" min="0" max={MAX_BEAD_COUNT} step="1"
        value={draft} aria-invalid={!valid} onChange={event => setDraft(event.target.value)} />
    </label>
    <span>粒</span>
    <button type="submit" disabled={!valid || !changed} aria-label={`保存 ${code} 库存`} title="保存"><Check className="h-4 w-4" aria-hidden="true" /></button>
    {!valid && <small role="alert">请输入 0–1,000,000 的整数</small>}
  </form>;
}

export function BeadInventoryPanel({ requireLogin }: { requireLogin: () => boolean }) {
  const inventory: BeadInventory = useSyncExternalStore(subscribeBeadInventory, getBeadInventorySnapshot, getServerBeadInventorySnapshot);
  const [brand, setBrand] = useState<BrandKey>('MARD_291');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(INVENTORY_PAGE_SIZE);
  const [batch, setBatch] = useState('500');
  const [message, setMessage] = useState('');
  const [legacyKey, setLegacyKey] = useState('');
  const [legacyTarget, setLegacyTarget] = useState('');
  const [importing, setImporting] = useState(false);
  const importInput = useRef<HTMLInputElement | null>(null);
  const rows: CatalogStockItem[] = useMemo(() => getBrandInventory(inventory, brand), [inventory, brand]);
  const groups = useMemo(() => [...new Set(rows.map(row => groupOf(row.code)))], [rows]);
  const legacy = useMemo(() => Object.entries(inventory).filter(([, item]) => !getInventoryColor(item)), [inventory]);
  const query = search.trim().toLowerCase();
  const filtered = rows.filter(row => (!query || `${row.code} ${row.name}`.toLowerCase().includes(query))
    && (group === 'all' || groupOf(row.code) === group)
    && (status === 'all' || (status === 'in_stock' ? row.count > 0 : row.count > 0 && row.count <= row.alertThreshold)));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const batchNumber = batch.trim() === '' ? NaN : Number(batch);
  const persist = (update: (latest: BeadInventory) => BeadInventory): boolean => {
    if (!requireLogin()) return false;
    try {
      if (!writeBeadInventory(update(getBeadInventorySnapshot()))) throw new Error('库存保存失败，请检查浏览器本地存储后重试');
      setMessage('库存已保存，实操需求会同步更新。');
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '库存保存失败');
      return false;
    }
  };
  const edit = (ids: string[], value: number, mode: 'set' | 'delta' = 'set') =>
    persist(latest => updateBrandInventory(latest, brand, ids, value, mode));
  const changeBrand = (next: BrandKey) => {
    setBrand(next); setSearch(''); setGroup('all'); setStatus('all'); setPage(0);
    setMessage(''); setLegacyTarget('');
  };
  const doExport = async () => {
    try {
      await exportInventoryExcel(`${BRAND_NAMES[brand]}`, rows.map(row => ({
        code: row.code, name: row.name, count: row.count, alertThreshold: row.alertThreshold,
      })));
      setMessage(`已导出 ${BRAND_NAMES[brand]} 全部 ${rows.length} 色，可在 Excel 里核对数量后导入。`);
    } catch (error) {
      setMessage(error instanceof Error ? `导出失败：${error.message}` : '导出失败');
    }
  };
  const doImport = async (file: File) => {
    if (!requireLogin()) return;
    setImporting(true);
    try {
      const imported = await parseInventoryExcel(file);
      const byCode = new Map(rows.map(row => [row.code.toUpperCase(), row]));
      const matched: Array<{ colorId: string; count: number }> = [];
      const unknownCodes: string[] = [];
      for (const item of imported) {
        const row = byCode.get(item.code);
        if (!row) { unknownCodes.push(item.code); continue; }
        if (isValidBeadCount(item.count) && item.count !== row.count) matched.push({ colorId: row.colorId, count: item.count });
      }
      if (!matched.length) {
        setMessage(`导入完成：没有需要更新的数量（${unknownCodes.length} 个色号不在 ${BRAND_NAMES[brand]} 中）。`);
        return;
      }
      const ok = persist(latest => {
        let working = latest;
        for (const item of matched) working = updateBrandInventory(working, brand, [item.colorId], item.count, 'set');
        return working;
      });
      if (ok) setMessage(`导入成功：更新 ${matched.length} 项数量${unknownCodes.length ? `；${unknownCodes.length} 个色号不在当前品牌（如 ${unknownCodes.slice(0, 5).join('、')}）` : ''}。`);
    } catch (error) {
      setMessage(error instanceof Error ? `导入失败：${error.message}` : '导入失败');
    } finally {
      setImporting(false);
      if (importInput.current) importInput.current.value = '';
    }
  };

  return <section className="bead-stock" aria-label="品牌拼豆库存">
    <div className="bead-stock__heading">
      <div><h3>豆仓 · 我的库存</h3><p>按品牌管理固定色卡，未设置数量均为 0。本机保存。</p></div>
      <div className="bead-stock__heading-tools">
        <label className="bead-stock__brand">拼豆品牌
          <select aria-label="拼豆品牌" value={brand} onChange={event => changeBrand(event.target.value as BrandKey)}>
            {INVENTORY_BRANDS.map(key => <option key={key} value={key}>{BRAND_NAMES[key]} · {BRAND_PALETTES[key].length} 色</option>)}
          </select>
        </label>
        <div className="bead-stock__excel">
          <button onClick={() => void doExport()} title="导出当前品牌全部色号与数量"><Download aria-hidden="true" className="h-4 w-4" />导出</button>
          <button disabled={importing} onClick={() => importInput.current?.click()} title="导入 Excel 更新数量（列：色号、数量）"><Upload aria-hidden="true" className="h-4 w-4" />{importing ? '导入中…' : '导入'}</button>
          <input ref={importInput} type="file" accept=".xlsx,.xls" className="sr-only" aria-label="导入库存 Excel"
            onChange={event => { const file = event.target.files?.[0]; if (file) void doImport(file); }} />
        </div>
      </div>
    </div>
    <div className="bead-stock__stats" aria-label="当前品牌库存统计">
      <span className="bead-stock__stat"><strong>{rows.reduce((sum, row) => sum + row.count, 0).toLocaleString()}</strong>粒库存</span>
      <span className="bead-stock__stat"><strong>{rows.filter(row => row.count > 0).length}</strong><i>/{rows.length}</i>有库存</span>
      <span className="bead-stock__stat"><strong>{rows.filter(row => row.count > 0 && row.count <= row.alertThreshold).length}</strong>低库存</span>
    </div>
    <div className="bead-stock__controls">
      <label className="bead-stock__search">
        <span className="sr-only">搜索当前品牌</span>
        <input type="search" placeholder="搜索色号或名称" value={search}
          onChange={event => { setSearch(event.target.value); setPage(0); }} />
      </label>
      <div className="bead-stock__filters" role="group" aria-label="库存状态">
        {([['all', '全部色号'], ['in_stock', '有库存'], ['alert', '低库存']] as const).map(([key, label]) =>
          <button key={key} type="button" aria-pressed={status === key} onClick={() => { setStatus(key); setPage(0); }}>{label}</button>)}
      </div>
      <div className="bead-stock__groups" role="group" aria-label="色号分组">
        {['all', ...groups].map(key => <button key={key} type="button" aria-pressed={group === key}
          onClick={() => { setGroup(key); setPage(0); }}>{key === 'all' ? '全部分组' : key}</button>)}
      </div>
    </div>
    <details className="bead-stock__batch">
      <summary>批量操作 · 当前筛选 {filtered.length} 色（含其他分页）</summary>
      <div className="bead-stock__batch-body">
        <label>数量 <input aria-label="批量数量" type="number" min="0" max={MAX_BEAD_COUNT} step="1"
          value={batch} onChange={event => setBatch(event.target.value)} /></label>
        {(['set', 'add', 'subtract'] as const).map(mode => <button key={mode}
          disabled={!filtered.length || !isValidBeadCount(batchNumber)} onClick={() => {
            edit(filtered.map(row => row.colorId), mode === 'subtract' ? -batchNumber : batchNumber, mode === 'set' ? 'set' : 'delta');
          }}>{mode === 'set' ? '批量设置' : mode === 'add' ? '批量增加' : '批量减少'}</button>)}
        {!isValidBeadCount(batchNumber) && <small role="alert">请输入 0–1,000,000 的整数</small>}
      </div>
    </details>
    <p className="bead-stock__message" role="status">{message}</p>
    <div className="bead-stock__list" role="list" aria-label="库存列表">
      {visible.map(row => <div key={`${row.colorId}:${row.count}`} role="listitem" data-color-id={row.colorId}
        className="bead-stock__row" title={row.name}>
        <span className="bead-stock__dot" style={{ backgroundColor: row.hex }} aria-hidden="true" />
        <strong className="bead-stock__code">{row.code}</strong>
        <span className="bead-stock__name">{row.name}</span>
        <QuantityInput code={row.code} count={row.count}
          onSave={value => edit([row.colorId], value)} />
        <div className="bead-stock__adjust">
          <button aria-label={`${row.code} 减少100粒`} disabled={row.count === 0} onClick={() => edit([row.colorId], -100, 'delta')}>−100</button>
          <button aria-label={`${row.code} 增加100粒`} disabled={row.count >= MAX_BEAD_COUNT} onClick={() => edit([row.colorId], 100, 'delta')}>+100</button>
        </div>
        {row.count > 0 && row.count <= row.alertThreshold && <small className="bead-stock__low">剩 {row.count}</small>}
      </div>)}
    </div>
    {!filtered.length && <p>当前品牌没有匹配的色号，请调整筛选。</p>}
    <StockPagination page={currentPage} pages={pages} total={filtered.length} pageSize={pageSize}
      onPage={setPage} onPageSize={next => { setPageSize(next); setPage(0); }} />
    {legacy.length > 0 && <details className="bead-stock__legacy">
      <summary>待确认旧库存 · {legacy.length} 条（原数量保留）</summary>
      <p>带完整品牌身份的旧记录自动归属原品牌；其他有品牌的记录按品牌与色号匹配。无品牌的自定义色号及身份冲突记录不自动归属，以免串品牌。确认归属后实操才会使用该库存。</p>
      <label>旧库存
        <select aria-label="待确认旧库存" value={legacyKey} onChange={event => setLegacyKey(event.target.value)}>
          <option value="">请选择旧记录</option>
          {legacy.map(([key, item]) => <option key={key} value={key}>{item.code} · {item.name} · {item.count} 粒 · {item.brand ?? '无品牌'}</option>)}
        </select>
      </label>
      <label>归入当前品牌色号
        <select aria-label="旧库存目标色号" value={legacyTarget} onChange={event => setLegacyTarget(event.target.value)}>
          <option value="">请选择真实色号</option>
          {rows.filter(row => !row.inventoryKeys.length).map(row => <option key={row.colorId} value={row.colorId}>{row.code}</option>)}
        </select>
      </label>
      <button disabled={!legacyKey || !legacyTarget} onClick={() => {
        if (persist(latest => assignLegacyInventory(latest, legacyKey, legacyTarget))) { setLegacyKey(''); setLegacyTarget(''); }
      }}>确认归入 {BRAND_NAMES[brand]}</button>
    </details>}
  </section>;
}
