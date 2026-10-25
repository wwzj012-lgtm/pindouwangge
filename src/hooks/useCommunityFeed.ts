import { useMemo, useSyncExternalStore } from 'react';
import { getApiSessionGeneration } from '../utils/api';
import { createCommunityFeedStore } from '../utils/communityFeedStore';

/** Account changes replace the snapshot synchronously, never after a paint. */
export function useCommunityFeed(accountKey: string | null) {
  const sessionGeneration = getApiSessionGeneration();
  const store = useMemo(() => createCommunityFeedStore(), [accountKey, sessionGeneration]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...state, refresh: store.refresh, loadMore: store.loadMore, updatePost: store.updatePost };
}
