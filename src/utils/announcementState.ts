export const ANNOUNCEMENT_READ_KEY = 'beadgrid_read_announcements_v1';

export function readAnnouncementIds(storage?: Storage | null): Set<string> {
  try {
    const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    const raw = target?.getItem(ANNOUNCEMENT_READ_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).slice(-100)
      : []);
  } catch {
    return new Set<string>();
  }
}

export function persistAnnouncementIds(ids: Set<string>, storage?: Storage | null): void {
  try {
    const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    target?.setItem(ANNOUNCEMENT_READ_KEY, JSON.stringify(Array.from(ids).slice(-100)));
  } catch {
    // Storage is optional; in-memory state still prevents duplicate prompts.
  }
}

export function nextUnreadAnnouncement<T extends { id: string }>(items: readonly T[], readIds: ReadonlySet<string>): T | null {
  return items.find(item => !readIds.has(item.id)) ?? null;
}

