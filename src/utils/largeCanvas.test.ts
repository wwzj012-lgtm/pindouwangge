import { describe, expect, it } from 'vitest';
import {
  cancelLargeCanvasRaf,
  fillLargeCanvasConnectedRegion,
  getLargeCanvasPaletteDisplay,
} from '../components/LargeCanvasView';
import {
  clampLargeCanvasFramePosition,
  getMovedLargeCanvasGridRectCandidate,
  getNewLargeCanvasGridRectCandidate,
  getResizedLargeCanvasGridRectCandidate,
  getLargeCanvasGridDimensions,
  getLargeCanvasModeSettings,
  largeCanvasGridRectsOverlap,
  LARGE_CANVAS_MAX_GRID_SIZE,
  LARGE_CANVAS_MAX_SIDES,
  LARGE_CANVAS_MODES,
  snapLargeCanvasGridRect,
  type LargeCanvasConversionMode,
  type LargeCanvasMaxSide,
  type LargeCanvasGridRect,
} from './largeCanvas';

describe('large canvas modes', () => {
  it('exposes the three requested conversion modes', () => {
    expect(LARGE_CANVAS_MODES.map(mode => mode.id)).toEqual(['cartoon', 'photo', 'logo']);
  });

  it('maps each mode to its pipeline and preserves its tuning parameters', () => {
    expect(getLargeCanvasModeSettings('cartoon')).toEqual({
      pipelineOverride: 'cartoon',
      dither: 'none',
      ditherStrength: 0,
      sharpening: 25,
      outlineBoost: true,
    });
    expect(getLargeCanvasModeSettings('photo')).toEqual({
      pipelineOverride: 'photo',
      dither: 'floyd',
      ditherStrength: 0.65,
      sharpening: 15,
      outlineBoost: false,
    });
    expect(getLargeCanvasModeSettings('logo')).toEqual({
      pipelineOverride: 'logo',
      dither: 'none',
      ditherStrength: 0,
      sharpening: 55,
      outlineBoost: true,
    });
  });

  it('falls back to cartoon settings for invalid runtime mode values', () => {
    expect(getLargeCanvasModeSettings('invalid' as LargeCanvasConversionMode)).toEqual({
      pipelineOverride: 'cartoon',
      dither: 'none',
      ditherStrength: 0,
      sharpening: 25,
      outlineBoost: true,
    });
  });

  it('keeps dragged frames inside the large board', () => {
    expect(clampLargeCanvasFramePosition({ x: -40, y: 1400 }, { width: 1880, height: 1120 }, { width: 292, height: 330 })).toEqual({ x: 16, y: 774 });
  });
});

describe('large canvas RAF cleanup', () => {
  it('does not dereference an empty transaction and only cancels real request ids', () => {
    const cancelled: number[] = [];
    expect(() => cancelLargeCanvasRaf(null, rafId => cancelled.push(rafId))).not.toThrow();
    expect(() => cancelLargeCanvasRaf(undefined, rafId => cancelled.push(rafId))).not.toThrow();
    cancelLargeCanvasRaf({ rafId: null }, rafId => cancelled.push(rafId));
    cancelLargeCanvasRaf({ rafId: 42 }, rafId => cancelled.push(rafId));
    expect(cancelled).toEqual([42]);
  });
});

