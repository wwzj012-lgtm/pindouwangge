import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminRequest } from './adminRequest';
import { AdminBadge, AdminButton, AdminConfirmDialog, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { dateText } from './adminUserModel';

/**
 * 批次 4：功能开关板块（挂在「功能配置」板块内）。
 * 三枚运营开关：register_enabled / community_post_enabled / maintenance_mode。
 * 开关读取每次查询 feature_flags（Workers 无长驻缓存），保存后下一次请求即生效。
 */

export interface FeatureFlagItem {
  key: string;
  enabled: boolean;
  description: string;
  updatedBy?: string | null;
  updatedAt?: number;
}

/** 三枚开关的 key 与生效说明（顺序即展示顺序）。 */
export const MANAGED_FLAG_KEYS = ['register_enabled', 'community_post_enabled', 'maintenance_mode'] as const;
export type ManagedFlagKey = typeof MANAGED_FLAG_KEYS[number];

export const flagExplanations: Record<ManagedFlagKey, string> = {
  register_enabled: '关闭后新用户注册接口直接 403 并返回引导文案；已注册用户不受影响。',
  community_post_enabled: '关闭后社区发帖接口 403；浏览、点赞、收藏等其它社区功能不受影响。',
  maintenance_mode: '开启后除后台（/api/admin/*）与健康检查外的全部接口返回 503；管理员仍可进入后台处理故障。',
};

export const flagTitles: Record<ManagedFlagKey, string> = {
  register_enabled: '开放注册',
  community_post_enabled: '开放社区发帖',
  maintenance_mode: '站点维护模式',
};

function isManagedKey(key: string): key is ManagedFlagKey {
  return (MANAGED_FLAG_KEYS as readonly string[]).includes(key);
}

export function parseManagedFlags(items: FeatureFlagItem[]): ManagedFlagKey[] {
  return MANAGED_FLAG_KEYS.filter(key => items.some(item => item.key === key && item.enabled));
}

export function FeatureFlagsPanel({ request, initialFlags }: { request: AdminRequest; initialFlags?: FeatureFlagItem[] }) {
  const [flags, setFlags] = useState<FeatureFlagItem[] | null>(initialFlags ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState<FeatureFlagItem | null>(null);
  const [saving, setSaving] = useState(false);
  const epoch = useRef(0);
  const load = useCallback(async () => {
    const version = ++epoch.current;
    setLoading(true); setError('');
    try {
      const result = await request<{ items: FeatureFlagItem[] }>('/api/admin/feature-flags?page=1&limit=100');
      if (version !== epoch.current) return;
      if (result.ok && result.data && Array.isArray(result.data.items)) {
        // 只展示三枚受管开关，按固定顺序。
        const managed = MANAGED_FLAG_KEYS
          .map(key => result.data!.items.find(item => item.key === key))
          .filter((item): item is FeatureFlagItem => Boolean(item));
        setFlags(managed); setSuccess('');
      } else setError((result.status === 403 ? '读取开关被服务端拒绝（403）：' : '功能开关读取失败：') + (result.error ?? '请重试'));
    } catch { if (version === epoch.current) setError('读取失败，请检查网络后重试。'); }
    finally { if (version === epoch.current) setLoading(false); }
  }, [request]);
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [load]);
  const save = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      const result = await request<{ updated: boolean }>('/api/admin/feature-flags', {
        method: 'PUT',
        body: JSON.stringify({ key: pending.key, enabled: pending.enabled, description: pending.description }),
      });
      if (result.ok) {
        setSuccess(`功能开关 ${pending.key} 已${pending.enabled ? '开启' : '关闭'}，下一次请求即生效。`);
        setPending(null);
        await load();
      } else setError('开关保存失败：' + (result.error ?? '请重试'));
    } catch { setError('开关保存请求失败，请检查网络后重试。'); }
    finally { setSaving(false); }
  };
  return <section aria-label="运营功能开关" aria-busy={loading}>
    <AdminToolbar actions={<AdminButton busy={loading} onClick={() => void load()}>刷新开关</AdminButton>}>
      <h2>运营功能开关</h2>
      <p>三枚即时生效的运营开关；其余配置项在上方「平台开关与参数」表中维护。</p>
    </AdminToolbar>
    {success && <p className="admin-success-message" role="status">{success}</p>}
    {error && <AdminErrorState message={error} retry={() => void load()} busy={loading || saving} />}
    <div className="admin-stage-panel" aria-busy={loading}>
      {!flags ? loading ? <AdminLoading /> : <AdminEmptyState title="尚无成功读取结果" /> : flags.length === 0
        ? <AdminEmptyState title="还没有受管开关" description="三枚开关由迁移 0019 播种；如缺失请检查迁移。" />
        : <div className="admin-table-scroll"><table className="admin-stage-table" aria-label="运营功能开关列表">
          <thead><tr><th>开关</th><th>当前状态</th><th>生效说明</th><th>更新</th><th>操作</th></tr></thead>
          <tbody>{flags.map(item => {
            const managedKey = isManagedKey(item.key) ? item.key : null;
            return <tr key={item.key} data-flag-row={item.key}>
              <td><strong>{managedKey ? flagTitles[managedKey] : item.key}</strong><small className="admin-mono">{item.key}</small></td>
              <td><AdminBadge tone={item.enabled ? 'success' : 'neutral'}>{item.enabled ? '开启' : '关闭'}</AdminBadge></td>
              <td><small>{managedKey ? flagExplanations[managedKey] : item.description || '—'}</small></td>
              <td><small>{dateText(item.updatedAt)}</small></td>
              <td><AdminButton data-flag-toggle={item.key} disabled={loading || saving}
                onClick={() => setPending({ ...item, enabled: !item.enabled })}>{item.enabled ? '关闭' : '开启'}</AdminButton></td>
            </tr>;
          })}</tbody>
        </table></div>}
    </div>
    <AdminConfirmDialog
      open={Boolean(pending)}
      title={(pending?.enabled ? '开启' : '关闭') + '功能开关'}
      description="确认后立即写入 feature_flags，下一次请求即生效。"
      subject={pending ? `${flagTitles[pending.key as ManagedFlagKey] ?? pending.key}（${pending.key}）` : ''}
      impact={pending?.key === 'maintenance_mode' && pending.enabled
        ? '开启后除后台与健康检查外的全部接口立即 503，请确认已在后台待命。'
        : pending?.key === 'register_enabled' && !pending.enabled
          ? '关闭后新用户将无法注册，已注册用户不受影响。'
          : pending?.key === 'community_post_enabled' && !pending.enabled
            ? '关闭后用户无法发布新帖子，已有帖子仍可浏览互动。'
            : '变更立即对全部请求生效。'}
      confirmLabel="确认变更"
      pending={saving}
      onClose={() => setPending(null)}
      onConfirm={() => void save()}
    />
  </section>;
}
