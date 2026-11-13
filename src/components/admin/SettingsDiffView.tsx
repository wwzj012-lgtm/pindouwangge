import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminRequest } from './adminRequest';
import { AdminButton, AdminErrorState, AdminToolbar } from './AdminPrimitives';
import { EmptyState } from './shared/EmptyState';
import { LoadingSkeleton } from './shared/LoadingSkeleton';

/**
 * 批次 5：系统设置变更历史（config 板块内）。
 *
 * 数据源：GET /api/admin/system-settings/history?key=（cap config.read），
 * 后端查 admin_operation_logs 中 action LIKE 'settings.%' 的 before/after 快照。
 * 前端按 key 选择 → 渲染每次变更的红绿行级 diff。
 */

export interface SettingHistoryItem {
  id: string;
  actorUid: string | null;
  action: string;
  targetType: string | null;
  key: string | null;
  before: unknown;
  after: unknown;
  note: string | null;
  createdAt: number;
}

interface SettingHistoryPage { items: SettingHistoryItem[]; total: number; limit: number; offset: number }

export interface SystemSettingItem { key: string; value: unknown; description?: string; updatedAt?: number }

/** 设置列表分页拉取参数：后端校验 limit 1-100，循环页数封顶防失控。 */
export const SETTING_KEYS_PAGE_SIZE = 100;
export const SETTING_KEYS_MAX_PAGES = 10;

/**
 * 分页拉取全部系统设置键：limit=100 起步，按返回 total 循环拉后续 offset，
 * 最多 SETTING_KEYS_MAX_PAGES 页（1000 条封顶）。任一页失败即抛错并携带后端原文。
 */
export async function fetchAllSettingKeys(request: AdminRequest, pageSize = SETTING_KEYS_PAGE_SIZE, maxPages = SETTING_KEYS_MAX_PAGES): Promise<string[]> {
  const keys: string[] = [];
  let offset = 0;
  for (let page = 0; page < Math.max(1, maxPages); page++) {
    const result = await request<{ items: SystemSettingItem[]; total: number }>(
      `/api/admin/system-settings?limit=${pageSize}&offset=${offset}`);
    if (!result.ok || !result.data || !Array.isArray(result.data.items)) {
      throw new Error(result.error ?? '返回的设置列表无效，请重试');
    }
    for (const item of result.data.items) if (item && typeof item.key === 'string') keys.push(item.key);
    offset += result.data.items.length;
    const total = result.data.total;
    if (!Number.isFinite(total) || result.data.items.length === 0 || offset >= total) break;
  }
  return keys;
}

const dateText = (at: number) => new Date(at).toLocaleString('zh-CN', { hour12: false });

/** 快照转可 diff 的多行文本（对象/数组 pretty JSON，标量原样）。 */
export function settingSnapshotText(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2) ?? String(value); }
  catch { return String(value); }
}

export type SettingDiffLineKind = 'same' | 'removed' | 'added';

export interface SettingDiffLine { kind: SettingDiffLineKind; text: string }

/**
 * 行级 LCS diff：before 行红色（removed）、after 行绿色（added）、
 * 双侧一致的行中性。返回 removed/added 混排序列，顺序按 diff 走向。
 */
export function settingDiffLines(beforeText: string, afterText: string): SettingDiffLine[] {
  const before = beforeText.split('\n');
  const after = afterText.split('\n');
  // LCS 动态规划表；快照行数有限（服务端截断到 200 字符内的字段会被序列化成短行）。
  const m = before.length, n = after.length;
  const table: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      table[i]![j] = before[i] === after[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const lines: SettingDiffLine[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (before[i] === after[j]) { lines.push({ kind: 'same', text: before[i]! }); i++; j++; }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) { lines.push({ kind: 'removed', text: before[i]! }); i++; }
    else { lines.push({ kind: 'added', text: after[j]! }); j++; }
  }
  while (i < m) { lines.push({ kind: 'removed', text: before[i]! }); i++; }
  while (j < n) { lines.push({ kind: 'added', text: after[j]! }); j++; }
  return lines;
}

