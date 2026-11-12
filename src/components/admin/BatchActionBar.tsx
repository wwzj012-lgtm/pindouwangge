import React, { useState } from 'react';
import { Ban, ShieldCheck } from 'lucide-react';
import { AdminButton, AdminConfirmDialog, AdminErrorState } from './AdminPrimitives';
import { parseBatchOutcome, type BatchOutcome } from './adminUserModel';

/**
 * 批次 3：共享批量操作栏。
 *
 * 显示当前勾选行数 + 可用动作；点击动作弹确认框（危险动作需填原因），
 * 确认后通过 `onRun` 逐条执行并在弹窗内展示逐条成功/失败结果。
 * 组件本身不关心业务实体：动作与执行器都由调用方（如 AdminUsers）注入。
 */

export interface BatchActionOption {
  key: string;
  label: string;
  /** 危险动作（封禁/下架）需填写原因后才能确认。 */
  requiresReason?: boolean;
}

export interface BatchRunResult {
  outcome: BatchOutcome | null;
  error?: string;
}

interface BatchActionBarProps {
  /** 当前勾选的 id 数量；为 0 时整栏禁用。 */
  selectedCount: number;
  actions: BatchActionOption[];
  /** 执行动作；返回解析后的批量结果（或 null + error）。 */
  onRun: (actionKey: string, params: { reason: string }) => Promise<BatchRunResult>;
  onClear: () => void;
  disabled?: boolean;
}

/** 逐条结果展示：成功行汇总，失败逐条列明（最多渲染 10 条防止弹窗爆长）。 */
export function BatchOutcomeList({ outcome }: { outcome: BatchOutcome }) {
  return <div className="admin-change-summary" data-batch-outcome>
    <p>共 {outcome.total} 项：成功 {outcome.succeeded} 项{outcome.failed.length > 0 ? `，失败 ${outcome.failed.length} 项` : ''}。</p>
    {outcome.failed.length > 0 && <ul data-batch-failures>
      {outcome.failed.slice(0, 10).map((item) => <li key={item.id}><span className="admin-mono">{item.id}</span>：{item.error}</li>)}
      {outcome.failed.length > 10 && <li>… 其余 {outcome.failed.length - 10} 条失败见服务端审计日志。</li>}
    </ul>}
  </div>;
}

export function BatchActionBar({ selectedCount, actions, onRun, onClear, disabled = false }: BatchActionBarProps) {
  const [pendingAction, setPendingAction] = useState<BatchActionOption | null>(null);
  const [reason, setReason] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BatchRunResult | null>(null);
  const close = () => { if (running) return; setPendingAction(null); setReason(''); setResult(null); };
  const openAction = (action: BatchActionOption) => { setResult(null); setReason(''); setPendingAction(action); };
  const run = async () => {
    if (!pendingAction) return;
    setRunning(true); setResult(null);
    try {
      const outcome = await onRun(pendingAction.key, { reason: reason.trim() });
      setResult(outcome);
    } catch (error) {
      setResult({ outcome: null, error: error instanceof Error ? error.message : String(error) });
    } finally { setRunning(false); }
  };
  const reasonMissing = Boolean(pendingAction?.requiresReason) && !reason.trim();
  return <div className="admin-batch-bar" role="region" aria-label="批量操作" data-batch-bar>
    <span data-batch-count aria-live="polite">已勾选 {selectedCount} 项</span>
    {actions.map((action) => <AdminButton
      key={action.key}
      data-batch-action={action.key}
      variant={action.requiresReason ? 'danger' : 'secondary'}
      disabled={disabled || selectedCount === 0}
      onClick={() => openAction(action)}
    >{action.requiresReason ? <Ban aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{action.label}</AdminButton>)}
    <AdminButton variant="ghost" disabled={disabled || selectedCount === 0} onClick={onClear} data-batch-clear>取消勾选</AdminButton>
    <AdminConfirmDialog
      open={Boolean(pendingAction)}
      title={`批量${pendingAction?.label ?? ''}`}
      description={'将对勾选的 ' + selectedCount + ' 项逐条执行；单条失败不影响其它条。'}
      subject={'已勾选 ' + selectedCount + ' 项'}
      impact="逐条提交，逐条成功或失败；结果在提交后展示。"
      reason={pendingAction?.requiresReason ? <label className="admin-stage-field">处理原因<textarea data-batch-reason value={reason} maxLength={500} disabled={running} onChange={(event) => setReason(event.target.value)} placeholder="每条审计记录都会带上该原因" /></label> : undefined}
      confirmLabel={'确认' + (pendingAction?.label ?? '')}
      pending={running}
      confirmDisabled={reasonMissing}
      onClose={close}
      onConfirm={() => void run()}
    >
      {result?.error && <AdminErrorState title="批量操作失败" message={result.error} />}
      {result?.outcome && <BatchOutcomeList outcome={result.outcome} />}
    </AdminConfirmDialog>
  </div>;
}
