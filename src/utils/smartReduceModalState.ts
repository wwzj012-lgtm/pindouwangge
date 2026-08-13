export interface SmartReduceSafetySession {
  isOpen: boolean;
  grid: (string | null)[][] | null;
}

/**
 * Background removal and border cropping are destructive options. Their state
 * is scoped to one opened preview and must not leak into the next pattern.
 */
export function shouldResetSmartReduceSafetyOptions(
  previous: SmartReduceSafetySession,
  current: SmartReduceSafetySession,
): boolean {
  return current.isOpen && (!previous.isOpen || previous.grid !== current.grid);
}

function displayPercent(value: number): string {
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** Formats a signed change without relying on callers to prepend a sign. */
export function formatReductionChange(percent: number, isChinese: boolean): string {
  const normalized = Number.isFinite(percent) ? percent : 0;
  if (Math.abs(normalized) < 0.05) return isChinese ? '不变' : 'Unchanged';

  const amount = `${displayPercent(normalized)}%`;
  if (normalized > 0) return isChinese ? `减少 ${amount}` : `Reduced ${amount}`;
  return isChinese ? `增加 ${amount}` : `Increased ${amount}`;
}
