import { describe, expect, it } from 'vitest';
import { resolveCanvasReset } from './canvasReset';

describe('canvas reset confirmation', () => {
  const grid = [['red', null], ['blue', 'green']];

  it('keeps the current grid unchanged when reset is cancelled', () => {
    expect(resolveCanvasReset(false, grid)).toBeNull();
    expect(grid).toEqual([['red', null], ['blue', 'green']]);
  });

  it('clears generated cells, undo/redo state, and returns the draft to freehand mode', () => {
    expect(resolveCanvasReset(true, grid)).toEqual({
      grid: [[null, null], [null, null]],
      history: [],
      historyIndex: -1,
      isImageDerivedPattern: false,
    });
  });
});
