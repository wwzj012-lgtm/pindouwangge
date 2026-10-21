import { describe, expect, it } from 'vitest';
import { getVisibleGridRange } from './visibleGridRange';

describe('getVisibleGridRange', () => {
  it('returns all cells when the board fits the viewport', () => {
    expect(getVisibleGridRange(10, 20, 0, 200)).toEqual({ start: 0, end: 10 });
  });

  it('includes partially visible cells at both viewport edges', () => {
    expect(getVisibleGridRange(100, 20, -31, 100)).toEqual({ start: 1, end: 7 });
  });

  it('returns an empty range when the board is fully outside the viewport', () => {
    expect(getVisibleGridRange(100, 20, -3000, 800)).toEqual({ start: 100, end: 100 });
    expect(getVisibleGridRange(100, 20, 3000, 800)).toEqual({ start: 0, end: 0 });
  });

  it('handles invalid geometry without producing invalid indices', () => {
    expect(getVisibleGridRange(10, 0, 0, 100)).toEqual({ start: 0, end: 0 });
  });
});
