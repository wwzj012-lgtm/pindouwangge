export interface CanvasViewportView {
  zoom: number;
  x: number;
  y: number;
}

/** Allows a 312/900-cell board to genuinely fit a narrow mobile viewport. */
export const MIN_CANVAS_ZOOM = 0.01;

interface Size {
  width: number;
  height: number;
}

/**
 * Bounds a finite rectangle whose screen origin is (x, y) and whose unscaled
 * size is content. Smaller axes stay centered; larger axes can expose either
 * edge with at most padding CSS pixels of blank space. Zoom is never changed.
 * Adapt nonzero content origins before calling, then undo that adaptation.
 * Invalid geometry is treated as empty; invalid offsets start at the center.
 */
export function clampCanvasViewport(
  view: CanvasViewportView,
  viewport: Size,
  content: Size,
  padding = 24,
): CanvasViewportView {
  const positive = (value: number) => Number.isFinite(value) && value > 0 ? value : 0;
  const safePadding = positive(padding);
  const geometryZoom = positive(view.zoom);
  const clampAxis = (offset: number, viewportSize: number, contentSize: number) => {
    const available = positive(viewportSize);
    const scaled = positive(positive(contentSize) * geometryZoom);
    const centered = (available - scaled) / 2;
    if (scaled <= available || available === 0) return centered;
    // Keep some content visible even in a viewport narrower than the gutter.
    const gutter = Math.min(safePadding, available / 2);
    const upper = Math.min(gutter, available);
    return Math.max(available - scaled - gutter, Math.min(upper, Number.isFinite(offset) ? offset : centered));
  };

  return {
    zoom: view.zoom,
    x: clampAxis(view.x, viewport.width, content.width),
    y: clampAxis(view.y, viewport.height, content.height),
  };
}
