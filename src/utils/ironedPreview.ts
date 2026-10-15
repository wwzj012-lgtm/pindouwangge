import type { BeadShape } from '../types';
import { drawBeadOnCanvas } from './exportUtils';

/** Occupied and empty view cells must use the same physical-pixel boundaries. */
export function getPreviewCellBounds(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const { a: scaleX, d: scaleY, e, f } = ctx.getTransform();
  // Resolve half-pixel ties consistently despite accumulated zoom/pan error.
  const snap = (value: number) => Math.round(value + 1e-7);
  const left = (snap(x * scaleX + e) - e) / scaleX;
  const top = (snap(y * scaleY + f) - f) / scaleY;
  const right = (snap((x + size) * scaleX + e) - e) / scaleX;
  const bottom = (snap((y + size) * scaleY + f) - f) / scaleY;
  return { left, top, width: right - left, height: bottom - top, scaleX, scaleY };
}

/** Canvas view renderer. Printable exports keep their own bead rendering. */
export function drawPreviewBeadOnCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colorHex: string,
  shape: BeadShape,
  symbolStr?: string | null,
  grid: readonly (readonly (string | null)[])[] = [],
  column: number = 0,
  row: number = 0,
): void {
  if (shape !== 'ironed') {
    drawBeadOnCanvas(ctx, x, y, size, colorHex, shape, symbolStr);
    return;
  }
  if (size <= 0 || (grid.length > 0 && !grid[row]?.[column])) return;

  // Shared device-pixel edges prevent antialiased gaps or mixed-color seams
  // at fractional zoom/pan. This changes drawing only, never grid coordinates.
  const { left, top, width, height, scaleX, scaleY } = getPreviewCellBounds(ctx, x, y, size);

  const above = Boolean(grid[row - 1]?.[column]);
  const below = Boolean(grid[row + 1]?.[column]);
  const before = Boolean(grid[row]?.[column - 1]);
  const after = Boolean(grid[row]?.[column + 1]);
  // Only convex exposed silhouette corners round off. Occupied neighbors,
  // including different colors, join flush; nulls and interior holes stay open.
  // Tiny corners add no useful detail and Chromium can overshoot them while
  // antialiasing. Keep small silhouettes square instead of eroding thin lines.
  const physicalSize = Math.min(width * scaleX, height * scaleY);
  const radius = physicalSize < 20
    ? 0
    : Math.round(physicalSize * 0.1) / Math.min(scaleX, scaleY);
  const radii = [
    !above && !before ? radius : 0,
    !above && !after ? radius : 0,
    !below && !after ? radius : 0,
    !below && !before ? radius : 0,
  ];

  ctx.fillStyle = colorHex;
  if (radii.every(value => value === 0)) {
    ctx.fillRect(left, top, width, height);
  } else {
    // Small curved paths can antialias just outside their nominal bounds.
    // A snapped cell clip guarantees no colored pixels enter adjacent nulls.
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.beginPath();
    ctx.roundRect(left, top, width, height, radii);
    ctx.fill();
    ctx.restore();
  }
}
