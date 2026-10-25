import React, { useMemo, useState } from 'react';
import { BRAND_NAMES, BRAND_ORDER, BRAND_PALETTES } from '../../data/palettes';
import type { BrandKey } from '../../types';
import { AdminButton, AdminEmptyState } from './AdminPrimitives';

// Display-only projection of the application's actual static catalog. CUSTOM is
// a user-managed template, not another built-in catalog; never mutate palettes.
export const builtinPaletteBrands = BRAND_ORDER.filter(brand => brand !== 'CUSTOM');
export function builtinPaletteColors(brand: BrandKey | 'all', query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return builtinPaletteBrands.filter(key => brand === 'all' || key === brand).flatMap(key =>
    BRAND_PALETTES[key].filter(color => !needle || [color.code, color.name, color.hex, BRAND_NAMES[key]].some(value => value.toLocaleLowerCase().includes(needle)))
      .map(color => ({ id: color.id, brand: key, brandName: BRAND_NAMES[key], code: color.code, name: color.name, hex: color.hex })),
  );
}

export function AdminBuiltinPalettes() {
  const [brand, setBrand] = useState<BrandKey | 'all'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const colors = useMemo(() => builtinPaletteColors(brand, search), [brand, search]);
  const pageSize = 48, pages = Math.max(1, Math.ceil(colors.length / pageSize));
  return <section className="admin-builtin-palettes" aria-label="内建色卡只读目录">
    <h3>内建色卡只读目录</h3>
    <p className="admin-info-box">来自应用静态内建调色板，仅供查询；这里不能新增、修改或删除。自定义色卡 CRUD 仍在“色卡配置 / 色号”中，后台配置不会自动替换内建调色板或改变匹配算法。</p>
    <div className="admin-community-filters">
      <label>品牌<select aria-label="内建色卡品牌" value={brand} onChange={event => { setBrand(event.target.value as BrandKey | 'all'); setPage(0); }}><option value="all">全部内建品牌</option>{builtinPaletteBrands.map(key => <option key={key} value={key}>{BRAND_NAMES[key]} · {BRAND_PALETTES[key].length} 色</option>)}</select></label>
      <label>搜索色号 / HEX<input aria-label="搜索内建色号或HEX" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="例如 A1、#FAF4C8" /></label>
    </div>
    <p role="status">匹配 {colors.length} 个内建色号 · 第 {page + 1} / {pages} 页 · 只读</p>
    {colors.length ? <div className="admin-builtin-color-grid">{colors.slice(page * pageSize, (page + 1) * pageSize).map(color => <article className="admin-builtin-color" key={color.id} data-builtin-color={color.id}>
      <span className="admin-builtin-swatch" style={{ backgroundColor: color.hex }} aria-label={color.hex} />
      <div><strong>{color.code}</strong><small>{color.brandName}</small><code>{color.hex}</code></div>
    </article>)}</div> : <AdminEmptyState title="没有匹配的内建色号" />}
    <div className="admin-pagination"><AdminButton disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页色号</AdminButton><AdminButton disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}>下一页色号</AdminButton></div>
  </section>;
}