describe('large canvas bucket fill', () => {
  const fillGrid = (grid: (string | null)[][], start: { x: number; y: number }, replacement: string | null): number => {
    const source = grid[start.y]?.[start.x] ?? null;
    return fillLargeCanvasConnectedRegion(
      grid[0]?.length ?? 0,
      grid.length,
      start,
      source,
      replacement,
      (x, y) => grid[y]?.[x] ?? null,
      (x, y, colorId) => { grid[y][x] = colorId; },
    );
  };

  it('fills all 320 by 220 empty-board cells through one bounded four-connected traversal', () => {
    const width = 320;
    const height = 220;
    const grid = Array.from({ length: height }, () => Array<string | null>(width).fill(null));
    const startedAt = performance.now();
    const changed = fillGrid(grid, { x: 0, y: 0 }, 'A1');
    const elapsed = performance.now() - startedAt;

    expect(changed).toBe(width * height);
    expect(grid.every(row => row.every(colorId => colorId === 'A1'))).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  it('does not cross closed borders or diagonal-only connections', () => {
    const grid: (string | null)[][] = [
      ['wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', null, null, null, 'wall'],
      ['wall', null, 'wall', null, 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall'],
    ];

    expect(fillGrid(grid, { x: 1, y: 1 }, 'A1')).toBe(5);
    expect(grid).toEqual([
      ['wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'A1', 'A1', 'A1', 'wall'],
      ['wall', 'A1', 'wall', 'A1', 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall'],
    ]);

    const diagonal: (string | null)[][] = [[null, 'wall'], ['wall', null]];
    expect(fillGrid(diagonal, { x: 0, y: 0 }, 'A1')).toBe(1);
    expect(diagonal).toEqual([['A1', 'wall'], ['wall', null]]);
  });

  it('does not emit a second batch when the source already has the selected color', () => {
    const grid: (string | null)[][] = [['A1']];
    let writes = 0;
    const changed = fillLargeCanvasConnectedRegion(
      1,
      1,
      { x: 0, y: 0 },
      'A1',
      'A1',
      () => grid[0][0],
      () => { writes += 1; },
    );

    expect(changed).toBe(0);
    expect(writes).toBe(0);
  });
});

describe('large canvas palette display', () => {
  it('uses the code and HEX for missing or duplicate color names', () => {
    expect(getLargeCanvasPaletteDisplay('A1', { hex: '#AABBCC', code: 'A1' }))
      .toEqual({ code: 'A1', hex: '#AABBCC', name: null });
    expect(getLargeCanvasPaletteDisplay('A1', { hex: '#AABBCC', code: 'A1', name: 'A1' }))
      .toEqual({ code: 'A1', hex: '#AABBCC', name: null });
  });

  it('preserves a real palette name alongside the code and HEX', () => {
    expect(getLargeCanvasPaletteDisplay('A1', { hex: '#AABBCC', code: 'A1', name: '晨雾蓝' }))
      .toEqual({ code: 'A1', hex: '#AABBCC', name: '晨雾蓝' });
  });
});

describe('large canvas grid dimensions', () => {
  it('keeps the default no-argument size at 100', () => {
    expect(getLargeCanvasGridDimensions(400, 100)).toEqual({ width: 100, height: 25 });
  });

  it.each(LARGE_CANVAS_MAX_SIDES)('fits landscape, portrait, square, and extreme images to the %s-cell preset', (maxSide: LargeCanvasMaxSide) => {
    const landscape = getLargeCanvasGridDimensions(400, 100, maxSide);
    const portrait = getLargeCanvasGridDimensions(100, 400, maxSide);
    const square = getLargeCanvasGridDimensions(512, 512, maxSide);
    const extreme = getLargeCanvasGridDimensions(100000, 1, maxSide);

    expect(landscape).toEqual({ width: maxSide, height: Math.max(1, Math.round(maxSide * 100 / 400)) });
    expect(portrait).toEqual({ width: Math.max(1, Math.round(maxSide * 100 / 400)), height: maxSide });
    expect(square).toEqual({ width: maxSide, height: maxSide });
    expect(extreme).toEqual({ width: maxSide, height: 1 });
    for (const size of [landscape, portrait, square, extreme]) {
      expect(Number.isInteger(size.width)).toBe(true);
      expect(Number.isInteger(size.height)).toBe(true);
      expect(size.width).toBeGreaterThanOrEqual(1);
      expect(size.height).toBeGreaterThanOrEqual(1);
      expect(size.width).toBeLessThanOrEqual(maxSide);
      expect(size.height).toBeLessThanOrEqual(maxSide);
      expect(Math.max(size.width, size.height)).toBe(maxSide);
    }
  });

  it('falls back safely for invalid dimensions and unsupported presets', () => {
    expect(getLargeCanvasGridDimensions(0, Number.NaN, 50)).toEqual({ width: 50, height: 50 });
    expect(getLargeCanvasGridDimensions(-10, Infinity, 75 as unknown as LargeCanvasMaxSide)).toEqual({ width: 100, height: 100 });
  });
});

describe('large canvas integer grid geometry', () => {
  const occupied: LargeCanvasGridRect = { id: 'occupied', x: 10, y: 10, width: 10, height: 10 };
  const active: LargeCanvasGridRect = { id: 'active', x: 30, y: 30, width: 10, height: 10 };

  it('snaps positions and dimensions to integer cells with a 1..100 size range', () => {
    expect(snapLargeCanvasGridRect({ id: 'snap', x: 4.49, y: -2.5, width: 0.49, height: 1000.1 }))
      .toEqual({ id: 'snap', x: 4, y: -2, width: 1, height: 100 });
    expect(snapLargeCanvasGridRect({ id: 'extreme', x: Infinity, y: Number.NaN, width: -Infinity, height: Number.NaN }))
      .toEqual({ id: 'extreme', x: 0, y: 0, width: 1, height: 1 });
  });

  it('allows horizontal and vertical moves that only touch another frame, but rejects one-cell intersections', () => {
    expect(getMovedLargeCanvasGridRectCandidate(active, { x: 20.4, y: 10.4 }, [occupied]))
      .toEqual({ id: 'active', x: 20, y: 10, width: 10, height: 10 });
    expect(getMovedLargeCanvasGridRectCandidate(active, { x: 10.4, y: 20.4 }, [occupied]))
      .toEqual({ id: 'active', x: 10, y: 20, width: 10, height: 10 });
    expect(getMovedLargeCanvasGridRectCandidate(active, { x: 19, y: 10 }, [occupied])).toBeNull();
  });

  it('keeps edge-adjacent frames valid while rejecting overlap and full containment', () => {
    const adjacent: LargeCanvasGridRect = { id: 'adjacent', x: 20, y: 10, width: 3, height: 10 };
    const oneCellOverlap: LargeCanvasGridRect = { id: 'overlap', x: 19, y: 10, width: 1, height: 1 };
    const containing: LargeCanvasGridRect = { id: 'containing', x: 9, y: 9, width: 12, height: 12 };

    expect(largeCanvasGridRectsOverlap(occupied, adjacent)).toBe(false);
    expect(largeCanvasGridRectsOverlap(occupied, oneCellOverlap)).toBe(true);
    expect(largeCanvasGridRectsOverlap(occupied, containing)).toBe(true);
    expect(getNewLargeCanvasGridRectCandidate(adjacent, [occupied])).toEqual(adjacent);
    expect(getNewLargeCanvasGridRectCandidate(oneCellOverlap, [occupied])).toBeNull();
    expect(getNewLargeCanvasGridRectCandidate(containing, [occupied])).toBeNull();
  });

  it('excludes the frame itself when validating a candidate', () => {
    expect(getNewLargeCanvasGridRectCandidate(occupied, [occupied])).toEqual(occupied);
  });

  it('validates snapped resize candidates for all four corners and preserves the opposite edge', () => {
    expect(getResizedLargeCanvasGridRectCandidate(active, 'top-left', { x: 25.4, y: 26.6 }, [occupied]))
      .toEqual({ id: 'active', x: 25, y: 27, width: 15, height: 13 });
    expect(getResizedLargeCanvasGridRectCandidate(active, 'top-right', { x: 44.6, y: 25.4 }, [occupied]))
      .toEqual({ id: 'active', x: 30, y: 25, width: 15, height: 15 });
    expect(getResizedLargeCanvasGridRectCandidate(active, 'bottom-left', { x: 25.4, y: 44.6 }, [occupied]))
      .toEqual({ id: 'active', x: 25, y: 30, width: 15, height: 15 });
    expect(getResizedLargeCanvasGridRectCandidate(active, 'bottom-right', { x: 44.6, y: 44.6 }, [occupied]))
      .toEqual({ id: 'active', x: 30, y: 30, width: 15, height: 15 });
  });

  it('rejects a resize candidate that reaches an occupied cell', () => {
    expect(getResizedLargeCanvasGridRectCandidate(active, 'top-left', { x: 19, y: 19 }, [occupied])).toBeNull();
  });
});
