import { captureApiSessionGuard } from './api';
import { listCommunityPosts, type CommunityPost } from './communityApi';
import { subscribeCommunityFeedInvalidation } from './communityFeedEvents';

export interface CommunityFeedState {
  posts: CommunityPost[];
  nextCursor: string | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
}

/** One account-scoped feed, with no persisted cache and no parallel page requests. */
export function createCommunityFeedStore() {
  const isSessionCurrent = captureApiSessionGuard();
  let state: CommunityFeedState = { posts: [], nextCursor: null, isLoading: true, isLoadingMore: false, error: null };
  const listeners = new Set<() => void>();
  let unsubscribeInvalidation: (() => void) | undefined;
  let version = 0;
  let pendingRefresh = false;
  let scheduled = false;
  let running: Promise<void> | null = null;
  let loadingCursor: string | undefined;

  const emit = (patch: Partial<CommunityFeedState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  const run = (initialCursor?: string): Promise<void> => {
    if (running) return running;
    loadingCursor = initialCursor;
    running = Promise.resolve().then(async () => {
      let cursor = initialCursor;
      do {
        if (!isSessionCurrent()) return;
        if (pendingRefresh) { cursor = undefined; pendingRefresh = false; }
        loadingCursor = cursor;
        const requestVersion = version;
        emit({ isLoading: !cursor, isLoadingMore: Boolean(cursor), error: null });
        try {
          const result = await listCommunityPosts(cursor);
          if (isSessionCurrent() && requestVersion === version) {
            if (result.ok && result.data) {
              const posts = cursor ? [...state.posts, ...result.data.posts] : result.data.posts;
              // A post may move between pages while publication changes the order.
              emit({ posts: [...new Map(posts.map((post) => [post.id, post])).values()], nextCursor: result.data.nextCursor });
            } else {
              emit({ error: result.error ?? '社区作品暂时无法加载，请重试' });
            }
          }
        } catch {
          if (isSessionCurrent() && requestVersion === version) emit({ error: '社区作品暂时无法加载，请重试' });
        }
        cursor = undefined;
      } while (pendingRefresh && listeners.size > 0 && isSessionCurrent());
    }).finally(() => {
      running = null;
      loadingCursor = undefined;
      // Invalidation can arrive after the loop exits but before this finalizer.
      // Drain that pending work, and keep refresh() awaiting the trailing GET.
      if (pendingRefresh && listeners.size > 0 && isSessionCurrent()) return run();
      if (isSessionCurrent()) emit({ isLoading: false, isLoadingMore: false });
    });
    return running;
  };

  const scheduleRefresh = () => {
    // Obsolete both first-page and pagination responses immediately, before
    // coalescing a burst of confirmed mutations into one microtask.
    version++;
    pendingRefresh = true;
    if (scheduled || running) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (listeners.size > 0 && isSessionCurrent()) void run();
    });
  };

  const refresh = (): Promise<void> => {
    if (!isSessionCurrent()) return Promise.resolve();
    if (running) {
      if (loadingCursor) { version++; pendingRefresh = true; }
      return running;
    }
    pendingRefresh = true;
    return run();
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        unsubscribeInvalidation = subscribeCommunityFeedInvalidation(scheduleRefresh);
        scheduleRefresh();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribeInvalidation?.();
          unsubscribeInvalidation = undefined;
          version++;
          pendingRefresh = false;
        }
      };
    },
    refresh,
    loadMore: (): Promise<void> => {
      if (!isSessionCurrent() || !state.nextCursor) return Promise.resolve();
      if (running) return running;
      return run(state.nextCursor);
    },
    updatePost: (id: string, updater: (post: CommunityPost) => CommunityPost): void => {
      if (!isSessionCurrent()) return;
      // A GET started before a confirmed reaction must not revert its counts.
      if (running) { version++; pendingRefresh = true; }
      emit({ posts: state.posts.map((post) => post.id === id ? updater(post) : post) });
    },
  };
}
