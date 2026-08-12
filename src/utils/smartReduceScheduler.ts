export interface SmartReduceFallbackSchedulerOptions {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
  setTimeout?: (callback: () => void, delay?: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
  timeout?: number;
}

/** Only the latest preview request may update the modal after async work completes. */
export function shouldAcceptSmartReducePreviewResult(
  requestId: number,
  latestRequestId: number,
): boolean {
  return requestId === latestRequestId;
}

/** Run fallback calculation outside render and yield to the browser when possible. */
export function scheduleSmartReduceFallback(
  task: () => void,
  options: SmartReduceFallbackSchedulerOptions = {},
): () => void {
  const timeout = options.timeout ?? 1000;
  const idleCallback = options.requestIdleCallback ?? (
    typeof window !== 'undefined'
      ? (window as Window & { requestIdleCallback?: SmartReduceFallbackSchedulerOptions['requestIdleCallback'] }).requestIdleCallback
      : undefined
  );
  const cancelIdleCallback = options.cancelIdleCallback ?? (
    typeof window !== 'undefined'
      ? (window as Window & { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback
      : undefined
  );

  if (idleCallback) {
    const handle = idleCallback(task, { timeout });
    return () => cancelIdleCallback?.(handle);
  }

  const setTimeoutFn = options.setTimeout ?? setTimeout;
  const clearTimeoutFn = options.clearTimeout ?? clearTimeout;
  const handle = setTimeoutFn(task, 0);
  return () => clearTimeoutFn(handle);
}
