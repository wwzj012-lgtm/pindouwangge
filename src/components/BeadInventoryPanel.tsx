import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { Check } from 'lucide-react';
import { BRAND_NAMES, BRAND_PALETTES } from '../data/palettes';
import type { BrandKey } from '../types';
import {
  assignLegacyInventory, getBeadInventorySnapshot, getBrandInventory, getInventoryColor,
  getServerBeadInventorySnapshot, INVENTORY_BRANDS, isValidBeadCount, MAX_BEAD_COUNT,
  subscribeBeadInventory, updateBrandInventory, writeBeadInventory, type BeadInventory, type CatalogStockItem,
} from '../utils/beadInventory';

export const INVENTORY_PAGE_SIZE = 36;
const groupOf = (code: string) => code.match(/^[A-Za-z]+/)?.[0].toUpperCase() ?? '数字';

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
  const [batch, setBatch] = useState('500');
  const [message, setMessage] = useState('');
  const [legacyKey, setLegacyKey] = useState('');
  const [legacyTarget, setLegacyTarget] = useState('');
  const rows: CatalogStockItem[] = useMemo(() => getBrandInventory(inventory, brand), [inventory, brand]);
  const groups = useMemo(() => [...new Set(rows.map(row => groupOf(row.code)))], [rows]);
  const legacy = useMemo(() => Object.entries(inventory).filter(([, item]) => !getInventoryColor(item)), [inventory]);
  const query = search.trim().toLowerCase();
  const filtered = rows.filter(row => (!query || `${row.code} ${row.name}`.toLowerCase().includes(query))
    && (group === 'all' || groupOf(row.code) === group)
    && (status === 'all' || (status === 'in_stock' ? row.count > 0 : row.count > 0 && row.count <= row.alertThreshold)));
  const pages = Math.max(1, Math.ceil(filtered.length / INVENTORY_PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * INVENTORY_PAGE_SIZE, (currentPage + 1) * INVENTORY_PAGE_SIZE);
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

  return <section className="bead-stock" aria-label="品牌拼豆库存">
    <div className="bead-stock__heading">
      <div><h3>豆仓 · 我的库存</h3><p>按品牌管理固定色卡，未设置数量均为 0。本机保存。</p></div>
      <label className="bead-stock__brand">拼豆品牌
        <select aria-label="拼豆品牌" value={brand} onChange={event => changeBrand(event.target.value as BrandKey)}>
          {INVENTORY_BRANDS.map(key => <option key={key} value={key}>{BRAND_NAMES[key]} · {BRAND_PALETTES[key].length} 色</option>)}
        </select>
      </label>
    </div>
    <div className="bead-stock__stats" aria-label="当前品牌库存统计">
      <div><strong>{rows.reduce((sum, row) => sum + row.count, 0).toLocaleString()}</strong><span>本品牌库存 · 粒</span></div>
      <div><strong>{rows.filter(row => row.count > 0).length} / {rows.length}</strong><span>有库存色号</span></div>
      <div><strong>{rows.filter(row => row.count > 0 && row.count <= row.alertThreshold).length}</strong><span>低库存色号</span></div>
    </div>
    <label className="bead-stock__search">搜索当前品牌
      <input type="search" placeholder="搜索色号或名称" value={search}
        onChange={event => { setSearch(event.target.value); setPage(0); }} />
    </label>
    <div className="bead-stock__filters" aria-label="库存状态">
      {([['all', '全部色号'], ['in_stock', '有库存'], ['alert', '低库存']] as const).map(([key, label]) =>
        <button key={key} aria-pressed={status === key} onClick={() => { setStatus(key); setPage(0); }}>{label}</button>)}
    </div>
    <div className="bead-stock__groups" aria-label="色号分组">
      {['all', ...groups].map(key => <button key={key} aria-pressed={group === key}
        onClick={() => { setGroup(key); setPage(0); }}>{key === 'all' ? '全部分组' : key}</button>)}
    </div>
    <div className="bead-stock__batch">
      <p>批量范围：{BRAND_NAMES[brand]} · 当前筛选的 {filtered.length} 色（含其他分页）</p>
      <label>数量 <input aria-label="批量数量" type="number" min="0" max={MAX_BEAD_COUNT} step="1"
        value={batch} onChange={event => setBatch(event.target.value)} /></label>
      {(['set', 'add', 'subtract'] as const).map(mode => <button key={mode}
        disabled={!filtered.length || !isValidBeadCount(batchNumber)} onClick={() => {
          edit(filtered.map(row => row.colorId), mode === 'subtract' ? -batchNumber : batchNumber, mode === 'set' ? 'set' : 'delta');
        }}>{mode === 'set' ? '批量设置' : mode === 'add' ? '批量增加' : '批量减少'}</button>)}
      {!isValidBeadCount(batchNumber) && <small role="alert">请输入 0–1,000,000 的整数</small>}
    </div>
    <p className="bead-stock__message" role="status">{message}</p>
    <div className="bead-stock__grid">
      {visible.map(row => <article key={`${row.colorId}:${row.count}`} data-color-id={row.colorId} className="bead-stock__card">
        <div className="bead-stock__swatch" style={{ backgroundColor: row.hex }}><strong>{row.code}</strong></div>
        <h4 title={row.name}>{row.name}</h4>
        <QuantityInput code={row.code} count={row.count}
          onSave={value => edit([row.colorId], value)} />
        <div className="bead-stock__adjust">
          <button aria-label={`${row.code} 减少100粒`} disabled={row.count === 0} onClick={() => edit([row.colorId], -100, 'delta')}>−100</button>
          <button aria-label={`${row.code} 增加100粒`} disabled={row.count >= MAX_BEAD_COUNT} onClick={() => edit([row.colorId], 100, 'delta')}>+100</button>
        </div>
        {row.count > 0 && row.count <= row.alertThreshold && <small className="bead-stock__low">仅剩 {row.count} 粒 · 低于 {row.alertThreshold} 提醒线</small>}
        {row.inventoryKeys.length > 1 && <small>旧重复记录取较小值；编辑会同步数量</small>}
      </article>)}
    </div>
    {!filtered.length && <p>当前品牌没有匹配的色号，请调整筛选。</p>}
    <nav className="bead-stock__pagination" aria-label="库存分页">
      <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button>
      <span>第 {currentPage + 1} / {pages} 页 · {filtered.length} 色</span>
      <button disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button>
    </nav>
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
