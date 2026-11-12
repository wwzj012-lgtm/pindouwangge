import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminRequest } from './adminRequest';
import { CronRunsPanel, cronDetailsText, cronTaskLabels, durationText, statusTone } from './CronRunsPanel';

const okRequest: AdminRequest = async <T,>() => ({
  ok: true,
  status: 200,
  data: {
    items: [{
      id: 'run1', taskName: 'specs_backfill', runDate: '2025-06-01', status: 'success',
      durationMs: 1234, details: { processed: 5 }, createdAt: 1700000000000,
    }],
    total: 1, limit: 50, offset: 0,
  } as unknown as T,
});

describe('CronRunsPanel', () => {
  it('formats status tones, durations and details', () => {
    expect(statusTone('success')).toBe('success');
    expect(statusTone('partial')).toBe('warning');
    expect(statusTone('failed')).toBe('danger');
    expect(statusTone('other')).toBe('neutral');
    expect(durationText(1234)).toBe('1234 ms');
    expect(durationText(null)).toBe('—');
    expect(cronDetailsText({ processed: 5, skipped: null })).toBe('processed: 5');
    expect(cronDetailsText({})).toBe('—');
    expect(cronTaskLabels.specs_backfill).toBe('社区帖子 specs 回填');
  });

  it('renders the run table with task labels and status badges', () => {
    const html = renderToStaticMarkup(React.createElement(CronRunsPanel, {
      request: okRequest,
      initialRuns: [{
        id: 'run1', taskName: 'specs_backfill', runDate: '2025-06-01', status: 'success',
        durationMs: 1234, details: { processed: 5 }, createdAt: 1700000000000,
      }],
    }));
    expect(html).toContain('定时任务执行记录');
    expect(html).toContain('社区帖子 specs 回填');
    expect(html).toContain('2025-06-01');
    expect(html).toContain('success');
    expect(html).toContain('1234 ms');
  });
});
