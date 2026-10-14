import type { EditablePatternProject } from './patternHistory';
import type { BeadColor, ConvertSettings } from '../types';
import type { GridSnapshot } from './historyTransactions';

/** False declines the import; legacy synchronous void callbacks still succeed. */
export type ContinueEditingPattern = (project: EditablePatternProject) => boolean | void | Promise<boolean | void>;

export function savedPatternStudioUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.set('tab', 'studio');
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Apply the existing mandatory quantization policy before establishing a baseline. */
export function normalizeRestoredPatternSettings(settings: ConvertSettings): ConvertSettings {
  return { ...settings, kmeansClustering: true };
}

/** Compared only on import/save, not on every paint or render. */
export function patternEditingSnapshot(
  grid: GridSnapshot,
  settings: ConvertSettings,
  brand: string,
  palette: BeadColor[],
  name: string,
): string {
  return JSON.stringify({ grid, settings, brand, palette, name });
}
