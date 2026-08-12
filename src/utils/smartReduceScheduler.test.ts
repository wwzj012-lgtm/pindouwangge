import { describe, expect, it, vi } from 'vitest';
import { scheduleSmartReduceFallback, shouldAcceptSmartReducePreviewResult } from './smartReduceScheduler';

describe('smart reducer scheduling', () => {
  it('accepts only the latest preview result', () => {
    expect(shouldAcceptSmartReducePreviewResult(3, 3)).toBe(true);
    expect(shouldAcceptSmartReducePreviewResult(2, 3)).toBe(false);
  });

  it('uses an idle callback with a timeout when one is available', () => {
    const idle = vi.fn((_task: () => void, _options?: { timeout: number }) => 7);
    const cancel = vi.fn();
    const task = vi.fn();
    const stop = scheduleSmartReduceFallback(task, {
      requestIdleCallback: idle,
      cancelIdleCallback: cancel,
      timeout: 250,
    });

    expect(idle).toHaveBeenCalledWith(task, { timeout: 250 });
    stop();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('falls back to a zero-delay timer when idle callbacks are unavailable', () => {
    const setTimeoutFn = vi.fn((_task: () => void, _delay?: number) => 11 as unknown as ReturnType<typeof setTimeout>);
    const clearTimeoutFn = vi.fn();
    const task = vi.fn();
    const stop = scheduleSmartReduceFallback(task, { setTimeout: setTimeoutFn, clearTimeout: clearTimeoutFn });

    expect(setTimeoutFn).toHaveBeenCalledWith(task, 0);
    stop();
    expect(clearTimeoutFn).toHaveBeenCalledWith(11);
  });
});
