import { describe, expect, it } from 'vitest';
import {
  clampReferencePanelPosition,
  getInitialReferencePanelPosition,
} from './referencePanelPosition';

describe('reference panel positioning', () => {
  it('keeps a dragged panel inside the visible canvas bounds', () => {
    expect(clampReferencePanelPosition(
      { x: -40, y: 800 },
      { width: 500, height: 360 },
      { width: 280, height: 180 },
    )).toEqual({ x: 8, y: 172 });
  });

  it('keeps a panel reachable when the canvas becomes narrower than the panel', () => {
    expect(clampReferencePanelPosition(
      { x: 80, y: 40 },
      { width: 220, height: 160 },
      { width: 300, height: 180 },
    )).toEqual({ x: 8, y: 8 });
  });

  it('initializes at the upper-right edge inside the canvas', () => {
    expect(getInitialReferencePanelPosition(
      { width: 500, height: 360 },
      { width: 280, height: 180 },
    )).toEqual({ x: 212, y: 8 });
  });
});
