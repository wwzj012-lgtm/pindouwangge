import React, { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import type { AdminRequest } from './adminRequest';
import { AdminConfirmDialog, AdminDrawer, AdminErrorState } from './AdminPrimitives';
import { requestError } from './adminUserModel';
import { contentRecoveryFor, contentScope } from './adminWriteRecovery';

/** 复核弹窗里"变更前 / 将提交"两块原来直接 JSON.stringify，运营看到的是
 *  {"title":"…","status":"draft","pinned":false}。这里换成字段表：
 *  已知字段翻译成中文，长文本截断（完整值留在 title），body/content 同值时去重。 */
const fieldLabels: Record<string, string> = {
  title: '标题', body: '内容', content: '内容', status: '状态', publishAt: '发布时间', expireAt: '结束时间',
  audience: '受众', pinned: '置顶', name: '名称', key: '键', description: '说明', url: '地址',
  enabled: '开关', value: '取值', channel: '渠道', memberType: '权益类型', days: '时长', quantity: '数量',
  sortOrder: '排序', roleId: '角色', permissions: '权限', code: '兑换码', label: '标签',
};
// 这些键本身就是动作名（服务端用 publish:true / withdraw:true 表达意图），值是布尔时别显示成"是"
const verbLabels: Record<string, string> = {
  publish: '发布', withdraw: '撤回', pin: '置顶', unpin: '取消置顶', delete: '删除', restore: '恢复', enabled: '启用',
};
// 操作对象那一行已经写了记录 ID，这里再列一遍是噪音
const hiddenKeys = new Set(['id', 'uid', 'createdAt', 'updatedAt']);
const valueLabels: Record<string, string> = {
  draft: '草稿', scheduled: '定时发布', published: '已发布', withdrawn: '已撤回',
  all: '所有用户', vip: 'VIP', pro: '商家Pro', true: '是', false: '否', null: '未设置',
};
const fieldLabel = (key: string) => fieldLabels[key] ?? key;
function textValue(value: unknown): string {
  if (value === null || value === undefined) return '未设置';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return valueLabels[value] ?? value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.length ? value.map(textValue).join('、') : '空';
  return JSON.stringify(value);
}
function FrozenFields({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <p className="admin-frozen-text">新建 / 未提供</p>;
  if (typeof value !== 'object' || Array.isArray(value)) return <p className="admin-frozen-text">{textValue(value)}</p>;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, item]) => !hiddenKeys.has(key) && !(key === 'content' && 'body' in value && item === (value as Record<string, unknown>).body));
  if (!entries.length) return <p className="admin-frozen-text">新建 / 未提供</p>;
  return <dl className="admin-frozen-fields">{entries.map(([key, item]) => {
    const verb = verbLabels[key];
    const full = verb && typeof item === 'boolean' ? item ? '执行' : '不执行' : textValue(item);
    const shown = full.length > 60 ? full.slice(0, 60) + '…' : full;
    return <div key={key}><dt>{verb ?? fieldLabel(key)}</dt><dd title={full.length > 60 ? full : undefined}>{shown}</dd></div>;
  })}</dl>;
}

