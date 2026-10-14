import React, { useRef, useState, type ReactNode } from 'react';
import type { AdminRequest } from './adminRequest';
import { AdminConfirmDialog, AdminDrawer, AdminErrorState } from './AdminPrimitives';
import { requestError } from './adminUserModel';

export function frozenValue<T>(value: T): T { return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T; }
export function parseJsonDraft(raw: string): { value?: unknown; error: string } { try { return { value: JSON.parse(raw), error: '' }; } catch { return { error: 'JSON格式无效，请修正后再提交。' }; } }
export interface ContentWrite {
  path: string; method: 'POST' | 'PUT' | 'DELETE'; body?: unknown; before?: unknown;
  title: string; object: string; impact: string; after?: unknown; done?: () => void | Promise<void>;
}
export function useContentWrite(request: AdminRequest) {
  const [pending, setPending] = useState<ContentWrite | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const lock = useRef(false);
  const review = (value: ContentWrite) => { if (lock.current) return; setError(''); setPending({ ...value, body: frozenValue(value.body), before: frozenValue(value.before), after: frozenValue(value.after ?? value.body) }); };
  const confirm = async () => {
    if (!pending || lock.current) return; lock.current = true; setBusy(true); setError(''); setSuccess('');
    try {
      const result = await request(pending.path, { method: pending.method, ...(pending.body !== undefined ? { body: JSON.stringify(pending.body) } : {}) });
      if (!result.ok) { setError(requestError(result, pending.title)); return; }
      const done = pending.done; setSuccess(pending.title + '已确认成功。'); setPending(null);
      try { await done?.(); } catch { setError('写入已成功，但读取刷新失败；请重读，不要重复写入。'); }
    } catch { setError('请求失败，输入与待提交快照保留；不会自动重试写入。'); }
    finally { lock.current = false; setBusy(false); }
  };
  const confirmation = <AdminConfirmDialog open={Boolean(pending)} title={pending?.title ?? '复核变更'} description={pending ? '对象：' + pending.object + '。参数在打开确认时冻结。' : ''} confirmLabel="确认提交" pending={busy} onClose={() => { if (!lock.current) setPending(null); }} onConfirm={() => void confirm()}>
    {pending && <><p className="admin-final-impact">作用范围：{pending.impact}</p><div className="admin-final-diff"><section><h3>变更前 / 读取值</h3><pre>{JSON.stringify(pending.before ?? '新建 / 未提供', null, 2)}</pre></section><section><h3>将提交值</h3><pre data-content-frozen>{JSON.stringify(pending.after ?? '删除指定记录', null, 2)}</pre></section></div></>}
    {error && <AdminErrorState title="实际操作未完成" message={error} />}
  </AdminConfirmDialog>;
  return { busy, error, success, review, confirmation };
}
export function ContentDrawer({ title, description, children, onClose, busy = false }: { title: string; description?: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const dirty = useRef(false), [discard, setDiscard] = useState(false);
  const close = () => { if (busy) return; if (dirty.current) setDiscard(true); else onClose(); };
  return <><AdminDrawer open title={title} description={description} pending={busy} className="admin-final-drawer" onClose={close}><div onChangeCapture={() => { dirty.current = true; }} onClickCapture={event => { if (event.target instanceof Element && event.target.closest('[data-editor-cancel]')) { event.preventDefault(); event.stopPropagation(); close(); } }}>{children}</div></AdminDrawer>
    <AdminConfirmDialog open={discard} title="放弃未保存输入？" description={'对象：' + title + '。取消保留输入，确认才关闭。'} confirmLabel="放弃并关闭" onClose={() => setDiscard(false)} onConfirm={onClose} /></>;
}
