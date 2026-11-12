import React, { useCallback, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { AdminButton } from './AdminPrimitives';
import { getAdminSessionToken, getApiToken } from '../../utils/api';
import { exportCsvFilename, exportCsvPath, type CsvExportType } from './adminUserModel';

/**
 * 批次 3：CSV 导出按钮。
 *
 * 导出需要 Authorization / X-Admin-Session 头，不能用 <a href> 直链，
 * 因此用 fetch 拉取 blob 后触发浏览器下载；后端是流式响应（分页游标），
 * 前端一次接收完整文件（上限 10000 行）。
 */

export interface CsvDownloadDependencies {
  fetcher?: typeof fetch;
  userToken?: () => string | null;
  sessionToken?: () => string | null;
  /** 下载触发器，测试可注入以避免触碰真实 DOM 下载。 */
  triggerDownload?: (blob: Blob, filename: string) => void;
  /** 文件名日期，测试可注入固定值；缺省为当天。 */
  date?: Date;
}

export const defaultTriggerDownload = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

/** 组装带双凭证的下载请求并返回文件名；错误以中文可读文案抛出。 */
export async function downloadAdminCsv(
  type: CsvExportType,
  {
    fetcher = globalThis.fetch,
    userToken = getApiToken,
    sessionToken = getAdminSessionToken,
    triggerDownload = defaultTriggerDownload,
    date = new Date(),
  }: CsvDownloadDependencies = {},
): Promise<string> {
  const token = userToken();
  if (!token) throw new Error('后台会话凭证不可用，请重新进入后台后再导出。');
  const headers: Record<string, string> = { Accept: 'text/csv', Authorization: `Bearer ${token}` };
  const session = sessionToken();
  if (session) headers['X-Admin-Session'] = session;
  const response = await fetcher(exportCsvPath(type), { method: 'GET', credentials: 'include', headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: unknown } | null;
    throw new Error(typeof payload?.message === 'string' ? payload.message : `导出失败（${response.status}）`);
  }
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('text/csv')) throw new Error('服务端未返回 CSV 内容，已取消下载。');
  const blob = await response.blob();
  const filename = exportCsvFilename(type, date);
  triggerDownload(blob, filename);
  return filename;
}

export function CsvExportButton({
  type, label, disabled = false,
  dependencies,
}: {
  type: CsvExportType;
  label?: string;
  disabled?: boolean;
  dependencies?: CsvDownloadDependencies;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const alive = useRef(true);
  React.useEffect(() => () => { alive.current = false; }, []);
  const download = useCallback(async () => {
    setBusy(true); setMessage(''); setError('');
    try {
      const filename = await downloadAdminCsv(type, dependencies);
      if (alive.current) setMessage('已导出 ' + filename);
    } catch (downloadError) {
      if (alive.current) setError(downloadError instanceof Error ? downloadError.message : '导出失败，请重试。');
    } finally { if (alive.current) setBusy(false); }
  }, [type, dependencies]);
  return <span className="admin-csv-export" data-csv-export={type}>
    <AdminButton data-csv-export-button disabled={disabled} busy={busy} onClick={() => void download()} title={'导出 ' + label + '（最多 10000 行，CSV 编码带 BOM）'}>
      <Download aria-hidden="true" />{label ?? '导出 CSV'}
    </AdminButton>
    {message && <small role="status">{message}</small>}
    {error && <small role="alert">{error}</small>}
  </span>;
}