export function frozenValue<T>(value: T): T { return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T; }
export function jsonDraftText(value: unknown): string { return JSON.stringify(value === undefined ? {} : value, null, 2); }
export function parseJsonDraft(raw: string): { value?: unknown; error: string } { try { return { value: JSON.parse(raw), error: '' }; } catch { return { error: 'JSON格式无效，请修正后再提交。' }; } }
export interface ContentWrite {
  path: string; method: 'POST' | 'PUT' | 'DELETE'; body?: unknown; before?: unknown;
  title: string; object: string; impact: string; after?: unknown; done?: () => void | Promise<void>;
}
export function useContentWrite(request: AdminRequest, options?: { canWrite: (scope: string) => boolean }) {
  const { currentUser } = useAuth();
  const recovery = contentRecoveryFor(currentUser?.uid ?? 'signed-out');
  const recoveryRevision = useSyncExternalStore(recovery.subscribe, recovery.snapshot, recovery.snapshot);
  const [pending, setPending] = useState<ContentWrite | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const lock = useRef(false);
  const uncertainScope = useRef<string | null>(null);
  const canWrite = (path: string) => options?.canWrite(contentScope(path)) !== false;
  const uncertainMessage = '写入结果不确定，请先成功刷新相关列表并核对；关闭或重开确认不会解除保护。';
  useEffect(() => {
    if (uncertainScope.current && !recovery.isUncertain(uncertainScope.current)) { uncertainScope.current = null; setError(''); }
  }, [recovery, recoveryRevision]);
  const review = (value: ContentWrite) => {
    if (lock.current) return;
    if (!canWrite(value.path)) { setError('当前读取结果尚未确认，请成功刷新相关列表后再操作。'); return; }
    setError(recovery.isUncertain(value.path) ? uncertainMessage : '');
    setPending({ ...value, body: frozenValue(value.body), before: frozenValue(value.before), after: frozenValue(value.after ?? value.body) });
  };
  const confirm = async () => {
    if (!pending || lock.current) return;
    if (recovery.isUncertain(pending.path) || !canWrite(pending.path)) return;
    lock.current = true; setBusy(true); setError(''); setSuccess('');
    try {
      const result = await request(pending.path, { method: pending.method, ...(pending.body !== undefined ? { body: JSON.stringify(pending.body) } : {}) });
      if (!result.ok) { if (result.status === 0) { recovery.markUncertain(pending.path); uncertainScope.current = contentScope(pending.path); } setError(requestError(result, pending.title) + (result.status === 0 ? ' ' + uncertainMessage : '')); return; }
      const done = pending.done; setSuccess(pending.title + '已确认成功。'); setPending(null);
      try { await done?.(); } catch { setError('写入已成功，但读取刷新失败；请重读，不要重复写入。'); }
    } catch { recovery.markUncertain(pending.path); uncertainScope.current = contentScope(pending.path); setError(uncertainMessage + ' 输入与待提交快照保留。'); }
    finally { lock.current = false; setBusy(false); }
  };
  const confirmation = <>{!pending && error && <AdminErrorState title="操作结果提醒" message={error} />}<AdminConfirmDialog open={Boolean(pending)} title={pending?.title ?? '复核变更'} description="参数在打开确认时冻结，请核对变更前后的值。" subject={pending?.object} impact={pending?.impact} confirmLabel="确认提交" confirmDisabled={Boolean(pending && (recovery.isUncertain(pending.path) || !canWrite(pending.path)))} pending={busy} onClose={() => { if (!lock.current) setPending(null); }} onConfirm={() => void confirm()}>
    {pending && <><div className="admin-final-diff"><section><h3>变更前</h3><FrozenFields value={pending.before} /></section><section><h3>将提交</h3><div data-content-frozen><FrozenFields value={pending.after ?? '删除指定记录'} /></div></section></div></>}
    {error && <AdminErrorState title="实际操作未完成" message={error} />}
  </AdminConfirmDialog></>;
  return { busy, error, success, review, confirmation, beginRead: recovery.beginRead, readSucceeded: recovery.readSucceeded };
}
export function ContentDrawer({ title, description, children, onClose, busy = false }: { title: string; description?: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const dirty = useRef(false), [discard, setDiscard] = useState(false);
  const close = () => { if (busy) return; if (dirty.current) setDiscard(true); else onClose(); };
  return <><AdminDrawer open title={title} description={description} pending={busy} className="admin-final-drawer" onClose={close}><div onChangeCapture={() => { dirty.current = true; }} onClickCapture={event => { if (event.target instanceof Element && event.target.closest('[data-editor-cancel]')) { event.preventDefault(); event.stopPropagation(); close(); } }}>{children}</div></AdminDrawer>
    <AdminConfirmDialog open={discard} title="放弃未保存输入？" description={'对象：' + title + '。取消保留输入，确认才关闭。'} confirmLabel="放弃并关闭" onClose={() => setDiscard(false)} onConfirm={onClose} /></>;
}
