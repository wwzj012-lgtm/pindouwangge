export type ColorDisplayState = 'empty' | 'normal' | 'focused' | 'completed' | 'dimmed';

export function toggleCompletedColorId(completedColorIds: readonly string[], colorId: string): string[] {
  if (!colorId) return [...completedColorIds];
  return completedColorIds.includes(colorId)
    ? completedColorIds.filter(id => id !== colorId)
    : [...completedColorIds, colorId];
}

export function getColorDisplayState(
  colorId: string | null | undefined,
  highlightColorIds: readonly string[] = [],
  completedColorIds: readonly string[] = [],
): ColorDisplayState {
  if (!colorId) return 'empty';
  if (completedColorIds.includes(colorId)) return 'completed';
  if (highlightColorIds.includes(colorId)) return 'focused';
  if (highlightColorIds.length > 0) return 'dimmed';
  return 'normal';
}
