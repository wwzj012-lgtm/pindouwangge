import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminRequest } from './adminRequest';
import { AdminButton } from './AdminPrimitives';
import './AdminWelfare.css';

export interface WelfareRule {
  id: string; name: string; triggerType: 'signup'; amountUnits: number;
  enabled: boolean; note: string | null; createdBy: string | null;
  createdAt: number; updatedAt: number; grantedUsers: number; grantedUnits: number;
}

const UNITS_PER_POINT = 10;
const dateText = (at: number) => new Date(at).toLocaleString('zh-CN', { hour12: false });
const STEP_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6" /><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13" /><path d="M12 8c-1.5-2.5-4-4-4-6.5a2 2 0 0 1 4-.5 2 2 0 0 1 4 .5C16 4 13.5 5.5 12 8z" />
  </svg>
);

export function AdminWelfare({ request, canAdjust }: { request: AdminRequest; canAdjust: boolean }) {
  const [rules, setRules] = useState<WelfareRule[] | null>(null);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<{ name?: string; points?: string }>({});
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
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
    const errors: { name?: string; points?: string } = {};
    if (!name.trim()) errors.name = '请填写规则名称';
    const parsed = Number(points);
    if (!points.trim()) errors.points = '请填写赠送积分';
    else if (!Number.isSafeInteger(parsed) || parsed <= 0) errors.points = '必须是正整数';
    else if (parsed > 100000) errors.points = '单条规则不超过 100000 积分';
    setFieldError(errors);
    if (Object.keys(errors).length > 0) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await request<{ rule: WelfareRule }>('/api/admin/welfare/rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), amountPoints: parsed, note: note.trim() || undefined }),
      });
      if (!response.ok) throw new Error(response.error ?? '创建失败');
      if (mounted.current) {
        setMessage(`规则「${name.trim()}」已启用：从现在起新注册的用户会自动到账 ${parsed} 积分`);
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
    setBusyId(rule.id); setError('');
    try {
      const response = await request<{ rule: WelfareRule }>('/api/admin/welfare/rules/toggle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }),
      });
      if (!response.ok) throw new Error(response.error ?? '操作失败');
      if (mounted.current) {
        setMessage(rule.enabled ? `规则「${rule.name}」已停用，新注册用户不再获得该奖励` : `规则「${rule.name}」已启用`);
        void load();
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      if (mounted.current) setBusyId(null);
    }
  };

  return <section className="admin-welfare">
    <div className="admin-welfare-hero">
      <h2>福利规则</h2>
      <p>配置自动发放的积分福利。规则启用后由系统在触发时机自动执行，无需人工干预。</p>
      <ol className="admin-welfare-flow" aria-label="福利发放流程">
        <li><span className="admin-welfare-flow-icon">{STEP_ICON}</span><strong>启用规则</strong><small>设定触发时机与赠送积分</small></li>
        <li><span className="admin-welfare-flow-icon">册</span><strong>用户注册</strong><small>新用户创建账号的瞬间触发</small></li>
        <li><span className="admin-welfare-flow-icon">✓</span><strong>积分自动到账</strong><small>写入积分账本，可在积分管理核对</small></li>
      </ol>
      <p className="admin-welfare-guard">每人每条规则只发放一次：重复注册、网络重试都不会多发。发放失败不会阻塞注册。</p>
    </div>

    {message && <p className="admin-welfare-banner" role="status">{message}</p>}
    {error && <p className="admin-welfare-error" role="alert">{error}</p>}

    {canAdjust ? <div className="admin-welfare-card admin-welfare-create">
      <h3>新建规则</h3>
      <div className="admin-welfare-form">
        <label>规则名称
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="如：新注册送 20 积分" maxLength={80} />
          {fieldError.name ? <span className="admin-welfare-field-error" role="alert">{fieldError.name}</span> : <small>建议写清金额，方便在列表里辨认</small>}
        </label>
        <label>触发时机
          <select value="signup" onChange={() => undefined} aria-describedby="welfare-trigger-hint">
            <option value="signup">新用户注册时</option>
          </select>
          <small id="welfare-trigger-hint">目前支持"新注册"触发；用户完成注册的瞬间自动发放</small>
        </label>
        <label>赠送积分
          <input type="number" min={1} max={100000} value={points} onChange={(event) => setPoints(event.target.value)} placeholder="如：20" />
          {fieldError.points ? <span className="admin-welfare-field-error" role="alert">{fieldError.points}</span> : <small>正整数，单条规则上限 100000</small>}
        </label>
        <label className="admin-welfare-note">备注
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选，仅管理员可见" maxLength={300} />
        </label>
        <div className="admin-welfare-submit">
          <AdminButton variant="primary" busy={busy} onClick={() => void create()}>创建并启用</AdminButton>
        </div>
      </div>
    </div> : <div className="admin-welfare-card"><p>没有调整积分的权限，只能查看规则与发放统计。</p></div>}

    <div className="admin-welfare-card">
      <h3>规则列表{rules ? <span className="admin-welfare-count">{rules.length} 条</span> : null}</h3>
      {loading && !rules ? <p>读取中…</p>
        : rules && rules.length === 0 ? <p className="admin-welfare-empty">还没有福利规则。用上面的表单创建第一条，新注册用户即可自动获得积分。</p>
        : rules ? <ul className="admin-welfare-rules">{rules.map((rule) => <li key={rule.id}
            className={`admin-welfare-rule${rule.enabled ? '' : ' admin-welfare-rule-off'}`}>
          <div className="admin-welfare-rule-main">
            <div className="admin-welfare-rule-title">
              <strong>{rule.name}</strong>
              <span className={`admin-welfare-badge${rule.enabled ? '' : ' off'}`}>{rule.enabled ? '启用中' : '已停用'}</span>
            </div>
            <div className="admin-welfare-rule-meta">
              <span>新注册触发</span><span>赠 {rule.amountUnits / UNITS_PER_POINT} 积分</span>
              {rule.note ? <span title={rule.note}>{rule.note}</span> : null}
              <span>创建于 {dateText(rule.createdAt)}</span>
            </div>
          </div>
          <div className="admin-welfare-rule-stats">
            <div><dt>已发放用户</dt><dd>{rule.grantedUsers}</dd></div>
            <div><dt>累计积分</dt><dd>{rule.grantedUnits / UNITS_PER_POINT}</dd></div>
          </div>
          {canAdjust ? <AdminButton busy={busyId === rule.id} onClick={() => void toggle(rule)}>{rule.enabled ? '停用' : '启用'}</AdminButton> : null}
        </li>)}</ul> : null}
    </div>
  </section>;
}
