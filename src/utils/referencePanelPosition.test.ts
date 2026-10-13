import { describe, expect, it } from 'vitest';
import {
  clampReferencePanelPosition,
  getCollapsedReferencePanelPosition,
  getExpandedReferencePanelPosition,
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

  it('collapses to the collapse button location rather than the upload button location', () => {
    // When the panel is at x: 200, width: 300, the upload button is near x: 204
    // while the collapse button is near the right edge x: 472.
    // The collapsed cloud icon (48x48) should appear at the collapse icon's position!
    const collapsedPos = getCollapsedReferencePanelPosition(
      { x: 200, y: 10 },
      { width: 800, height: 600 },
      { width: 300, height: 200 },
      { width: 48, height: 48 },
    );

    // Button center = 200 + 300 - 20 = 480; cloud x = 480 - 24 = 456
    // Y center = 10 + 18 = 28; cloud y = 28 - 24 = 4 -> clamped to margin 8
    expect(collapsedPos.x).toBe(456);
    expect(collapsedPos.y).toBe(8);
    // Crucially, collapsedPos.x is close to right edge (456), NOT at the upload position (200)!
    expect(collapsedPos.x).toBeGreaterThan(400);
  });

  it('expands back aligning the collapse button with the cloud icon location', () => {
    const cloudPos = { x: 456, y: 8 };
    const expandedPos = getExpandedReferencePanelPosition(
      cloudPos,
      { width: 800, height: 600 },
      { width: 300, height: 200 },
      { width: 48, height: 48 },
    );

    // Cloud center = 456 + 24 = 480.
    // expandedX = 480 - 280 = 200.
    // expandedY = (8 + 24) - 18 = 14.
    expect(expandedPos.x).toBe(200);
    expect(expandedPos.y).toBe(14);
  });
});
