export interface ImageRequestGate {
  begin: () => number;
  invalidate: () => number;
  isCurrent: (token: number) => boolean;
}

/**
 * Tracks the newest image-related request. Only the newest request may commit
 * UI state; synchronous edits invalidate any work still in flight.
 */
export const createImageRequestGate = (): ImageRequestGate => {
  let currentToken = 0;

  const nextToken = () => {
    currentToken += 1;
    return currentToken;
  };

  return {
    begin: nextToken,
    invalidate: nextToken,
    isCurrent: (token) => token === currentToken,
  };
};
