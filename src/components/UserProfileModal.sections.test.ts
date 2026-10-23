import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { splitProfilePatternSections } from './UserProfileModal';
import type { ExportedPatternRecord } from '../utils/patternHistory';

function record(id: string, status: 0 | 1 | 2 | undefined, userId: string | null = 'user-1'): ExportedPatternRecord {
  return {
    id,
    userId,
    title: id,
    width: 29,
    height: 29,
    totalBeads: 1,
    createdAt: 1,
    updatedAt: 1,
    syncState: 'synced',
    hasLocalCopy: true,
    hasCloudCopy: true,
    status,
  };
}

describe('UserProfileModal pattern sections', () => {
  it('keeps published works in the library while omitting deleted and other-account records', () => {
    const sections = splitProfilePatternSections([
      record('private', 0),
      record('published', 1),
      { ...record('cloud-only-published', 1), hasLocalCopy: false },
      { ...record('local-only', 0), hasCloudCopy: false },
      { ...record('unbound-local', undefined, null), hasCloudCopy: false },
      record('another-user-private', 0, 'user-2'),
      record('another-user-published', 1, 'user-2'),
      record('deleted', 2),
      record('deleted-unbound', 2, null),
      record('legacy-private', undefined),
    ], 'user-1');

    expect(sections.libraryRecords.map((item) => item.id)).toEqual([
      'private', 'published', 'cloud-only-published', 'local-only', 'unbound-local', 'legacy-private',
    ]);
    expect(sections.publishedRecords.map((item) => item.id)).toEqual(['published', 'cloud-only-published']);
    expect(sections.publishedRecords.every((item) => sections.libraryRecords.includes(item))).toBe(true);
  });

  it('keeps an engineering record in the library when it becomes published', () => {
    const saved = record('publish-without-moving', 0);
    const before = splitProfilePatternSections([saved], 'user-1');
    const after = splitProfilePatternSections([{ ...saved, status: 1 }], 'user-1');

    expect(before.libraryRecords.map((item) => item.id)).toEqual(['publish-without-moving']);
    expect(before.publishedRecords).toEqual([]);
    expect(after.libraryRecords.map((item) => item.id)).toEqual(['publish-without-moving']);
    expect(after.publishedRecords.map((item) => item.id)).toEqual(['publish-without-moving']);
  });

  it('shows unbound local records but no account works when signed out', () => {
    const sections = splitProfilePatternSections([
      record('unbound-local', 0, null),
      record('deleted-local', 2, null),
      record('account-private', 0),
      record('account-published', 1),
    ], null);

    expect(sections.libraryRecords.map((item) => item.id)).toEqual(['unbound-local']);
    expect(sections.publishedRecords).toEqual([]);
  });

  it('renders the Works, Likes, and My Library tabs in that order', () => {
    const source = readFileSync(new URL('./UserProfileModal.tsx', import.meta.url), 'utf8');
    const works = source.indexOf('<span>作品</span>');
    const likes = source.indexOf('<span>喜欢</span>');
    const library = source.indexOf('<span>我的图库</span>');

    expect(works).toBeGreaterThan(-1);
    expect(works).toBeLessThan(likes);
    expect(likes).toBeLessThan(library);
    expect(source).toContain('activePatternRecords.map(record =>');
    expect(source).toContain("activeTab === 'works' ? publishedRecords : libraryRecords");
    expect(source).toContain('我的图库 · 全部工程');
    expect(source).not.toContain('我的图库 · 私有工程');
    expect(source).not.toContain('私有图库');
  });
});
