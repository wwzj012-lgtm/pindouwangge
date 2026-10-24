import { describe, expect, it } from 'vitest';
import { AdminWriteRecovery, contentRecoveryFor, contentScope } from './adminWriteRecovery';

describe('uncertain content write reconciliation', () => {
  const assets = '/api/admin/storage-assets', moderation = '/api/admin/content-moderation';
  it('requires a read that started after uncertainty, not an already in-flight read', () => {
    const recovery = new AdminWriteRecovery();
    const oldRead = recovery.beginRead(assets);
    recovery.markUncertain(assets);
    recovery.readSucceeded(oldRead);
    expect(recovery.isUncertain(assets)).toBe(true);
    recovery.readSucceeded(recovery.beginRead(assets));
    expect(recovery.isUncertain(assets)).toBe(false);
  });
  it('does not reconcile a newer uncertain write using an earlier verification response', () => {
    const recovery = new AdminWriteRecovery();
    recovery.markUncertain(assets);
    const read = recovery.beginRead(assets);
    recovery.markUncertain(assets);
    recovery.readSucceeded(read);
    expect(recovery.isUncertain(assets)).toBe(true);
  });
  it('keeps failed reads locked and isolates each related API collection', () => {
    const recovery = new AdminWriteRecovery();
    recovery.markUncertain(assets); recovery.markUncertain(moderation);
    recovery.beginRead(assets); // A failed/obsolete GET deliberately never calls readSucceeded.
    recovery.readSucceeded(recovery.beginRead('/api/admin/community-content'));
    expect(recovery.isUncertain(assets)).toBe(true);
    expect(recovery.isUncertain(moderation)).toBe(true);
    recovery.readSucceeded(recovery.beginRead(moderation + '?page=1'));
    expect(recovery.isUncertain(assets)).toBe(true);
    expect(recovery.isUncertain(moderation)).toBe(false);
  });
  it('retains locks across remount lookups but isolates operators', () => {
    const first = contentRecoveryFor('recovery-unit-operator-a');
    first.markUncertain(assets);
    expect(contentRecoveryFor('recovery-unit-operator-a').isUncertain(assets)).toBe(true);
    expect(contentRecoveryFor('recovery-unit-operator-b').isUncertain(assets)).toBe(false);
  });
  it('groups announcement publishing with its own announcement collection, not configuration', () => {
    expect(contentScope('/api/admin/announcements/publish')).toBe('/api/admin/announcements');
    expect(contentScope('/api/admin/feature-flags?page=1')).toBe('/api/admin/feature-flags');
  });
  it('notifies subscribers only on a recovery state change and supports unsubscribe', () => {
    const recovery = new AdminWriteRecovery(); let count = 0;
    const unsubscribe = recovery.subscribe(() => { count++; });
    recovery.beginRead(assets); expect(count).toBe(0);
    recovery.markUncertain(assets); expect(count).toBe(1);
    recovery.readSucceeded(recovery.beginRead(assets)); expect(count).toBe(2);
    unsubscribe(); recovery.markUncertain(assets); expect(count).toBe(2);
  });
});
