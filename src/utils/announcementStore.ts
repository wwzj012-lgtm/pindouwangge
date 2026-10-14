import { persistAnnouncementIds, readAnnouncementIds } from './announcementState';

export interface PublicAnnouncementItem {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  publishAt: number;
  expireAt: number | null;
  actionLabel?: string;
  actionUrl?: string;
}

export interface AnnouncementSnapshot {
  current: PublicAnnouncementItem[];
  currentState: 'loading' | 'ready' | 'error';
  history: PublicAnnouncementItem[];
  historyState: 'idle' | 'loading' | 'ready' | 'error';
  historyError: string | null;
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
  open: boolean;
  view: 'history' | 'detail';
  selected: PublicAnnouncementItem | null;
  readIds: ReadonlySet<string>;
}

interface StoreOptions {
  fetcher?: typeof fetch;
  storage?: Storage | null;
}

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

// Keep exactly the existing content-sensitive FNV-1a key so prior read markers survive.
export function announcementReadKey(item: PublicAnnouncementItem): string {
  const text = `${item.publishAt}:${item.title}:${item.content}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${item.id}:fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function parseItems(data: Record<string, unknown>, historical: boolean): PublicAnnouncementItem[] {
  if (!Array.isArray(data.announcements)) throw new Error('Invalid announcement response');
  return data.announcements.slice(0, historical ? 20 : 3).flatMap(value => {
    const row = object(value);
    const id = typeof row?.id === 'string' ? row.id.trim().slice(0, 128) : '';
    const title = typeof row?.title === 'string' ? row.title.trim().slice(0, 120) : '';
    const content = typeof row?.content === 'string' ? row.content.trim().slice(0, 10_000) : '';
    const publishAt = typeof row?.publishAt === 'number' && Number.isSafeInteger(row.publishAt) ? row.publishAt : 0;
    const expiry = row?.expireAt;
    if (!id || !title || !content || publishAt <= 0 || publishAt > Date.now() || typeof row?.pinned !== 'boolean') return [];
    if (historical && expiry !== null && (typeof expiry !== 'number' || !Number.isSafeInteger(expiry))) throw new Error('Invalid history expiry');
    const expireAt = typeof expiry === 'number' && Number.isSafeInteger(expiry) ? expiry : null;
    if (!historical && expireAt !== null && expireAt <= Date.now()) return [];
    return [{ id, title, content, pinned: row.pinned, publishAt, expireAt,
      actionLabel: typeof row.actionLabel === 'string' ? row.actionLabel.trim().slice(0, 40) : undefined,
      actionUrl: typeof row.actionUrl === 'string' ? row.actionUrl.trim().slice(0, 500) : undefined,
    }];
  });
}

export function createAnnouncementStore(options: StoreOptions = {}) {
  const fetcher: typeof fetch = options.fetcher ?? ((input, init) => fetch(input, init));
  let state: AnnouncementSnapshot = {
    current: [], currentState: 'loading', history: [], historyState: 'idle', historyError: null,
    pagination: { limit: 10, hasMore: false, nextCursor: null },
    open: false, view: 'history', selected: null, readIds: readAnnouncementIds(options.storage),
  };
  const listeners = new Set<() => void>();
  let currentEpoch = 0, historyEpoch = 0, mounts = 0;
  let currentController: AbortController | undefined, historyController: AbortController | undefined;
  let autoOpened = false, manuallyOpened = false;
  let retryCursor: string | null = null;
  const update = (next: Partial<AnnouncementSnapshot>) => {
    state = { ...state, ...next };
    listeners.forEach(listener => listener());
  };
  const read = (item: PublicAnnouncementItem) => {
    const readIds = new Set(state.readIds);
    readIds.add(announcementReadKey(item));
    persistAnnouncementIds(readIds, options.storage);
    return readIds;
  };
  async function publicData(url: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    const response = await fetcher(url, { headers: { Accept: 'application/json' }, credentials: 'omit', signal });
    if (!response.ok) throw new Error('Announcement request failed');
    const envelope = object(await response.json());
    const data = object(envelope?.data);
    if (envelope?.success !== true || !data) throw new Error('Invalid announcement envelope');
    return data;
  }
  async function loadCurrent(): Promise<void> {
    currentController?.abort();
    const controller = currentController = new AbortController();
    const epoch = ++currentEpoch;
    update({ currentState: 'loading' });
    try {
      const items = parseItems(await publicData('/api/public/announcements', controller.signal), false);
      if (controller.signal.aborted || epoch !== currentEpoch) return;
      const next: Partial<AnnouncementSnapshot> = { current: items, currentState: 'ready' };
      if (items.length && !autoOpened) {
        autoOpened = true;
        if (!manuallyOpened && !state.open) Object.assign(next, { open: true, view: 'detail', selected: items[0], readIds: read(items[0]) });
      }
      update(next);
    } catch {
      if (!controller.signal.aborted && epoch === currentEpoch) update({ currentState: 'error' });
    }
  }
  async function loadHistory(cursor: string | null): Promise<void> {
    historyController?.abort();
    const controller = historyController = new AbortController();
    const epoch = ++historyEpoch;
    retryCursor = cursor;
    update({ historyState: 'loading', historyError: null });
    try {
      const query = new URLSearchParams({ limit: '10' });
      if (cursor) query.set('cursor', cursor);
      const data = await publicData(`/api/public/announcements/history?${query}`, controller.signal);
      const rows = parseItems(data, true);
      const page = object(data.pagination);
      if (!page || !Number.isSafeInteger(page.limit) || Number(page.limit) < 1 || Number(page.limit) > 20
        || typeof page.hasMore !== 'boolean' || (page.nextCursor !== null && typeof page.nextCursor !== 'string')
        || (page.hasMore && (!page.nextCursor || String(page.nextCursor).length > 512))) throw new Error('Invalid history pagination');
      if (controller.signal.aborted || epoch !== historyEpoch) return;
      const items = cursor ? [...state.history] : [];
      for (const item of rows) {
        const index = items.findIndex(existing => existing.id === item.id);
        if (index < 0) items.push(item); else items[index] = item;
      }
      update({ history: items, historyState: 'ready', historyError: null,
        pagination: { limit: Number(page.limit), hasMore: page.hasMore, nextCursor: page.nextCursor as string | null } });
    } catch {
      if (!controller.signal.aborted && epoch === historyEpoch) update({ historyState: 'error', historyError: '公告历史暂时无法加载，请稍后重试。已载入的公告仍可查看。' });
    }
  }
  function close() {
    historyController?.abort(); ++historyEpoch;
    update({ open: false, historyState: state.history.length ? 'ready' : 'idle', historyError: null });
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    mount: () => {
      if (++mounts === 1) void loadCurrent();
      let released = false;
      return () => {
        if (released) return; released = true;
        if (--mounts === 0) {
          currentController?.abort(); ++currentEpoch;
          close();
        }
      };
    },
    loadCurrent,
    openHistory: async () => {
      manuallyOpened = true;
      update({ open: true, view: 'history', selected: null });
      await loadHistory(null);
    },
    openDetail: (item: PublicAnnouncementItem) => update({ selected: item, view: 'detail', readIds: read(item) }),
    backToHistory: async () => {
      update({ view: 'history', selected: null });
      if (state.historyState === 'idle') await loadHistory(null);
    },
    loadMore: async () => { if (state.pagination.hasMore && state.historyState !== 'loading') await loadHistory(state.pagination.nextCursor); },
    retryHistory: () => loadHistory(retryCursor),
    close,
  };
}

export type AnnouncementStore = ReturnType<typeof createAnnouncementStore>;
const documentStores = new WeakMap<Document, AnnouncementStore>();

/** Document lifetime, not component/session/localStorage lifetime: refresh gets a new gate. */
export function getAnnouncementStore(document: Document, options?: StoreOptions): AnnouncementStore {
  let store = documentStores.get(document);
  if (!store) { store = createAnnouncementStore(options); documentStores.set(document, store); }
  return store;
}
