import { describe, expect, it } from 'vitest';
import { normalizeMinmax, thresholdSubjectMask } from './subjectSegmentation';

describe('normalizeMinmax', () => {
  it('scales values into [0,1] by the observed range', () => {
    const values = normalizeMinmax(new Float32Array([2, 4, 6, 8]));
    expect(Array.from(values)[0]).toBe(0);
    expect(Array.from(values)[3]).toBe(1);
    expect(Array.from(values)[1]).toBeCloseTo(1 / 3, 5);
    expect(Array.from(values)[2]).toBeCloseTo(2 / 3, 5);
  });

  it('leaves a flat (degenerate) map unchanged instead of dividing by zero', () => {
    const values = normalizeMinmax(new Float32Array([0.7, 0.7, 0.7]));
    expect(Array.from(values)[0]).toBeCloseTo(0.7, 5);
    expect(Array.from(values)[2]).toBeCloseTo(0.7, 5);
  });
});

describe('thresholdSubjectMask', () => {
  it('marks probabilities at or above the threshold as subject', () => {
    const mask = thresholdSubjectMask(new Float32Array([0.1, 0.5, 0.49, 0.9]));
    expect(Array.from(mask)).toEqual([0, 1, 0, 1]);
  });
});
