import React, { useState } from 'react';
import { Ban, ShieldCheck } from 'lucide-react';
import { AdminButton, AdminConfirmDialog, AdminDialog, AdminErrorState } from './AdminPrimitives';
import { parseBatchOutcome, type BatchOutcome } from './adminUserModel';

/**
 * 批次 3：共享批量操作栏。
 *
 * 视觉精修（PRD admin_console_visual_polish）：
 * - selectedCount = 0 时整个批量条不渲染（初始页面无批量条 DOM）；
 * - 选中后 fixed 底部居中浮动底条（圆角 8、阴影），不推挤布局；
 * - 仅危险动作（封禁等 requiresReason）弹确认框；普通动作（解封）直接执行，
 *   结果以结果弹窗展示（非确认弹窗，无"确认提交"按钮）。
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
  /** 当前勾选的 id 数量；为 0 时整个批量条不渲染。 */
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
  const [directResultOpen, setDirectResultOpen] = useState(false);
  const close = () => { if (running) return; setPendingAction(null); setReason(''); setResult(null); setDirectResultOpen(false); };
  const execute = async (actionKey: string, params: { reason: string }) => {
    setRunning(true); setResult(null);
    try { return await onRun(actionKey, params); }
    catch (error) { return { outcome: null, error: error instanceof Error ? error.message : String(error) } as BatchRunResult; }
    finally { setRunning(false); }
  };
  const openAction = (action: BatchActionOption) => {
    if (action.requiresReason) { setResult(null); setReason(''); setPendingAction(action); return; }
    // 普通动作直接执行，不经过确认框；完成后以结果弹窗回显。
    setPendingAction(action); setDirectResultOpen(true);
    void execute(action.key, { reason: '' }).then(outcome => setResult(outcome));
  };
  const run = async () => {
    if (!pendingAction) return;
    const outcome = await execute(pendingAction.key, { reason: reason.trim() });
    setResult(outcome);
  };
  const reasonMissing = Boolean(pendingAction?.requiresReason) && !reason.trim();
  // 验收：selectedCount = 0 时无批量条 DOM；选中后出现且 fixed 浮动不推挤布局。
  if (selectedCount === 0) return null;
  return <div className="admin-batch-bar" role="region" aria-label="批量操作" data-batch-bar>
    <span data-batch-count aria-live="polite">已选 {selectedCount} 项</span>
    {actions.map((action) => <AdminButton
      key={action.key}
      data-batch-action={action.key}
      variant={action.requiresReason ? 'danger' : 'secondary'}
      disabled={disabled || running}
      onClick={() => openAction(action)}
    >{action.requiresReason ? <Ban aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{action.label}</AdminButton>)}
    <AdminButton variant="ghost" disabled={disabled || running} onClick={onClear} data-batch-clear>清除</AdminButton>
    <AdminConfirmDialog
      open={Boolean(pendingAction?.requiresReason)}
      title={`批量${pendingAction?.label ?? ''}`}
      description={'将对勾选的 ' + selectedCount + ' 项逐条执行；单条失败不影响其它条。'}
      subject={'已选 ' + selectedCount + ' 项'}
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
    <AdminDialog
      open={directResultOpen && !pendingAction?.requiresReason}
      title={'批量' + (pendingAction?.label ?? '') + '结果'}
      description="普通批量操作无需二次确认，已直接执行；单条失败不影响其它条。"
      pending={running && directResultOpen}
      onClose={close}
      footer={<div className="admin-dialog-actions"><AdminButton data-admin-autofocus onClick={close} disabled={running}>关闭</AdminButton></div>}
    >
      {result?.error && <AdminErrorState title="批量操作失败" message={result.error} />}
      {result?.outcome && <BatchOutcomeList outcome={result.outcome} />}
      {running && <p className="admin-stage-footnote" role="status">正在逐条提交…</p>}
    </AdminDialog>
  </div>;
}
