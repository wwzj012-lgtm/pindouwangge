import React from 'react';

/**
 * 批次 5：共享数据表格（视觉规范落地件）。
 *
 * 目标是"机械替换、行为不变"：输出与既有 .admin-stage-table 相同的
 * div.admin-table-scroll > table 结构，行内 data-* 属性通过 rowAttrs /
 * rowSelectAttrs 原样透传，既有测试断言不受影响。
 *
 * 能力：
 * - 列定义（label/align/numeric/width/sticky）；数字列右对齐 + tabular-nums；
 * - 表头吸顶（sticky top，见 admin.css .admin-data-table）；
 * - 操作列 sticky right（column.sticky = 'right'）；
 * - 排序回调（th aria-sort，排序按钮由调用方以 header 节点注入）；
 * - 行选择（可选 checkbox 列，供批量操作）。
 */

export type AdminDataTableAlign = 'left' | 'center' | 'right';

export interface AdminDataTableColumn<T> {
  /** 数据字段名，同时也是 React key。 */
  key: string;
  /** 表头内容；给出 header 节点时优先使用（例如排序按钮、全选框）。 */
  label: React.ReactNode;
  /** 完全接管表头内容（不套 label 默认渲染）。 */
  header?: React.ReactNode;
  align?: AdminDataTableAlign;
  /** 数字列：右对齐 + tabular-nums（与 align: 'right' 可叠加）。 */
  numeric?: boolean;
  /** 建议列宽（写入 th/td style width）。 */
  width?: string;
  /** 操作列固定在右侧（横向滚动时不被裁掉）。 */
  sticky?: 'right';
  /** 该列是否参与排序；给出 sortDirection 时 th 输出 aria-sort。 */
  sortable?: boolean;
  sortDirection?: 'asc' | 'desc' | null;
  ariaSortLabel?: string;
  /** 单元格渲染；缺省渲染 row[key] 的字符串形式，空值为 —。 */
  render?: (row: T, index: number) => React.ReactNode;
  /** 单元格级属性透传（如响应式布局的 data-label）。 */
  cellAttrs?: (row: T, index: number) => Record<string, string | number | undefined>;
}

export interface AdminDataTableProps<T> {
  columns: ReadonlyArray<AdminDataTableColumn<T>>;
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  ariaLabel: string;
  className?: string;
  /** 滚动容器额外类名（默认含 admin-table-scroll）。 */
  wrapperClassName?: string;
  /** 表格最小宽度（px），写入 style 供横向滚动。 */
  minWidth?: number;
  /** 行选择（批量操作）；不传则不渲染 checkbox 列。 */
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  selectAllLabel?: string;
  selectAllChecked?: boolean;
  onToggleAll?: (checked: boolean) => void;
  selectAllAttrs?: Record<string, string>;
  rowSelectLabel?: (row: T, index: number) => string;
  rowSelectAttrs?: (row: T, index: number) => Record<string, string>;
  onToggleRow?: (row: T, checked: boolean) => void;
  /** 行级 data-* 等属性透传（既有测试锚点）。 */
  rowAttrs?: (row: T, index: number) => Record<string, string | number | undefined>;
  /** 行后附加行（如审计 diff 展开行）。 */
  renderExpandedRow?: (row: T, index: number) => React.ReactNode;
}

const alignClass = (column: { align?: AdminDataTableAlign; numeric?: boolean }): string => {
  const classes: string[] = [];
  if (column.align === 'right' || column.numeric) classes.push('admin-col--right');
  else if (column.align === 'center') classes.push('admin-col--center');
  if (column.numeric) classes.push('admin-col--numeric');
  return classes.join(' ');
};

const sortValue = (direction: 'asc' | 'desc' | null | undefined): 'ascending' | 'descending' | undefined => {
  if (direction === 'asc') return 'ascending';
  if (direction === 'desc') return 'descending';
  return undefined;
};

function defaultCell<T>(row: T, column: AdminDataTableColumn<T>): React.ReactNode {
  if (column.render) return column.render(row, 0);
  const value = (row as Record<string, unknown>)[column.key];
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

export function AdminDataTable<T>({
  columns,
  rows,
  rowKey,
  ariaLabel,
  className = '',
  wrapperClassName = '',
  minWidth,
  selectable = false,
  selected,
  selectAllLabel = '全选本页',
  selectAllChecked = false,
  onToggleAll,
  selectAllAttrs,
  rowSelectLabel,
  rowSelectAttrs,
  onToggleRow,
  rowAttrs,
  renderExpandedRow,
}: AdminDataTableProps<T>) {
  const tableClass = `admin-stage-table admin-data-table${className ? ' ' + className : ''}`;
  const selectColumn: AdminDataTableColumn<T> | null = selectable
    ? { key: '__select__', label: selectAllLabel }
    : null;
  return <div className={`admin-table-scroll${wrapperClassName ? ' ' + wrapperClassName : ''}`}>
    <table className={tableClass} aria-label={ariaLabel} style={minWidth ? { minWidth } : undefined}>
      <thead><tr>
        {selectColumn && <th className="admin-col--select" aria-label={selectAllLabel}>
          <input type="checkbox" aria-label={selectAllLabel} checked={selectAllChecked}
            {...(selectAllAttrs ?? {})} onChange={event => onToggleAll?.(event.currentTarget.checked)} />
        </th>}
        {columns.map(column => {
          const ariaSort = column.sortable ? sortValue(column.sortDirection) : undefined;
          const headerContent = column.header ?? column.label;
          return <th key={column.key} scope="col" aria-sort={ariaSort} aria-label={column.ariaSortLabel}
            className={[alignClass(column), column.sticky === 'right' ? 'admin-col--sticky-right' : ''].filter(Boolean).join(' ')}
            style={column.width ? { width: column.width } : undefined}>{headerContent}</th>;
        })}
      </tr></thead>
      <tbody>{rows.map((row, index) => {
        const key = rowKey(row, index);
        const attrs = rowAttrs?.(row, index) ?? {};
        return <React.Fragment key={key}>
          <tr {...attrs}>
            {selectColumn && <td className="admin-col--select">
              <input type="checkbox" aria-label={rowSelectLabel?.(row, index) ?? '选择本行'}
                checked={selected?.has(key) ?? false}
                {...(rowSelectAttrs?.(row, index) ?? {})}
                onChange={event => onToggleRow?.(row, event.currentTarget.checked)} />
            </td>}
            {columns.map(column => <td key={column.key}
              className={[alignClass(column), column.sticky === 'right' ? 'admin-col--sticky-right' : ''].filter(Boolean).join(' ')}
              style={column.width ? { width: column.width } : undefined}
              {...(column.cellAttrs?.(row, index) ?? {})}>
              {column.render ? column.render(row, index) : defaultCell(row, column)}
            </td>)}
          </tr>
          {renderExpandedRow?.(row, index)}
        </React.Fragment>;
      })}</tbody>
    </table>
  </div>;
}
