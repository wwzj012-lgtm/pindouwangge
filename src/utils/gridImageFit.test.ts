import { describe, expect, it } from 'vitest';
import { getGridImageFitRect } from './gridImageFit';

describe('grid image fit', () => {
  it('preserves source proportions and centers the image when aspect lock is on', () => {
    expect(getGridImageFitRect(100, 100, 80, 40, true)).toEqual({
      x: 20,
      y: 0,
      width: 40,
      height: 40,
    });
  });

  it('fills the current grid dimensions when free aspect sizing is selected', () => {
    expect(getGridImageFitRect(100, 100, 80, 40, false)).toEqual({
      x: 0,
      y: 0,
      width: 80,
      height: 40,
    });
  });

  it('rejects invalid source or grid dimensions', () => {
    expect(getGridImageFitRect(0, 100, 80, 40, true)).toBeNull();
  });
});
