import React from 'react';

/**
 * 批次 5：共享筛选栏（三段式）。
 *
 * 左侧筛选条件字段 + 右侧主操作 slot + 下方结果计数行。
 * 通过 className 透传既有 grid 布局类（如 admin-user-filters），字段节点
 * 仍是直接子元素，老 CSS 的 grid-template-columns 不被破坏。
 */

export interface FilterBarProps {
  /** 无障碍标签（role=search 的 aria-label）。 */
  label?: string;
  /** 左侧筛选字段（label/input/select 列表，作为容器直接子元素渲染）。 */
  filters: React.ReactNode;
  /** 右侧主操作（查询/重置按钮等）。 */
  actions?: React.ReactNode;
  /** 下方结果计数行；不传则不渲染。 */
  resultCount?: React.ReactNode;
  /** 容器类名（可携带既有布局类，如 "admin-stage-panel admin-user-filters"）。 */
  className?: string;
}

export function FilterBar({ label = '筛选', filters, actions, resultCount, className = '' }: FilterBarProps) {
  return <>
    <div className={`admin-filterbar${className ? ' ' + className : ''}`} role="search" aria-label={label}>
      {filters}
      {actions !== undefined && actions !== null
        ? <div className="admin-filterbar-actions">{actions}</div>
        : null}
    </div>
    {resultCount !== undefined && resultCount !== null
      ? <p className="admin-filterbar-result" role="status">{resultCount}</p>
      : null}
  </>;
}
