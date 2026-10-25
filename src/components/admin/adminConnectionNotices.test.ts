import { describe, expect, it } from 'vitest';
import { AdminConnectionNotices } from './adminConnectionNotices';

const lost = { ok: false, status: 0, error: '未收到写入响应' };
const receipt = (operationId: string) => ({ operationId, brandCode: 'TEST', version: 1, colorId: null, action: 'createBrand' });
const success = (data: unknown) => ({ ok: true, status: 200, data });
const mutation = (id: string) => ({ method: 'POST', body: JSON.stringify({ operationId: id, brandCode: 'TEST' }) });
describe('module connection notices remain separate from write recovery', () => {
  it('clears only the matching confirmed brand mutation and leaves other failed requests', () => {
    const notices = new AdminConnectionNotices();
    notices.settle(notices.begin('brands', '/api/admin/brands', mutation('first')), lost, 'operator');
    notices.settle(notices.begin('brands', '/api/admin/brands', mutation('second')), { ...lost, error: '另一笔未确认' }, 'operator');
    notices.settle(notices.begin('brands', '/api/admin/brands'), success({ items: [] }), 'operator');
    expect(notices.messages().brands).toContain('未收到写入响应');
    notices.settle(notices.begin('brands', '/api/admin/brands/mutations?id=first'), success(receipt('first')), 'operator');
    expect(notices.messages().brands).toBe('另一笔未确认');
    notices.settle(notices.begin('brands', '/api/admin/brands/mutations?id=second'), success(receipt('second')), 'operator');
    expect(notices.messages().brands).toBeUndefined();
  });
  it('keeps unknown failures for not-found, malformed and wrong-operation receipts', () => {
    const notices = new AdminConnectionNotices();
    notices.settle(notices.begin('brands', '/api/admin/brands', mutation('first')), lost, 'operator');
    for (const data of [{ status: 'not_found' }, {}, receipt('wrong')]) {
      notices.settle(notices.begin('brands', '/api/admin/brands/mutations?id=first'), success(data), 'operator');
      expect(notices.messages().brands).toBe('未收到写入响应');
    }
    notices.settle(notices.begin('brands', '/api/admin/brands', mutation('first')), success({}), 'operator');
    expect(notices.messages().brands).toBe('未收到写入响应');
  });
  it('matches failed read queries, keeps scopes separate and ignores obsolete failures', () => {
    const notices = new AdminConnectionNotices();
    const stale = notices.begin('brands', '/api/admin/brands');
    notices.settle(notices.begin('brands', '/api/admin/brands'), success({ items: [] }), 'operator');
    notices.settle(stale, lost, 'operator'); expect(notices.messages()).toEqual({});
    notices.settle(notices.begin('users', '/api/admin/users?search=a'), lost, 'operator');
    notices.settle(notices.begin('users', '/api/admin/users?search=b'), success({ items: [] }), 'operator');
    notices.settle(notices.begin('brands', '/api/admin/brands'), success({ items: [] }), 'operator');
    expect(notices.messages().users).toBe('未收到写入响应');
    notices.settle(notices.begin('users', '/api/admin/users?search=a'), success({ items: [] }), 'operator');
    expect(notices.messages()).toEqual({});
  });
  it('does not retain generic sensitive write bodies and cannot erase newer failures with old success', () => {
    const notices = new AdminConnectionNotices();
    const secret = notices.begin('users', '/api/admin/reset-password', { method: 'POST', body: '{"password":"private-secret"}' });
    expect(JSON.stringify(secret)).not.toContain('private-secret');
    const old = notices.begin('brands', '/api/admin/brands');
    notices.settle(notices.begin('brands', '/api/admin/brands'), lost, 'operator');
    notices.settle(old, success({ items: [] }), 'operator');
    expect(notices.messages().brands).toBe('未收到写入响应');
  });
});
