import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CsvExportButton, downloadAdminCsv } from './CsvExportButton';
import { exportCsvFilename, exportCsvPath } from './adminUserModel';

describe('csv export path and filename', () => {
  it('builds the export endpoint path with a bounded limit', () => {
    expect(exportCsvPath('users')).toBe('/api/admin/export?type=users&limit=10000');
    expect(exportCsvPath('audit-logs', 500)).toBe('/api/admin/export?type=audit-logs&limit=500');
    expect(exportCsvPath('credit-ledger', 99999)).toBe('/api/admin/export?type=credit-ledger&limit=10000');
    expect(exportCsvPath('redemptions', 0)).toBe('/api/admin/export?type=redemptions&limit=1');
  });
  it('names the file by type and UTC date', () => {
    expect(exportCsvFilename('users', new Date('2026-07-12T00:00:00Z'))).toBe('users-20260712.csv');
    expect(exportCsvFilename('audit-logs', new Date('2026-01-02T00:00:00Z'))).toBe('audit-logs-20260102.csv');
  });
});

describe('downloadAdminCsv', () => {
  const csvResponse = () => new Response('\uFEFFuid\nu1\n', {
    status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' },
  });
  it('sends both admin credentials and triggers a download with the type+date filename', async () => {
    const fetcher = vi.fn().mockResolvedValue(csvResponse());
    const triggerDownload = vi.fn();
    const filename = await downloadAdminCsv('users', {
      fetcher: fetcher as unknown as typeof fetch,
      userToken: () => 'user-token',
      sessionToken: () => 'session-token',
      triggerDownload,
      date: new Date('2026-07-12T00:00:00Z'),
    });
    expect(filename).toBe('users-20260712.csv');
    const [path, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe(exportCsvPath('users'));
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer user-token');
    expect(headers['X-Admin-Session']).toBe('session-token');
    expect(init.credentials).toBe('include');
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const [blob, downloadedName] = triggerDownload.mock.calls[0] as unknown as [Blob, string];
    expect(downloadedName).toBe('users-20260712.csv');
    expect(await blob.text()).toContain('uid');
  });
  it('refuses to run without an admin bearer token', async () => {
    await expect(downloadAdminCsv('users', {
      fetcher: vi.fn(), userToken: () => null, sessionToken: () => 's', triggerDownload: vi.fn(),
    })).rejects.toThrow('后台会话凭证不可用');
  });
  it('surfaces server rejection messages instead of saving an error page', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: false, message: 'type 必须为 users、credit-ledger、redemptions 或 audit-logs' }, { status: 400 }));
    await expect(downloadAdminCsv('users', {
      fetcher: fetcher as unknown as typeof fetch, userToken: () => 't', sessionToken: () => 's', triggerDownload: vi.fn(),
    })).rejects.toThrow('type 必须为');
  });
  it('refuses non-CSV payloads (e.g. an HTML login page)', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<html>login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await expect(downloadAdminCsv('users', {
      fetcher: fetcher as unknown as typeof fetch, userToken: () => 't', sessionToken: () => 's', triggerDownload: vi.fn(),
    })).rejects.toThrow('未返回 CSV');
  });
});

describe('CsvExportButton rendering', () => {
  it('renders a normal download button with the type marker', () => {
    const html = renderToStaticMarkup(React.createElement(CsvExportButton, { type: 'users', label: '导出用户 CSV' }));
    expect(html).toContain('导出用户 CSV');
    expect(html).toContain('data-csv-export="users"');
    expect(html).toContain('data-csv-export-button');
  });
});
