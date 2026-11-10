import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminRequest } from './adminRequest';
import { AdminButton } from './AdminPrimitives';

export interface WelfareRule {
  id: string; name: string; triggerType: 'signup'; amountUnits: number;
  enabled: boolean; note: string | null; createdBy: string | null;
  createdAt: number; updatedAt: number; grantedUsers: number; grantedUnits: number;
}

const UNITS_PER_POINT = 100;
const dateText = (at: number) => new Date(at).toLocaleString('zh-CN', { hour12: false });

export function AdminWelfare({ request, canAdjust }: { request: AdminRequest; canAdjust: boolean }) {
  const [rules, setRules] = useState<WelfareRule[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await request<{ rules: WelfareRule[] }>('/api/admin/welfare/rules', { method: 'GET' });
      if (!response.ok) throw new Error(response.error ?? '读取失败');
      if (mounted.current) setRules(response.data.rules);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '读取失败');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    const parsed = Number(points);
    if (!name.trim()) { setError('请填写规则名称'); return; }
    if (!Number.isSafeInteger(parsed) || parsed <= 0) { setError('赠送积分必须是正整数'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await request<{ rule: WelfareRule }>('/api/admin/welfare/rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), amountPoints: parsed, note: note.trim() || undefined }),
      });
      if (!response.ok) throw new Error(response.error ?? '创建失败');
      if (mounted.current) {
        setMessage(`规则已创建：新注册用户将自动获得 ${parsed} 积分`);
        setName(''); setPoints(''); setNote('');
        void load();
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '创建失败');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const toggle = async (rule: WelfareRule) => {
    setBusy(true); setError('');
    try {
      const response = await request<{ rule: WelfareRule }>('/api/admin/welfare/rules/toggle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }),
      });
      if (!response.ok) throw new Error(response.error ?? '操作失败');
      if (mounted.current) void load();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return <section className="admin-welfare">
    <header><h2>福利规则</h2>
      <p>规则启用后自动生效：每位新注册用户按规则获得积分，每人每条规则只发放一次。发放写入积分账本（来源"福利规则"），可在积分管理中核对。</p>
    </header>
    {message && <p className="admin-welfare-ok" role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {canAdjust ? <div className="admin-welfare-create">
      <label>规则名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="如：新注册送 20 积分" maxLength={80} /></label>
      <label>赠送积分<input type="number" min={1} max={100000} value={points} onChange={(event) => setPoints(event.target.value)} placeholder="如：20" /></label>
      <label>备注<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选" maxLength={300} /></label>
      <AdminButton variant="primary" busy={busy} onClick={() => void create()}>创建规则</AdminButton>
    </div> : <p>没有调整积分的权限，只能查看规则。</p>}
    {loading && !rules ? <p>读取中…</p> : rules && rules.length === 0 ? <p>还没有福利规则。</p> : rules ? <table className="admin-welfare-table">
      <thead><tr><th>规则</th><th>触发</th><th>赠送</th><th>已发放</th><th>状态</th><th>创建时间</th><th /></tr></thead>
      <tbody>{rules.map((rule) => <tr key={rule.id}>
        <td><strong>{rule.name}</strong>{rule.note ? <small>{rule.note}</small> : null}</td>
        <td>新注册</td>
        <td>{rule.amountUnits / UNITS_PER_POINT} 积分</td>
        <td>{rule.grantedUsers} 人 · {rule.grantedUnits / UNITS_PER_POINT} 积分</td>
        <td>{rule.enabled ? <span className="admin-welfare-on">启用中</span> : <span className="admin-welfare-off">已停用</span>}</td>
        <td>{dateText(rule.createdAt)}</td>
        <td>{canAdjust ? <AdminButton busy={busy} onClick={() => void toggle(rule)}>{rule.enabled ? '停用' : '启用'}</AdminButton> : null}</td>
      </tr>)}</tbody>
    </table> : null}
  </section>;
}