function HistoryDiff({ item }: { item: SettingHistoryItem }) {
  const beforeLines = settingDiffLines(settingSnapshotText(item.before), settingSnapshotText(item.after));
  return <div className="admin-settings-diff" data-settings-diff={item.id}>
    <p className="admin-settings-diff-meta">
      <span>{dateText(item.createdAt)}</span>
      <span className="admin-mono">{item.action}</span>
      <span>{item.actorUid ?? '操作者未提供'}</span>
      {item.note && <span className="admin-settings-diff-note">{item.note}</span>}
    </p>
    <div className="admin-settings-diff-body">
      {beforeLines.map((line, index) => (
        <div key={index} className={`admin-diff-row admin-diff-row--${line.kind}`}>
          <span aria-hidden="true">{line.kind === 'removed' ? '−' : line.kind === 'added' ? '+' : ' '}</span>
          <code>{line.text === '' ? ' ' : line.text}</code>
        </div>
      ))}
    </div>
  </div>;
}

export function SettingsDiffView({ request, initialKeys, initialHistory, initialKey }: {
  request: AdminRequest;
  initialKeys?: string[];
  initialHistory?: SettingHistoryItem[];
  initialKey?: string;
}) {
  const [keys, setKeys] = useState<string[] | null>(initialKeys ?? null);
  const [selectedKey, setSelectedKey] = useState(initialKey ?? '');
  const [history, setHistory] = useState<SettingHistoryPage | null>(initialHistory
    ? { items: initialHistory, total: initialHistory.length, limit: 50, offset: 0 }
    : null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);

  const loadKeys = useCallback(async () => {
    const version = ++epoch.current;
    setLoading(true); setError('');
    try {
      const list = await fetchAllSettingKeys(request);
      if (version !== epoch.current) return;
      setKeys(list);
      setSelectedKey(current => (current && list.includes(current) ? current : list[0] ?? ''));
    } catch (caught) {
      if (version === epoch.current) setError('读取系统设置列表失败：' + (caught instanceof Error ? caught.message : '请重试'));
    }
    finally { if (version === epoch.current) setLoading(false); }
  }, [request]);

  const loadHistory = useCallback(async (key: string) => {
    if (!key) { setHistory(null); return; }
    const version = ++epoch.current;
    setHistoryLoading(true); setError('');
    try {
      const result = await request<SettingHistoryPage>('/api/admin/system-settings/history?key=' + encodeURIComponent(key) + '&limit=50');
      if (version !== epoch.current) return;
      if (result.ok && result.data && Array.isArray(result.data.items)) setHistory(result.data);
      else { setHistory(null); setError('读取设置变更历史失败：' + (result.error ?? '请重试')); }
    } catch { if (version === epoch.current) setError('读取设置变更历史失败，请检查网络后重试。'); }
    finally { if (version === epoch.current) setHistoryLoading(false); }
  }, [request]);

  useEffect(() => { void loadKeys(); return () => { epoch.current++; }; }, [loadKeys]);
  useEffect(() => { void loadHistory(selectedKey); return () => { epoch.current++; }; }, [loadHistory, selectedKey]);

  return <section aria-label="系统设置变更历史" aria-busy={loading || historyLoading}>
    <AdminToolbar actions={<AdminButton busy={loading} onClick={() => void loadKeys()}>刷新键列表</AdminButton>}>
      <h2>系统设置变更历史</h2>
      <p>选择配置键查看 before/after 快照；红色为改动前，绿色为改动后。数据来自结构化写审计（settings.%）。</p>
    </AdminToolbar>
    {error && <AdminErrorState message={error} retry={() => { void loadKeys(); void loadHistory(selectedKey); }} busy={loading || historyLoading} />}
    {keys && <label className="admin-settings-diff-picker">配置键
      <select data-settings-key-select value={selectedKey} onChange={event => setSelectedKey(event.target.value)} aria-label="选择配置键">
        {keys.map(key => <option key={key} value={key}>{key}</option>)}
      </select>
    </label>}
    {historyLoading ? <LoadingSkeleton rows={6} columns={1} ariaLabel="正在读取设置变更历史…" />
      : !history ? <EmptyState title="尚无变更历史" description="该配置键还没有 settings.% 审计记录；保存一次配置后会出现。" scope="settings-diff" />
        : history.items.length === 0
          ? <EmptyState title="该配置键还没有变更记录" description="保存一次该配置后，这里会出现前后快照 diff。" scope="settings-diff" />
          : <div className="admin-settings-diff-list">
            <p className="admin-result-caption">共 {history.total} 条变更记录，最新在前。</p>
            {history.items.map(item => <HistoryDiff key={item.id} item={item} />)}
          </div>}
  </section>;
}
