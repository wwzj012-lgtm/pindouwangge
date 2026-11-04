import { describe, expect, it } from 'vitest';
import { normalizeMinmax, refineSubjectMask, thresholdSubjectMask } from './subjectSegmentation';

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

describe('refineSubjectMask', () => {
  it('grows strong seeds through connected weak pixels and fills enclosed holes', () => {
    // 5x5: strong seed top-left, weak path leading to a weak pocket, an
    // isolated strong island with a zero hole inside it.
    // p map (rows):
    // 0.9 0.1 0.0 0.0 0.0
    // 0.1 0.1 0.0 0.0 0.0
    // 0.0 0.0 0.9 0.9 0.9
    // 0.0 0.0 0.9 0.0 0.9
    // 0.0 0.0 0.9 0.9 0.9
    const values = [
      0.9, 0.1, 0.0, 0.0, 0.0,
      0.1, 0.1, 0.0, 0.0, 0.0,
      0.0, 0.0, 0.9, 0.9, 0.9,
      0.0, 0.0, 0.9, 0.0, 0.9,
      0.0, 0.0, 0.9, 0.9, 0.9,
    ];
    const mask = refineSubjectMask(new Float32Array(values), 5, 5);
    // Weak cluster reachable from the strong seed is all subject.
    expect(mask[0]).toBe(1);
    expect(mask[1]).toBe(1);
    expect(mask[5]).toBe(1);
    expect(mask[6]).toBe(1);
    // The zero pixel inside the strong island is an enclosed hole -> filled.
    expect(mask[18]).toBe(1);
    // Far background stays background.
    expect(mask[4]).toBe(0);
    expect(mask[9]).toBe(0);
    expect(mask[20]).toBe(0);
  });

  it('never grows into background that never touches a strong seed', () => {
    const values = new Float32Array(25).fill(0.2);
    const mask = refineSubjectMask(new Float32Array(values), 5, 5);
    expect(mask.every(value => value === 0)).toBe(true);
  });
});
