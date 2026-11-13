import React, { useEffect, useMemo, useState } from 'react';
import { AdminButton } from '../AdminPrimitives';

/**
 * 共享管理端分页（分页重设计）：
 * 左「共 N 条」 / 中页码组（当前页高亮，≥8 页折叠省略号，点省略号跳 ±5） /
 * 右「每页条数」+「跳至页」。样式对齐密度规范：32px 控件、8px 圆角、border 仅分隔。
 *
 * 翻页契约：调用方持有 offset/limit，本组件只回调新的 offset（或新的 limit），
 * 不改任何请求语义。total=0 不渲染；单页只显示「共 N 条」。
 */

export type PaginationPageItem = number | 'ellipsis-left' | 'ellipsis-right';

/** 页码折叠：总页数 < 8 全量展示；否则保留首/尾/当前±2，其余折叠为省略号。 */
export function paginationPageItems(current: number, pageCount: number): PaginationPageItem[] {
  const count = Math.max(1, pageCount);
  const page = Math.min(Math.max(1, current), count);
  if (count < 8) return Array.from({ length: count }, (_v, i) => i + 1);
  const window = new Set<number>([1, count, page - 2, page - 1, page, page + 1, page + 2]);
  const pages = Array.from({ length: count }, (_v, i) => i + 1).filter(value => window.has(value));
  const items: PaginationPageItem[] = [];
  let previous = 0;
  for (const value of pages) {
    // 中间断口：在当前页窗口之前 → 左省略号（点按向前跳 5 页），之后 → 右省略号。
    if (previous && value - previous > 1) items.push(value < page ? 'ellipsis-left' : 'ellipsis-right');
    items.push(value);
    previous = value;
  }
  return items;
}

/** 跳页解析：非正整数或超出范围返回 null（红框提示且不生效）。 */
export function parseJumpPage(value: string, pageCount: number): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > Math.max(1, pageCount)) return null;
  return parsed;
}

export function clampDisplayPage(offset: number, limit: number): number {
  if (limit <= 0) return 1;
  return Math.floor(Math.max(0, offset) / limit) + 1;
}

export interface AdminPaginationProps {
  total: number;
  limit: number;
  offset: number;
  /** 新 offset（首条下标）；调用方按现有请求契约换算 page/offset。 */
  onPageChange: (nextOffset: number) => void;
  /** 提供后渲染「每页条数」下拉；切换时调用方自行重置 offset。 */
  pageSizeOptions?: readonly number[];
  onLimitChange?: (nextLimit: number) => void;
  /** nav 的 aria-label（如「账户分页」）。 */
  label?: string;
  busy?: boolean;
}

const DEFAULT_SIZE_OPTIONS = [10, 20, 50, 100] as const;

export function AdminPagination({ total, limit, offset, onPageChange, pageSizeOptions, onLimitChange, label = '分页', busy = false }: AdminPaginationProps) {
  const safeLimit = limit > 0 ? limit : 1;
  const pageCount = Math.max(1, Math.ceil(Math.max(0, total) / safeLimit));
  const [jumpDraft, setJumpDraft] = useState('');
  const [jumpInvalid, setJumpInvalid] = useState(false);
  useEffect(() => { setJumpDraft(''); setJumpInvalid(false); }, [total, safeLimit, offset]);
  const items = useMemo(() => paginationPageItems(clampDisplayPage(offset, safeLimit), pageCount), [offset, safeLimit, pageCount]);
  if (total <= 0) return null;
  // 单页：不渲染页码组与跳转，仅显示「共 N 条」。
  if (pageCount <= 1) return <nav className={`admin-pagination${busy ? ' admin-pagination--busy' : ''}`} aria-label={label}><span>共 {total} 条</span></nav>;
  const current = clampDisplayPage(offset, safeLimit);
  const jump = (raw: string) => {
    const page = parseJumpPage(raw, pageCount);
    if (page === null) { setJumpInvalid(true); return; }
    setJumpInvalid(false); setJumpDraft('');
    onPageChange((page - 1) * safeLimit);
  };
  return <nav className={`admin-pagination${busy ? ' admin-pagination--busy' : ''}`} aria-label={label}>
    <span className="admin-pagination-total">共 {total} 条</span>
    <div className="admin-pagination-pages" role="group" aria-label={`${label}页码`}>
      <AdminButton aria-label="上一页" disabled={busy || offset <= 0} onClick={() => onPageChange(Math.max(0, offset - safeLimit))}>上一页</AdminButton>
      {items.map((item, index) => item === 'ellipsis-left' || item === 'ellipsis-right'
        ? <button key={`${item}-${index}`} type="button" className="admin-pagination-ellipsis" data-pagination-ellipsis={item === 'ellipsis-left' ? 'left' : 'right'}
          title={item === 'ellipsis-left' ? `向前跳 5 页` : `向后跳 5 页`} aria-label={item === 'ellipsis-left' ? `向前跳 5 页` : `向后跳 5 页`}
          disabled={busy}
          onClick={() => {
            const target = item === 'ellipsis-left' ? current - 5 : current + 5;
            onPageChange((Math.min(Math.max(1, target), pageCount) - 1) * safeLimit);
          }}>…</button>
        : <button key={item} type="button" className={`admin-pagination-page${item === current ? ' admin-pagination-page--current' : ''}`}
          data-pagination-page={item} aria-current={item === current ? 'page' : undefined} disabled={busy}
          onClick={() => { if (item !== current) onPageChange((item - 1) * safeLimit); }}>{item}</button>)}
      <AdminButton aria-label="下一页" disabled={busy || offset + safeLimit >= total} onClick={() => onPageChange(offset + safeLimit)}>下一页</AdminButton>
    </div>
    <div className="admin-pagination-side">
      {pageSizeOptions && onLimitChange && <label className="admin-pagination-size">每页
        <select data-pagination-size value={safeLimit} disabled={busy} onChange={event => {
          const next = Number(event.target.value);
          if (Number.isSafeInteger(next) && next > 0 && next !== safeLimit) { setJumpDraft(''); setJumpInvalid(false); onLimitChange(next); }
        }}>{[...new Set([...pageSizeOptions, safeLimit])].sort((a, b) => a - b).map(size => <option key={size} value={size}>{size} 条</option>)}</select>
      </label>}
      <label className={`admin-pagination-jump${jumpInvalid ? ' admin-pagination-jump--invalid' : ''}`}>跳至
        <input data-pagination-jump inputMode="numeric" value={jumpDraft} placeholder={`${current}/${pageCount}`}
          aria-invalid={jumpInvalid || undefined} disabled={busy} title={jumpInvalid ? '请输入 1 到 ' + pageCount + ' 之间的页码' : undefined}
          onChange={event => { setJumpDraft(event.target.value); setJumpInvalid(false); }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); jump(jumpDraft); } }}
          onBlur={() => { if (jumpDraft.trim()) jump(jumpDraft); else setJumpInvalid(false); }} />
        页
      </label>
      {jumpInvalid && <span className="admin-pagination-jump-error" role="alert">请输入 1–{pageCount} 的页码</span>}
    </div>
  </nav>;
}
