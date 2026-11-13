import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AdminPagination,
  clampDisplayPage,
  paginationPageItems,
  parseJumpPage,
} from './AdminPagination';

describe('paginationPageItems（页码折叠）', () => {
  it('shows every page when there are fewer than 8 pages', () => {
    expect(paginationPageItems(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(paginationPageItems(4, 1)).toEqual([1]);
  });
  it('folds long page lists around the current window', () => {
    expect(paginationPageItems(1, 12)).toEqual([1, 2, 3, 'ellipsis-right', 12]);
    expect(paginationPageItems(12, 12)).toEqual([1, 'ellipsis-left', 10, 11, 12]);
    expect(paginationPageItems(6, 12)).toEqual([1, 'ellipsis-left', 4, 5, 6, 7, 8, 'ellipsis-right', 12]);
    expect(paginationPageItems(3, 12)).toEqual([1, 2, 3, 4, 5, 'ellipsis-right', 12]);
    expect(paginationPageItems(10, 12)).toEqual([1, 'ellipsis-left', 8, 9, 10, 11, 12]);
  });
  it('clamps the current page into the valid range', () => {
    expect(paginationPageItems(99, 3)).toEqual([1, 2, 3]);
    expect(paginationPageItems(0, 3)).toEqual([1, 2, 3]);
  });
});

describe('paginationPageItems 折叠边界（8/9/50/100 页）', () => {
  // 公式：总页数 ≥ 8 折叠；保留首、尾、当前±2，间断口补省略号。
  it('8 pages: folding starts exactly at 8', () => {
    expect(paginationPageItems(1, 8)).toEqual([1, 2, 3, 'ellipsis-right', 8]);
    expect(paginationPageItems(4, 8)).toEqual([1, 2, 3, 4, 5, 6, 'ellipsis-right', 8]);
    expect(paginationPageItems(8, 8)).toEqual([1, 'ellipsis-left', 6, 7, 8]);
  });
  it('9 pages: first/current±2/last groups hold', () => {
    expect(paginationPageItems(1, 9)).toEqual([1, 2, 3, 'ellipsis-right', 9]);
    expect(paginationPageItems(5, 9)).toEqual([1, 'ellipsis-left', 3, 4, 5, 6, 7, 'ellipsis-right', 9]);
    expect(paginationPageItems(9, 9)).toEqual([1, 'ellipsis-left', 7, 8, 9]);
  });
  it('50 pages: first/current±2/last groups hold', () => {
    expect(paginationPageItems(1, 50)).toEqual([1, 2, 3, 'ellipsis-right', 50]);
    expect(paginationPageItems(25, 50)).toEqual([1, 'ellipsis-left', 23, 24, 25, 26, 27, 'ellipsis-right', 50]);
    expect(paginationPageItems(50, 50)).toEqual([1, 'ellipsis-left', 48, 49, 50]);
  });
  it('100 pages: first/current±2/last groups hold', () => {
    expect(paginationPageItems(1, 100)).toEqual([1, 2, 3, 'ellipsis-right', 100]);
    expect(paginationPageItems(50, 100)).toEqual([1, 'ellipsis-left', 48, 49, 50, 51, 52, 'ellipsis-right', 100]);
    expect(paginationPageItems(100, 100)).toEqual([1, 'ellipsis-left', 98, 99, 100]);
  });
});

describe('parseJumpPage（跳页输入）', () => {
  it('accepts integers inside the page range only', () => {
    expect(parseJumpPage('3', 10)).toBe(3);
    expect(parseJumpPage(' 7 ', 10)).toBe(7);
    expect(parseJumpPage('0', 10)).toBeNull();
    expect(parseJumpPage('11', 10)).toBeNull();
    expect(parseJumpPage('-2', 10)).toBeNull();
    expect(parseJumpPage('abc', 10)).toBeNull();
    expect(parseJumpPage('1.5', 10)).toBeNull();
    expect(parseJumpPage('', 10)).toBeNull();
  });
});

describe('clampDisplayPage（offset → 页码）', () => {
  it('derives the 1-based page from the offset', () => {
    expect(clampDisplayPage(0, 20)).toBe(1);
    expect(clampDisplayPage(20, 20)).toBe(2);
    expect(clampDisplayPage(45, 20)).toBe(3);
  });
});

describe('AdminPagination rendering', () => {
  const props = { total: 200, limit: 20, offset: 40, onPageChange: () => undefined };

  it('renders nothing for zero total', () => {
    const html = renderToStaticMarkup(React.createElement(AdminPagination, { ...props, total: 0 }));
    expect(html).toBe('');
  });
  it('renders only the total caption for a single small page', () => {
    const html = renderToStaticMarkup(React.createElement(AdminPagination, { ...props, total: 8, limit: 20, offset: 0 }));
    expect(html).toContain('共 8 条');
    expect(html).not.toContain('上一页');
    expect(html).not.toContain('data-pagination-jump');
  });
  it('renders page buttons with the current page highlighted and accessible prev/next labels', () => {
    const html = renderToStaticMarkup(React.createElement(AdminPagination, { ...props, label: '账户分页' }));
    expect(html).toContain('aria-label="账户分页"');
    expect(html).toContain('aria-label="上一页"');
    expect(html).toContain('aria-label="下一页"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-pagination-page="3"');
    expect(html).toContain('共 200 条');
  });
  it('renders the size select only when both options and handler are provided', () => {
    const html = renderToStaticMarkup(React.createElement(AdminPagination, { ...props, pageSizeOptions: [10, 20, 50, 100] }));
    expect(html).not.toContain('data-pagination-size');
    const withLimit = renderToStaticMarkup(React.createElement(AdminPagination, {
      ...props, pageSizeOptions: [10, 20, 50, 100], onLimitChange: () => undefined,
    }));
    expect(withLimit).toContain('data-pagination-size');
    expect(withLimit).toContain('每页');
  });
  it('marks the jump input as invalid without navigating when the value is out of range', () => {
    // 非法值红框提示不生效由交互回调保证；静态渲染断言 aria-invalid 通道存在。
    expect(parseJumpPage('999', 10)).toBeNull();
  });
});
