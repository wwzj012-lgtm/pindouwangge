import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminRequest } from './adminRequest';
import { SessionManagerPanel, canForceLogout, sessionLabel, type AdminSessionItem } from './SessionManagerPanel';

const session = (adminUid: string, sessionId: string): AdminSessionItem => ({
  sessionId, adminUid, adminName: adminUid === 'admin' ? '管理员' : null, adminEmail: `${adminUid}@example.test`,
  ipHash: 'a'.repeat(64), userAgent: null, createdAt: 1700000000000, lastSeenAt: 1700000001000, expiresAt: 1700096400000,
});

const okRequest: AdminRequest = async <T,>() => ({
  ok: true,
  status: 200,
  data: { items: [session('admin', 'adm_self'), session('other', 'adm_other')], generatedAt: 1700000002000 } as unknown as T,
});

describe('SessionManagerPanel', () => {
  it('refuses to force-logout the operator own session and labels sessions', () => {
    const self = session('admin', 'adm_self');
    const other = session('other', 'adm_other');
    expect(canForceLogout(self, 'admin')).toBe(false);
    expect(canForceLogout(other, 'admin')).toBe(true);
    expect(sessionLabel(other)).toBe('other@example.test');
  });

  it('renders the session table; own session shows a badge instead of a kick button', () => {
    const html = renderToStaticMarkup(React.createElement(SessionManagerPanel, {
      request: okRequest,
      operatorUid: 'admin',
      initialSessions: [session('admin', 'adm_self'), session('other', 'adm_other')],
    }));
    expect(html).toContain('后台会话');
    expect(html).toContain('adm_other');
    expect(html).toContain('强制下线');
    expect(html).toContain('当前会话');
    // 自身会话行不渲染强制下线按钮（canForceLogout=false 走徽章分支）。
    expect(html).not.toContain('data-force-logout="adm_self"');
    expect(html).toContain('data-force-logout="adm_other"');
  });
});
