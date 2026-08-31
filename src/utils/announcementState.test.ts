import { describe, expect, it } from 'vitest';
import { nextUnreadAnnouncement, persistAnnouncementIds, readAnnouncementIds } from './announcementState';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => Array.from(data.keys())[index] ?? null,
    removeItem: key => data.delete(key),
    setItem: (key, value) => data.set(key, value),
  };
}

describe('announcement read state', () => {
  it('persists read ids and returns only the first unread announcement', () => {
    const storage = memoryStorage();
    const read = new Set(['a']);
    persistAnnouncementIds(read, storage);
    expect(readAnnouncementIds(storage)).toEqual(new Set(['a']));
    expect(nextUnreadAnnouncement([{ id: 'a' }, { id: 'b' }], readAnnouncementIds(storage))).toEqual({ id: 'b' });
  });
});

