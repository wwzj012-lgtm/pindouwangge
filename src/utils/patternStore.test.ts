import { describe, expect, it } from 'vitest';
import {
  fetchAllCloudPatternPages,
  mapWithConcurrency,
  mergeRenamedPatternSummary,
  mergePatternRecordSummaries,
  normalizePatternTitle,
  patternDeletionActions,
  requiresExplicitCloudBinding,
  sameGrid,
  samePalette,
  type PatternRecordSummary,
} from './patternStore';

function summary(overrides: Partial<PatternRecordSummary>): PatternRecordSummary {
  return {
    id: 'work-1',
    userId: 'user-1',
    title: 'Pattern',
    width: 29,
    height: 29,
    totalBeads: 1,
    createdAt: 1,
    updatedAt: 1,
    syncState: 'pending',
    hasLocalCopy: true,
    hasCloudCopy: false,
    ...overrides,
  };
}

describe('pattern history list merging', () => {
  it('deduplicates matching local and cloud work ids', () => {
    const merged = mergePatternRecordSummaries([
      summary({ updatedAt: 10, syncState: 'failed', syncError: 'offline', hasLocalCopy: true }),
      summary({ updatedAt: 9, syncState: 'synced', hasCloudCopy: true }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'work-1',
      syncState: 'failed',
      hasLocalCopy: true,
      hasCloudCopy: true,
    });
  });

  it('keeps the newest record first', () => {
    const merged = mergePatternRecordSummaries([
      summary({ id: 'older', updatedAt: 1 }),
      summary({ id: 'newer', updatedAt: 2 }),
    ]);
    expect(merged.map((record) => record.id)).toEqual(['newer', 'older']);
  });

  it('uses the id as a deterministic tie-breaker for equal update times', () => {
    const merged = mergePatternRecordSummaries([
      summary({ id: 'zulu', updatedAt: 2 }),
      summary({ id: 'alpha', updatedAt: 2 }),
    ]);
    expect(merged.map((record) => record.id)).toEqual(['alpha', 'zulu']);
  });

  it('keeps both local and cloud availability when cloud metadata is newer', () => {
    const merged = mergePatternRecordSummaries([
      summary({ updatedAt: 1, hasLocalCopy: true, hasCloudCopy: false }),
      summary({ updatedAt: 2, hasLocalCopy: false, hasCloudCopy: true, syncState: 'synced' }),
    ]);
    expect(merged[0]).toMatchObject({ hasLocalCopy: true, hasCloudCopy: true, syncState: 'synced' });
  });

  it('retains the published work status and treats records without a status as private', () => {
    const published = mergePatternRecordSummaries([
      summary({ updatedAt: 1, status: 0 }),
      summary({ updatedAt: 2, status: 1, hasCloudCopy: true }),
    ]);
    expect(published[0]?.status).toBe(1);

    const legacy = mergePatternRecordSummaries([summary({ status: undefined })]);
    expect(legacy[0]?.status ?? 0).toBe(0);
  });

  it('uses the cloud title after a successful rename, but preserves a pending local title', () => {
    const synced = mergePatternRecordSummaries([
      summary({ title: 'Old local', updatedAt: 1, syncState: 'synced', hasLocalCopy: true }),
      summary({ title: 'Renamed cloud', updatedAt: 2, syncState: 'synced', hasLocalCopy: false, hasCloudCopy: true }),
    ]);
    expect(synced[0]?.title).toBe('Renamed cloud');

    const pending = mergePatternRecordSummaries([
      summary({ title: 'Unsynced local', updatedAt: 3, syncState: 'pending', hasLocalCopy: true }),
      summary({ title: 'Cloud title', updatedAt: 2, syncState: 'synced', hasLocalCopy: false, hasCloudCopy: true }),
    ]);
    expect(pending[0]?.title).toBe('Unsynced local');
  });

  it('validates and trims rename titles before any local or cloud update', () => {
    expect(normalizePatternTitle('  New name  ')).toBe('New name');
    expect(() => normalizePatternTitle('   ')).toThrow(/1 and 200/);
    expect(() => normalizePatternTitle('x'.repeat(201))).toThrow(/1 and 200/);
    expect(() => normalizePatternTitle(null)).toThrow(/text/);
  });

  it('merges cloud rename metadata without manufacturing dimensions for cloud-only cards', () => {
    const record = summary({
      id: 'cloud-only',
      userId: 'user-1',
      title: 'Before',
      width: 900,
      height: 300,
      totalBeads: 123,
      cloudRevision: 7,
      hasLocalCopy: false,
      hasCloudCopy: true,
      hasPreview: true,
      previewRevision: 7,
    });
    const merged = mergeRenamedPatternSummary(record, { id: 'cloud-only', title: 'After', updatedAt: 20 });
    expect(merged).toMatchObject({
      id: 'cloud-only',
      title: 'After',
      width: 900,
      height: 300,
      totalBeads: 123,
      cloudRevision: 7,
      hasPreview: true,
      previewRevision: 7,
      hasLocalCopy: false,
      hasCloudCopy: true,
    });
  });

  it('keeps anonymous local records unbound until explicit account sync', () => {
    const record = summary({ userId: null, hasCloudCopy: false, syncState: 'local-only' });
    expect(requiresExplicitCloudBinding(record, 'user-1')).toBe(true);
    expect(requiresExplicitCloudBinding(record, null)).toBe(false);
    expect(patternDeletionActions(record)).toEqual(['local']);
  });

  it('exposes separate deletion actions for records that exist in both stores', () => {
    expect(patternDeletionActions(summary({ hasLocalCopy: true, hasCloudCopy: true })))
      .toEqual(['local', 'cloud-and-local']);
    expect(patternDeletionActions(summary({ hasLocalCopy: false, hasCloudCopy: true })))
      .toEqual(['cloud-and-local']);
  });

  it('limits concurrent cloud chunk reads while preserving descriptor order', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency([0, 1, 2, 3, 4, 5, 6], 3, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value === 0 ? 5 : 1));
      active -= 1;
      return value * 2;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(result).toEqual([0, 2, 4, 6, 8, 10, 12]);
  });

  it('fetches owner gallery pages past the first page and preserves every record', async () => {
    const offsets: number[] = [];
    const records = await fetchAllCloudPatternPages(async (offset, limit) => {
      offsets.push(offset);
      expect(limit).toBe(20);
      if (offset === 0) return Array.from({ length: 20 }, (_, index) => ({ id: `work-${index}` }));
      if (offset === 20) return Array.from({ length: 3 }, (_, index) => ({ id: `work-${20 + index}` }));
      return [];
    });

    expect(offsets).toEqual([0, 20]);
    expect(records?.map((record) => record.id)).toEqual(Array.from({ length: 23 }, (_, index) => `work-${index}`));
  });

  it('stops on an empty page and returns null for a failed or non-progressing page', async () => {
    let calls = 0;
    const emptyAfterFullPage = await fetchAllCloudPatternPages(async (offset) => {
      calls += 1;
      return offset === 0 ? Array.from({ length: 20 }, (_, index) => ({ id: `work-${index}` })) : [];
    });
    expect(emptyAfterFullPage).toHaveLength(20);
    expect(calls).toBe(2);

    calls = 0;
    const failed = await fetchAllCloudPatternPages(async (offset) => {
      calls += 1;
      if (offset === 0) return Array.from({ length: 20 }, (_, index) => ({ id: `work-${index}` }));
      throw new Error('network');
    });
    expect(failed).toBeNull();
    expect(calls).toBe(2);

    calls = 0;
    const repeatedPage = Array.from({ length: 20 }, (_, index) => ({ id: `work-${index}` }));
    const nonProgressing = await fetchAllCloudPatternPages(async () => {
      calls += 1;
      return repeatedPage;
    });
    expect(nonProgressing).toBeNull();
    expect(calls).toBe(2);
  });
});

