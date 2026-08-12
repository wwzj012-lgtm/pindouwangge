import type { BeadSavingPercent } from './smartReduceUtils';

export type SmartReduceMembership = 'free' | 'vip' | 'pro';
export type SmartReduceFooterAction = 'apply' | 'trial' | 'authenticate';

export const SMART_REDUCE_TARGETS: readonly BeadSavingPercent[] = [0, 15, 25, 40];

export function getSmartReduceMembership(isVip: boolean, isPro: boolean): SmartReduceMembership {
  if (isPro) return 'pro';
  return isVip ? 'vip' : 'free';
}

export function canUseSavingTarget(
  target: BeadSavingPercent,
  membership: SmartReduceMembership,
): boolean {
  if (membership === 'pro') return true;
  if (membership === 'vip') return target === 0 || target === 15 || target === 25;
  return target === 0 || target === 15;
}

export function nearestAllowedSavingTarget(
  target: BeadSavingPercent,
  membership: SmartReduceMembership,
): BeadSavingPercent {
  const allowed = SMART_REDUCE_TARGETS.filter((value) => canUseSavingTarget(value, membership));
  return allowed.reduce((nearest, value) => value <= target ? value : nearest, allowed[0]);
}

export function canApplySavingTarget(
  target: BeadSavingPercent,
  membership: SmartReduceMembership,
  hasFreeTrial: boolean,
): boolean {
  if (!canUseSavingTarget(target, membership)) return false;
  return membership !== 'free' || (target === 15 && hasFreeTrial);
}

export function getSmartReduceFooterAction(
  membership: SmartReduceMembership,
  target: BeadSavingPercent,
  hasFreeTrial: boolean,
): SmartReduceFooterAction {
  if (membership === 'free') return target === 15 && hasFreeTrial ? 'trial' : 'authenticate';
  return 'apply';
}
