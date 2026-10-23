export function practiceTimerStorageKey(workKey: string, userId?: string | null): string {
  return `beadgrid_practice_timer_v1:${encodeURIComponent(JSON.stringify([userId ?? null, workKey]))}`;
}

interface TimerOptions {
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/** Accumulate monotonic timestamps, never interval ticks or time spent with the panel closed. */
export function createPracticeTimer(workKey: string, userId?: string | null, options: TimerOptions = {}) {
  const key = practiceTimerStorageKey(workKey, userId);
  const now = options.now ?? (() => performance.now());
  let storage: TimerOptions['storage'] = options.storage;
  if (storage === undefined) {
    try { storage = window.localStorage; } catch { storage = null; }
  }
  let elapsed = 0;
  let startedAt: number | null = null;
  let persistenceAvailable = Boolean(storage);
  try {
    const saved: unknown = JSON.parse(storage?.getItem(key) ?? 'null');
    if (saved && typeof saved === 'object' && 'elapsedMs' in saved
      && typeof saved.elapsedMs === 'number' && Number.isFinite(saved.elapsedMs) && saved.elapsedMs >= 0) {
      elapsed = saved.elapsedMs;
    }
  } catch { /* An unreadable saved timer starts paused at zero. */ }
  const getElapsedMs = () => elapsed + (startedAt === null ? 0 : Math.max(0, now() - startedAt));
  const checkpoint = () => {
    try {
      if (!storage) return false;
      storage.setItem(key, JSON.stringify({ elapsedMs: getElapsedMs() }));
      persistenceAvailable = true;
      return true;
    } catch {
      persistenceAvailable = false;
      return false;
    }
  };
  return {
    getElapsedMs,
    isRunning: () => startedAt !== null,
    canPersist: () => persistenceAvailable,
    checkpoint,
    start() {
      if (startedAt === null) startedAt = now();
    },
    pause() {
      elapsed = getElapsedMs();
      startedAt = null;
      checkpoint();
    },
    reset() {
      elapsed = 0;
      startedAt = null;
      checkpoint();
    },
  };
}

export function formatPracticeDuration(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}
