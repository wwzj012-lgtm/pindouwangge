import React, { useEffect, useId, useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';
import type { AdminRequest } from './adminRequest';
import { AdminButton, AdminConfirmDialog, AdminDrawer, AdminErrorState } from './AdminPrimitives';
import { userLabel, type AdminUser } from './adminUserModel';

type Mode = 'random' | 'custom';
interface ResetResult { success: boolean; mode: Mode; temporaryPassword?: string; }

export function passwordResetValidation(password: string, confirmation: string): string {
  if (password.length < 8 || password.length > 72 || !password.trim()) return '密码必须为 8–72 个字符，且不能全为空白。';
  return password === confirmation ? '' : '两次输入的密码不一致。';
}

export function AdminPasswordReset({ user, currentUserUid, request, onClose }: {
  user: AdminUser; currentUserUid?: string; request: AdminRequest; onClose: () => void; key?: string;
}) {
  const id = useId();
  const [mode, setMode] = useState<Mode>('random');
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [review, setReview] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState<{ temporaryPassword?: string; notice: string } | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const writing = useRef(false), mounted = useRef(false), completed = useRef(false), attempted = useRef(false);
  const surface = useRef<HTMLDivElement | null>(null);
  const clearDOM = (root: HTMLDivElement | null) => {
    root?.querySelectorAll('input').forEach(input => { input.value = ''; input.defaultValue = ''; input.removeAttribute('value'); });
    root?.querySelector('[data-reset-temporary-password]')?.replaceChildren();
  };
  const self = currentUserUid === user.uid;
  useEffect(() => {
    const root = surface.current;
    mounted.current = true;
    return () => { mounted.current = false; clearDOM(root); };
  }, []);
  const close = () => {
    if (writing.current) return;
    clearDOM(surface.current);
    setPassword(''); setConfirmation(''); setResult(null); setError(''); setReview(false); onClose();
  };
  const changeMode = (next: Mode) => {
    clearDOM(surface.current);
    setMode(next); setPassword(''); setConfirmation(''); setError(''); setReview(false);
  };
  const validate = () => self ? '不能重置当前管理员自己的密码。' : mode === 'custom' ? passwordResetValidation(password, confirmation) : '';
  const submit = async () => {
    if (writing.current || completed.current || attempted.current || !review) return;
    const validation = validate();
    if (validation) { setError(validation); setReview(false); return; }
    writing.current = true; attempted.current = true; setBusy(true); setError('');
    try {
      // Only this endpoint receives the secret. The server owns the redacted audit event.
      const response = await request<ResetResult>('/api/admin/reset-password', {
        method: 'POST', body: JSON.stringify({ uid: user.uid, mode, ...(mode === 'custom' ? { password } : {}) }),
      });
      if (!mounted.current) return;
      if (!response.ok) {
        // Never render an arbitrary error payload, which could echo submitted secrets.
        setError(response.status === 403 ? '重置密码被服务端拒绝（403）：需要 users.write；目标为管理员时还需要 admins.write。'
          : response.status === 401 ? '后台会话已失效（401），请重新进入后台。'
          : response.status === 400 ? '服务端拒绝请求（400）：请确认目标不是当前管理员，且密码符合要求。'
          : response.status === 404 ? '目标用户不存在（404），请关闭并刷新用户列表。'
          : `重置结果未确认${response.status ? '（' + response.status + '）' : '（网络或超时）'}。密码可能已更新，请先核实；不会自动重试。再次操作前请返回设置并重新确认。`);
        return;
      }
      clearDOM(surface.current);
      completed.current = true; setReview(false); setPassword(''); setConfirmation('');
      const data = response.data;
      const valid = data?.success === true && data.mode === mode;
      const temporaryPassword = valid && mode === 'random' && typeof data.temporaryPassword === 'string' && data.temporaryPassword.length >= 8 && data.temporaryPassword.length <= 72
        ? data.temporaryPassword : undefined;
      setResult({ temporaryPassword, notice: !valid || mode === 'random' && !temporaryPassword
        ? '接口已返回成功，但未提供完整结果。请核实目标账号；本次不会重复提交，无法恢复临时密码。'
        : '密码已重置，目标用户的现有登录会话已撤销。请安全转交新密码，并提醒用户重新登录。' });
    } catch {
      if (mounted.current) setError('重置结果未确认（网络异常）。密码可能已更新，请先核实；不会自动重试。再次操作前请返回设置并重新确认。');
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const copy = async () => {
    if (!result?.temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      if (mounted.current) setCopyMessage('已复制，请安全转交并及时清理剪贴板。');
    } catch { if (mounted.current) setCopyMessage('复制失败，请手动选择临时密码复制。'); }
  };
  return <div ref={surface} data-admin-sensitive data-admin-password-reset>
    <AdminDrawer open title="重置用户密码" description={userLabel(user) + ' · ' + user.email + ' · UID：' + user.uid}
      className="admin-user-drawer" pending={busy} onClose={close}>
      {result ? <section data-password-reset-result>
        <p className="admin-success-message" role="status">{result.notice}</p>
        {result.temporaryPassword && <div className="admin-info-box" data-admin-sensitive>
          <h3>临时密码 · 仅本次展示</h3><p>关闭或离开后不再显示，请现在记录并安全转交。</p>
          <p data-reset-temporary-password className="admin-mono admin-reset-password-value" aria-label="本次临时密码">{result.temporaryPassword}</p>
          <AdminButton onClick={() => void copy()}>复制临时密码</AdminButton>
          {copyMessage && <p role="status">{copyMessage}</p>}
        </div>}
        <AdminButton variant="primary" onClick={close}>完成并关闭</AdminButton>
      </section> : <>
        <div className="admin-info-box"><p>重置后，目标用户的现有登录会话将被撤销，需要使用新密码重新登录。</p>
          <p>需要 users.write 权限；重置管理员还需要 admins.write。权限以服务端判定为准。</p></div>
        {self && <AdminErrorState message="不能重置当前管理员自己的密码。" />}
        <label className="admin-stage-field">重置方式<select aria-label="重置方式" value={mode} disabled={busy || self} onChange={event => changeMode(event.target.value as Mode)}>
          <option value="random">随机生成临时密码</option><option value="custom">指定新密码</option>
        </select></label>
        {mode === 'random' ? <p className="admin-stage-footnote">服务端生成随机密码，成功后仅在本次窗口显示。</p> : <div className="admin-form-grid" data-admin-sensitive>
          <label>新密码<input type="password" autoComplete="new-password" spellCheck={false} value={password} disabled={busy} minLength={8} maxLength={72}
            aria-describedby={id + '-password-help'} onChange={event => { setPassword(event.target.value); setError(''); }} /></label>
          <label>再次输入新密码<input type="password" autoComplete="new-password" spellCheck={false} value={confirmation} disabled={busy} minLength={8} maxLength={72}
            aria-describedby={id + '-password-help'} onChange={event => { setConfirmation(event.target.value); setError(''); }} /></label>
          <p id={id + '-password-help'} className="admin-stage-footnote">8–72 个字符，不能全为空白；两次输入必须一致。不会在确认摘要中展示密码。</p>
        </div>}
        {error && <AdminErrorState title="密码重置尚未确认" message={error} />}
        <div className="admin-final-actions"><AdminButton onClick={close} disabled={busy}>取消</AdminButton>
          <AdminButton variant="danger" disabled={busy || self} onClick={() => { const message = validate(); setError(message); if (!message) { attempted.current = false; setReview(true); } }}><KeyRound aria-hidden="true" />核对目标并继续</AdminButton></div>
      </>}
    </AdminDrawer>
    <AdminConfirmDialog open={review} title="确认重置此用户密码？" description={'目标：' + userLabel(user) + ' · ' + user.email + ' · UID：' + user.uid}
      pending={busy} confirmDisabled={Boolean(error)} confirmLabel="确认重置密码" onClose={() => { if (!writing.current) { setReview(false); setError(''); } }} onConfirm={() => void submit()}>
      <div className="admin-change-summary"><p>方式：{mode === 'random' ? '随机生成临时密码' : '指定新密码（不展示密码内容）'}</p>
        <p>影响：立即替换登录密码，并撤销该用户现有登录会话。此操作不可撤销。</p></div>
      {error && <><AdminErrorState title="密码重置尚未确认" message={error} /><AdminButton disabled={busy} onClick={() => { setReview(false); setError(''); }}>返回设置并重新核对</AdminButton></>}
    </AdminConfirmDialog>
  </div>;
}
