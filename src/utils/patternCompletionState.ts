export interface CompletionInput {
  workKey: string;
  sourceHash: string;
  width: number;
  height: number;
  occupancyBase64: string;
  savingTarget: 15 | 25 | 40;
}

export interface ServerPaidCoverage {
  status: 'COMPLETED' | 'LEGACY';
  paidNonEmptyBeads: number;
  paidSavingTarget: number;
}

export function completionInputKey(input: CompletionInput): string {
  return JSON.stringify([input.workKey, input.sourceHash, input.width, input.height, input.occupancyBase64, input.savingTarget]);
}

/** Local edit identity, independent of content hashes, pricing inputs and paid coverage. */
export function advanceCompletionEditRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Invalid completion edit revision.');
  }
  return revision + 1;
}

export function isCompletionEditRevisionCurrent(confirmedRevision: number, currentRevision: number): boolean {
  return Number.isSafeInteger(confirmedRevision) && confirmedRevision >= 0 && confirmedRevision === currentRevision;
}

/** Read only the existing Worker's paid/settlement fields, never a local bead count. */
export function readServerPaidCoverage(value: unknown, input: CompletionInput, settled = false): ServerPaidCoverage | null {
  if (!value || typeof value !== 'object') return null;
  const quote = value as Record<string, unknown>;
  if (quote.workKey !== input.workKey || quote.sourceHash !== input.sourceHash) return null;
  const paid = quote.paid && typeof quote.paid === 'object' ? quote.paid as Record<string, unknown> : null;
  const status = paid?.status === 'LEGACY' ? 'LEGACY'
    : settled && quote.completed === true ? 'COMPLETED' : paid?.status;
  if (status !== 'COMPLETED' && status !== 'LEGACY') return null;
  if (settled && quote.completed !== true) return null;
  const cap = settled ? quote.nextPaidNonEmptyBeads : paid?.nonEmptyBeads;
  const level = settled ? quote.nextPaidBeadSavingLevel : paid?.beadSavingLevel;
  if (typeof cap !== 'number' || !Number.isSafeInteger(cap) || cap < 0
    || typeof level !== 'number' || ![0, 15, 25, 40].includes(level)) return null;
  return { status, paidNonEmptyBeads: cap, paidSavingTarget: level };
}

export function isWithinServerPaidCoverage(coverage: ServerPaidCoverage | null, nonEmptyBeads: number, savingTarget: number): boolean {
  return coverage !== null && (coverage.status === 'LEGACY'
    || (Number.isSafeInteger(nonEmptyBeads) && nonEmptyBeads >= 0
      && nonEmptyBeads <= coverage.paidNonEmptyBeads && savingTarget <= coverage.paidSavingTarget));
}
