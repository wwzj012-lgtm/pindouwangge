import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { splitProfilePatternSections } from './UserProfileModal';
import type { ExportedPatternRecord } from '../utils/patternHistory';

function record(id: string, status: 0 | 1 | 2 | undefined, userId = 'user-1'): ExportedPatternRecord {
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
  it('keeps published works and private library records disjoint while omitting deleted records', () => {
    const sections = splitProfilePatternSections([
      record('private', 0),
      record('published', 1),
      record('another-user-published', 1, 'user-2'),
      record('deleted', 2),
      record('legacy-private', undefined),
    ], 'user-1');

    expect(sections.privateRecords.map((item) => item.id)).toEqual(['private', 'legacy-private']);
    expect(sections.publishedRecords.map((item) => item.id)).toEqual(['published']);
    const visibleIds = [...sections.privateRecords, ...sections.publishedRecords].map((item) => item.id);
    expect(visibleIds).not.toContain('deleted');
    expect(visibleIds).not.toContain('another-user-published');
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
  });
});
