import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminRequest } from './adminRequest';
import { adminRoleLabel, adminPermissionLabel } from './adminPresentation';
import { AdminBadge, AdminButton, AdminConfirmDialog, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { LatestRequest, SYSTEM_ROLE_MINIMUMS, dateText, permissionDelta, requestError } from './adminUserModel';

interface Role { id: string; code: string; displayName: string; description: string; system: boolean; permissionCount: number; }
interface Permission { id: string; code: string; displayName: string; description: string; }
interface Assignment { userUid: string; roleId: string; roleCode: string; roleName: string; assignedAt: number; }
interface PermissionDetail { role: Role; permissionCodes: string[]; }
interface Selection { id: string; before: string[]; codes: Set<string>; }
type Pending = { kind: 'save'; role: Role; codes: string[]; added: string[]; removed: string[] }
  | { kind: 'grant'; uid: string; role: Role } | { kind: 'revoke'; assignment: Assignment }
  | { kind: 'select'; id: string } | { kind: 'reload' };

export function AdminRoles({ request }: { request: AdminRequest }) {
  const [roles, setRoles] = useState<Role[]>([]), [permissions, setPermissions] = useState<Permission[] | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null), [selectedId, setSelectedId] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [loading, setLoading] = useState(false), [permissionLoading, setPermissionLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(''), [assignmentError, setAssignmentError] = useState(''), [permissionError, setPermissionError] = useState('');
  const [actionError, setActionError] = useState(''), [success, setSuccess] = useState('');
  const [uid, setUid] = useState(''), [assignmentRoleId, setAssignmentRoleId] = useState(''), [formVersion, setFormVersion] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null), [busy, setBusy] = useState(false);
  const [confirmedGrants, setConfirmedGrants] = useState<Set<string>>(new Set()), [confirmedRevocations, setConfirmedRevocations] = useState<Set<string>>(new Set());
  const epoch = useRef(new LatestRequest()), detailEpoch = useRef(new LatestRequest()), writing = useRef(false);
  const role = roles.find(item => item.id === selectedId);
  const current = selection?.id === selectedId ? selection : null;
  const delta = permissionDelta(current?.before ?? [], current?.codes ?? []);
  const dirty = delta.added.length > 0 || delta.removed.length > 0;
  const locked = role?.code === 'super_admin' ? permissions?.map(p => p.code) ?? [] : SYSTEM_ROLE_MINIMUMS[role?.code ?? ''] ?? [];

  const load = useCallback(async () => {
    const version = epoch.current.next(); setLoading(true); setCatalogError(''); setAssignmentError('');
    try {
      const [roleResult, permissionResult, assignmentResult] = await Promise.all([
        request<{ items: Role[] }>('/api/admin/roles'), request<{ items: Permission[] }>('/api/admin/permissions'), request<{ items: Assignment[] }>('/api/admin/admin-user-roles'),
      ]);
      if (!epoch.current.current(version)) return;
      const messages: string[] = [];
      if (roleResult.ok && Array.isArray(roleResult.data?.items)) {
        const next = roleResult.data.items; setRoles(next);
        setSelectedId(value => next.some(item => item.id === value) ? value : next[0]?.id ?? '');
        setAssignmentRoleId(value => next.some(item => item.id === value) ? value : next[0]?.id ?? '');
      } else messages.push(requestError(roleResult, '读取角色目录'));
      if (permissionResult.ok && Array.isArray(permissionResult.data?.items)) setPermissions(permissionResult.data.items);
      else messages.push(requestError(permissionResult, '读取权限目录'));
      setCatalogError(messages.join(' '));
      if (assignmentResult.ok && Array.isArray(assignmentResult.data?.items)) {
        setAssignments(assignmentResult.data.items); setConfirmedGrants(new Set()); setConfirmedRevocations(new Set());
      } else setAssignmentError(requestError(assignmentResult, '读取管理员角色关系'));
    } catch { if (epoch.current.current(version)) { setCatalogError('目录读取失败，已有内容保留，可重试。'); setAssignmentError('账号角色读取失败，已有内容保留，可重试。'); } }
    finally { if (epoch.current.current(version)) setLoading(false); }
  }, [request]);
  const readPermissions = useCallback(async () => {
    if (!selectedId) return;
    const version = detailEpoch.current.next(); setPermissionLoading(true); setPermissionError('');
    try {
      const result = await request<PermissionDetail>('/api/admin/roles/permissions?roleId=' + encodeURIComponent(selectedId));
      if (!detailEpoch.current.current(version)) return;
      if (!result.ok || result.data?.role.id !== selectedId || !Array.isArray(result.data?.permissionCodes)) { setPermissionError(requestError(result, '读取所选角色权限')); return; }
      setSelection({ id: selectedId, before: result.data.permissionCodes, codes: new Set(result.data.permissionCodes) });
    } catch { if (detailEpoch.current.current(version)) setPermissionError('权限读取失败，已有选择保留，可重试。'); }
    finally { if (detailEpoch.current.current(version)) setPermissionLoading(false); }
  }, [request, selectedId]);
  useEffect(() => { void load(); return () => epoch.current.invalidate(); }, [load]);
  useEffect(() => { void readPermissions(); return () => detailEpoch.current.invalidate(); }, [readPermissions]);
  const choose = (id: string) => { if (busy || id === selectedId) return; if (dirty) setPending({ kind: 'select', id }); else setSelectedId(id); };
  const retryPermissions = () => { if (dirty) setPending({ kind: 'reload' }); else void readPermissions(); };
  const assigned = assignments?.some(item => item.userUid === uid.trim() && item.roleId === assignmentRoleId) || confirmedGrants.has(uid.trim() + ':' + assignmentRoleId);
  const grantRole = roles.find(item => item.id === assignmentRoleId);
  const confirm = async () => {
    if (!pending || writing.current) return;
    if (pending.kind === 'select') { setSelectedId(pending.id); setPending(null); return; }
    if (pending.kind === 'reload') { setPending(null); await readPermissions(); return; }
    writing.current = true; setBusy(true); setActionError(''); setSuccess('');
    try {
      let result;
      if (pending.kind === 'save') result = await request('/api/admin/roles/permissions', { method: 'PUT', body: JSON.stringify({ roleId: pending.role.id, permissionCodes: pending.codes }) });
      else if (pending.kind === 'grant') result = await request('/api/admin/admin-user-roles', { method: 'POST', body: JSON.stringify({ userUid: pending.uid, roleId: pending.role.id }) });
      else result = await request('/api/admin/admin-user-roles?userUid=' + encodeURIComponent(pending.assignment.userUid) + '&roleId=' + encodeURIComponent(pending.assignment.roleId), { method: 'DELETE' });
      if (!result.ok) { setActionError(requestError(result, pending.kind === 'save' ? '保存角色权限' : pending.kind === 'grant' ? '授予后台角色' : '撤销后台角色')); return; }
      if (pending.kind === 'save') { setSelection({ id: pending.role.id, before: pending.codes, codes: new Set(pending.codes) }); setSuccess('权限已保存；正在重读服务端配置。'); await readPermissions(); }
      if (pending.kind === 'grant') { setConfirmedGrants(value => new Set([...value, pending.uid + ':' + pending.role.id])); setUid(''); setFormVersion(value => value + 1); setSuccess('已授予指定后台角色，未修改旧角色字段或付费资格。'); }
      if (pending.kind === 'revoke') { setConfirmedRevocations(value => new Set([...value, pending.assignment.userUid + ':' + pending.assignment.roleId])); setSuccess('指定角色已撤销；以服务端关系列表刷新结果为准。'); }
      setPending(null); await load();
    } catch { setActionError('操作失败，未自动重试；当前输入与权限选择已保留。'); }
    finally { writing.current = false; setBusy(false); }
  };
  const saveReview = () => {
    if (!role || !current || !dirty || role.code === 'super_admin' || busy || permissionLoading || !permissions) return;
    if (locked.some(code => !current.codes.has(code))) { setActionError('系统最低权限必须保留；不会自动补造授权。'); return; }
    setActionError(''); setPending({ kind: 'save', role, codes: [...current.codes].sort(), ...delta });
  };
  return <section className="admin-roles-page">
    <AdminToolbar><h2>后台角色与账号授权</h2><p>权限目录描述可配置能力，不是当前操作者权限范围；服务端最终校验每次操作。</p></AdminToolbar>
    {catalogError && <AdminErrorState title="部分目录未读取" message={catalogError} retry={() => void load()} busy={loading} />}
    {success && <p className="admin-success-message" role="status">{success}</p>}
    {actionError && !pending && <AdminErrorState title="操作未完成" message={actionError} />}
    <div className="admin-roles-layout"><aside className="admin-stage-panel admin-role-list" aria-label="后台角色列表"><h2>角色列表</h2>
      {roles.length ? roles.map(item => <button type="button" key={item.id} data-role-select={item.id} className="admin-role-choice" aria-pressed={selectedId === item.id} disabled={busy} onClick={() => choose(item.id)}><strong>{adminRoleLabel(item.code,item.displayName)}</strong><small className="admin-mono">{item.code}</small><small>目录返回 {item.permissionCount} 项权限{item.system ? ' · 系统角色' : ''}</small></button>) : loading ? <AdminLoading label="正在读取角色…" /> : <AdminEmptyState title="暂无可读取角色" />}
    </aside><section className="admin-stage-panel admin-role-permissions"><AdminToolbar actions={<><AdminButton onClick={retryPermissions} disabled={!role || busy || permissionLoading}>重读权限</AdminButton><AdminButton data-role-save variant="primary" disabled={!role || !current || !permissions || !dirty || busy || permissionLoading || role.code === 'super_admin'} onClick={saveReview}>保存权限</AdminButton></>}><h2>{role ? adminRoleLabel(role.code,role.displayName) : '选择角色'}</h2><p>{role?.description && /[\u3400-\u9fff]/u.test(role.description) ? role.description : '具体能力以服务端配置为准。'}</p></AdminToolbar>
      {role?.code === 'super_admin' && <p className="admin-info-box">超级管理员角色只读，必须保留全部权限，不可削权。</p>}
      {role?.code !== 'super_admin' && locked.length > 0 && <p className="admin-info-box">系统最低授权：{locked.join('、')}。这些选项不可取消。</p>}
      {permissionError && <AdminErrorState title="角色权限未更新" message={permissionError} retry={retryPermissions} busy={permissionLoading || busy} />}
      {permissionLoading ? <AdminLoading label="正在读取所选角色权限…" /> : current && permissions ? <div className="admin-permission-grid">{permissions.map(permission => <label className="admin-permission-option" key={permission.id}><input data-permission-code={permission.code} type="checkbox" checked={current.codes.has(permission.code)} disabled={busy || role?.code === 'super_admin' || locked.includes(permission.code)} onChange={event => setSelection(value => { if (!value || value.id !== selectedId) return value; const codes = new Set(value.codes); if (event.target.checked) codes.add(permission.code); else codes.delete(permission.code); return { ...value, codes }; })} /><span><strong>{adminPermissionLabel(permission.code,permission.displayName)}</strong><small className="admin-mono">{permission.code}</small>{locked.includes(permission.code) && <small>系统最低授权</small>}</span></label>)}</div> : <AdminEmptyState title="尚无可编辑的权限明细" description="必须读取目录与该角色的实际配置，不会把目录当作已授权。" />}
      {dirty && <p className="admin-result-caption" role="status">未保存：新增 {delta.added.length} 项 / 移除 {delta.removed.length} 项。保存前将列出具体差异。</p>}
    </section></div>
    <section className="admin-stage-panel"><AdminToolbar><h2>管理员账号角色</h2><p>只管理指定UID的后台角色关系，不改写旧角色字段或会员资格。</p></AdminToolbar>
      {assignmentError && <AdminErrorState title="账号角色读取失败" message={assignmentError + ' 其它已读取目录仍可使用。'} retry={() => void load()} busy={loading} />}
      <form className="admin-role-grant-form" key={formVersion} onSubmit={event => { event.preventDefault(); if (uid.trim() && grantRole && !assigned && !busy) { setActionError(''); setPending({ kind: 'grant', uid: uid.trim(), role: grantRole }); } }}>
        <label>目标用户UID<input data-role-user value={uid} maxLength={128} disabled={busy} onChange={event => setUid(event.target.value)} placeholder="输入现有用户UID" /></label>
        <label>后台角色<select data-role-assignment value={assignmentRoleId} disabled={busy || !roles.length} onChange={event => setAssignmentRoleId(event.target.value)}>{roles.map(item => <option key={item.id} value={item.id}>{adminRoleLabel(item.code,item.displayName)}</option>)}</select></label>
        <AdminButton data-role-grant type="submit" variant="primary" disabled={busy || !uid.trim() || !grantRole || Boolean(assigned)}>查看授权并确认</AdminButton>
      </form>{assigned && <p className="admin-stage-footnote">服务端列表或本次已成功请求表明该关系已存在，不重复授予。</p>}
      {assignments === null ? loading ? <AdminLoading label="正在读取账号角色…" /> : <AdminEmptyState title="尚无成功读取结果" /> : assignments.length ? <div className="admin-assignment-table-wrap"><table className="admin-stage-table" aria-label="管理员账号角色"><thead><tr><th>用户UID</th><th>后台角色</th><th>授予时间</th><th>操作</th></tr></thead><tbody>{assignments.map(item => <tr key={item.userUid + ':' + item.roleId}><td className="admin-mono">{item.userUid}</td><td><AdminBadge>{adminRoleLabel(item.roleCode,item.roleName)}</AdminBadge><small className="admin-mono">{item.roleCode}</small></td><td>{dateText(item.assignedAt)}</td><td><AdminButton data-role-revoke={item.userUid + ':' + item.roleId} variant="danger" disabled={busy || confirmedRevocations.has(item.userUid + ':' + item.roleId)} onClick={() => { setActionError(''); setPending({ kind: 'revoke', assignment: item }); }}>撤销此角色</AdminButton></td></tr>)}</tbody></table></div> : <AdminEmptyState title="暂无管理员角色关系" description="授予前将再次确认目标UID与角色。" />}
    </section>
    <AdminConfirmDialog open={Boolean(pending)} title={pending?.kind === 'save' ? '确认角色权限差异' : pending?.kind === 'grant' ? '确认授予后台角色' : pending?.kind === 'revoke' ? '确认撤销后台角色' : '放弃未保存权限？'} description={pending?.kind === 'save' ? adminRoleLabel(pending.role.code,pending.role.displayName) + '（' + pending.role.code + '）' : pending?.kind === 'grant' ? '目标UID：' + pending.uid + '；角色：' + adminRoleLabel(pending.role.code,pending.role.displayName) : pending?.kind === 'revoke' ? '目标UID：' + pending.assignment.userUid + '；角色：' + adminRoleLabel(pending.assignment.roleCode,pending.assignment.roleName) : '取消会保留当前选择，确认才切换或重读。'} confirmLabel="确认操作" pending={busy} onClose={() => { if (!writing.current) setPending(null); }} onConfirm={() => void confirm()}>
      {pending?.kind === 'save' && <div className="admin-change-summary"><p>新增：{pending.added.join('、') || '无'}</p><p>移除：{pending.removed.join('、') || '无'}</p><p>影响：更新该角色的权限集合；不改变其它角色，不把目录当作当前操作者权限范围。</p></div>}
      {pending?.kind === 'grant' && <p>影响：为这个UID新增所选后台角色关系；实际能力以服务端RBAC为准，不修改付费资格。</p>}
      {pending?.kind === 'revoke' && <p>影响：移除这个UID的指定角色关系；是否仍有其它后台权限由服务端决定，不删除账号。</p>}
      {actionError && <AdminErrorState title="服务端操作未完成" message={actionError} />}
    </AdminConfirmDialog>
  </section>;
}