/**
 * 保存提速的前提（2026-11-25）：网格没变时复用已有缩略图，不再花 ~340ms
 * 重渲染。这个判据必须严格——漏判会让缩略图长期显示旧图。
 */
describe('sameGrid（缩略图复用判据）', () => {
  it('逐格相同 → true', () => {
    expect(sameGrid([['A1', 'H2'], [null, 'C3']], [['A1', 'H2'], [null, 'C3']])).toBe(true);
  });

  it('任一格不同 → false', () => {
    expect(sameGrid([['A1', 'H2']], [['A1', 'H3']])).toBe(false);
  });

  it('空与非空、行列数不同 → false', () => {
    expect(sameGrid([[]], [['A1']])).toBe(false);
    expect(sameGrid([['A1']], [['A1'], ['A1']])).toBe(false);
    expect(sameGrid(undefined, [['A1']])).toBe(false);
  });
});

describe('samePalette（缩略图复用判据之配色）', () => {
  const color = (code: string, rgb: [number, number, number]) => ({ code, name: code, hex: '#000000', rgb } as never);

  it('码与 RGB 全同 → true', () => {
    expect(samePalette([color('A1', [1, 2, 3])], [color('A1', [1, 2, 3])])).toBe(true);
  });

  it('同码不同 RGB（换品牌/改色板）→ false', () => {
    expect(samePalette([color('A1', [1, 2, 3])], [color('A1', [1, 2, 4])])).toBe(false);
  });

  it('数量或顺序不同 → false', () => {
    expect(samePalette([color('A1', [1, 2, 3])], [color('A1', [1, 2, 3]), color('B2', [4, 5, 6])])).toBe(false);
    expect(samePalette([color('A1', [1, 2, 3]), color('B2', [4, 5, 6])], [color('B2', [4, 5, 6]), color('A1', [1, 2, 3])])).toBe(false);
  });

  it('空/缺 → false（不许当作可复用）', () => {
    expect(samePalette(undefined, [color('A1', [1, 2, 3])])).toBe(false);
    expect(samePalette([], [])).toBe(true);
  });
});
