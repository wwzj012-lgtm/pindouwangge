import React from 'react';

/**
 * 批次 5：统一加载骨架。
 *
 * 表格形状的占位骨架（rows × columns 条 shimmer 块），role="status" +
 * aria-busy，替代"读之前一片空白"的观感。文案由 ariaLabel 提供。
 */

export interface LoadingSkeletonProps {
  rows?: number;
  columns?: number;
  ariaLabel?: string;
  className?: string;
}

export function LoadingSkeleton({ rows = 4, columns = 1, ariaLabel = '正在加载', className = '' }: LoadingSkeletonProps) {
  const rowCount = Math.max(1, Math.min(rows, 12));
  const columnCount = Math.max(1, Math.min(columns, 8));
  return <div className={`admin-skeleton${className ? ' ' + className : ''}`} role="status" aria-label={ariaLabel} aria-busy="true"
    data-admin-skeleton>
    {Array.from({ length: rowCount }, (_, row) => <div className="admin-skeleton-row" key={row} aria-hidden="true">
      {Array.from({ length: columnCount }, (_, column) => <span
        className="admin-skeleton-bar" key={column}
        style={{ width: `${column === 0 ? 18 : 30 + ((row * 7 + column * 13) % 40)}%` }} />)}
    </div>)}
    <span className="admin-hidden-text">{ariaLabel}</span>
  </div>;
}
