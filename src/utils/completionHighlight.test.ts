import { describe, expect, it } from 'vitest';
import { getColorDisplayState, toggleCompletedColorId } from './completionHighlight';

describe('completion color state', () => {
  it('toggles a color between制作中 and已完成 without mutating the input', () => {
    const completed = ['M02'];

    expect(toggleCompletedColorId(completed, 'M01')).toEqual(['M02', 'M01']);
    expect(toggleCompletedColorId(completed, 'M02')).toEqual([]);
    expect(completed).toEqual(['M02']);
  });

  it('classifies empty, focused, completed, dimmed, and normal cells', () => {
    expect(getColorDisplayState(null)).toBe('empty');
    expect(getColorDisplayState('M01')).toBe('normal');
    expect(getColorDisplayState('M01', ['M01'])).toBe('focused');
    expect(getColorDisplayState('M02', ['M01'])).toBe('dimmed');
    expect(getColorDisplayState('M01', ['M01'], ['M01'])).toBe('completed');
  });
});
