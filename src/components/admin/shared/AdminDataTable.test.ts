import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminDataTable, type AdminDataTableColumn } from './AdminDataTable';
import { AdminStatusBadge, STATUS_TONES, resolveStatusTone } from './StatusBadge';
import { FilterBar } from './FilterBar';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';

interface Row { id: string; name: string; count: number; status: string; }

const rows: Row[] = [
  { id: 'a', name: '第一行', count: 12, status: 'active' },
  { id: 'b', name: '第二行', count: 0, status: 'pending' },
];

const columns: Array<AdminDataTableColumn<Row>> = [
  { key: 'name', label: '名称' },
  { key: 'count', label: '数量', numeric: true, width: '110px' },
  {
    key: 'status',
    label: '状态',
    render: row => React.createElement(AdminStatusBadge, { status: row.status, label: row.status === 'active' ? '正常' : '待处理' }),
  },
  { key: 'actions', label: '操作', sticky: 'right', render: () => React.createElement('button', { type: 'button' }, '操作') },
];

describe('AdminDataTable (批次 5 共享表格契约)', () => {
  it('renders the shared stage-table structure with an aria label', () => {
    const html = renderToStaticMarkup(React.createElement(AdminDataTable<Row>, {
      columns, rows, rowKey: row => row.id, ariaLabel: '示例表格',
    }));
    expect(html).toContain('admin-table-scroll');
    expect(html).toContain('admin-stage-table admin-data-table');
    expect(html).toContain('aria-label="示例表格"');
    expect(html).toContain('第一行');
    expect(html).toContain('12');
  });

  it('right-aligns numeric columns with tabular-nums and supports widths', () => {
    const html = renderToStaticMarkup(React.createElement(AdminDataTable<Row>, {
      columns, rows, rowKey: row => row.id, ariaLabel: '示例表格',
    }));
    expect(html).toContain('admin-col--right');
    expect(html).toContain('admin-col--numeric');
    expect(html).toContain('width:110px');
  });

  it('marks the sticky action column and pins the header', () => {
    const html = renderToStaticMarkup(React.createElement(AdminDataTable<Row>, {
      columns, rows, rowKey: row => row.id, ariaLabel: '示例表格',
    }));
    expect(html).toContain('admin-col--sticky-right');
  });

  it('emits aria-sort for the sortable column and keeps custom sort buttons', () => {
    const sortColumns: Array<AdminDataTableColumn<Row>> = [
      {
        key: 'name',
        label: '名称',
        sortable: true,
        sortDirection: 'asc',
        header: React.createElement('button', { type: 'button', 'data-sort-name': '' }, '名称'),
      },
    ];
    const html = renderToStaticMarkup(React.createElement(AdminDataTable<Row>, {
      columns: sortColumns, rows, rowKey: row => row.id, ariaLabel: '排序表格',
    }));
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('data-sort-name');
    const descending = renderToStaticMarkup(React.createElement(AdminDataTable<Row>, {
      columns: [{ ...sortColumns[0]!, sortDirection: 'desc' }], rows, rowKey: row => row.id, ariaLabel: '排序表格',
    }));
    expect(descending).toContain('aria-sort="descending"');
  });

  it('renders a selection column wired to bulk toggles and row anchors', () => {
    const selected = new Set(['a']);
    const html = renderToStaticMarkup(React.createElement(AdminDataTable<Row>, {
      columns, rows, rowKey: row => row.id, ariaLabel: '选择表格',
      selectable: true,
      selected,
      selectAllAttrs: { 'data-select-all': '' },
      rowSelectAttrs: row => ({ 'data-row-check': row.id }),
      rowAttrs: row => ({ 'data-demo-row': row.id }),
    }));
    expect(html).toContain('data-select-all');
    expect(html).toContain('data-row-check="a"');
    expect(html).toContain('data-demo-row="a"');
    // 勾选状态跟随 selected 集合。
    expect(html).toMatch(/data-row-check="a"[^>]*checked/);
    expect(html).not.toMatch(/data-row-check="b"[^>]*checked/);
  });

  it('renders expanded rows after the anchor row', () => {
    const html = renderToStaticMarkup(React.createElement(AdminDataTable<Row>, {
      columns, rows, rowKey: row => row.id, ariaLabel: '展开表格',
      renderExpandedRow: row => row.id === 'a' ? React.createElement('tr', null, React.createElement('td', { colSpan: 2 }, '展开内容')) : undefined,
    }));
    expect(html).toContain('展开内容');
  });

  it('falls back to — for missing cell values', () => {
    const html = renderToStaticMarkup(React.createElement(AdminDataTable<Row>, {
      columns: [{ key: 'missing', label: '缺失列' }], rows, rowKey: row => row.id, ariaLabel: '缺失表格',
    }));
    expect(html).toContain('—');
  });
});

