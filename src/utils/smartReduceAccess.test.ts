import { describe, expect, it } from 'vitest';
import {
  canApplySavingTarget,
  canUseSavingTarget,
  getSmartReduceMembership,
  getSmartReduceFooterAction,
  nearestAllowedSavingTarget,
} from './smartReduceAccess';

describe('smart reducer membership access', () => {
  it('limits the free trial to the 15% target', () => {
    const membership = getSmartReduceMembership(false, false);
    expect(canUseSavingTarget(0, membership)).toBe(true);
    expect(canUseSavingTarget(15, membership)).toBe(true);
    expect(canUseSavingTarget(25, membership)).toBe(false);
    expect(canUseSavingTarget(40, membership)).toBe(false);
    expect(canApplySavingTarget(15, membership, true)).toBe(true);
    expect(canApplySavingTarget(15, membership, false)).toBe(false);
    expect(canApplySavingTarget(0, membership, true)).toBe(false);
  });

  it('keeps 15% and 25% for VIP, and reserves 40% for Merchant Pro', () => {
    const vip = getSmartReduceMembership(true, false);
    const pro = getSmartReduceMembership(true, true);
    expect(canUseSavingTarget(25, vip)).toBe(true);
    expect(canUseSavingTarget(40, vip)).toBe(false);
    expect(canUseSavingTarget(40, pro)).toBe(true);
    expect(nearestAllowedSavingTarget(40, vip)).toBe(25);
    expect(nearestAllowedSavingTarget(40, getSmartReduceMembership(false, false))).toBe(15);
  });

  it('keeps the authentication CTA clickable after the free trial is consumed', () => {
    const free = getSmartReduceMembership(false, false);
    expect(getSmartReduceFooterAction(free, 15, true)).toBe('trial');
    expect(getSmartReduceFooterAction(free, 15, false)).toBe('authenticate');
    expect(getSmartReduceFooterAction(free, 0, true)).toBe('authenticate');
  });
});
