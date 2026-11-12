import React from 'react';
import { AdminEmptyState } from '../AdminPrimitives';

/**
 * 批次 5：统一空态。
 *
 * 薄封装 AdminEmptyState：全后台空态共用一个视觉（居中图标 + 标题 + 说明 +
 * 可选主操作），并挂 data-admin-empty 供测试锚定。
 */

export interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  /** 测试锚点后缀（data-admin-empty="users"）。 */
  scope?: string;
}

export function EmptyState({ title = '暂无数据', description, action, scope }: EmptyStateProps) {
  return <div data-admin-empty={scope}>
    <AdminEmptyState title={title} description={description} action={action} />
  </div>;
}
