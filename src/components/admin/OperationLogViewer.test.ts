import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminRequest } from './adminRequest';
import {
  OperationLogViewer,
  emptyOperationLogQuery,
  operationLogDiff,
  operationLogQuery,
} from './OperationLogViewer';

const okRequest: AdminRequest = async <T,>() => ({
  ok: true,
  status: 200,
  data: {
    items: [{
      id: 'log1',
      actorUid: 'admin',
      action: 'announcement.upsert',
      targetType: 'announcement',
      targetId: 'ann_1',
      before: { title: '旧标题' },
      after: { title: '新标题' },
      beforeJson: '{"title":"旧标题"}',
      afterJson: '{"title":"新标题"}',
      note: '更新公告',
      createdAt: 1700000000000,
    }],
    total: 1,
    limit: 30,
    offset: 0,
  } as unknown as T,
});

describe('OperationLogViewer', () => {
  it('serializes bounded query strings without empty filters', () => {
    expect(operationLogQuery(emptyOperationLogQuery())).toBe('?limit=30&offset=0');
    expect(operationLogQuery({ actor: ' admin ', action: 'roles.create', from: '2025-01-01', to: 'not-a-date', limit: 10, offset: 20 }))
      .toBe('?actor=admin&action=roles.create&from=2025-01-01&limit=10&offset=20');
  });

  it('renders field-level before/after diffs', () => {
    const diff = operationLogDiff({ before: { title: '旧标题', note: null }, after: { title: '新标题', note: null } });
    expect(diff).toHaveLength(2);
    const title = diff.find(row => row.field === 'title')!;
    expect(title.before).toBe('旧标题');
    expect(title.after).toBe('新标题');
    expect(diff.find(row => row.field === 'note')!.before).toBe('（未变）');
    // 非对象快照退化为单行「值」对比（例如删除操作的 after=null）。
    const scalar = operationLogDiff({ before: 'old', after: null });
    expect(scalar).toEqual([{ field: '值', before: 'old', after: '∅' }]);
  });

  it('renders the audit table with the action badge and expandable diff', async () => {
    const html = renderToStaticMarkup(React.createElement(OperationLogViewer, {
      request: okRequest,
      initialItems: [{
        id: 'log1', actorUid: 'admin', action: 'announcement.upsert', targetType: 'announcement', targetId: 'ann_1',
        before: { title: '旧标题' }, after: { title: '新标题' },
        beforeJson: '{"title":"旧标题"}', afterJson: '{"title":"新标题"}', note: '更新公告', createdAt: 1700000000000,
      }],
    }));
    expect(html).toContain('管理操作审计');
    expect(html).toContain('announcement.upsert');
    expect(html).toContain('展开前后对比');
    expect(html).toContain('更新公告');
    expect(html).toContain('admin');
  });
});
