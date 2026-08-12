import { describe, expect, it } from 'vitest';
import {
  mapWithConcurrency,
  mergeRenamedPatternSummary,
  mergePatternRecordSummaries,
  normalizePatternTitle,
  patternDeletionActions,
  requiresExplicitCloudBinding,
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

  it('keeps both local and cloud availability when cloud metadata is newer', () => {
    const merged = mergePatternRecordSummaries([
      summary({ updatedAt: 1, hasLocalCopy: true, hasCloudCopy: false }),
      summary({ updatedAt: 2, hasLocalCopy: false, hasCloudCopy: true, syncState: 'synced' }),
    ]);
    expect(merged[0]).toMatchObject({ hasLocalCopy: true, hasCloudCopy: true, syncState: 'synced' });
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
});
