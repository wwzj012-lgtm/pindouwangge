export interface PressRepeatOptions {
  delay?: number;
  interval?: number;
}

export interface PressRepeatController {
  start: () => void;
  stop: () => void;
  shouldHandleClick: () => boolean;
}

type RepeatAction = () => boolean | void;

/**
 * Starts repeat only after a long press. Returning false from the action stops
 * repetition, which lets callers halt cleanly at the beginning/end of history.
 */
export const createPressRepeatController = (
  action: RepeatAction,
  { delay = 500, interval = 125 }: PressRepeatOptions = {},
): PressRepeatController => {
  let delayTimer: ReturnType<typeof setTimeout> | undefined;
  let intervalTimer: ReturnType<typeof setInterval> | undefined;
  let repeated = false;

  const clearTimers = () => {
    if (delayTimer !== undefined) clearTimeout(delayTimer);
    if (intervalTimer !== undefined) clearInterval(intervalTimer);
    delayTimer = undefined;
    intervalTimer = undefined;
  };

  const runAction = () => {
    if (action() === false) {
      clearTimers();
      return false;
    }
    return true;
  };

  return {
    start: () => {
      clearTimers();
      repeated = false;
      delayTimer = setTimeout(() => {
        repeated = true;
        if (!runAction()) return;
        intervalTimer = setInterval(runAction, interval);
      }, delay);
    },
    stop: clearTimers,
    shouldHandleClick: () => {
      const shouldHandle = !repeated;
      repeated = false;
      return shouldHandle;
    },
  };
};
