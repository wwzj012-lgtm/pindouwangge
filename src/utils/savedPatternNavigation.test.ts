import { describe, expect, it } from 'vitest';
import { normalizeRestoredPatternSettings, patternEditingSnapshot, savedPatternStudioUrl, type ContinueEditingPattern } from './savedPatternNavigation';
import { commitHistorySnapshot, getUndoState } from './historyTransactions';
import type { BeadColor, ConvertSettings } from '../types';
import type { EditablePatternProject } from './patternHistory';

describe('saved pattern studio URL', () => {
  it.each(['home', 'community', 'largeCanvas', 'studio'])('replaces %s without losing other query values or hash', tab => {
    expect(savedPatternStudioUrl(`http://localhost/workspace?keep=1&tab=${tab}#canvas`))
      .toBe('/workspace?keep=1&tab=studio#canvas');
  });
  it.each(['/workspace', '/app', '/large-canvas', '/assembly'])('keeps the existing workspace route %s', route => {
    expect(savedPatternStudioUrl(`http://localhost${route}`)).toBe(`${route}?tab=studio`);
  });
  it('does not accumulate duplicate tab values', () => {
    expect(savedPatternStudioUrl('http://localhost/workspace?tab=home&tab=community')).toBe('/workspace?tab=studio');
  });
});

describe('saved editing baseline', () => {
  const grid = [['red', null]];
  const settings = { width: 2, height: 1, boardSize: 29 } as ConvertSettings;
  const palette = [{ id: 'red', hex: '#ff0000', rgb: [255, 0, 0] }] as BeadColor[];
  const snapshot = () => patternEditingSnapshot(grid, settings, 'MARD', palette, 'one');
  it('compares equal cloned save/load state and never mutates it', () => {
    expect(patternEditingSnapshot(structuredClone(grid), { ...settings }, 'MARD', structuredClone(palette), 'one')).toBe(snapshot());
    expect(grid).toEqual([['red', null]]);
  });
  it('normalizes legacy restore settings before the baseline without mutating the saved settings', () => {
    const legacySettings = { ...settings, kmeansClustering: false };
    const restoredSettings = normalizeRestoredPatternSettings(legacySettings);
    expect(restoredSettings).toEqual({ ...legacySettings, kmeansClustering: true });
    expect(legacySettings.kmeansClustering).toBe(false);
    const baseline = patternEditingSnapshot(grid, restoredSettings, 'MARD', palette, 'one');
    expect(patternEditingSnapshot(grid, normalizeRestoredPatternSettings(restoredSettings), 'MARD', palette, 'one')).toBe(baseline);
    expect(patternEditingSnapshot([['red', 'red']], restoredSettings, 'MARD', palette, 'one')).not.toBe(baseline);
  });
  it('detects unsaved grid, settings, brand, palette, and name changes', () => {
    const changed = [
      patternEditingSnapshot([[null, null]], settings, 'MARD', palette, 'one'),
      patternEditingSnapshot(grid, { ...settings, boardSize: 50 }, 'MARD', palette, 'one'),
      patternEditingSnapshot(grid, settings, 'OTHER', palette, 'one'),
      patternEditingSnapshot(grid, settings, 'MARD', [{ ...palette[0], hex: '#000000' }], 'one'),
      patternEditingSnapshot(grid, settings, 'MARD', palette, 'two'),
    ];
    changed.forEach(value => expect(value).not.toBe(snapshot()));
  });
  it('a loaded baseline cannot undo to another work; subsequent paint still undoes normally', () => {
    const baseline = structuredClone(grid);
    expect(getUndoState([baseline], 0)).toBeNull();
    const edited = [['red', 'red']];
    const commit = commitHistorySnapshot([baseline], 0, baseline, edited);
    const undo = getUndoState(commit.history, commit.historyIndex);
    expect(undo?.history[undo.historyIndex]).toEqual(grid);
  });
  it('supports legacy synchronous void callbacks and explicit decline/async receipts', async () => {
    const project = {} as EditablePatternProject;
    const legacy: (project: EditablePatternProject) => void = () => {};
    const callbacks: ContinueEditingPattern[] = [legacy, () => false, async () => true];
    expect(await callbacks[0](project)).toBeUndefined();
    expect(await callbacks[1](project)).toBe(false);
    expect(await callbacks[2](project)).toBe(true);
  });
});
