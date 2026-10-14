import { describe, expect, it, vi } from 'vitest';
import { createAnnouncementStore, getAnnouncementStore } from './announcementStore';

const item = (id: string, expireAt: number | null = null) => ({ id, title: `公告 ${id}`, content: '<script>alert(1)</script>', pinned: false, publishAt: 1000, expireAt });
const current = (items = [item('one'), item('two')]) => new Response(JSON.stringify({ success: true, data: { announcements: items } }));
const history = (items = [item('one')], nextCursor: string | null = null) => new Response(JSON.stringify({ success: true, data: { announcements: items, pagination: { limit: 10, hasMore: !!nextCursor, nextCursor } } }));
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

describe('announcement document visit gate', () => {
  it('opens once on a nonempty current success, without cascading, even after retry/remount or read persistence', async () => {
    const storage = { getItem: () => '[]', setItem: vi.fn() } as unknown as Storage;
    const store = createAnnouncementStore({ fetcher: vi.fn(async () => current()), storage });
    const release = store.mount();
    await store.loadCurrent();
    expect(store.getSnapshot().open).toBe(true);
    expect(store.getSnapshot().selected?.id).toBe('one');
    store.close();
    await store.loadCurrent();
    expect(store.getSnapshot().open).toBe(false);
    release(); const again = store.mount();
    await store.loadCurrent();
    expect(store.getSnapshot().open).toBe(false);
    expect(storage.setItem).toHaveBeenCalled();
    again();
  });

  it('does not consume the gate on errors, empty current data or future/expired rows', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(current([])).mockResolvedValueOnce(current([item('expired', 1)])).mockResolvedValueOnce(current([{ ...item('future'), publishAt: Date.now() + 100_000 }])).mockResolvedValueOnce(current());
    const store = createAnnouncementStore({ fetcher, storage: null });
    for (let i = 0; i < 4; i++) { await store.loadCurrent(); expect(store.getSnapshot().open).toBe(false); }
    await store.loadCurrent(); expect(store.getSnapshot().open).toBe(true);
  });

  it('manual opening before current success updates the same window and prevents later automatic reopening', async () => {
    const pending = deferred<Response>();
    const store = createAnnouncementStore({ fetcher: vi.fn(url => String(url).includes('/history') ? Promise.resolve(history()) : pending.promise), storage: null });
    const load = store.loadCurrent();
    await store.openHistory();
    pending.resolve(current()); await load;
    expect(store.getSnapshot().view).toBe('history');
    store.close(); await store.loadCurrent();
    expect(store.getSnapshot().open).toBe(false);
  });

  it('shares gate for the same document (including identity changes) but a refreshed document auto-opens again despite persisted reads', async () => {
    let saved = '[]'; const storage: Storage = { length: 1, clear: () => { saved = '[]'; }, key: () => 'read', removeItem: () => { saved = '[]'; }, getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
    const options = { fetcher: vi.fn(async () => current()), storage };
    const doc = {} as Document;
    const first = getAnnouncementStore(doc, options); await first.loadCurrent(); first.close();
    expect(getAnnouncementStore(doc, options)).toBe(first);
    await getAnnouncementStore(doc, options).loadCurrent(); expect(first.getSnapshot().open).toBe(false);
    const refreshed = getAnnouncementStore({} as Document, options); await refreshed.loadCurrent();
    expect(refreshed.getSnapshot().open).toBe(true);
  });

  it('ignores aborted/stale StrictMode requests and writes nothing after the last unmount', async () => {
    const old = deferred<Response>(), latest = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const store = createAnnouncementStore({ fetcher, storage: null });
    const release = store.mount(); release(); const releaseAgain = store.mount();
    latest.resolve(current([item('fresh')])); await vi.waitFor(() => expect(store.getSnapshot().selected?.id).toBe('fresh'));
    old.resolve(current([item('stale')])); await Promise.resolve(); await Promise.resolve();
    expect(store.getSnapshot().selected?.id).toBe('fresh');
    releaseAgain(); expect(store.getSnapshot().open).toBe(false);
  });
});

describe('real public history loading', () => {
  it('loads more than three including expired rows; reads do not remove historical items', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(history([item('1'), item('2'), item('3'), item('4', 1)], 'next')).mockResolvedValueOnce(history([item('5')]));
    const store = createAnnouncementStore({ fetcher, storage: null });
    await store.openHistory(); store.openDetail(store.getSnapshot().history[3]);
    expect(store.getSnapshot().selected?.expireAt).toBe(1);
    await store.backToHistory(); await store.loadMore();
    expect(store.getSnapshot().history).toHaveLength(5);
    expect(String(fetcher.mock.calls[1][0])).toContain('cursor=next');
    expect(fetcher.mock.calls.every(call => !String(call[0]).includes('/admin/'))).toBe(true);
  });

  it('retains loaded history on next-page failure and retries the same cursor without duplicate rows', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(history([item('1')], 'next')).mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(history([item('1'), item('2')]));
    const store = createAnnouncementStore({ fetcher, storage: null });
    await store.openHistory(); await store.loadMore();
    expect(store.getSnapshot().historyState).toBe('error'); expect(store.getSnapshot().history).toHaveLength(1);
    await store.retryHistory();
    expect(String(fetcher.mock.calls[2][0])).toContain('cursor=next');
    expect(store.getSnapshot().history.map(row => row.id)).toEqual(['1', '2']);
  });

  it('rejects unsuccessful/malformed history envelopes rather than reporting successful empty history', async () => {
    const store = createAnnouncementStore({ fetcher: vi.fn(async () => new Response(JSON.stringify({ success: false }))), storage: null });
    await store.openHistory(); expect(store.getSnapshot().historyState).toBe('error');
  });
});
