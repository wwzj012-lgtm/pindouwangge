import { describe, expect, it } from 'vitest';
import { createImageRequestGate } from './imageRequestGate';

describe('image request gate', () => {
  it('allows B to replace A', () => {
    const gate = createImageRequestGate();
    const requestA = gate.begin();
    const requestB = gate.begin();

    expect(gate.isCurrent(requestA)).toBe(false);
    expect(gate.isCurrent(requestB)).toBe(true);
  });

  it('invalidates a request when the canvas is cleared or replaced', () => {
    const gate = createImageRequestGate();
    const requestA = gate.begin();
    gate.invalidate();

    expect(gate.isCurrent(requestA)).toBe(false);
  });

  it('prevents an old request finally from closing current loading', () => {
    const gate = createImageRequestGate();
    let loading = true;
    const requestA = gate.begin();
    const requestB = gate.begin();

    const finish = (token: number) => {
      if (gate.isCurrent(token)) loading = false;
    };

    finish(requestA);
    expect(loading).toBe(true);
    finish(requestB);
    expect(loading).toBe(false);
  });
});
