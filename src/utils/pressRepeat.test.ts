import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPressRepeatController } from './pressRepeat';

describe('press repeat controller', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a normal click to one action', () => {
    vi.useFakeTimers();
    let count = 0;
    const controller = createPressRepeatController(() => {
      count += 1;
      return true;
    });

    controller.start();
    controller.stop();
    if (controller.shouldHandleClick()) count += 1;

    expect(count).toBe(1);
  });

  it('repeats after the hold delay and suppresses the trailing click', () => {
    vi.useFakeTimers();
    let count = 0;
    const controller = createPressRepeatController(() => {
      count += 1;
      return true;
    }, { delay: 500, interval: 125 });

    controller.start();
    vi.advanceTimersByTime(499);
    expect(count).toBe(0);
    vi.advanceTimersByTime(251);
    controller.stop();

    expect(count).toBe(3);
    expect(controller.shouldHandleClick()).toBe(false);
  });

  it('stops before the long-press delay and when the action reaches a boundary', () => {
    vi.useFakeTimers();
    let count = 0;
    const controller = createPressRepeatController(() => {
      count += 1;
      return count < 2;
    });

    controller.start();
    controller.stop();
    vi.advanceTimersByTime(1000);
    expect(count).toBe(0);

    controller.start();
    vi.advanceTimersByTime(1000);
    expect(count).toBe(2);
  });

  it('stops an active repeat without scheduling another action', () => {
    vi.useFakeTimers();
    let count = 0;
    const controller = createPressRepeatController(() => {
      count += 1;
      return true;
    });

    controller.start();
    vi.advanceTimersByTime(500);
    controller.stop();
    vi.advanceTimersByTime(1000);

    expect(count).toBe(1);
  });
});
