import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminRequest } from './adminRequest';
import { RunLogsViewer, isActivityItem, runLogQuery, runLogSources } from './RunLogsViewer';

const okRequest: AdminRequest = async <T,>() => ({
  ok: true,
  status: 200,
  data: {
    type: 'activity',
    items: [{
      id: 'a1', actorUid: 'normal', eventType: 'community_post.published',
      entityType: 'community_post', entityId: 'post_1', metadata: {}, occurredAt: 1700000000000,
    }],
    total: 1,
    limit: 30,
    offset: 0,
  } as unknown as T,
});

describe('RunLogsViewer', () => {
  it('serializes the split-source query', () => {
    expect(runLogQuery('audit', 50, 10)).toBe('?type=audit&limit=50&offset=10');
    expect(runLogQuery('activity', 30, 0)).toBe('?type=activity&limit=30&offset=0');
  });

  it('discriminates activity rows from audit rows', () => {
    expect(isActivityItem({ id: '1', actorUid: null, eventType: 'x', entityType: null, entityId: null, metadata: {}, occurredAt: 1 })).toBe(true);
    expect(isActivityItem({ id: '2', operatorUid: null, operatorEmail: null, action: 'A', details: null, timestamp: 1 })).toBe(false);
    expect(runLogSources.map(source => source.id)).toEqual(['activity', 'audit']);
  });

  it('renders source tabs and the activity table', () => {
    const html = renderToStaticMarkup(React.createElement(RunLogsViewer, {
      request: okRequest,
      initialItems: [{ id: 'a1', actorUid: 'normal', eventType: 'community_post.published', entityType: 'community_post', entityId: 'post_1', metadata: {}, occurredAt: 1700000000000 }],
    }));
    expect(html).toContain('运行日志');
    expect(html).toContain('用户活动');
    expect(html).toContain('管理审计');
    expect(html).toContain('community_post.published');
    expect(html).toContain('normal');
  });
});
