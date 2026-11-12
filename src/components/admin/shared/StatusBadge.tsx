import React from 'react';
import { AdminBadge } from '../AdminPrimitives';

/**
 * 批次 5：统一状态徽章。
 *
 * 各板块的状态值（active/banned/pending/failed……）集中注册到一张语义色表，
 * 新板块不再各自定义 tone 映射；语义 map 之外的值回落 neutral。
 * 'info' 是新增的第五种语义色（蓝色，见 admin.css .admin-badge--info）。
 */

export type AdminStatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

/** 统一色语义注册表：状态字符串 → 徽章语义色。 */
export const STATUS_TONES: Record<string, AdminStatusTone> = {
  // 成功 / 正常
  active: 'success', normal: 'success', success: 'success', enabled: 'success',
  available: 'success', visible: 'success', published: 'success', completed: 'success',
  // 等待 / 警告
  open: 'warning', pending: 'warning', partial: 'warning', suspended: 'warning',
  hidden: 'warning', delete_pending: 'warning', deletePending: 'warning', low_stock: 'warning',
  // 处理中 / 信息
  reviewing: 'info', scheduled: 'info', draft: 'info', info: 'info',
  // 失败 / 危险
  banned: 'danger', failed: 'danger', rejected: 'danger', blocked: 'danger', error: 'danger',
  // 中性
  disabled: 'neutral', neutral: 'neutral', withdrawn: 'neutral', redeemed: 'neutral',
  used: 'neutral', resolved: 'neutral', uncategorized: 'neutral',
};

export function resolveStatusTone(status: string | null | undefined): AdminStatusTone {
  if (!status) return 'neutral';
  return STATUS_TONES[status] ?? 'neutral';
}

interface AdminStatusBadgeProps {
  /** 状态值（参与语义色映射）。 */
  status?: string | null;
  /** 展示文案；缺省直接显示状态值本身。 */
  label?: React.ReactNode;
  /** 显式指定语义色时优先于 status 映射。 */
  tone?: AdminStatusTone;
}

export function AdminStatusBadge({ status, label, tone }: AdminStatusBadgeProps) {
  return <AdminBadge tone={tone ?? resolveStatusTone(status)}>{label ?? status ?? '—'}</AdminBadge>;
}
