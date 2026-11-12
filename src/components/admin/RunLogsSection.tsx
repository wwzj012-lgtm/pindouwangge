import React, { useState } from 'react';
import type { AdminRequest } from './adminRequest';
import { RunLogsViewer } from './RunLogsViewer';
import { CronRunsPanel } from './CronRunsPanel';
import { SessionManagerPanel } from './SessionManagerPanel';
import { AdminLogsCodes } from './AdminLogsCodes';

/**
 * 批次 5：监控板块 IA 重排。
 *
 * 批次 4 曾把「运行日志 / 定时任务 / 后台会话」临时挂成三个独立菜单项；
 * 本批次把它们合并进 runLogs 板块内 tab，同时吸收旧 logs SectionId 的
 * 数据源展示（activity/audit 两源分流已在 RunLogsViewer 内，legacy
 * /api/admin/logs 保留为「历史日志」tab）。旧书签（section=logs/sessions/
 * cronRuns）由 resolveAdminSection 映射到这里。
 */

export type RunLogsTab = 'runs' | 'cron' | 'sessions' | 'legacy';

export const runLogsTabs: Array<{ id: RunLogsTab; label: string }> = [
  { id: 'runs', label: '运行日志' },
  { id: 'cron', label: '定时任务' },
  { id: 'sessions', label: '管理会话' },
  { id: 'legacy', label: '历史日志' },
];

export function RunLogsSection({ request, operatorUid }: { request: AdminRequest; operatorUid: string }) {
  const [tab, setTab] = useState<RunLogsTab>('runs');
  return <div className="admin-runlogs-section" data-runlogs-tab={tab}>
    <div className="admin-module-tabs" role="group" aria-label="监控板块视图">
      {runLogsTabs.map(item => (
        <button key={item.id} type="button" data-runlogs-tab-button={item.id} className={`admin-button admin-button--${tab === item.id ? 'primary' : 'secondary'}`}
          aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>
      ))}
    </div>
    {tab === 'runs' && <RunLogsViewer request={request} />}
    {tab === 'cron' && <CronRunsPanel request={request} />}
    {tab === 'sessions' && <SessionManagerPanel request={request} operatorUid={operatorUid} />}
    {tab === 'legacy' && <AdminLogsCodes mode="logs" request={request} />}
  </div>;
}
