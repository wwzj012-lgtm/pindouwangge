export interface ContentReadTicket { scope: string; startedAt: number; }

/** Collection-level recovery barrier. Never cleared by opening/closing an editor. */
export class AdminWriteRecovery {
  private clock = 0;
  private revision = 0;
  private uncertain = new Map<string, number>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  private changed() { this.revision++; for (const listener of this.listeners) listener(); }
  isUncertain = (path: string) => this.uncertain.has(contentScope(path));
  markUncertain(path: string) { this.uncertain.set(contentScope(path), ++this.clock); this.changed(); }
  beginRead = (path: string): ContentReadTicket => ({ scope: contentScope(path), startedAt: ++this.clock });
  readSucceeded = (ticket: ContentReadTicket) => {
    const uncertainAt = this.uncertain.get(ticket.scope);
    // A response to a read already in flight when the write failed is not reconciliation.
    if (uncertainAt !== undefined && ticket.startedAt > uncertainAt) { this.uncertain.delete(ticket.scope); this.changed(); }
  };
}

export function contentScope(path: string): string {
  const pathname = path.split('?')[0];
  return pathname === '/api/admin/announcements/publish' ? '/api/admin/announcements' : pathname;
}

// In-memory only, isolated by operator. Survives module/editor remounts, not a new login identity.
const operatorRecoveries = new Map<string, AdminWriteRecovery>();
export function contentRecoveryFor(operatorUid: string): AdminWriteRecovery {
  let recovery = operatorRecoveries.get(operatorUid);
  if (!recovery) { recovery = new AdminWriteRecovery(); operatorRecoveries.set(operatorUid, recovery); }
  return recovery;
}
