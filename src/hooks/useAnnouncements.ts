import { useEffect, useSyncExternalStore } from 'react';
import { announcementReadKey, getAnnouncementStore } from '../utils/announcementStore';

export function useAnnouncements() {
  const store = getAnnouncementStore(document);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(store.mount, [store]);
  const hasUnread = [...state.current, ...state.history].some(item => !state.readIds.has(announcementReadKey(item)));
  return { store, state, hasUnread };
}
