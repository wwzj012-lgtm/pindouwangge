import { describe, expect, it } from 'vitest';
import { clampCanvasViewport } from './canvasViewport';

describe('clampCanvasViewport', () => {
  const viewport = { width: 800, height: 600 };
  const content = { width: 1000, height: 900 };

  it('bounds extreme drags in both directions with reachable edges', () => {
    expect(clampCanvasViewport({ zoom: 1, x: 1e9, y: -1e9 }, viewport, content))
      .toEqual({ zoom: 1, x: 24, y: -324 });
    expect(clampCanvasViewport({ zoom: 1, x: -1e9, y: 1e9 }, viewport, content))
      .toEqual({ zoom: 1, x: -224, y: 24 });
  });

  it('preserves valid cursor-anchored zoom without moving the anchor', () => {
    const before = { zoom: 1, x: -100, y: -90 };
    const cursor = { x: 300, y: 250 };
    const zoom = 2;
    const after = clampCanvasViewport({ zoom,
      x: cursor.x - (cursor.x - before.x) * zoom / before.zoom,
      y: cursor.y - (cursor.y - before.y) * zoom / before.zoom,
    }, viewport, content);
    expect((cursor.x - after.x) / after.zoom).toBe((cursor.x - before.x) / before.zoom);
    expect((cursor.y - after.y) / after.zoom).toBe((cursor.y - before.y) / before.zoom);
  });

  it('reclamps after zooming out and centers each small axis independently', () => {
    expect(clampCanvasViewport({ zoom: 0.5, x: -5000, y: 9000 }, viewport, content))
      .toEqual({ zoom: 0.5, x: 150, y: 75 });
    expect(clampCanvasViewport({ zoom: 2, x: -5000, y: 9000 }, viewport, { width: 100, height: 1000 }))
      .toEqual({ zoom: 2, x: 300, y: 24 });
    expect(clampCanvasViewport({ zoom: 2, x: -5000, y: 9000 }, viewport, { width: 1000, height: 100 }))
      .toEqual({ zoom: 2, x: -1224, y: 200 });
  });

  it('reclamps on resize without changing zoom', () => {
    const view = { zoom: 1.25, x: -474, y: -549 };
    expect(clampCanvasViewport(view, { width: 1400, height: 1200 }, content))
      .toEqual({ zoom: 1.25, x: 75, y: 37.5 });
    expect(clampCanvasViewport(view, { width: 900, height: 800 }, content))
      .toEqual({ zoom: 1.25, x: -374, y: -349 });
  });

  it('centers exactly fitting content and respects custom padding', () => {
    expect(clampCanvasViewport({ zoom: 1, x: 200, y: -200 }, viewport, viewport))
      .toEqual({ zoom: 1, x: 0, y: 0 });
    expect(clampCanvasViewport({ zoom: 1, x: 200, y: -2000 }, viewport, content, 12))
      .toEqual({ zoom: 1, x: 12, y: -312 });
  });

  it('supports an adapted nonzero source origin and fixed ruler strips', () => {
    const zoom = 2;
    const origin = { x: 30, y: -10 };
    const translated = clampCanvasViewport({ zoom, x: 500 + origin.x * zoom, y: -9000 + origin.y * zoom }, viewport, content);
    const pan = { x: translated.x - origin.x * zoom, y: translated.y - origin.y * zoom };
    expect(pan.x + origin.x * zoom).toBe(24);
    expect(pan.y + origin.y * zoom + content.height * zoom).toBe(viewport.height - 24);
    expect(clampCanvasViewport({ zoom: 1, x: 9999, y: 9999 }, viewport,
      { width: 20 * 10 * zoom + 28, height: 20 * 5 * zoom + 28 }))
      .toEqual({ zoom: 1, x: 186, y: 186 });
  });

  it('keeps first and last cells visible when focus is clamped near an edge', () => {
    for (const cell of [0, 99]) {
      const zoom = 4;
      const center = (cell + 0.5) * 20 * zoom;
      const view = clampCanvasViewport({ zoom, x: viewport.width / 2 - center, y: viewport.height / 2 - center }, viewport, { width: 2000, height: 2000 });
      expect(center + view.x).toBeGreaterThan(0);
      expect(center + view.x).toBeLessThan(viewport.width);
      expect(center + view.y).toBeGreaterThan(0);
      expect(center + view.y).toBeLessThan(viewport.height);
    }
  });

  it('handles nonfinite offsets and degenerate geometry defensively', () => {
    expect(clampCanvasViewport({ zoom: 1, x: NaN, y: Infinity }, viewport, content))
      .toEqual({ zoom: 1, x: -100, y: -150 });
    for (const zoom of [0, -1, NaN, Infinity]) {
      const view = clampCanvasViewport({ zoom, x: NaN, y: -Infinity }, viewport, content);
      expect(view.zoom).toBe(zoom);
      expect(view.x).toBe(400);
      expect(view.y).toBe(300);
    }
    expect(clampCanvasViewport({ zoom: 1, x: NaN, y: NaN }, { width: 0, height: NaN }, { width: 0, height: -5 }, NaN))
      .toEqual({ zoom: 1, x: 0, y: 0 });
    const tiny = clampCanvasViewport({ zoom: 1, x: Infinity, y: 999 }, { width: 1, height: 2 }, content, 500);
    expect(tiny.x).toBe(-499.5);
    expect(tiny.y).toBe(1);
    expect(clampCanvasViewport({ zoom: 1, x: 999, y: 999 }, viewport, { width: Infinity, height: NaN }))
      .toEqual({ zoom: 1, x: 400, y: 300 });
  });
});
