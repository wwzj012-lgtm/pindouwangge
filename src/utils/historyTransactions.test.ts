import { describe, expect, it } from 'vitest';
import {
  commitHistorySnapshot,
  getRedoState,
  getUndoState,
  gridsEqual,
  type GridSnapshot,
} from './historyTransactions';

const empty: GridSnapshot = [[null, null], [null, null]];
const firstStroke: GridSnapshot = [['A', null], [null, null]];
const secondStroke: GridSnapshot = [['A', 'B'], [null, null]];

describe('history transactions', () => {
  it('commits an entire continuous stroke as one undo record', () => {
    const strokeStart = empty;
    const afterFirstMove: GridSnapshot = [['A', null], [null, null]];
    const afterSecondMove: GridSnapshot = [['A', 'A'], [null, null]];

    const commit = commitHistorySnapshot([], -1, strokeStart, afterSecondMove);

    expect(commit.changed).toBe(true);
    expect(commit.history).toHaveLength(2);
    expect(commit.historyIndex).toBe(1);
    expect(gridsEqual(commit.history[0], strokeStart)).toBe(true);
    expect(gridsEqual(commit.history[1], afterSecondMove)).toBe(true);
    expect(gridsEqual(afterFirstMove, commit.history[1])).toBe(false);
  });

  it('keeps distinct strokes as separate records and branches after undo', () => {
    const first = commitHistorySnapshot([], -1, empty, firstStroke);
    const second = commitHistorySnapshot(first.history, first.historyIndex, firstStroke, secondStroke);
    const undone = getUndoState(second.history, second.historyIndex);

    expect(second.history).toHaveLength(3);
    expect(undone?.historyIndex).toBe(1);
    expect(undone && gridsEqual(undone.history[undone.historyIndex], firstStroke)).toBe(true);

    const branched = commitHistorySnapshot(second.history, undone!.historyIndex, firstStroke, empty);
    expect(branched.history).toHaveLength(3);
    expect(getRedoState(branched.history, branched.historyIndex)).toBeNull();
  });

  it('does not commit a canceled or completed interaction that made no change', () => {
    const result = commitHistorySnapshot([], -1, empty, empty);

    expect(result.changed).toBe(false);
    expect(result.history).toEqual([]);
    expect(result.historyIndex).toBe(-1);
  });
});