describe('AdminStatusBadge (统一色语义)', () => {
  it('maps statuses to the unified semantic registry', () => {
    expect(resolveStatusTone('active')).toBe('success');
    expect(resolveStatusTone('banned')).toBe('danger');
    expect(resolveStatusTone('pending')).toBe('warning');
    expect(resolveStatusTone('reviewing')).toBe('info');
    expect(resolveStatusTone('disabled')).toBe('neutral');
    expect(resolveStatusTone('unknown-value')).toBe('neutral');
    expect(resolveStatusTone(null)).toBe('neutral');
    expect(STATUS_TONES.success).toBe('success');
  });

  it('renders label text and falls back to the status value', () => {
    const labelled = renderToStaticMarkup(React.createElement(AdminStatusBadge, { status: 'active', label: '正常' }));
    expect(labelled).toContain('admin-badge--success');
    expect(labelled).toContain('正常');
    const fallback = renderToStaticMarkup(React.createElement(AdminStatusBadge, { status: 'pending' }));
    expect(fallback).toContain('admin-badge--warning');
    expect(fallback).toContain('pending');
  });
});

describe('FilterBar (三段式筛选栏)', () => {
  it('renders fields, right-aligned actions and a result count row', () => {
    const html = renderToStaticMarkup(React.createElement(FilterBar, {
      label: '示例筛选',
      filters: React.createElement('label', null, '搜索', React.createElement('input', { 'aria-label': '搜索条件' })),
      actions: React.createElement('button', { type: 'button', 'data-demo-query': '' }, '查询'),
      resultCount: '共 12 条',
    }));
    expect(html).toContain('role="search"');
    expect(html).toContain('aria-label="示例筛选"');
    expect(html).toContain('data-demo-query');
    expect(html).toContain('admin-filterbar-actions');
    expect(html).toContain('admin-filterbar-result');
    expect(html).toContain('共 12 条');
  });

  it('omits the action and count segments when not provided', () => {
    const html = renderToStaticMarkup(React.createElement(FilterBar, { filters: React.createElement('input', { 'aria-label': '字段' }) }));
    expect(html).not.toContain('admin-filterbar-actions');
    expect(html).not.toContain('admin-filterbar-result');
  });
});

describe('EmptyState / LoadingSkeleton (统一空态与加载态)', () => {
  it('renders the shared empty state with scope anchor', () => {
    const html = renderToStaticMarkup(React.createElement(EmptyState, {
      title: '没有匹配记录', description: '调整条件后重试', scope: 'demo',
    }));
    expect(html).toContain('data-admin-empty="demo"');
    expect(html).toContain('没有匹配记录');
    expect(html).not.toContain('role="alert"');
  });

  it('renders the skeleton with role=status and bounded rows', () => {
    const html = renderToStaticMarkup(React.createElement(LoadingSkeleton, { rows: 3, columns: 4, ariaLabel: '正在加载示例' }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('admin-skeleton-bar');
    expect(html).toContain('正在加载示例');
    // 行数被夹在 1..12。
    const bars = renderToStaticMarkup(React.createElement(LoadingSkeleton, { rows: 99, ariaLabel: '上限' }));
    expect(bars.match(/admin-skeleton-row/g)).toHaveLength(12);
  });
});
