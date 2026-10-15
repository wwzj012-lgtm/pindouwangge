import { describe, expect, it } from 'vitest';
import { advanceCompletionEditRevision, completionInputKey, isCompletionEditRevisionCurrent, isWithinServerPaidCoverage, readServerPaidCoverage, type CompletionInput } from './patternCompletionState';

const input: CompletionInput = { workKey: 'local-work', sourceHash: 'local-source', width: 35, height: 35, occupancyBase64: 'Aw==', savingTarget: 15 };
const serverQuote = { ...input, nonEmptyBeads: 2, paid: { status: 'COMPLETED', nonEmptyBeads: 3, beadSavingLevel: 15 } };

describe('local completion confirmation edit revision', () => {
  it('allows an unchanged confirmation without adding revision to the billing input', () => {
    const confirmedRevision = 0;
    expect(isCompletionEditRevisionCurrent(confirmedRevision, confirmedRevision)).toBe(true);
    expect(completionInputKey(input)).toBe(completionInputKey({ ...input }));
    expect(input).not.toHaveProperty('editRevision');
  });

  it('invalidates recolor even when the entire pricing input and occupancy stay equal', () => {
    const confirmedRevision = 0;
    const afterRecolor = advanceCompletionEditRevision(confirmedRevision);
    expect(completionInputKey({ ...input })).toBe(completionInputKey(input));
    expect(afterRecolor).toBe(1);
    expect(isCompletionEditRevisionCurrent(confirmedRevision, afterRecolor)).toBe(false);
  });

  it('never revives the old confirmation after recolor and undo/redo A -> B -> A', () => {
    const confirmedRevision = 0;
    let revision = advanceCompletionEditRevision(confirmedRevision); // A -> B
    revision = advanceCompletionEditRevision(revision); // undo: B -> A
    expect(isCompletionEditRevisionCurrent(confirmedRevision, revision)).toBe(false);
    revision = advanceCompletionEditRevision(revision); // redo: A -> B
    revision = advanceCompletionEditRevision(revision); // undo: B -> A
    expect(revision).toBe(4);
    expect(isCompletionEditRevisionCurrent(confirmedRevision, revision)).toBe(false);
    expect(isCompletionEditRevisionCurrent(revision, revision)).toBe(true);
  });

  it('does not mutate server paid coverage or turn a confirmed edit into a new paid grant', () => {
    const coverage = Object.freeze(readServerPaidCoverage(serverQuote, input)!);
    const revision = advanceCompletionEditRevision(0);
    expect(isCompletionEditRevisionCurrent(0, revision)).toBe(false);
    expect(coverage).toEqual({ status: 'COMPLETED', paidNonEmptyBeads: 3, paidSavingTarget: 15 });
    expect(isWithinServerPaidCoverage(coverage, 3, 15)).toBe(true);
    expect(isWithinServerPaidCoverage(coverage, 4, 15)).toBe(false);
    expect(readServerPaidCoverage({ ...serverQuote, nextPaidNonEmptyBeads: 1000, nextPaidBeadSavingLevel: 40 }, input)).toEqual(coverage);
  });
});

describe('existing server completion coverage', () => {
  it('keys the entire quote input without counting colors or board cells', () => {
    expect(completionInputKey({ ...input })).toBe(completionInputKey(input));
    for (const change of [{ workKey: 'other' }, { sourceHash: 'other' }, { width: 36 }, { height: 36 }, { occupancyBase64: 'Bg==' }, { savingTarget: 25 as const }]) {
      expect(completionInputKey({ ...input, ...change })).not.toBe(completionInputKey(input));
    }
  });
  it('reads current Worker paid fields rather than current/decreased bead count', () => {
    expect(readServerPaidCoverage(serverQuote, input)).toEqual({ status: 'COMPLETED', paidNonEmptyBeads: 3, paidSavingTarget: 15 });
  });
  it('retains the server high-water cap from a completed settlement after deletion', () => {
    expect(readServerPaidCoverage({ ...serverQuote, completed: true, nextPaidNonEmptyBeads: 3, nextPaidBeadSavingLevel: 15 }, input, true)?.paidNonEmptyBeads).toBe(3);
  });
  it('does not use a root nonEmptyBeads field or local saved metadata as payment', () => {
    expect(readServerPaidCoverage({ ...input, nonEmptyBeads: 1000, completionStatus: 'COMPLETED', paidNonEmptyBeads: 1000 }, input)).toBeNull();
    expect(readServerPaidCoverage({ ...input, completed: true, nonEmptyBeads: 1000 }, input, true)).toBeNull();
  });
  it('rejects another work or source, even if its paid amount is higher', () => {
    expect(readServerPaidCoverage({ ...serverQuote, workKey: 'other' }, input)).toBeNull();
    expect(readServerPaidCoverage({ ...serverQuote, sourceHash: 'other' }, input)).toBeNull();
    expect(readServerPaidCoverage({ paid: serverQuote.paid }, input)).toBeNull();
  });
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects malformed server caps %s', cap => {
    expect(readServerPaidCoverage({ ...serverQuote, paid: { ...serverQuote.paid, nonEmptyBeads: cap } }, input)).toBeNull();
  });
  it('does not mistake a quote for a completion receipt', () => {
    expect(readServerPaidCoverage(serverQuote, input, true)).toBeNull();
  });
  it('preserves same count/recolor/move, deletion, undo/redo and zero within N', () => {
    const coverage = readServerPaidCoverage(serverQuote, input);
    for (const count of [3, 2, 0, 2, 3]) expect(isWithinServerPaidCoverage(coverage, count, 15)).toBe(true);
    expect(isWithinServerPaidCoverage(coverage, 4, 15)).toBe(false);
  });
  it('does not grant a saving-level upgrade or an unknown coverage', () => {
    expect(isWithinServerPaidCoverage(readServerPaidCoverage(serverQuote, input), 3, 25)).toBe(false);
    expect(isWithinServerPaidCoverage(null, 1, 15)).toBe(false);
    expect(readServerPaidCoverage({ ...serverQuote, paid: { ...serverQuote.paid, beadSavingLevel: 99 } }, input)).toBeNull();
  });
  it('retains server-marked legacy semantics without converting local legacy metadata into coverage', () => {
    const legacy = readServerPaidCoverage({ ...serverQuote, paid: { status: 'LEGACY', nonEmptyBeads: 3, beadSavingLevel: 0 } }, input);
    expect(isWithinServerPaidCoverage(legacy, 4, 15)).toBe(true);
    expect(readServerPaidCoverage({ ...input, completionStatus: 'LEGACY' }, input)).toBeNull();
  });
});
