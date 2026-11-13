import React, { useEffect, useRef } from 'react';
import { AdminButton } from '../AdminPrimitives';

/**
 * 共享成功反馈 toast（复用撤销 toast 的视觉体系）：
 * 2.5 秒自动消失；可选撤销动作（5 秒场景由调用方自行传 duration）。
 * 渲染为固定底部居中的 role=status 区域，不阻断操作流。
 */

export interface AdminToastProps {
  message: string;
  /** 提供后渲染「撤销」按钮；点击后先关闭 toast 再执行撤销。 */
  undo?: () => void;
  /** 自动消失毫秒数；默认 2500。传 0 表示不自动消失（测试场景）。 */
  duration?: number;
  onDismiss?: () => void;
}

export function AdminToast({ message, undo, duration = 2500, onDismiss }: AdminToastProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (duration <= 0) return;
    timer.current = setTimeout(() => onDismiss?.(), duration);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [duration, onDismiss]);
  return <div className="admin-undo-toast" role="status" data-admin-toast>
    <span>{message}</span>
    {undo && <AdminButton onClick={() => { const action = undo; onDismiss?.(); action(); }}>撤销</AdminButton>}
  </div>;
}
