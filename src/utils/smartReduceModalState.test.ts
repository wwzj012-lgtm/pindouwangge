import { describe, expect, it } from 'vitest';
import {
  formatReductionChange,
  shouldResetSmartReduceSafetyOptions,
} from './smartReduceModalState';

describe('smart reduce modal safety state', () => {
  const grid = [['dark']];

  it('resets destructive options when the modal reopens or receives a new grid session', () => {
    expect(shouldResetSmartReduceSafetyOptions(
      { isOpen: false, grid },
      { isOpen: true, grid },
    )).toBe(true);
    expect(shouldResetSmartReduceSafetyOptions(
      { isOpen: true, grid },
      { isOpen: true, grid: [['dark']] },
    )).toBe(true);
  });

  it('does not reset destructive options during ordinary rerenders of one preview', () => {
    expect(shouldResetSmartReduceSafetyOptions(
      { isOpen: true, grid },
      { isOpen: true, grid },
    )).toBe(false);
  });
});

describe('reduction change formatting', () => {
  it.each([
    [-12.5, false, 'Increased 12.5%'],
    [0, false, 'Unchanged'],
    [15, false, 'Reduced 15%'],
    [-12.5, true, '增加 12.5%'],
    [0, true, '不变'],
    [15, true, '减少 15%'],
  ])('formats %s consistently', (value, isChinese, expected) => {
    expect(formatReductionChange(value, isChinese)).toBe(expected);
  });
});
