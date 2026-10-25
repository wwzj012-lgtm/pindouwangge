type Listener = () => void;
const listeners = new Set<Listener>();

/** In-memory invalidation only: no user data or credentials cross this boundary. */
export function subscribeCommunityFeedInvalidation(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function invalidateCommunityFeed(): void {
  for (const listener of listeners) {
    // A subscriber must never turn a confirmed server mutation into a failure.
    try { listener(); } catch { /* The next mount/manual refresh revalidates. */ }
  }
}
